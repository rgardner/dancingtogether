import {
    SEEK_OVERCORRECT_MS, MusicPlayer, PlaybackState2, StationManager,
    StationMusicPlayer2, StationServer2, WebSocketBridge,
    WebSocketListenCallback
} from '../static/js/station2'
import $ from 'jquery';

const MockStationId: number = 1;
const MockStationName: string = 'MockStationName';
const MockDeviceId: string = 'MockDeviceId';
const MockContextUri: string = 'MockContextUri';
const MockCurrentTrackUri: string = 'MockCurrentTrackUri';
const MockServerEtag: string = 'MockServerEtag';

beforeEach(() => {
    // Mock StationManager.getAdjustedPlaybackPosition, as it adjusts based on
    // the client/server time offset via Date.getTime, which is
    // non-deterministic
    const getAdjustedPlaybackPosition = jest.fn().mockImplementation(serverState => {
        return serverState.raw_position_ms;
    });
    StationManager.prototype.getAdjustedPlaybackPosition = getAdjustedPlaybackPosition.bind(StationManager);
});

class MockMusicPlayer implements MusicPlayer {
    public playbackState: PlaybackState2 = new PlaybackState2('', '', true, 0, new Date(), null);
    observers: Map<string, JQueryCallback> = new Map();

    // MusicPlayer

    getAccessToken() { return ''; }
    setAccessToken(_value: string) { }

    connect(): Promise<boolean> { return Promise.resolve(true); }

    on(eventName, cb) {
        let callbacks = this.observers.get(eventName);
        if (!callbacks) {
            callbacks = $.Callbacks();
            this.observers.set(eventName, callbacks);
        }

        callbacks.add(cb);
    }

    getCurrentState(): Promise<PlaybackState2> {
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

    await expect(stationServer.sendPingRequest())
        .resolves.toEqual(expect.objectContaining({
            'startTime': expect.any(Date),
        }));
});

test('station server can send a playback state', async () => {
    expect.assertions(2);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = new StationServer2(MockStationId, mockWebSocketBridge);

    const mockPlaybackState = new PlaybackState2(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, new Date(), null);
    const mockServerEtag = '';
    mockWebSocketBridge.receiveData().then(data => {
        expect(data).toEqual({
            'command': 'player_state_change',
            'state': mockPlaybackState,
            'etag': mockServerEtag,
        });
        mockWebSocketBridge.fire({
            'type': 'ensure_playback_state',
            'state': mockPlaybackState,
        });
    });

    await expect(stationServer.sendPlaybackState(mockPlaybackState, mockServerEtag))
        .resolves.toEqual(mockPlaybackState);
});

test('station server can resync the playback state', async () => {
    expect.assertions(2);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = new StationServer2(MockStationId, mockWebSocketBridge);

    const mockPlaybackState = new PlaybackState2(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, new Date());
    mockWebSocketBridge.receiveData().then(data => {
        expect(data).toEqual({
            'command': 'player_state_change',
            'state': mockPlaybackState,
            'etag': '',
        });
        mockWebSocketBridge.fire({
            'type': 'ensure_playback_state',
            'state': mockPlaybackState,
        });
    });

    await expect(stationServer.sendSyncRequest(mockPlaybackState))
        .resolves.toEqual(mockPlaybackState);
});

test('station manager correctly adjusts playback state when server is paused', async () => {
    let mockMusicPlayer = new MockMusicPlayer();
    let stationMusicPlayer = new StationMusicPlayer2(mockMusicPlayer);
    let stationManager = new StationManager(
        new StationServer2(MockStationId, new MockWebSocketBridge()),
        stationMusicPlayer);

    const mockPlaybackState = new PlaybackState2(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, new Date(), MockServerEtag);

    // assume server has already set the current track
    mockMusicPlayer.playbackState.context_uri = mockPlaybackState.context_uri;
    mockMusicPlayer.playbackState.current_track_uri = mockPlaybackState.current_track_uri;

    await expect(stationManager.applyServerState(mockPlaybackState)).resolves.toBeUndefined();

    expect(mockMusicPlayer.playbackState.context_uri).toEqual(mockPlaybackState.context_uri);
    expect(mockMusicPlayer.playbackState.current_track_uri).toEqual(mockPlaybackState.current_track_uri);
    expect(mockMusicPlayer.playbackState.paused).toBe(mockPlaybackState.paused);
    expect(mockMusicPlayer.playbackState.raw_position_ms).toBe(mockPlaybackState.raw_position_ms);
    expect(stationManager.serverEtag).toEqual(mockPlaybackState.etag);
});

test('station manager correctly adjusts playback state when server is playing', async () => {
    let mockMusicPlayer = new MockMusicPlayer();
    let stationManager = new StationManager(
        new StationServer2(MockStationId, new MockWebSocketBridge()),
        new StationMusicPlayer2(mockMusicPlayer));

    const mockPlaybackState = new PlaybackState2(
        MockContextUri, MockCurrentTrackUri, false /*paused*/,
        10000 /*raw_position_ms*/, new Date(), MockServerEtag);

    // assume server has already set the current track
    mockMusicPlayer.playbackState.context_uri = mockPlaybackState.context_uri;
    mockMusicPlayer.playbackState.current_track_uri = mockPlaybackState.current_track_uri;

    await expect(stationManager.applyServerState(mockPlaybackState)).resolves.toBeUndefined();

    expect(mockMusicPlayer.playbackState.context_uri).toEqual(mockPlaybackState.context_uri);
    expect(mockMusicPlayer.playbackState.current_track_uri).toEqual(mockPlaybackState.current_track_uri);
    expect(mockMusicPlayer.playbackState.paused).toBe(mockPlaybackState.paused);
    const newPlaybackPosition = mockPlaybackState.raw_position_ms + SEEK_OVERCORRECT_MS;
    expect(mockMusicPlayer.playbackState.raw_position_ms).toBe(newPlaybackPosition);
    expect(stationManager.serverEtag).toEqual(mockPlaybackState.etag);
});
