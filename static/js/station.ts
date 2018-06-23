import * as $ from 'jquery';
import { CircularArray, ListenerRole, median, wait } from './util';
import { MusicPlayer, PlaybackState, SpotifyMusicPlayer } from './music_player';
import { ChannelWebSocketBridge, WebSocketBridge } from './websocket_bridge';
import { ViewManager } from './station_view';

const SERVER_HEARTBEAT_INTERVAL_MS = 3000;
export const MAX_SEEK_ERROR_MS = 2000;
export const SEEK_OVERCORRECT_MS = 2000;

interface AppData {
    spotifyConnectPlayerName: string;
    userIsDJ: boolean;
    userIsAdmin: boolean;
    accessToken: string;
    stationId: number;
    stationTitle: string;
    debug: boolean;
}

declare const APP_DATA: AppData;

window.onSpotifyWebPlaybackSDKReady = () => {
    let listenerRole = ListenerRole.None;
    if (APP_DATA.userIsDJ) listenerRole |= ListenerRole.DJ;
    if (APP_DATA.userIsAdmin) listenerRole |= ListenerRole.Admin;
    let webSocketBridge = new ChannelWebSocketBridge();

    new StationManager(
        listenerRole,
        APP_DATA.stationTitle,
        new StationServer(APP_DATA.stationId, getCrossSiteRequestForgeryToken(), webSocketBridge),
        new StationMusicPlayer(
            APP_DATA.spotifyConnectPlayerName,
            APP_DATA.accessToken,
            StationMusicPlayer.getCachedVolume()
        ),
        APP_DATA.debug,
    );
};

export class StationManager {
    taskExecutor = new TaskExecutor();
    clientEtag?: Date;
    serverEtag?: Date;
    heartbeatIntervalId?: number;
    viewManager: ViewManager;
    roundTripTimes = new CircularArray<number>(5);
    clientServerTimeOffsets = new CircularArray<number>(5);

    constructor(
        private listenerRole: ListenerRole, stationTitle: string,
        private server: StationServer, private musicPlayer: StationMusicPlayer,
        debug: boolean) {
        this.viewManager = new ViewManager(listenerRole, stationTitle, debug);
        this.bindMusicPlayerActions();
        this.bindServerActions();
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

    updateServerPlaybackState(playbackState?: PlaybackState): Promise<void> {
        return (playbackState ? Promise.resolve(playbackState) : this.musicPlayer.getCurrentState())
            .then(state => {
                if (!state || (this.clientEtag && (state.sample_time <= this.clientEtag))) {
                    return Promise.resolve();
                }

                state.sample_time = new Date(state.sample_time.getTime() + this.getMedianClientServerTimeOffset());

                return Promise.race([this.server.sendPlaybackState(state, this.serverEtag), timeout(5000)])
                    .then(serverState => {
                        return this.applyServerPlaybackState(<PlaybackState>serverState);
                    })
                    .catch(e => {
                        console.error(e);
                        this.taskExecutor.clear();
                        this.taskExecutor.push(() => this.syncServerPlaybackState());
                    });
            });
    }

    syncServerPlaybackState(): Promise<void> {
        return Promise.race([this.server.getPlaybackState(), timeout(5000)])
            .then(serverState => {
                if (serverState) {
                    return this.applyServerPlaybackState(serverState);
                }
            });
    }

    calculatePing(): Promise<void> {
        return Promise.race([this.server.sendPingRequest(), timeout(5000)])
            .then((pong: PongResponse) => {
                this.adjustServerTimeOffset(pong.startTime, pong.serverTime, new Date());
            })
            .catch(console.error);
    }

    applyServerPlaybackState(serverState: PlaybackState): Promise<void> {
        if (this.serverEtag && (<Date>serverState.etag <= this.serverEtag)) {
            return Promise.resolve();
        }

        return this.musicPlayer.getCurrentState()
            .then(clientState => {
                let changeTrackIfNeeded = Promise.resolve();
                if (!clientState || (clientState.context_uri !== serverState.context_uri) ||
                    (clientState.current_track_uri !== serverState.current_track_uri)) {
                    changeTrackIfNeeded = this.musicPlayer.play(serverState.context_uri, serverState.current_track_uri);
                }

                return changeTrackIfNeeded
                    .then(() => {
                        return Promise.race([retry(() => this.currentTrackReady(serverState)), timeout(5000)]);
                    })
                    .then(() => this.musicPlayer.getCurrentState())
                    .then(clientState => {
                        if (!clientState) {
                            return Promise.reject('Spotify not ready');
                        }

                        if (serverState.paused) {
                            const pauseIfNeeded = (clientState.paused ? Promise.resolve() : this.musicPlayer.pause());
                            return pauseIfNeeded.then(() => this.musicPlayer.seek(serverState.raw_position_ms));
                        } else {
                            const localPosition = clientState.raw_position_ms;
                            const serverPosition = this.getAdjustedPlaybackPosition(serverState);
                            if (Math.abs(localPosition - serverPosition) > MAX_SEEK_ERROR_MS) {
                                const newLocalPosition = serverPosition + SEEK_OVERCORRECT_MS;
                                console.log(`Playback adjustment needed: local: ${localPosition}, server: ${serverPosition}, new local: ${newLocalPosition}`);
                                return this.musicPlayer.seek(newLocalPosition)
                                    .then(() => Promise.race([retry(() => this.currentPositionReady(newLocalPosition)), timeout(5000)]))
                                    .then(() => {
                                        const serverPosition = this.getAdjustedPlaybackPosition(serverState);
                                        if (((newLocalPosition > serverPosition) && (newLocalPosition < (serverPosition + MAX_SEEK_ERROR_MS)))) {
                                            return this.musicPlayer.freeze(localPosition - serverPosition);
                                        } else {
                                            return this.musicPlayer.resume();
                                        }
                                    });
                            } else if (clientState.paused) {
                                return this.musicPlayer.resume();
                            } else {
                                return Promise.resolve();
                            }
                        }
                    })
                    .then(() => this.musicPlayer.getCurrentState())
                    .then(clientState => {
                        if (!clientState) {
                            return Promise.reject('Spotify not ready');
                        }

                        this.clientEtag = clientState.sample_time;
                        this.serverEtag = serverState.etag;
                        return Promise.resolve();
                    })
                    .catch((e: any) => {
                        console.error(e);
                        this.taskExecutor.push(() => this.syncServerPlaybackState());
                    });
            });
    }

    currentTrackReady(expectedState: PlaybackState): Promise<boolean> {
        return this.musicPlayer.getCurrentState().then(state => {
            if (state) {
                return state.current_track_uri === expectedState.current_track_uri;
            } else {
                return false;
            }
        });
    }

    currentPositionReady(expectedPosition: number): Promise<boolean> {
        return this.musicPlayer.getCurrentState().then(state => {
            if (state) {
                return state.raw_position_ms >= expectedPosition;
            } else {
                return false;
            }
        });
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

export enum ServerError {
    ClientError,
}

export interface Listener {
    userId: number,
    userName: string,
    userEmail: string,
    isDJ: boolean,
    isAdmin: boolean,
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
            this.onOnce('pong', (pongResponse: PongResponse) => {
                resolve(pongResponse);
            });
            this.webSocketBridge.send({
                'command': 'ping',
                'start_time': new Date(),
            });
        });
    }

    sendPlaybackState(playbackState: PlaybackState, serverEtag?: Date): Promise<PlaybackState> {
        const url = `/api/v1/stations/${this.stationId}/`;

        let headers = new Headers();
        headers.append('X-CSRFToken', this.csrftoken);
        addConditionalRequestHeader(headers, playbackState);
        headers.append('Content-Type', 'application/json');

        return fetch(url, {
            body: JSON.stringify({
                'playbackstate': playbackState
            }),
            credentials: 'include',
            headers: headers,
            method: 'PATCH',
        }).then(response => {
            if (response.status === 200) {
                return response.json();
            } else if (response.status === 412) {
                throw new Error('Conditional station playback state update failed');
            } else {
                return response.json().then(data => Promise.reject(data));
            }
        }).then((data: any) => {
            return createPlaybackStateFromServer(data.playbackstate);
        });
    }

    getPlaybackState(): Promise<PlaybackState | undefined> {
        const url = `/api/v1/stations/${this.stationId}/`;
        return fetch(url, {
            credentials: 'include',
        }).then(response => {
            return response.json().then(data => {
                if (response.ok) {
                    if (data.playbackstate) {
                        return createPlaybackStateFromServer(data.playbackstate);
                    } else {
                        return undefined;
                    }
                } else {
                    throw new Error(data);
                }
            });
        });
    }

    getListeners(): Promise<Array<Listener>> {
        const url = `/api/v1/stations/${this.stationId}/listeners/`;
        return fetch(url, {
            credentials: 'include',
        }).then(response => {
            return response.json().then(data => {
                if (response.ok) {
                    return data;
                } else {
                    throw new Error(data);
                }
            });
        });
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

function addConditionalRequestHeader(headers: Headers, playbackState: PlaybackState) {
    if (playbackState.etag) {
        headers.append('If-Unmodified-Since', playbackState.etag.toISOString());
    }
}

export class StationMusicPlayer {
    volumeBeforeMute = 0.8;
    public musicPlayer: MusicPlayer;

    constructor(clientName: string, accessToken: string, initialVolume: number) {
        this.musicPlayer = new SpotifyMusicPlayer(clientName, accessToken, initialVolume);
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

    muteUnmuteVolume() {
        return new Promise(resolve => {
            this.getVolume().then(volume => {
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

                return newVolume;
            }).then(newVolume => {
                return this.setVolume(newVolume).then(() => Promise.resolve(newVolume));
            }).then(newVolume => {
                resolve(newVolume);
            });
        });
    }

    play(contextUri: string, currentTrackUri: string): Promise<void> {
        return this.musicPlayer.play(contextUri, currentTrackUri);
    }

    pause(): Promise<void> { return this.musicPlayer.pause(); }
    resume(): Promise<void> { return this.musicPlayer.resume(); }
    togglePlay(): Promise<void> { return this.musicPlayer.togglePlay(); }

    freeze(duration: number): Promise<void> {
        return this.musicPlayer.pause().then(() => {
            return wait(duration)
        }).then(() => {
            return this.musicPlayer.resume();
        });
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

function retry(condition: () => Promise<boolean>): Promise<void> {
    return condition().then(b => {
        return (b ? Promise.resolve() : wait(250).then(() => {
            return retry(condition);
        }));
    });
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
