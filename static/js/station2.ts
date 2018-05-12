import * as $ from 'jquery';

export interface MusicPlayer {
    connect(): Promise<boolean>;

    on(eventName, cb);

    getCurrentState(): Promise<PlaybackState>;

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
        public raw_position_ms: number, public sample_time: Date) {
    }

    static fromSpotify(state) {
        return new PlaybackState2(
            state['context']['uri'],
            state['track_window']['current_track']['uri'],
            state['paused'],
            state['position'],
            new Date(state['timestamp']));
    }

    static fromServer(state) {
        return new PlaybackState2(
            state.context_uri,
            state.current_track_uri,
            state.paused,
            state.raw_position_ms,
            new Date(state.sample_time));
    }
}

export class StationManager {
    taskExecutor: TaskExecutor = new TaskExecutor();
    serverPings: CircularArray2<number> = new CircularArray2(5);

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

    updateServerPlaybackState(playbackState): Promise<void> {
        return Promise.race([this.server.sendPlaybackState(playbackState), timeout(5000)])
            .then(serverState => {
                return this.applyServerState(serverState);
            })
            .catch(() => {
                return this.syncServerPlaybackState(playbackState);
            });
    }

    syncServerPlaybackState(playbackState): Promise<void> {
        return Promise.race([this.server.sendSyncRequest(playbackState), timeout(5000)])
            .then(serverState => {
                return this.applyServerState(serverState);
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

    applyServerState(serverState) { }
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

    sendPlaybackState(playbackState: PlaybackState2): Promise<PlaybackState2> {
        return Promise.reject();
    }

    sendSyncRequest(playbackState): Promise<PlaybackState2> {
        return Promise.reject();
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

    constructor(clientName, public accessToken: string, private musicPlayer: MusicPlayer) {
        this.volumeBeforeMute = this.volume;
        this.bindSpotifyActions();
        this.musicPlayer.connect();
    }

    on(eventName: string, cb: Function) {
        if (this.musicPlayer) {
            // @ts-ignore
            this.musicPlayer.on(eventName, cb);
        } else {
            this.storedSpotifyCallbacks.push([eventName, cb]);
        }
    }

    bindSpotifyActions() {
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

    getCurrentState(): Promise<PlaybackState> { return this.musicPlayer.getCurrentState(); }

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


function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function timeout(ms: number): Promise<void> {
    return wait(ms).then(Promise.reject);
}
