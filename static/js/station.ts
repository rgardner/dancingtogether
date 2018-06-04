import * as $ from 'jquery';
import { ListenerRole, wait } from './util';
import { MusicPlayer, PlaybackState, SpotifyMusicPlayer } from './music_player';
import { ChannelWebSocketBridge, WebSocketBridge } from './websocket_bridge';
import { ViewManager } from './station_view';

const SERVER_HEARTBEAT_INTERVAL_MS = 3000;
export const MAX_SEEK_ERROR_MS = 2000;
export const SEEK_OVERCORRECT_MS = 2000;
const BACKOFF_TIME_MS = 120000;

interface AppData {
    spotifyConnectPlayerName: string;
    userIsDJ: boolean;
    userIsAdmin: boolean;
    accessToken: string;
    stationId: number;
}

declare const APP_DATA: AppData;

window.onSpotifyWebPlaybackSDKReady = () => {
    let webSocketBridge = new ChannelWebSocketBridge();
    let musicPlayer = new SpotifyMusicPlayer(APP_DATA.spotifyConnectPlayerName,
        APP_DATA.accessToken, StationMusicPlayer.getCachedVolume());

    let listenerRole = ListenerRole.None;
    if (APP_DATA.userIsDJ) listenerRole |= ListenerRole.DJ;
    if (APP_DATA.userIsAdmin) listenerRole |= ListenerRole.Admin;

    new StationManager(
        listenerRole,
        new StationServer(APP_DATA.stationId, webSocketBridge),
        new StationMusicPlayer(musicPlayer));
};

export class StationManager {
    taskExecutor = new TaskExecutor();
    clientEtag?: Date;
    serverEtag?: Date;
    heartbeatIntervalId?: number;
    viewManager: ViewManager;
    roundTripTimes = new CircularArray2<number>(5);
    clientServerTimeOffsets = new CircularArray2<number>(5);

    constructor(listenerRole: ListenerRole, private server: StationServer, private musicPlayer: StationMusicPlayer) {
        this.viewManager = new ViewManager(listenerRole);
        this.bindMusicPlayerActions();
        this.bindServerActions();
    }

    bindMusicPlayerActions() {
        this.musicPlayer.on('ready', ({ device_id }) => {
            this.taskExecutor.push(() => this.server.sendJoinRequest(device_id));
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
            if (error === ServerError.PreconditionFailed) {
                this.taskExecutor.clear();
                this.taskExecutor.push(() => this.syncServerPlaybackState());
            } else if (error === ServerError.SpotifyError) {
                Promise.resolve(this.stopSteadyState())
                    .then(() => wait(BACKOFF_TIME_MS))
                    .then(() => this.startSteadyState());
            } else {
                console.error(`${error}: ${message}`);
            }
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

        this.server.on('station_state_change', (serverState: PlaybackState) => {
            this.taskExecutor.push(() => this.applyServerState(serverState));
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
        this.server.removeListener('station_state_change');
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
            this.taskExecutor.push(() => this.updateServerPlaybackState());
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

                return Promise.race([this.server.sendPlaybackState(state, this.serverEtag), timeout(5000)])
                    .then(serverState => {
                        return this.applyServerState(<PlaybackState>serverState);
                    })
                    .catch(() => {
                        return this.syncServerPlaybackState(playbackState);
                    });
            });
    }

    syncServerPlaybackState(playbackState?: PlaybackState): Promise<void> {
        return (playbackState ? Promise.resolve(playbackState) : this.musicPlayer.getCurrentState())
            .then(state => {
                if ((!state && this.clientEtag) || (state && (this.clientEtag && (state.sample_time <= this.clientEtag)))) {
                    return Promise.resolve();
                }

                return Promise.race([this.server.sendSyncRequest(state || undefined), timeout(5000)])
                    .then(serverState => {
                        return this.applyServerState(<PlaybackState>serverState);
                    })
                    .catch(() => {
                        return this.syncServerPlaybackState(playbackState);
                    });
            });
    }

    calculatePing(): Promise<void> {
        return Promise.race([this.server.sendPingRequest(), timeout(5000)])
            .then((pong: PongResponse) => {
                this.adjustServerTimeOffset(pong.startTime, pong.serverTime, new Date());
            })
            .catch(console.error);
    }

    applyServerState(serverState: PlaybackState): Promise<void> {
        if (this.serverEtag && (<Date>serverState.etag <= this.serverEtag)) {
            return Promise.resolve();
        }

        return Promise.race([retry(() => this.currentTrackReady(serverState)), timeout(5000)])
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
        let position = serverState.raw_position_ms;
        if (!serverState.paused) {
            const serverTimeOffset = this.getMedianClientServerTimeOffset();
            position += ((new Date()).getTime() - (serverState.sample_time.getTime() + serverTimeOffset));
        }

        return position;
    }

    adjustServerTimeOffset(startTime: Date, serverTime: Date, currentTime: Date) {
        this.roundTripTimes.push(currentTime.getTime() - startTime.getTime());
        const medianOneWayTime = Math.round(median(this.roundTripTimes.entries()) / 2);
        //const clientServerTimeOffset = currentTime.getTime() - medianOneWayTime - serverTime.getTime();
        const clientServerTimeOffset = currentTime.getTime() - startTime.getTime();
        this.clientServerTimeOffsets.push(clientServerTimeOffset);
    }
}

interface JoinResponse {
    stationName: string;
}

interface PongResponse {
    startTime: Date;
    serverTime: Date;
}

export enum ServerError {
    PreconditionFailed,
    SpotifyError,
}

export class StationServer {
    requestId = 0;
    observers = new Map([
        ['error', $.Callbacks()],
        ['join', $.Callbacks()],
        ['pong', $.Callbacks()],
        ['ensure_playback_state', $.Callbacks()],
        ['station_state_change', $.Callbacks()],
    ]);

    constructor(private stationId: number, private webSocketBridge: WebSocketBridge) {
        // Correctly decide between ws:// and wss://
        const wsScheme = window.location.protocol == 'https:' ? 'wss' : 'ws';
        const wsPath = wsScheme + '://' + window.location.host + '/station/stream/';
        this.webSocketBridge.connect(wsPath);
        this.bindWebSocketBridgeActions();
    }

    bindWebSocketBridgeActions() {
        this.webSocketBridge.listen(action => { this.onMessage(action); });
    }

    // Public events
    // station_state_change: (state: PlaybackState)
    // error: (error: string, message: string)
    //     client_error
    //     precondition_failed
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

    sendJoinRequest(deviceId: string): Promise<JoinResponse> {
        return new Promise(resolve => {
            this.onOnce('join', (stationName: string) => {
                resolve({ stationName });
            });
            this.webSocketBridge.send({
                'command': 'join',
                'station': this.stationId,
                'device_id': deviceId,
            });
        });
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
        return new Promise(resolve => {
            const thisRequestId = ++this.requestId;
            this.onRequest('ensure_playback_state', thisRequestId, (serverPlaybackState: PlaybackState) => {
                resolve(serverPlaybackState);
            });
            this.webSocketBridge.send({
                'command': 'player_state_change',
                'request_id': thisRequestId,
                'state': playbackState,
                'etag': serverEtag,
            });
        });
    }

    sendSyncRequest(playbackState?: PlaybackState): Promise<PlaybackState> {
        return new Promise(resolve => {
            const thisRequestId = ++this.requestId;
            this.onRequest('ensure_playback_state', thisRequestId, (serverPlaybackState: PlaybackState) => {
                resolve(serverPlaybackState);
            });
            this.webSocketBridge.send({
                'command': 'get_playback_state',
                'request_id': thisRequestId,
                'state': playbackState,
            });
        });
    }

    onMessage(action: any) {
        if (action.error) {
            this.observers.get('error')!.fire(serverErrorFromString(action.error), action.message);
        } else if (action.join) {
            this.observers.get('join')!.fire(action.join);
        } else if (action.type === 'ensure_playback_state') {
            const requestId = action.request_id;
            const serverPlaybackState = createPlaybackStateFromServer(action.state);
            if (requestId) {
                this.observers.get(action.type)!.fire(requestId, serverPlaybackState);
            } else {
                this.observers.get('station_state_change')!.fire(serverPlaybackState);
            }
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
    if (error === 'precondition_failed') {
        return ServerError.PreconditionFailed;
    } else if (error === 'spotify_error') {
        return ServerError.SpotifyError;
    } else {
        console.assert();
        throw Error("Unknown server error");
    }
}

function createPlaybackStateFromServer(state: any) {
    return new PlaybackState(
        state.context_uri,
        state.current_track_uri,
        state.paused,
        state.raw_position_ms,
        new Date(state.sample_time),
        new Date(state.etag));
}

export class StationMusicPlayer {
    volumeBeforeMute = 0.8;

    constructor(private musicPlayer: MusicPlayer) {
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

class CircularArray2<T> {
    array: Array<T> = [];
    position = 0;
    constructor(readonly capacity: number) {
    }

    get length(): number {
        return this.array.length;
    }

    entries(): Array<T> {
        return this.array;
    }

    push(e: T) {
        this.array[this.position % this.capacity] = e;
        this.position++;
    }
}

function median(arr: Array<number>): number {
    return arr.concat().sort()[Math.floor(arr.length / 2)];
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
