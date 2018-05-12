import {
    MusicPlayer, PlaybackState2, StationManager, StationMusicPlayer2,
    StationServer2, WebSocketBridge, WebSocketListenCallback
} from '../static/js/station2'
import * as $ from 'jquery';

const MockStationId: number = 1;
const MockStationName: string = 'MockStationName';
const MockClientName: string = 'MockClientName';
const MockAccessToken: string = 'MockAccessToken';
const MockDeviceId: string = 'MockDeviceId';

class MockMusicPlayer implements MusicPlayer {
    playbackState: PlaybackState2;
    observers: Map<string, JQueryCallback> = new Map();

    // MusicPlayer

    connect(): Promise<boolean> { return Promise.resolve(true); }

    on(eventName, cb) {
        let callbacks = this.observers.get(eventName);
        if (!callbacks) {
            callbacks = $.Callbacks();
            this.observers.set(eventName, callbacks);
        }

        callbacks.add(cb);
    }

    getCurrentState(): Promise<PlaybackState> {
        return Promise.resolve(this.playbackState);
    }

    getVolume(): Promise<number> { return Promise.reject(); }

    setVolume(_value: number): Promise<void> { return Promise.reject(); }

    pause(): Promise<void> {
        this.playbackState.paused = true;
        return Promise.resolve();
    }

    resume(): Promise<void> {
        this.playbackState.paused = false;
        return Promise.resolve();
    }

    togglePlay(): Promise<void> {
        this.playbackState.paused = !this.playbackState.paused;
        return Promise.resolve();
    }

    seek(positionMS: number): Promise<void> {
        this.playbackState.raw_position_ms = positionMS;
        return Promise.resolve();
    }

    previousTrack(): Promise<void> { return Promise.reject(); }
    nextTrack(): Promise<void> { return Promise.reject(); }

    // Mock functions

    fire(eventName, payload) {
        this.observers.get(eventName).fire(payload);
    }
}

class MockWebSocketBridge implements WebSocketBridge {
    callback?: WebSocketListenCallback = null;
    receiveDataCallback?: Function = null;

    // WebSocketBridge

    connect(_path: string) { }

    listen(callback: WebSocketListenCallback) {
        this.callback = callback;
    }

    send(data: any) {
        this.receiveDataCallback(data);
        this.receiveDataCallback = null;
    }

    // Mock functions

    fire(data) {
        this.callback(data, undefined);
    }

    receiveData(): Promise<any> {
        return new Promise(resolve => {
            this.receiveDataCallback = resolve;
        });
    }
}

test('station server can join a station', async () => {
    expect.assertions(2);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = new StationServer2(MockStationId, mockWebSocketBridge);

    mockWebSocketBridge.receiveData().then(data => {
        expect(data).toEqual({
            'command': 'join',
            'station': MockStationId,
            'device_id': MockDeviceId,
        });

        mockWebSocketBridge.fire({ 'join': MockStationName });
    });

    await expect(stationServer.sendJoinRequest(MockDeviceId)).resolves.toEqual(MockStationName);
});

test('station server can send a ping', async () => {
    expect.assertions(2);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = new StationServer2(MockStationId, mockWebSocketBridge);

    mockWebSocketBridge.receiveData().then(data => {
        expect(data).toEqual(expect.objectContaining({
            'start_time': expect.any(Date),
        }));
        mockWebSocketBridge.fire({ 'type': 'pong', 'start_time': data.start_time });
    });

    await expect(stationServer.sendPingRequest()).resolves.toEqual(expect.objectContaining({
        'startTime': expect.any(Date),
    }));
});
