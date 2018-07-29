import * as $ from 'jquery';
import * as React from 'react';
import './Station.css';

import { MusicPlayer } from './components/MusicPlayer';
import { StationAdmin } from './components/StationAdmin';
import { StationDebug } from './components/StationDebug';
import { IMusicPlayer, PlaybackState } from './music_player';
import SpotifyMusicPlayer from './spotify_music_player';
import { CircularArray, ListenerRole, median, wait } from './util';
import { IWebSocketBridge } from './websocket_bridge';

const SERVER_HEARTBEAT_INTERVAL_MS = 3000;
export const MAX_SEEK_ERROR_MS = 2000;
export const SEEK_OVERCORRECT_MS = 2000;

interface IStationManagerProps {
    userId: number;
    listenerRole: ListenerRole;
    stationTitle: string;
    server: StationServer;
    clientName: string;
    accessToken: string;
    accessTokenExpirationTime: Date;
    debug: boolean;
    initialVolume?: number;
}

interface IStationManagerState {
    taskExecutor: TaskExecutor;
    clientEtag?: Date;
    serverEtag?: Date;
    heartbeatIntervalId?: number;
    musicPlayer: StationMusicPlayer;
    accessToken: string;
    accessTokenExpirationTime: Date;
    clientPlaybackState?: PlaybackState;
    volume?: number;
    isReady: boolean;
    isConnected: boolean;
    errorMessage?: string;
    listeners: IListener[];
    adminActionResponseStatus?: string;
    roundTripTimes: CircularArray<number>;
    clientServerTimeOffsets: CircularArray<number>;
}

export class StationManager extends React.Component<IStationManagerProps, IStationManagerState> {
    constructor(props: IStationManagerProps) {
        super(props);
        this.state = {
            accessToken: props.accessToken,
            accessTokenExpirationTime: props.accessTokenExpirationTime,
            clientServerTimeOffsets: new CircularArray<number>(5),
            isConnected: false,
            isReady: false,
            listeners: [],
            musicPlayer: new StationMusicPlayer(
                new SpotifyMusicPlayer({
                    clientName: this.props.clientName,
                    getOAuthToken: cb => this.getOAuthToken(cb),
                    initialVolume: this.props.initialVolume,
                })),
            roundTripTimes: new CircularArray<number>(5),
            taskExecutor: new TaskExecutor(),
            volume: props.initialVolume,
        }

        this.bindMusicPlayerActions();
        this.bindServerActions();

        this.onMuteButtonClick = this.onMuteButtonClick.bind(this);
        this.onVolumeSliderChange = this.onVolumeSliderChange.bind(this);

        this.onPlayPauseButtonClick = this.onPlayPauseButtonClick.bind(this);
        this.onPreviousTrackButtonClick = this.onPreviousTrackButtonClick.bind(this);
        this.onNextTrackButtonClick = this.onNextTrackButtonClick.bind(this);

        this.onListenerInviteSubmit = this.onListenerInviteSubmit.bind(this);
        this.onListenerDeleteSubmit = this.onListenerDeleteSubmit.bind(this);
    }

    public render() {
        let connectionStatus;
        if (this.state.isConnected) {
            connectionStatus = <span className="bg-success">Connected</span>;
        } else if (this.state.errorMessage) {
            connectionStatus = <span className="bg-danger">Not Connected</span>;
        } else {
            connectionStatus = <span className="bg-info">Not Connected</span>;
        }

        return (
            <div>
                <div className="row">
                    <div className="col">
                        Status: {connectionStatus}<br /><br />
                        {this.state.errorMessage &&
                            <div>
                                <span className="bg-danger">{this.state.errorMessage}</span><br />
                            </div>
                        }

                        <h1>{this.props.stationTitle}</h1>
                        <MusicPlayer
                            listenerRole={this.props.listenerRole}
                            playbackState={this.state.clientPlaybackState}
                            isConnected={this.state.isConnected}
                            isReady={this.state.isReady}
                            volume={this.state.volume}
                            onMuteButtonClick={this.onMuteButtonClick}
                            onVolumeSliderChange={this.onVolumeSliderChange}
                            onPlayPauseButtonClick={this.onPlayPauseButtonClick}
                            onPreviousTrackButtonClick={this.onPreviousTrackButtonClick}
                            onNextTrackButtonClick={this.onNextTrackButtonClick}
                        />
                    </div>
                    {((this.props.listenerRole & ListenerRole.Admin) === ListenerRole.Admin) &&
                        <div className="col">
                            <StationAdmin
                                isReady={this.state.isReady}
                                listeners={this.state.listeners}
                                responseStatus={this.state.adminActionResponseStatus}
                                onListenerInviteSubmit={this.onListenerInviteSubmit}
                                onListenerDeleteSubmit={this.onListenerDeleteSubmit}
                            />
                        </div>
                    }
                </div>
                <div className="row">
                    {this.props.debug &&
                        <StationDebug
                            roundTripTimes={this.state.roundTripTimes}
                            clientServerTimeOffsets={this.state.clientServerTimeOffsets}
                        />}
                </div>
            </div>
        );
    }

    public getAdjustedPlaybackPosition(serverState: PlaybackState): number {
        const position = serverState.raw_position_ms;
        let adjustment = 0;
        if (!serverState.paused) {
            const serverTimeOffset = this.getMedianClientServerTimeOffset();
            adjustment = ((new Date()).getTime() - (serverState.sample_time.getTime() - serverTimeOffset));
        }

        return (position + adjustment);
    }

    // Test utilities

    public getMusicPlayer(): IMusicPlayer {
        return this.state.musicPlayer.musicPlayer;
    }

    private bindMusicPlayerActions() {
        this.state.musicPlayer.on('ready', () => {
            this.startSteadyState();

            this.setState({
                isConnected: true,
                isReady: true,
            });
        });

        this.state.musicPlayer.on('initialization_error', ({ message }) => {
            this.setState({
                errorMessage: message,
                isConnected: false,
            })
        });

        this.state.musicPlayer.on('account_error', ({ message }) => {
            this.setState({
                errorMessage: message,
                isConnected: false,
            })
        });
    }

    private onMuteButtonClick() {
        this.state.musicPlayer.muteUnmuteVolume().then(newVolume => {
            this.setState({
                volume: newVolume,
            });
        });
    }

    private onVolumeSliderChange(newVolume: number) {
        this.state.musicPlayer.setVolume(newVolume).then(() => {
            this.setState({
                volume: newVolume,
            });
        });
    }

    private onPlayPauseButtonClick() {
        this.state.musicPlayer.togglePlay();
    }

    private onPreviousTrackButtonClick() {
        this.state.musicPlayer.previousTrack();
    }

    private onNextTrackButtonClick() {
        this.state.musicPlayer.nextTrack();
    }

    private onListenerInviteSubmit(username: string) {
        this.state.taskExecutor.push(() => this.inviteListener(username));
    }

    private onListenerDeleteSubmit(listenerId: number) {
        this.state.taskExecutor.push(() => this.deleteListener(listenerId));
    }

    private bindServerActions() {
        this.props.server.on('error', (error: ServerError, message: string) => {
            console.error(`${error}: ${message}`);
        });
    }

    private bindSteadyStateActions() {
        this.state.musicPlayer.on('player_state_changed', clientState => {
            if (clientState) {
                if (this.state.clientEtag && (clientState.sample_time <= this.state.clientEtag)) {
                    return;
                }

                this.setState({
                    clientPlaybackState: clientState,
                });
            }
        });

        this.props.server.on('playback_state_changed', (serverState: PlaybackState) => {
            this.state.taskExecutor.push(() => this.applyServerPlaybackState(serverState));
        });
    }

    private startSteadyState() {
        this.bindSteadyStateActions();
        // tslint:disable-next-line:no-bitwise
        if ((this.props.listenerRole & ListenerRole.Admin) === ListenerRole.Admin) {
            this.state.taskExecutor.push(() => this.showListeners());
        }

        this.state.taskExecutor.push(() => this.calculatePing());
        this.state.taskExecutor.push(() => this.syncServerPlaybackState());
        this.enableHeartbeat();
    }

    private enableHeartbeat() {
        const heartbeatIntervalId = window.setInterval(() => {
            this.state.taskExecutor.push(() => this.calculatePing());
            // tslint:disable-next-line:no-bitwise
            if ((this.props.listenerRole & ListenerRole.DJ) === ListenerRole.DJ) {
                this.state.taskExecutor.push(() => this.updateServerPlaybackState());
            }
        }, SERVER_HEARTBEAT_INTERVAL_MS);

        this.setState({
            heartbeatIntervalId
        });
    }

    private async updateServerPlaybackState(playbackState?: PlaybackState): Promise<void> {
        if (!playbackState) {
            const tempPlaybackState = await this.state.musicPlayer.getCurrentState();
            playbackState = (tempPlaybackState ? tempPlaybackState : undefined);
        }

        if (!playbackState || (this.state.clientEtag && (playbackState.sample_time <= this.state.clientEtag))) {
            return;
        }

        // Convert sample time from client time to server time
        playbackState.sample_time = new Date(playbackState.sample_time.getTime() + this.getMedianClientServerTimeOffset());

        try {
            const serverState: PlaybackState = await Promise.race([this.props.server.sendPlaybackState(playbackState), timeout(5000)]);
            await this.applyServerPlaybackState(serverState);
        } catch (e) {
            console.error(e);
            this.state.taskExecutor.clear();
            this.state.taskExecutor.push(() => this.syncServerPlaybackState());
        }
    }

    private async syncServerPlaybackState(): Promise<void> {
        const serverState = await Promise.race([this.props.server.getPlaybackState(), timeout(5000)]);
        if (serverState) {
            return this.applyServerPlaybackState(serverState);
        }
    }

    private async calculatePing(): Promise<void> {
        const pong = await Promise.race([this.props.server.sendPingRequest(), timeout(5000)]);
        this.adjustServerTimeOffset(pong.startTime, pong.serverTime, new Date());
    }

    private getOAuthToken(cb: (accessToken: string) => void) {
        let refreshTokenIfNeeded = Promise.resolve(this.props.accessToken);
        if ((new Date()) > this.props.accessTokenExpirationTime) {
            refreshTokenIfNeeded = this.refreshOAuthToken();
        }

        refreshTokenIfNeeded.then(accessToken => cb(accessToken));
    }

    private async refreshOAuthToken(): Promise<string> {
        const response = await Promise.race([this.props.server.refreshOAuthToken(this.props.userId), timeout(5000)]);
        this.setState({
            accessToken: response.accessToken,
            accessTokenExpirationTime: response.accessTokenExpirationTime,
        });
        return response.accessToken;
    }

    private async applyServerPlaybackState(serverState: PlaybackState): Promise<void> {
        if (this.state.serverEtag && (serverState.etag! <= this.state.serverEtag)) {
            return;
        }

        try {
            let clientState = await this.state.musicPlayer.getCurrentState();
            if (!clientState || (clientState.context_uri !== serverState.context_uri) ||
                (clientState.current_track_uri !== serverState.current_track_uri)) {
                await this.state.musicPlayer.play(serverState.context_uri, serverState.current_track_uri);
            }

            await Promise.race([retry(() => this.currentTrackReady(serverState)), timeout(5000)]);

            clientState = await this.state.musicPlayer.getCurrentState();
            if (!clientState) {
                throw new Error('Spotify not ready');
            }

            if (serverState.paused) {
                if (clientState.paused) {
                    await this.state.musicPlayer.pause();
                }

                await this.state.musicPlayer.seek(serverState.raw_position_ms);
            } else {
                const localPosition = clientState.raw_position_ms;
                const serverPosition = this.getAdjustedPlaybackPosition(serverState);
                if (Math.abs(localPosition - serverPosition) > MAX_SEEK_ERROR_MS) {
                    const newLocalPosition = serverPosition + SEEK_OVERCORRECT_MS;
                    console.log(`Playback adjustment needed: local: ${localPosition}, server: ${serverPosition}, new local: ${newLocalPosition}`);
                    await this.state.musicPlayer.seek(newLocalPosition);
                    await Promise.race([retry(() => this.currentPositionReady(newLocalPosition)), timeout(5000)]);
                    const serverPositionAfterSeek = this.getAdjustedPlaybackPosition(serverState);
                    if (((newLocalPosition > serverPositionAfterSeek) && (newLocalPosition < (serverPositionAfterSeek + MAX_SEEK_ERROR_MS)))) {
                        await this.state.musicPlayer.freeze(localPosition - serverPositionAfterSeek);
                    } else {
                        await this.state.musicPlayer.resume();
                    }
                } else if (clientState.paused) {
                    await this.state.musicPlayer.resume();
                }
            }

            clientState = await this.state.musicPlayer.getCurrentState();
            if (!clientState) {
                throw new Error('Spotify not ready');
            }

            this.setState({
                clientEtag: clientState.sample_time,
                serverEtag: serverState.etag,
            });
        } catch (e) {
            console.error(e);
            this.state.taskExecutor.push(() => this.syncServerPlaybackState());
        }
    }

    private async showListeners(): Promise<void> {
        const listeners = await Promise.race([this.props.server.getListeners(), timeout(5000)]);
        this.setState({ listeners });
    }

    private async inviteListener(username: string): Promise<void> {
        try {
            const listener = await Promise.race([this.props.server.inviteListener(username, false, false), timeout(5000)]);

            this.setState(prevState => ({
                adminActionResponseStatus: formatListenerInviteResult(username),
                listeners: prevState.listeners.concat([listener]),
            }));
        } catch (e) {
            const result = ((e instanceof ListenerAlreadyExistsError) ? ServerError.ListenerAlreadyExistsError
                : ServerError.Unknown);
            this.setState({
                adminActionResponseStatus: formatListenerInviteResult(username, result),
            });
        }
    }

    private async deleteListener(listenerId: number): Promise<void> {
        try {
            await Promise.race([this.props.server.deleteListener(listenerId), timeout(5000)]);
            this.setState(prevState => ({
                listeners: prevState.listeners.filter((listener: IListener) => (listener.id !== listenerId)),
            }));
        } catch (e) {
            this.setState({
                adminActionResponseStatus: e.message,
            });
        }
    }

    private async currentTrackReady(expectedState: PlaybackState): Promise<boolean> {
        const state = await this.state.musicPlayer.getCurrentState();
        if (state) {
            return state.current_track_uri === expectedState.current_track_uri;
        } else {
            return false;
        }
    }

    private async currentPositionReady(expectedPosition: number): Promise<boolean> {
        const state = await this.state.musicPlayer.getCurrentState();
        if (state) {
            return state.raw_position_ms >= expectedPosition;
        } else {
            return false;
        }
    }

    private getMedianClientServerTimeOffset(): number {
        console.assert(this.state.clientServerTimeOffsets.length > 0);
        return median(this.state.clientServerTimeOffsets.entries());
    }

    private adjustServerTimeOffset(startTime: Date, serverTime: Date, currentTime: Date) {
        const roundTripTimes = this.state.roundTripTimes;
        roundTripTimes.push(currentTime.getTime() - startTime.getTime());

        const medianOneWayTime = Math.round(median(roundTripTimes.entries()) / 2);
        const clientServerTimeOffset = ((serverTime.getTime() + medianOneWayTime) - currentTime.getTime());
        const clientServerTimeOffsets = this.state.clientServerTimeOffsets;
        clientServerTimeOffsets.push(clientServerTimeOffset);

        this.setState({
            clientServerTimeOffsets,
            roundTripTimes,
        });
    }
}

interface IPongResponse {
    startTime: Date;
    serverTime: Date;
}

interface IOAuthTokenResponse {
    accessToken: string;
    accessTokenExpirationTime: Date;
}

export enum ServerError {
    ClientError,
    ListenerAlreadyExistsError,
    Unknown,
}

class ListenerAlreadyExistsError extends Error { }

export interface IListener {
    id: number;
    username: string,
    stationId: number,
    isAdmin: boolean,
    isDJ: boolean,
}

export class StationServer {
    private observers = new Map([
        ['error', $.Callbacks()],
        ['join', $.Callbacks()],
        ['pong', $.Callbacks()],
        ['playback_state_changed', $.Callbacks()],
    ]);

    constructor(private stationId: number, private csrftoken: string, private webSocketBridge: IWebSocketBridge) {
        // Correctly decide between ws:// and wss://
        const wsScheme = ((window.location.protocol === 'https:') ? 'wss' : 'ws');
        const wsBaseUrl = wsScheme + '://' + window.location.host;
        const wsUrl = `${wsBaseUrl}/api/stations/${stationId}/stream/`;
        this.webSocketBridge.connect(wsUrl);
        this.bindWebSocketBridgeActions();
    }

    public bindWebSocketBridgeActions() {
        this.webSocketBridge.listen(action => { this.onMessage(action); });
    }

    // Public events
    // playback_state_change: (state: PlaybackState)
    // error: (error: ServerError, message: string)
    public on(eventName: string, cb: any) {
        this.observers.get(eventName)!.add(cb);
    }

    public onOnce(eventName: string, cb: any) {
        const cbWrapper = (...args: any[]) => {
            this.removeListener(eventName, cbWrapper);
            cb(...args);
        };
        this.on(eventName, cbWrapper);
    }

    public removeListener(eventName: string, cb?: any) {
        if (cb) {
            this.observers.get(eventName)!.remove(cb);
        } else {
            this.observers.get(eventName)!.empty();
        }
    }

    public sendPingRequest(): Promise<IPongResponse> {
        return new Promise(resolve => {
            this.onOnce('pong', resolve);
            this.webSocketBridge.send({
                'command': 'ping',
                'start_time': new Date(),
            });
        });
    }

    public async refreshOAuthToken(userId: number): Promise<IOAuthTokenResponse> {
        const url = `/api/v1/users/${userId}/accesstoken/refresh/`;
        const response = await fetch(url, {
            credentials: 'include',
            method: 'POST',
        });

        if (response.ok) {
            const data = await response.json();
            return {
                accessToken: data.token,
                accessTokenExpirationTime: new Date(data.token_expiration_time),
            };
        } else {
            throw new Error(await response.text());
        }
    }

    public async sendPlaybackState(playbackState: PlaybackState): Promise<PlaybackState> {
        const url = `/api/v1/stations/${this.stationId}/`;

        const headers = new Headers();
        headers.append('X-CSRFToken', this.csrftoken);
        headers.append('Content-Type', 'application/json');

        const response = await fetch(url, {
            body: JSON.stringify({
                'playbackstate': playbackState
            }),
            credentials: 'include',
            headers,
            method: 'PATCH',
        });

        if (response.status === 200) {
            const data = await response.json();
            return createPlaybackStateFromServer(data.playbackstate);
        } else if (response.status === 412) {
            throw new Error('Conditional station playback state update failed');
        } else {
            throw new Error(await response.text());
        }
    }

    public async getPlaybackState(): Promise<PlaybackState | undefined> {
        const url = `/api/v1/stations/${this.stationId}/`;
        const response = await fetch(url, {
            credentials: 'include',
        });

        if (response.ok) {
            const data = await response.json();
            if (data.playbackstate) {
                return createPlaybackStateFromServer(data.playbackstate);
            } else {
                return undefined;
            }
        } else {
            throw new Error(await response.text());
        }
    }

    public async getListeners(): Promise<IListener[]> {
        const url = `/api/v1/stations/${this.stationId}/listeners/`;
        const response = await fetch(url, {
            credentials: 'include',
        });

        if (response.ok) {
            const data = await response.json();
            return data.map(createListenerFromServer);
        } else {
            throw new Error(await response.text());
        }
    }

    public async inviteListener(username: string, isAdmin: boolean, isDJ: boolean): Promise<IListener> {
        const url = `/api/v1/stations/${this.stationId}/listeners/`;
        const headers = new Headers();
        headers.append('X-CSRFToken', this.csrftoken);
        headers.append('Content-Type', 'application/json');

        const response = await fetch(url, {
            body: JSON.stringify({
                'is_admin': isAdmin,
                'is_dj': isDJ,
                'station': this.stationId,
                'user': username,
            }),
            credentials: 'include',
            headers,
            method: 'POST',
        });

        const data = await response.json();
        if (response.ok) {
            return createListenerFromServer(data as IServerListener);
        } else if (data.non_field_errors.some((s: string) => (s === "The fields user, station must make a unique set."))) {
            throw new ListenerAlreadyExistsError();
        } else {
            throw new Error(await response.text());
        }
    }

    public async deleteListener(listenerId: number): Promise<void> {
        const url = `/api/v1/stations/${this.stationId}/listeners/${listenerId}/`;

        const headers = new Headers();
        headers.append('X-CSRFToken', this.csrftoken);

        const response = await fetch(url, {
            credentials: 'include',
            headers,
            method: 'DELETE',
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }
    }

    private onMessage(action: any) {
        console.log('Received: ', action);
        if (action.error) {
            this.observers.get('error')!.fire(serverErrorFromString(action.error), action.message);
        } else if (action.join) {
            this.observers.get('join')!.fire(action.join);
        } else if (action.type === 'playback_state_changed') {
            const serverPlaybackState = createPlaybackStateFromServer(action.playbackstate);
            this.observers.get(action.type)!.fire(serverPlaybackState);
        } else if (action.type === 'pong') {
            const pong: IPongResponse = {
                serverTime: new Date(action.server_time),
                startTime: new Date(action.start_time),
            };
            this.observers.get(action.type)!.fire(pong);
        }
    }
}

function serverErrorFromString(error: string): ServerError {
    if (error === 'client_error') {
        return ServerError.ClientError;
    } else {
        console.assert();
        throw Error(`Unknown server error: ${error}`);
    }
}

function createPlaybackStateFromServer(state: any) {
    return new PlaybackState(
        state.context_uri,
        state.current_track_uri,
        state.paused,
        state.raw_position_ms,
        new Date(state.sample_time),
        new Date(state.last_updated_time));
}

export interface IServerListener {
    id: number;
    user: string;
    station: number;
    is_admin: boolean;
    is_dj: boolean;
}

function createListenerFromServer(listener: IServerListener): IListener {
    return {
        'id': listener.id,
        'isAdmin': listener.is_admin,
        'isDJ': listener.is_dj,
        'stationId': listener.station,
        'username': listener.user,
    }
}

export class StationMusicPlayer {
    public static getCachedVolume() {
        const value = localStorage.getItem('musicVolume');
        return ((value !== null) ? parseFloat(value) : 0.8);
    }

    public static setCachedVolume(volume: number) {
        localStorage.setItem('musicVolume', volume.toString());
    }

    private volumeBeforeMute = 0.8;

    constructor(public musicPlayer: IMusicPlayer) {
        this.musicPlayer.connect();
    }

    public on(eventName: string, cb: (...args: any[]) => void) {
        this.musicPlayer.on(eventName, cb);
    }

    public removeListener(eventName: string) {
        this.musicPlayer.removeListener(eventName);
    }

    public getCurrentState(): Promise<PlaybackState | null> { return this.musicPlayer.getCurrentState(); }

    public getVolume(): Promise<number> { return this.musicPlayer.getVolume(); }

    public setVolume(value: number): Promise<void> {
        StationMusicPlayer.setCachedVolume(value);
        return this.musicPlayer.setVolume(value);
    }

    public async muteUnmuteVolume(): Promise<number> {
        const volume = await this.getVolume();

        // BUG: Spotify API returns null instead of 0.0.
        // Tracked by https://github.com/rgardner/dancingtogether/issues/12

        let newVolume = 0.0;
        if ((volume === 0.0) || (volume === null)) {
            // currently muted, so unmute
            newVolume = this.volumeBeforeMute;
        } else {
            // currently unmuted, so mute and store current volume for restore
            this.volumeBeforeMute = volume;
            newVolume = 0.0;
        }

        await this.setVolume(newVolume);
        return newVolume;
    }

    public play(contextUri: string, currentTrackUri: string): Promise<void> {
        return this.musicPlayer.play(contextUri, currentTrackUri);
    }

    public pause(): Promise<void> { return this.musicPlayer.pause(); }
    public resume(): Promise<void> { return this.musicPlayer.resume(); }
    public togglePlay(): Promise<void> { return this.musicPlayer.togglePlay(); }

    public async freeze(duration: number): Promise<void> {
        await this.musicPlayer.pause();
        await wait(duration);
        await this.musicPlayer.resume();
    }

    public seek(positionMS: number): Promise<void> { return this.musicPlayer.seek(positionMS); }

    public previousTrack(): Promise<void> { return this.musicPlayer.previousTrack(); }
    public nextTrack(): Promise<void> { return this.musicPlayer.nextTrack(); }
}

class TaskExecutor {
    private tasks: Promise<any> = Promise.resolve();
    private tasksInFlight: number = 0;

    public push(task: (...args: any[]) => Promise<any>) {
        if (this.tasksInFlight === 0) {
            // why reset tasks here? in case the native promises implementation isn't
            // smart enough to garbage collect old completed tasks in the chain.
            this.clear();
        }
        this.tasksInFlight += 1;
        this.tasks.then(task).then(() => {
            this.tasksInFlight -= 1;
        })
    }

    public clear() {
        this.tasksInFlight = 0;
        this.tasks = Promise.resolve();
    }
}

function timeout(ms: number): Promise<never> {
    // @ts-ignore: Type '{}' is not assignable to type 'never'
    return wait(ms).then(Promise.reject);
}

async function retry(condition: () => Promise<boolean>): Promise<void> {
    const b = await condition();
    if (!b) {
        await wait(250);
        await retry(condition);
    }
}

export function formatListenerInviteResult(username: string, error?: ServerError): string {
    if (!error) {
        return `${username} is now a listener`;
    } else if (error === ServerError.ListenerAlreadyExistsError) {
        return `Error: ${username} is already a listener`;
    } else {
        return `An error occurred while inviting ${username}`;
    }
}
