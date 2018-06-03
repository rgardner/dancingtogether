import * as $ from 'jquery';
import { ListenerRole, wait } from '../static/js/util';
import { MusicPlayer, PlaybackState } from '../static/js/music_player';
import { WebSocketBridge, WebSocketListenCallback } from '../static/js/websocket_bridge';
import {
    SEEK_OVERCORRECT_MS, StationManager, StationMusicPlayer, StationServer,
    ServerError,
} from '../static/js/station'

const MockStationId = 1;
const MockStationName = 'MockStationName';
const MockDeviceId = 'MockDeviceId';
const MockContextUri = 'MockContextUri';
const MockCurrentTrackUri = 'MockCurrentTrackUri';
const MockServerEtag1 = new Date('2018-05-20T20:57:33.992Z');
const MockServerEtag2 = new Date('2018-05-20T20:58:33.992Z');

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
    public playbackState = new PlaybackState('', '', true, 0, new Date());
    observers = new Map([
        ['player_state_changed', $.Callbacks()],
    ]);

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

    removeListener(eventName: string) {
        this.observers.get(eventName)!.empty();
    }

    getCurrentState(): Promise<PlaybackState> {
        return Promise.resolve(this.playbackState);
    }

    getVolume(): Promise<number> { return Promise.reject(); }

    setVolume(_value: number): Promise<void> { return Promise.reject(); }

    pause(): Promise<void> {
        this.playbackState.paused = true;
        this.firePlayerStateChange();
        return Promise.resolve();
    }

    resume(): Promise<void> {
        this.playbackState.paused = false;
        this.firePlayerStateChange();
        return Promise.resolve();
    }

    togglePlay(): Promise<void> {
        this.playbackState.paused = !this.playbackState.paused;
        this.firePlayerStateChange();
        return Promise.resolve();
    }

    seek(positionMS: number): Promise<void> {
        this.playbackState.raw_position_ms = positionMS;
        this.firePlayerStateChange();
        return Promise.resolve();
    }

    previousTrack(): Promise<void> { return Promise.reject("not implemented"); }
    nextTrack(): Promise<void> { return Promise.reject("not implemented"); }

    // Mock functions

    fire(eventName, payload) {
        this.observers.get(eventName).fire(payload);
    }

    firePlayerStateChange() {
        this.getCurrentState().then(playbackState => {
            const newPlaybackState = Object.assign({}, playbackState, {
                sample_time: new Date(),
            });
            this.observers.get('player_state_changed')!.fire(newPlaybackState)
        });
    }
}

class MockWebSocketBridge implements WebSocketBridge {
    callback?: WebSocketListenCallback;
    receiveDataCallback?: Function;

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
    let stationServer = new StationServer(MockStationId, mockWebSocketBridge);

    mockWebSocketBridge.receiveData().then(data => {
        expect(data).toEqual({
            'command': 'join',
            'station': MockStationId,
            'device_id': MockDeviceId,
        });

        mockWebSocketBridge.fire({ 'join': MockStationName });
    });

    await expect(stationServer.sendJoinRequest(MockDeviceId)).resolves.toEqual({
        'stationName': MockStationName,
    });
});

test('station server can send a ping', async () => {
    expect.assertions(2);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = new StationServer(MockStationId, mockWebSocketBridge);

    mockWebSocketBridge.receiveData().then(data => {
        expect(data).toEqual(expect.objectContaining({
            'command': 'ping',
            'start_time': expect.any(Date),
        }));
        mockWebSocketBridge.fire({
            'type': 'pong',
            'start_time': data.start_time,
            'server_time': new Date(),
        });
    });

    await expect(stationServer.sendPingRequest())
        .resolves.toEqual(expect.objectContaining({
            'startTime': expect.any(Date),
            'serverTime': expect.any(Date),
        }));
});

test('station server can send a playback state', async () => {
    expect.assertions(2);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = new StationServer(MockStationId, mockWebSocketBridge);

    const mockPlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, new Date(), null);
    const mockServerEtag = MockServerEtag1;
    mockWebSocketBridge.receiveData().then(data => {
        expect(data).toEqual(expect.objectContaining({
            'command': 'player_state_change',
            'request_id': expect.any(Number),
            'state': mockPlaybackState,
            'etag': mockServerEtag,
        }));
        let responsePlaybackState = mockPlaybackState;
        responsePlaybackState.etag = MockServerEtag2;
        mockWebSocketBridge.fire({
            'type': 'ensure_playback_state',
            'request_id': data.request_id,
            'state': responsePlaybackState,
        });
    });

    let expectedResponsePlaybackState = mockPlaybackState;
    expectedResponsePlaybackState.etag = MockServerEtag2;
    await expect(stationServer.sendPlaybackState(mockPlaybackState, mockServerEtag))
        .resolves.toEqual(expectedResponsePlaybackState);
});

test('station server can resync the playback state', async () => {
    expect.assertions(2);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = new StationServer(MockStationId, mockWebSocketBridge);

    const mockPlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, new Date(), null);
    mockWebSocketBridge.receiveData().then(data => {
        expect(data).toEqual(expect.objectContaining({
            'command': 'get_playback_state',
            'request_id': expect.any(Number),
            'state': mockPlaybackState,
        }));
        let responsePlaybackState = mockPlaybackState;
        responsePlaybackState.etag = MockServerEtag1;
        mockWebSocketBridge.fire({
            'type': 'ensure_playback_state',
            'request_id': data.request_id,
            'state': responsePlaybackState,
        });
    });

    let expectedResponsePlaybackState = mockPlaybackState;
    expectedResponsePlaybackState.etag = MockServerEtag1;
    await expect(stationServer.sendSyncRequest(mockPlaybackState))
        .resolves.toEqual(expectedResponsePlaybackState);
});

test('station server fires notifications for station state changes', async () => {
    expect.assertions(1);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = new StationServer(MockStationId, mockWebSocketBridge);

    const mockPlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, new Date(), MockServerEtag1);

    stationServer.on('station_state_change', data => {
        expect(data).toEqual(mockPlaybackState);
    });

    mockWebSocketBridge.fire({
        'type': 'ensure_playback_state',
        'state': mockPlaybackState,
    });
});

test('station server fires notifications for errors', async () => {
    expect.assertions(6);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = new StationServer(MockStationId, mockWebSocketBridge);

    const mockError1 = { error: 'precondition_failed', message: 'out of sync' };
    stationServer.onOnce('error', (error, message) => {
        expect(error).toEqual(ServerError.PreconditionFailed);
        expect(message).toEqual(mockError1.message);
    });

    mockWebSocketBridge.fire(mockError1);

    const mockError2 = { error: 'too_many_requests', message: 'request throttled' };
    stationServer.onOnce('error', (error, message) => {
        expect(error).toEqual(ServerError.TooManyRequests);
        expect(message).toEqual(mockError2.message);
    });

    mockWebSocketBridge.fire(mockError2);

    const mockError3 = { error: 'internal_server_error', message: 'an error occurred' };
    stationServer.onOnce('error', (error, message) => {
        expect(error).toEqual(ServerError.InternalServerError);
        expect(message).toEqual(mockError3.message);
    });

    mockWebSocketBridge.fire(mockError3);
});

test.skip('station manager correctly adjusts client server time offset', async () => {
    let stationManager = new StationManager(
        ListenerRole.None,
        new StationServer(MockStationId, new MockWebSocketBridge()),
        new StationMusicPlayer(new MockMusicPlayer()));

    let startTime = new Date('2018-05-31T00:00:01.000Z');
    let serverTime = new Date('2018-05-31T00:00:03.000Z');
    let currentTime = new Date('2018-05-31T00:00:02.000Z');
    stationManager.adjustServerTimeOffset(startTime, serverTime, currentTime);

    expect(stationManager.roundTripTimes.length).toBe(1);
    expect(stationManager.roundTripTimes.entries()).toEqual([1000]);
    expect(stationManager.clientServerTimeOffsets.length).toBe(1);
    expect(stationManager.clientServerTimeOffsets.entries()).toEqual([-1500]);
});

function verify_music_player_playback_state(mockMusicPlayer: MockMusicPlayer, playbackState: PlaybackState) {
    expect(mockMusicPlayer.playbackState.context_uri).toEqual(playbackState.context_uri);
    expect(mockMusicPlayer.playbackState.current_track_uri).toEqual(playbackState.current_track_uri);
    expect(mockMusicPlayer.playbackState.paused).toBe(playbackState.paused);
    expect(mockMusicPlayer.playbackState.raw_position_ms).toBe(playbackState.raw_position_ms);
}

test('station manager correctly adjusts playback state when server is paused', async () => {
    let mockMusicPlayer = new MockMusicPlayer();
    let stationMusicPlayer = new StationMusicPlayer(mockMusicPlayer);
    let stationManager = new StationManager(
        ListenerRole.None,
        new StationServer(MockStationId, new MockWebSocketBridge()),
        stationMusicPlayer);

    const mockPlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, new Date(), MockServerEtag1);

    // assume server has already set the current track
    mockMusicPlayer.playbackState.context_uri = mockPlaybackState.context_uri;
    mockMusicPlayer.playbackState.current_track_uri = mockPlaybackState.current_track_uri;

    await expect(stationManager.applyServerState(mockPlaybackState)).resolves.toBeUndefined();

    verify_music_player_playback_state(mockMusicPlayer, mockPlaybackState);
    expect(stationManager.serverEtag).toEqual(mockPlaybackState.etag);
});

test('station manager correctly adjusts playback state when server is playing', async () => {
    let mockMusicPlayer = new MockMusicPlayer();
    let stationManager = new StationManager(
        ListenerRole.None,
        new StationServer(MockStationId, new MockWebSocketBridge()),
        new StationMusicPlayer(mockMusicPlayer));

    const mockPlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, false /*paused*/,
        10000 /*raw_position_ms*/, new Date(), MockServerEtag1);

    // assume server has already set the current track
    mockMusicPlayer.playbackState.context_uri = mockPlaybackState.context_uri;
    mockMusicPlayer.playbackState.current_track_uri = mockPlaybackState.current_track_uri;

    await expect(stationManager.applyServerState(mockPlaybackState)).resolves.toBeUndefined();

    const expectedPlaybackState = Object.assign({}, mockPlaybackState, {
        raw_position_ms: mockPlaybackState.raw_position_ms + SEEK_OVERCORRECT_MS,
    })
    verify_music_player_playback_state(mockMusicPlayer, expectedPlaybackState);
    expect(stationManager.serverEtag).toEqual(mockPlaybackState.etag);
});

test('station manager correctly handles precondition failed', async () => {
    let mockWebSocketBridge = new MockWebSocketBridge();
    let mockMusicPlayer = new MockMusicPlayer();
    let stationManager = new StationManager(
        ListenerRole.None,
        new StationServer(MockStationId, mockWebSocketBridge),
        new StationMusicPlayer(mockMusicPlayer));

    const mockPlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, new Date());

    // Set up callback for server receiving get request and response
    // assume server has already set the current track
    mockWebSocketBridge.receiveData().then(data => {
        expect(data).toEqual(expect.objectContaining({
            'command': 'get_playback_state',
            'request_id': expect.any(Number),
            'state': mockMusicPlayer.playbackState,
        }));

        // Server would update current track on behalf of client
        mockMusicPlayer.playbackState.context_uri = mockPlaybackState.context_uri;
        mockMusicPlayer.playbackState.current_track_uri = mockPlaybackState.current_track_uri;

        let responsePlaybackState = mockPlaybackState;
        responsePlaybackState.etag = MockServerEtag1;
        mockWebSocketBridge.fire({
            'type': 'ensure_playback_state',
            'request_id': data.request_id,
            'state': responsePlaybackState,
        });
    });

    // Set up callback for music player state change correct
    let donePromise = new Promise(resolve => {
        mockMusicPlayer.on('player_state_changed', (playbackState: PlaybackState) => {
            expect(playbackState.context_uri).toEqual(mockPlaybackState.context_uri);
            expect(playbackState.current_track_uri).toEqual(mockPlaybackState.current_track_uri);
            expect(playbackState.paused).toBe(mockPlaybackState.paused);
            expect(playbackState.raw_position_ms).toBe(mockPlaybackState.raw_position_ms);
            resolve();
        });
    });

    mockWebSocketBridge.fire({
        error: 'precondition_failed',
        message: 'out of sync',
    });

    await expect(donePromise).resolves.toBeUndefined();
});

test('station manager correctly handles internal server error', async () => {
    expect.assertions(4);

    let mockMusicPlayer = new MockMusicPlayer();
    let stationMusicPlayer = new StationMusicPlayer(mockMusicPlayer);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationManager = new StationManager(
        ListenerRole.None,
        new StationServer(MockStationId, mockWebSocketBridge),
        stationMusicPlayer);

    let initialPlaybackState = mockMusicPlayer.playbackState;
    stationManager.bindSteadyStateActions();

    mockWebSocketBridge.fire({
        error: 'internal_server_error',
        message: 'unknown error occurred',
    });

    mockWebSocketBridge.fire({
        'type': 'ensure_playback_state',
        'state': new PlaybackState(MockContextUri, MockCurrentTrackUri, true /*paused*/, 0, new Date()),
    });
    await wait(50).then(() => {
        verify_music_player_playback_state(mockMusicPlayer, initialPlaybackState);
    });
});
