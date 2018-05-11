import {
    MusicPlayer, PlaybackState2, StationManager, StationMusicPlayer2,
    StationServer2, WebSocketBridge, WebSocketListenCallback
} from '../static/js/station2'
import * as $ from 'jquery';

const MockStationId: number = 1;
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
    callback: WebSocketListenCallback;
    dataReceivedCallback: any;

    // WebSocketBridge

    connect(_path: string) { }

    listen(callback: WebSocketListenCallback) {
        this.callback = callback;
    }

    send(data: any) {
        this.dataReceivedCallback(data);
    }

    // Mock functions

    fire(data) {
        this.callback(data, undefined);
    }
}

test('station manager initializes server and music player correctly', () => {
    let mockWebSocketBridge = new MockWebSocketBridge();
    let mockMusicPlayer = new MockMusicPlayer();
    let _stationManager = new StationManager(
        new StationServer2(MockStationId, mockWebSocketBridge),
        new StationMusicPlayer2(MockClientName, MockAccessToken, mockMusicPlayer));

    mockMusicPlayer.fire('ready', { device_id: MockDeviceId });
    mockWebSocketBridge.dataReceivedCallback = data => {
        expect(data).toEqual({
            'command': 'join',
            'station': MockStationId,
            'device_id': MockDeviceId,
        });
    };

    const mockEnsurePlaybackStateResponse = {
        'type': 'ensure_playback_state',
        'state': {
            'context_uri': 'MockContextUri',
            'current_track_uri': 'MockCurrentTrackUri',
            'paused': true,
            'raw_position_ms': 0,
            'sample_time': new Date(),
        },
    };
    mockWebSocketBridge.fire(mockEnsurePlaybackStateResponse);
});
