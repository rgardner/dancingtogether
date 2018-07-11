import * as $ from 'jquery';
import { CircularArray, ListenerRole, median, wait } from './util';
import { MusicPlayer, PlaybackState, createSpotifyMusicPlayer } from './music_player';
import { ChannelWebSocketBridge, WebSocketBridge } from './websocket_bridge';
import { ViewManager } from './station_view';

const SERVER_HEARTBEAT_INTERVAL_MS = 3000;
export const MAX_SEEK_ERROR_MS = 2000;
export const SEEK_OVERCORRECT_MS = 2000;

interface AppData {
    userId: number;
    stationId: number;
    stationTitle: string;
    userIsDJ: boolean;
    userIsAdmin: boolean;
    spotifyConnectPlayerName: string;
    accessToken: string;
    accessTokenExpirationTime: Date;
    debug: boolean;
}

declare const APP_DATA: AppData;

window.onSpotifyWebPlaybackSDKReady = () => {
    let listenerRole = ListenerRole.None;
    if (APP_DATA.userIsDJ) listenerRole |= ListenerRole.DJ;
    if (APP_DATA.userIsAdmin) listenerRole |= ListenerRole.Admin;
    let webSocketBridge = new ChannelWebSocketBridge();

    new StationManager(
        APP_DATA.userId,
        listenerRole,
        APP_DATA.stationTitle,
        new StationServer(APP_DATA.stationId, getCrossSiteRequestForgeryToken(), webSocketBridge),
        APP_DATA.spotifyConnectPlayerName,
        APP_DATA.accessToken,
        APP_DATA.accessTokenExpirationTime,
        APP_DATA.debug,
        StationMusicPlayer.getCachedVolume(),
    );
};

export class StationManager {
    taskExecutor = new TaskExecutor();
    clientEtag?: Date;
    serverEtag?: Date;
    heartbeatIntervalId?: number;
    musicPlayer: StationMusicPlayer;
    viewManager: ViewManager;
    roundTripTimes = new CircularArray<number>(5);
    clientServerTimeOffsets = new CircularArray<number>(5);

    constructor(
        private userId: number, private listenerRole: ListenerRole,
        stationTitle: string, private server: StationServer,
        clientName: string, private accessToken: string,
        private accessTokenExpirationTime: Date, debug: boolean,
        initialVolume?: number) {
        this.musicPlayer = new StationMusicPlayer(
            createSpotifyMusicPlayer({
                clientName: clientName,
                getOAuthToken: cb => this.getOAuthToken(cb),
                initialVolume: initialVolume,
            }));
        this.viewManager = new ViewManager(listenerRole, stationTitle, debug);
        this.bindMusicPlayerActions();
        this.bindServerActions();
        this.bindViewActions();
    }

    bindMusicPlayerActions() {
        this.musicPlayer.on('ready', () => {
            this.startSteadyState();

            this.viewManager.stationView.setState(() => ({ isConnected: true }));
            this.viewManager.listenerView.setState(() => ({ isReady: true }));
            this.musicPlayer.getVolume().then(volume => {
                this.viewManager.listenerView.setState(() => ({ volume: volume }));
            });
            this.viewManager.djView.setState(() => ({ isReady: true }));
        });

        this.musicPlayer.on('initialization_error', ({ message }) => {
            this.viewManager.stationView.setState(() => ({ isConnected: false, errorMessage: message }));
        });

        this.musicPlayer.on('account_error', ({ message }) => {
            this.viewManager.stationView.setState(() => ({ isConnected: false, errorMessage: message }));
        });
    }

    bindServerActions() {
        this.server.on('error', (error: ServerError, message: string) => {
            console.error(`${error}: ${message}`);
        });
    }

    bindViewActions() {
        this.viewManager.adminView.on('invite_listener', (username: string) => {
            this.taskExecutor.push(() => this.inviteListener(username));
        });
    }

    bindSteadyStateActions() {
        this.musicPlayer.on('player_state_changed', clientState => {
            if (clientState) {
                if (this.clientEtag && (clientState.sample_time <= this.clientEtag)) {
                    return;
                }

                this.viewManager.stationView.setState(() => ({ playbackState: clientState }));
                this.viewManager.musicPositionView.setState(() => ({ paused: clientState.paused, positionMS: clientState.raw_position_ms }));
                this.viewManager.djView.setState(() => ({ playbackState: clientState }));
            }
        });

        this.server.on('playback_state_changed', (serverState: PlaybackState) => {
            this.taskExecutor.push(() => this.applyServerPlaybackState(serverState));
        });

        this.viewManager.listenerView.on('muteButtonClick', () => {
            this.musicPlayer.muteUnmuteVolume().then(newVolume => {
                this.viewManager.listenerView.setState(() => ({ volume: newVolume }));
            });
        });

        this.viewManager.listenerView.on('volumeSliderChange', (newVolume: number) => {
            this.musicPlayer.setVolume(newVolume).then(() => {
                this.viewManager.listenerView.setState(() => ({ volume: newVolume }));
            });
        });

        this.viewManager.djView.on('playPauseButtonClick', () => {
            this.musicPlayer.togglePlay();
        });

        this.viewManager.djView.on('previousTrackButtonClick', () => {
            this.musicPlayer.previousTrack();
        });

        this.viewManager.djView.on('nextTrackButtonClick', () => {
            this.musicPlayer.nextTrack();
        });
    }

    startSteadyState() {
        this.bindSteadyStateActions();
        if ((this.listenerRole & ListenerRole.Admin) === ListenerRole.Admin) {
            this.taskExecutor.push(() => this.showListeners());
        }

        this.taskExecutor.push(() => this.calculatePing());
        this.taskExecutor.push(() => this.syncServerPlaybackState());
        this.enableHeartbeat();
    }

    stopSteadyState() {
        this.musicPlayer.removeListener('player_state_changed');
        this.server.removeListener('playback_state_changed');
        this.viewManager.listenerView.removeListener('muteButtonClick');
        this.viewManager.listenerView.removeListener('volumeSliderChange');
        this.viewManager.djView.removeListener('playPauseButtonClick');
        this.viewManager.djView.removeListener('previousTrackButtonClick');
        this.viewManager.djView.removeListener('nextTrackButtonClick');

        this.disableHeartbeat();
        this.taskExecutor.clear();
    }

    enableHeartbeat() {
        this.heartbeatIntervalId = window.setInterval(() => {
            this.taskExecutor.push(() => this.calculatePing());
            if ((this.listenerRole & ListenerRole.DJ) === ListenerRole.DJ) {
                this.taskExecutor.push(() => this.updateServerPlaybackState());
            }
        }, SERVER_HEARTBEAT_INTERVAL_MS);
    }

    disableHeartbeat() {
        if (this.heartbeatIntervalId) {
            window.clearInterval(this.heartbeatIntervalId);
        }
    }

    async updateServerPlaybackState(playbackState?: PlaybackState): Promise<void> {
        if (!playbackState) {
            const tempPlaybackState = await this.musicPlayer.getCurrentState();
            playbackState = (tempPlaybackState ? tempPlaybackState : undefined);
        }

        if (!playbackState || (this.clientEtag && (playbackState.sample_time <= this.clientEtag))) {
            return;
        }

        // Convert sample time from client time to server time
        playbackState.sample_time = new Date(playbackState.sample_time.getTime() + this.getMedianClientServerTimeOffset());

        try {
            const serverState: PlaybackState = await Promise.race([this.server.sendPlaybackState(playbackState, this.serverEtag), timeout(5000)]);
            await this.applyServerPlaybackState(serverState);
        } catch (e) {
            console.error(e);
            this.taskExecutor.clear();
            this.taskExecutor.push(() => this.syncServerPlaybackState());
        }
    }

    async syncServerPlaybackState(): Promise<void> {
        const serverState = await Promise.race([this.server.getPlaybackState(), timeout(5000)]);
        if (serverState) {
            return this.applyServerPlaybackState(serverState);
        }
    }

    async calculatePing(): Promise<void> {
        const pong = await Promise.race([this.server.sendPingRequest(), timeout(5000)]);
        this.adjustServerTimeOffset(pong.startTime, pong.serverTime, new Date());
    }

    getOAuthToken(cb: (accessToken: string) => void) {
        let refreshTokenIfNeeded = Promise.resolve(this.accessToken);
        if ((new Date()) > this.accessTokenExpirationTime) {
            refreshTokenIfNeeded = this.refreshOAuthToken();
        }

        refreshTokenIfNeeded.then(accessToken => cb(accessToken));
    }

    async refreshOAuthToken(): Promise<string> {
        const response = await Promise.race([this.server.refreshOAuthToken(this.userId), timeout(5000)]);
        this.accessToken = response.accessToken;
        this.accessTokenExpirationTime = response.accessTokenExpirationTime;
        return this.accessToken;
    }

    async applyServerPlaybackState(serverState: PlaybackState): Promise<void> {
        if (this.serverEtag && (<Date>serverState.etag <= this.serverEtag)) {
            return;
        }

        try {
            let clientState = await this.musicPlayer.getCurrentState();
            if (!clientState || (clientState.context_uri !== serverState.context_uri) ||
                (clientState.current_track_uri !== serverState.current_track_uri)) {
                await this.musicPlayer.play(serverState.context_uri, serverState.current_track_uri);
            }

            await Promise.race([retry(() => this.currentTrackReady(serverState)), timeout(5000)]);

            clientState = await this.musicPlayer.getCurrentState();
            if (!clientState) {
                throw new Error('Spotify not ready');
            }

            if (serverState.paused) {
                if (clientState.paused) {
                    await this.musicPlayer.pause();
                }

                await this.musicPlayer.seek(serverState.raw_position_ms);
            } else {
                const localPosition = clientState.raw_position_ms;
                const serverPosition = this.getAdjustedPlaybackPosition(serverState);
                if (Math.abs(localPosition - serverPosition) > MAX_SEEK_ERROR_MS) {
                    const newLocalPosition = serverPosition + SEEK_OVERCORRECT_MS;
                    console.log(`Playback adjustment needed: local: ${localPosition}, server: ${serverPosition}, new local: ${newLocalPosition}`);
                    await this.musicPlayer.seek(newLocalPosition);
                    await Promise.race([retry(() => this.currentPositionReady(newLocalPosition)), timeout(5000)]);
                    const serverPositionAfterSeek = this.getAdjustedPlaybackPosition(serverState);
                    if (((newLocalPosition > serverPositionAfterSeek) && (newLocalPosition < (serverPositionAfterSeek + MAX_SEEK_ERROR_MS)))) {
                        await this.musicPlayer.freeze(localPosition - serverPositionAfterSeek);
                    } else {
                        await this.musicPlayer.resume();
                    }
                } else if (clientState.paused) {
                    await this.musicPlayer.resume();
                }
            }

            clientState = await this.musicPlayer.getCurrentState();
            if (!clientState) {
                throw new Error('Spotify not ready');
            }

            this.clientEtag = clientState.sample_time;
            this.serverEtag = serverState.etag;
        } catch (e) {
            console.error(e);
            this.taskExecutor.push(() => this.syncServerPlaybackState());
        }
    }

    showListeners(): Promise<void> {
        return Promise.race([this.server.getListeners(), timeout(5000)])
            .then(listeners => {
                this.viewManager.adminView.setState(() => ({
                    listeners: listeners,
                }));
            });
    }

    async inviteListener(username: string): Promise<void> {
        try {
            const listener = await Promise.race([this.server.inviteListener(username, false, false), timeout(5000)]);
            this.viewManager.adminView.showListenerInviteResult(username);
            this.viewManager.adminView.setState((prevState: any) => ({
                listeners: prevState.listeners.concat([listener]),
            }));
        } catch (e) {
            const result = ((e instanceof ListenerAlreadyExistsError) ? ServerError.ListenerAlreadyExistsError
                : ServerError.Unknown);
            this.viewManager.adminView.showListenerInviteResult(username, result);
        }
    }

    async currentTrackReady(expectedState: PlaybackState): Promise<boolean> {
        const state = await this.musicPlayer.getCurrentState();
        if (state) {
            return state.current_track_uri === expectedState.current_track_uri;
        } else {
            return false;
        }
    }

    async currentPositionReady(expectedPosition: number): Promise<boolean> {
        const state = await this.musicPlayer.getCurrentState();
        if (state) {
            return state.raw_position_ms >= expectedPosition;
        } else {
            return false;
        }
    }

    getMedianClientServerTimeOffset(): number {
        console.assert(this.clientServerTimeOffsets.length > 0);
        return median(this.clientServerTimeOffsets.entries());
    }

    getAdjustedPlaybackPosition(serverState: PlaybackState): number {
        const position = serverState.raw_position_ms;
        let adjustment = 0;
        if (!serverState.paused) {
            const serverTimeOffset = this.getMedianClientServerTimeOffset();
            adjustment = ((new Date()).getTime() - (serverState.sample_time.getTime() - serverTimeOffset));
        }

        return (position + adjustment);
    }

    adjustServerTimeOffset(startTime: Date, serverTime: Date, currentTime: Date) {
        this.roundTripTimes.push(currentTime.getTime() - startTime.getTime());
        const medianOneWayTime = Math.round(median(this.roundTripTimes.entries()) / 2);
        const clientServerTimeOffset = ((serverTime.getTime() + medianOneWayTime) - currentTime.getTime());
        this.clientServerTimeOffsets.push(clientServerTimeOffset);
        this.viewManager.debugView.setState(() => ({
            roundTripTimes: this.roundTripTimes,
            clientServerTimeOffsets: this.clientServerTimeOffsets,
        }));
    }
}

interface PongResponse {
    startTime: Date;
    serverTime: Date;
}

interface OAuthTokenResponse {
    accessToken: string;
    accessTokenExpirationTime: Date;
}

export enum ServerError {
    ClientError,
    ListenerAlreadyExistsError,
    Unknown,
}

class ListenerAlreadyExistsError extends Error { }

export interface Listener {
    username: string,
    stationId: number,
    isAdmin: boolean,
    isDJ: boolean,
}

export class StationServer {
    requestId = 0;
    observers = new Map([
        ['error', $.Callbacks()],
        ['join', $.Callbacks()],
        ['pong', $.Callbacks()],
        ['playback_state_changed', $.Callbacks()],
    ]);

    constructor(private stationId: number, private csrftoken: string, private webSocketBridge: WebSocketBridge) {
        // Correctly decide between ws:// and wss://
        const wsScheme = ((window.location.protocol === 'https:') ? 'wss' : 'ws');
        const wsBaseUrl = wsScheme + '://' + window.location.host;
        const wsUrl = `${wsBaseUrl}/api/stations/${stationId}/stream/`;
        this.webSocketBridge.connect(wsUrl);
        this.bindWebSocketBridgeActions();
    }

    bindWebSocketBridgeActions() {
        this.webSocketBridge.listen(action => { this.onMessage(action); });
    }

    // Public events
    // playback_state_change: (state: PlaybackState)
    // error: (error: ServerError, message: string)
    on(eventName: string, cb: Function) {
        this.observers.get(eventName)!.add(cb);
    }

    onOnce(eventName: string, cb: Function) {
        const cbWrapper = (...args: any[]) => {
            this.removeListener(eventName, cbWrapper);
            cb(...args);
        };
        this.on(eventName, cbWrapper);
    }

    onRequest(eventName: string, thisRequestId: number, cb: Function) {
        const cbWrapper = (requestId: number, ...args: any[]) => {
            if (requestId === thisRequestId) {
                this.removeListener(eventName, cbWrapper);
                cb(...args);
            }
        };
        this.on(eventName, cbWrapper);
    }

    removeListener(eventName: string, cb?: Function) {
        if (cb) {
            this.observers.get(eventName)!.remove(cb);
        } else {
            this.observers.get(eventName)!.empty();
        }
    }

    sendPingRequest(): Promise<PongResponse> {
        return new Promise(resolve => {
            this.onOnce('pong', resolve);
            this.webSocketBridge.send({
                'command': 'ping',
                'start_time': new Date(),
            });
        });
    }

    async refreshOAuthToken(userId: number): Promise<OAuthTokenResponse> {
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

    async sendPlaybackState(playbackState: PlaybackState, serverEtag?: Date): Promise<PlaybackState> {
        const url = `/api/v1/stations/${this.stationId}/`;

        let headers = new Headers();
        headers.append('X-CSRFToken', this.csrftoken);
        headers.append('Content-Type', 'application/json');

        const response = await fetch(url, {
            body: JSON.stringify({
                'playbackstate': playbackState
            }),
            credentials: 'include',
            headers: headers,
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

    async getPlaybackState(): Promise<PlaybackState | undefined> {
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

    async getListeners(): Promise<Array<Listener>> {
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

    async inviteListener(username: string, isAdmin: boolean, isDJ: boolean): Promise<Listener> {
        const url = `/api/v1/stations/${this.stationId}/listeners/`;
        let headers = new Headers();
        headers.append('X-CSRFToken', this.csrftoken);
        headers.append('Content-Type', 'application/json');

        const response = await fetch(url, {
            body: JSON.stringify({
                'user': username,
                'station': this.stationId,
                'is_admin': isAdmin,
                'is_dj': isDJ,
            }),
            credentials: 'include',
            headers: headers,
            method: 'POST',
        });

        const data = await response.json();
        if (response.ok) {
            return createListenerFromServer(<ServerListener>data);
        } else if (data.non_field_errors.some((s: string) => (s === "The fields user, station must make a unique set."))) {
            throw new ListenerAlreadyExistsError();
        } else {
            throw new Error(await response.text());
        }
    }

    onMessage(action: any) {
        console.log('Received: ', action);
        if (action.error) {
            this.observers.get('error')!.fire(serverErrorFromString(action.error), action.message);
        } else if (action.join) {
            this.observers.get('join')!.fire(action.join);
        } else if (action.type === 'playback_state_changed') {
            const serverPlaybackState = createPlaybackStateFromServer(action.playbackstate);
            this.observers.get(action.type)!.fire(serverPlaybackState);
        } else if (action.type === 'pong') {
            const pong: PongResponse = {
                startTime: new Date(action.start_time),
                serverTime: new Date(action.server_time),
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

export interface ServerListener {
    user: string,
    station: number,
    is_admin: boolean,
    is_dj: boolean,
}

function createListenerFromServer(listener: ServerListener): Listener {
    return {
        'username': listener.user,
        'stationId': listener.station,
        'isAdmin': listener.is_admin,
        'isDJ': listener.is_dj,
    }
}

export class StationMusicPlayer {
    volumeBeforeMute = 0.8;

    constructor(public musicPlayer: MusicPlayer) {
        this.musicPlayer.connect();
    }

    on(eventName: string, cb: (...args: any[]) => void) {
        this.musicPlayer.on(eventName, cb);
    }

    removeListener(eventName: string) {
        this.musicPlayer.removeListener(eventName);
    }

    getCurrentState(): Promise<PlaybackState | null> { return this.musicPlayer.getCurrentState(); }

    static getCachedVolume() {
        const value = localStorage.getItem('musicVolume');
        return ((value !== null) ? parseFloat(value) : 0.8);
    }

    static setCachedVolume(volume: number) {
        localStorage['musicVolume'] = volume;
    }

    getVolume(): Promise<number> { return this.musicPlayer.getVolume(); }

    setVolume(value: number): Promise<void> {
        StationMusicPlayer.setCachedVolume(value);
        return this.musicPlayer.setVolume(value);
    }

    async muteUnmuteVolume(): Promise<number> {
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

    play(contextUri: string, currentTrackUri: string): Promise<void> {
        return this.musicPlayer.play(contextUri, currentTrackUri);
    }

    pause(): Promise<void> { return this.musicPlayer.pause(); }
    resume(): Promise<void> { return this.musicPlayer.resume(); }
    togglePlay(): Promise<void> { return this.musicPlayer.togglePlay(); }

    async freeze(duration: number): Promise<void> {
        await this.musicPlayer.pause();
        await wait(duration);
        await this.musicPlayer.resume();
    }

    seek(positionMS: number): Promise<void> { return this.musicPlayer.seek(positionMS); }

    previousTrack(): Promise<void> { return this.musicPlayer.previousTrack(); }
    nextTrack(): Promise<void> { return this.musicPlayer.nextTrack(); }
}

class TaskExecutor {
    tasks: Promise<any> = Promise.resolve();
    tasksInFlight: number = 0;

    push(task: (...args: any[]) => Promise<any>) {
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

    clear() {
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

function getCrossSiteRequestForgeryToken(): string {
    const csrftoken = getCookie('csrftoken');
    if (!csrftoken) {
        console.assert(false, 'Cannot obtain csrftoken');
        throw new Error('Cannot obtain csrftoken');
    }

    return csrftoken;
}

function getCookie(name: string) {
    var cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var cookie = $.trim(cookies[i]);
            // Does this cookie string begin with the name we want?
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }

    return cookieValue;
}
