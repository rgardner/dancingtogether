import $ from 'jquery';

declare var channels;

export const MAX_SEEK_ERROR_MS = 2000;
export const SEEK_OVERCORRECT_MS = 2000;
export const DEFAULT_SERVER_ONE_WAY_TIME_MS = 30;

export interface MusicPlayer {
    isAvailable(): boolean;
    getAccessToken(): string;
    setAccessToken(value: string);

    connect(): Promise<boolean>;

    on(eventName, cb);

    getCurrentState(): Promise<PlaybackState2>;

    getVolume(): Promise<number>;
    setVolume(value: number): Promise<void>;

    pause(): Promise<void>;
    resume(): Promise<void>;
    togglePlay(): Promise<void>;

    seek(positionMS: number): Promise<void>;

    previousTrack(): Promise<void>;
    nextTrack(): Promise<void>;
}

export interface WebSocketListenCallback {
    (action, stream);
}

export interface WebSocketBridge {
    connect(path: string);
    listen(callback: WebSocketListenCallback);
    send(data: any);
}

interface JoinResponse {
    stationName: string;
}

interface PongResponse {
    startTime: Date;
}

export class PlaybackState2 {
    constructor(public context_uri: string,
        public current_track_uri: string, public paused: boolean,
        public raw_position_ms: number, public sample_time: Date, public etag?: string) {
    }

    static fromSpotify(state) {
        return new PlaybackState2(
            state['context']['uri'],
            state['track_window']['current_track']['uri'],
            state['paused'],
            state['position'],
            new Date(state['timestamp']),
            null);
    }

    static fromServer(state) {
        return new PlaybackState2(
            state.context_uri,
            state.current_track_uri,
            state.paused,
            state.raw_position_ms,
            new Date(state.sample_time),
            state.etag);
    }
}

export class StationApp2 {
    readonly stationManager: StationManager;

    constructor(_userIsDJ, _userIsAdmin, accessToken, stationId) {
        let webSocketBridge = new ChannelWebSocketBridge();
        let musicPlayer = new SpotifyMusicPlayer('Dancing Together', accessToken);
        this.stationManager = new StationManager(
            new StationServer2(stationId, webSocketBridge),
            new StationMusicPlayer2(musicPlayer));
    }
}

class ChannelWebSocketBridge implements WebSocketBridge {
    impl: any = new channels.WebSocketBridge();
    connect(path: string) { this.impl.connect(path); }
    listen(callback: WebSocketListenCallback) { this.impl.listen(callback); }
    send(data: any) { this.impl.send(data); }
}

class SpotifyMusicPlayer implements MusicPlayer {
    impl?: Spotify.SpotifyPlayer = null;
    observers: Map<string, JQueryCallback> = new Map([
        ['available', $.Callbacks()]
    ]);

    constructor(clientName: string, private accessToken: string) {
        window.onSpotifyWebPlaybackSDKReady = () => {
            this.impl = new Spotify.Player({
                name: clientName,
                getOAuthToken: cb => { cb(this.getAccessToken()); },
                volume: 0.8, // TODO: use cached volume
            });

            this.observers['available'].fire();
        }
    }

    isAvailable() { return (this.impl !== null); }
    getAccessToken(): string { return this.accessToken; }
    setAccessToken(value: string) { this.accessToken = value; }

    connect(): Promise<boolean> { return this.impl.connect(); }

    on(eventName, cb) {
        if (eventName === 'available') {
            this.observers.get('available').add(cb);
        } else {
            return this.impl.on(eventName, cb);
        }
    }

    getCurrentState(): Promise<PlaybackState2> {
        return this.impl.getCurrentState().then(state => {
            return (state ? PlaybackState2.fromSpotify(state) : null);
        });
    }

    getVolume(): Promise<number> { return this.impl.getVolume(); }
    setVolume(value: number): Promise<void> { return this.impl.setVolume(value); }

    pause(): Promise<void> { return this.impl.pause(); }
    resume(): Promise<void> { return this.impl.resume(); }
    togglePlay(): Promise<void> { return this.impl.togglePlay(); }

    seek(positionMS: number): Promise<void> { return this.impl.seek(positionMS); }

    previousTrack(): Promise<void> { return this.impl.previousTrack(); }
    nextTrack(): Promise<void> { return this.impl.nextTrack(); }
}

export class StationManager {
    taskExecutor: TaskExecutor = new TaskExecutor();
    serverPings: CircularArray2<number> = new CircularArray2(5);
    clientEtag?: Date = null;
    serverEtag?: string = null;

    constructor(private server: StationServer2, private musicPlayer: StationMusicPlayer2) {
        this.bindMusicPlayerActions();
    }

    bindMusicPlayerActions() {
        this.musicPlayer.on('ready', ({ device_id }) => {
            this.taskExecutor.push(() => this.server.sendJoinRequest(device_id));
            this.taskExecutor.push(() => this.calculatePing());
        });

        this.musicPlayer.on('player_state_changed', state => {
            if (state) {
                const clientState = PlaybackState2.fromSpotify(state);
                this.taskExecutor.push(() => this.updateServerPlaybackState(clientState));
            }
        });
    }

    updateServerPlaybackState(playbackState: PlaybackState2): Promise<void> {
        return Promise.race([this.server.sendPlaybackState(playbackState), timeout(5000)])
            .then(serverState => {
                return this.applyServerState(<PlaybackState2>serverState);
            })
            .catch(() => {
                return this.syncServerPlaybackState(playbackState);
            });
    }

    syncServerPlaybackState(playbackState: PlaybackState2): Promise<void> {
        return Promise.race([this.server.sendSyncRequest(playbackState), timeout(5000)])
            .then(serverState => {
                return this.applyServerState(<PlaybackState2>serverState);
            })
            .catch(() => {
                return this.syncServerPlaybackState(playbackState);
            });
    }

    calculatePing(): Promise<void> {
        return Promise.race([this.server.sendPingRequest(), timeout(5000)])
            .then((pong: PongResponse) => {
                this.serverPings.push((new Date()).getTime() - pong.startTime.getTime());
            })
            .catch(console.error);
    }

    applyServerState(serverState: PlaybackState2): Promise<void> {
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
            .then(state => {
                this.clientEtag = state.sample_time;
                this.serverEtag = serverState.etag;
            })
            .catch(e => {
                console.error(e);
                this.musicPlayer.getCurrentState().then(state => {
                    this.taskExecutor.push(() => this.syncServerPlaybackState(state));
                })
            });
    }

    currentTrackReady(expectedState: PlaybackState2): Promise<boolean> {
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

    getMedianServerOneWayTime(): number {
        if (this.serverPings.length === 0) {
            return DEFAULT_SERVER_ONE_WAY_TIME_MS;
        } else {
            return (median(this.serverPings.entries()) / 2);
        }
    }

    getAdjustedPlaybackPosition(serverState: PlaybackState2): number {
        let position = serverState.raw_position_ms;
        if (!serverState.paused) {
            const serverDelay = this.getMedianServerOneWayTime();
            position += ((new Date()).getTime() - (serverState.sample_time.getTime() + serverDelay));
        }

        return position;
    }
}

export class StationServer2 {
    observers: Map<string, JQueryCallback> = new Map([
        ['join', $.Callbacks()],
        ['pong', $.Callbacks()],
        ['ensure_playback_state', $.Callbacks()],
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

    on(eventName: string, cb: Function) {
        this.observers.get(eventName).add(cb);
    }

    onOnce(eventName: string, cb: Function) {
        const cbWrapper = (...args) => {
            this.removeListener(eventName, cbWrapper);
            cb(...args);
        };
        this.on(eventName, cbWrapper);
    }

    removeListener(eventName: string, cb: Function) {
        this.observers.get(eventName).remove(cb);
    }

    sendJoinRequest(deviceId): Promise<JoinResponse> {
        return new Promise(resolve => {
            this.onOnce('join', stationName => {
                resolve(stationName);
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
            this.onOnce('pong', pongResponse => {
                resolve(pongResponse);
            });
            this.webSocketBridge.send({
                'command': 'ping',
                'start_time': new Date(),
            });
        });
    }

    sendPlaybackState(playbackState: PlaybackState2, serverEtag?: string): Promise<PlaybackState2> {
        return new Promise(resolve => {
            this.onOnce('ensure_playback_state', serverPlaybackState => {
                resolve(serverPlaybackState);
            });
            this.webSocketBridge.send({
                'command': 'player_state_change',
                'state': playbackState,
                'etag': serverEtag || '',
            });
        });
    }

    sendSyncRequest(playbackState): Promise<PlaybackState2> {
        return new Promise(resolve => {
            this.onOnce('ensure_playback_state', serverPlaybackState => {
                resolve(serverPlaybackState);
            });
            this.webSocketBridge.send({
                'command': 'player_state_change',
                'state': playbackState,
                'etag': '',
            });
        });
    }

    onMessage(action) {
        if (action.join) {
            this.observers.get('join').fire(action.join);
        } else if (action.type === 'ensure_playback_state') {
            const serverPlaybackState = PlaybackState2.fromServer(action.state);
            this.observers.get(action.type).fire(serverPlaybackState);
        } else if (action.type === 'pong') {
            this.observers.get(action.type).fire({ startTime: action.start_time });
        }
    }
}

export class StationMusicPlayer2 {
    isReady: boolean = false;
    deviceId?: string = null;
    storedSpotifyCallbacks: Array<[string, Function]> = [];
    volume: number = 0.8;
    volumeBeforeMute: number;

    constructor(private musicPlayer: MusicPlayer) {
        this.volumeBeforeMute = this.volume;
        this.bindMusicPlayerAvailableActions();
        if (this.musicPlayer.isAvailable()) {
            // If already available, bind the music player actions immediately
            this.bindMusicPlayerActions();
            this.musicPlayer.connect();
        }
    }

    on(eventName: string, cb: Function) {
        if (this.musicPlayer.isAvailable()) {
            // @ts-ignore
            this.musicPlayer.on(eventName, cb);
        } else {
            this.storedSpotifyCallbacks.push([eventName, cb]);
        }
    }

    bindMusicPlayerAvailableActions() {
        this.musicPlayer.on('available', () => {
            this.bindMusicPlayerActions();
            this.musicPlayer.connect();
        });
    }

    bindMusicPlayerActions() {
        this.storedSpotifyCallbacks.forEach(nameCBPair => {
            // @ts-ignore
            this.musicPlayer.on(nameCBPair[0], nameCBPair[1]);
        });

        this.musicPlayer.on('ready', ({ device_id }) => {
            this.deviceId = device_id;
            this.isReady = true;
        });

        this.musicPlayer.on('initialization_error', () => {
            this.isReady = false;
        });

        this.musicPlayer.on('authentication_error', () => {
            this.isReady = false;
        });

        this.musicPlayer.on('account_error', () => {
            this.isReady = false;
        });
    }

    getCurrentState(): Promise<PlaybackState2> { return this.musicPlayer.getCurrentState(); }

    static getCachedVolume() {
        const value = localStorage.getItem('musicVolume');
        return ((value !== null) ? parseFloat(value) : 0.8);
    }

    static setCachedVolume(volume) {
        localStorage['musicVolume'] = volume;
    }

    getVolume(): Promise<number> { return this.musicPlayer.getVolume(); }
    setVolume(value: number): Promise<void> { return this.musicPlayer.setVolume(value); }

    pause(): Promise<void> { return this.musicPlayer.pause(); }
    resume(): Promise<void> { return this.musicPlayer.resume(); }
    togglePlay(): Promise<void> { return this.musicPlayer.togglePlay(); }

    freeze(duration: number): Promise<void> {
        return this.musicPlayer.pause().then(() => wait(duration)).then(() => this.musicPlayer.resume());
    }

    seek(positionMS): Promise<void> { return this.musicPlayer.seek(positionMS); }

    previousTrack(): Promise<void> { return this.musicPlayer.previousTrack(); }
    nextTrack(): Promise<void> { return this.musicPlayer.nextTrack(); }
}

class TaskExecutor {
    tasks: Promise<any> = Promise.resolve();
    tasksInFlight: number = 0;

    push(task) {
        if (this.tasksInFlight === 0) {
            // why reset tasks here? in case the native promises implementation isn't
            // smart enough to garbage collect old completed tasks in the chain.
            this.tasks = Promise.resolve();
        }
        this.tasksInFlight += 1;
        this.tasks.then(task).then(() => {
            this.tasksInFlight -= 1;
        })
    }
}

class CircularArray2<T> {
    array: Array<T> = [];
    position: number = 0;
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

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function timeout(ms: number): Promise<void> {
    return wait(ms).then(Promise.reject);
}

function retry(condition: () => Promise<boolean>): Promise<void> {
    return condition().then(b => (b ? Promise.resolve() : wait(250).then(() => retry(condition))));
}
