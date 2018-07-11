import * as $ from 'jquery';
import { ListenerRole } from '../static/js/util';
import {
    MusicPlayer, PlaybackState, PlayerInit, createSpotifyMusicPlayer,
} from '../static/js/music_player';
import { WebSocketBridge, WebSocketListenCallback } from '../static/js/websocket_bridge';
import {
    Listener, SEEK_OVERCORRECT_MS, StationManager, StationServer, ServerError,
    ServerListener,
} from '../static/js/station'

const MockUserId = 1;
const MockUsername1 = 'MockUserName1';
const MockStationId = 1;
const MockStationName = 'MockStationName';
const MockCrossSiteRequestForgeryToken = 'MockCrossSiteRequestForgeryToken';
const MockContextUri = 'MockContextUri';
const MockCurrentTrackUri = 'MockCurrentTrackUri';
const MockServerEtag1 = new Date('2018-05-20T20:57:33.992Z');
const MockServerEtag2 = new Date('2018-05-20T20:58:33.992Z');
const MockPlayerName = 'MockPlayerName';
const MockAccessToken1 = 'MockAccessToken1';
const MockAccessToken2 = 'MockAccessToken2';
const MockAccessTokenExpirationTime1 = new Date('2018-05-20T20:59:33.992Z');
const MockAccessTokenExpirationTime2 = new Date('2018-05-20T21:60:33.992Z');
const Debug = false;

createSpotifyMusicPlayer = jest.fn();

beforeEach(() => {
    // Mock StationManager.getAdjustedPlaybackPosition, as it adjusts based on
    // the client/server time offset via Date.getTime, which is
    // non-deterministic
    const getAdjustedPlaybackPosition = jest.fn().mockImplementation(serverState => {
        return serverState.raw_position_ms;
    });
    StationManager.prototype.getAdjustedPlaybackPosition = getAdjustedPlaybackPosition.bind(StationManager);

    createSpotifyMusicPlayer.mockClear();
    fetch.resetMocks();
});

class MockMusicPlayer implements MusicPlayer {
    getOAuthToken: (cb: (accessToken: string) => void) => void;
    public playbackState = new PlaybackState('', '', true, 0, new Date());
    observers = new Map([
        ['player_state_changed', $.Callbacks()],
    ]);

    // MusicPlayer

    constructor(options: PlayerInit) {
        this.getOAuthToken = options.getOAuthToken;
    }

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

    play(_contextUri: string, _currentTrackUri: string): Promise<void> {
        return Promise.reject();
    }

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

    requestOAuthToken(): Promise<string> {
        return new Promise(resolve => {
            this.getOAuthToken(resolve);
        });
    }

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

function createStationServer(mockWebSocketBridge: MockWebSocketBridge) {
    return new StationServer(MockStationId, MockCrossSiteRequestForgeryToken, mockWebSocketBridge);
}

test('station server can send a ping', async () => {
    expect.assertions(2);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = createStationServer(mockWebSocketBridge);

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
    let stationServer = createStationServer(new MockWebSocketBridge());

    // Mock server response
    const sampleTime = new Date();
    const responsePlaybackState = new ServerPlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        1000 /*raw_position_ms*/, sampleTime, MockServerEtag2);
    fetch.mockResponseOnce(JSON.stringify({
        'playbackstate': responsePlaybackState,
    }));

    const currentPlaybackState = new ServerPlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        1000 /*raw_position_ms*/, sampleTime);

    const expectedResponsePlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        1000 /*raw_position_ms*/, sampleTime, MockServerEtag2);
    await expect(stationServer.sendPlaybackState(currentPlaybackState))
        .resolves.toEqual(expectedResponsePlaybackState);

    expect(fetch.mock.calls.length).toEqual(1);
});

test('station server can get the playback state', async () => {
    expect.assertions(2);
    let stationServer = createStationServer(new MockWebSocketBridge());

    // Mock server response
    const sampleTime = new Date();
    const responsePlaybackState = new ServerPlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        1000 /*raw_position_ms*/, sampleTime, MockServerEtag2);
    fetch.mockResponseOnce(JSON.stringify({
        'playbackstate': responsePlaybackState,
    }));

    const expectedResponsePlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        1000 /*raw_position_ms*/, sampleTime, MockServerEtag2);
    await expect(stationServer.getPlaybackState())
        .resolves.toEqual(expectedResponsePlaybackState);

    expect(fetch.mock.calls.length).toEqual(1);
});

test('station server fires notifications for station state changes', async () => {
    expect.assertions(1);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = createStationServer(mockWebSocketBridge);

    const sampleTime = new Date();
    const mockPlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, sampleTime, MockServerEtag1);

    stationServer.on('playback_state_changed', data => {
        expect(data).toEqual(mockPlaybackState);
    });
    mockWebSocketBridge.fire({
        'type': 'playback_state_changed',
        'playbackstate': new ServerPlaybackState(
            MockContextUri, MockCurrentTrackUri, true /*paused*/,
            0 /*raw_position_ms*/, sampleTime, MockServerEtag1
        ),
    });
});

test('station server fires notifications for errors', async () => {
    expect.assertions(2);
    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationServer = createStationServer(mockWebSocketBridge);

    const mockError1 = { error: 'client_error', message: 'failed to join station' };
    stationServer.onOnce('error', (error, message) => {
        expect(error).toEqual(ServerError.ClientError);
        expect(message).toEqual(mockError1.message);
    });

    mockWebSocketBridge.fire(mockError1);
});

function createServerListener(listener: Listener) {
    return {
        user: listener.username,
        station: listener.stationId,
        is_admin: listener.isAdmin,
        is_dj: listener.isDJ,
    };
}

test('station server can get listeners', async () => {
    let stationServer = createStationServer(new MockWebSocketBridge());

    // Mock server response
    const listener = {
        username: MockUsername1,
        stationId: MockStationId,
        isAdmin: false,
        isDJ: false,
    };
    const responseListeners = [createServerListener(listener)];
    fetch.mockResponseOnce(JSON.stringify(responseListeners));

    await expect(stationServer.getListeners()).resolves.toEqual([listener]);

    expect(fetch.mock.calls.length).toEqual(1);
});

test('station server can invite listeners', async () => {
    let stationServer = createStationServer(new MockWebSocketBridge());

    // Mock server response
    const listener = {
        username: MockUsername1,
        stationId: MockStationId,
        isAdmin: false,
        isDJ: false,
    };
    fetch.mockResponseOnce(JSON.stringify(createServerListener(listener)));

    await expect(stationServer.inviteListener(listener.username, listener.isAdmin, listener.isDJ))
        .resolves.toEqual(listener);

    expect(fetch.mock.calls.length).toEqual(1);
});

function createStationManager(stationServer: StationServer): StationManager {
    return new StationManager(
        MockUserId, ListenerRole.None, MockStationName, stationServer,
        MockPlayerName, MockAccessToken1, MockAccessTokenExpirationTime1, Debug);
}

function addDefaultNetworkTimes(stationManager: StationManager) {
    stationManager.roundTripTimes.push(0);
    stationManager.clientServerTimeOffsets.push(0);
}

test('station manager correctly adjusts client server time offset', async () => {
    let mockMusicPlayer: MusicPlayer = undefined;
    createSpotifyMusicPlayer.mockImplementation(options => {
        mockMusicPlayer = new MockMusicPlayer(options);
        return mockMusicPlayer;
    });

    let stationManager = createStationManager(
        createStationServer(new MockWebSocketBridge()),
    );

    let startTime = new Date('2018-05-31T00:00:01.000Z');
    let serverTime = new Date('2018-05-31T00:00:03.000Z');
    let currentTime = new Date('2018-05-31T00:00:02.000Z');
    stationManager.adjustServerTimeOffset(startTime, serverTime, currentTime);

    expect(stationManager.roundTripTimes.length).toBe(1);
    expect(stationManager.roundTripTimes.entries()).toEqual([1000]);
    expect(stationManager.clientServerTimeOffsets.length).toBe(1);
    expect(stationManager.clientServerTimeOffsets.entries()).toEqual([1500]);
});

function verify_music_player_playback_state(mockMusicPlayer: MockMusicPlayer, playbackState: PlaybackState) {
    expect(mockMusicPlayer.playbackState.context_uri).toEqual(playbackState.context_uri);
    expect(mockMusicPlayer.playbackState.current_track_uri).toEqual(playbackState.current_track_uri);
    expect(mockMusicPlayer.playbackState.paused).toBe(playbackState.paused);
    expect(mockMusicPlayer.playbackState.raw_position_ms).toBe(playbackState.raw_position_ms);
}

test('station manager correctly adjusts playback state when server is paused', async () => {
    let mockMusicPlayer: MockMusicPlayer = undefined;
    createSpotifyMusicPlayer.mockImplementation(options => {
        mockMusicPlayer = new MockMusicPlayer(options);
        return mockMusicPlayer;
    });

    let stationManager = createStationManager(createStationServer(new MockWebSocketBridge()));
    addDefaultNetworkTimes(stationManager);

    const mockPlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, true /*paused*/,
        0 /*raw_position_ms*/, new Date(), MockServerEtag1);

    // assume server has already set the current track
    mockMusicPlayer.playbackState.context_uri = mockPlaybackState.context_uri;
    mockMusicPlayer.playbackState.current_track_uri = mockPlaybackState.current_track_uri;

    await expect(stationManager.applyServerPlaybackState(mockPlaybackState)).resolves.toBeUndefined();

    verify_music_player_playback_state(mockMusicPlayer, mockPlaybackState);
    expect(stationManager.serverEtag).toEqual(mockPlaybackState.etag);
});


test('station manager correctly adjusts playback state when server is playing', async () => {
    let mockMusicPlayer: MockMusicPlayer = undefined;
    createSpotifyMusicPlayer.mockImplementation(options => {
        mockMusicPlayer = new MockMusicPlayer(options);
        return mockMusicPlayer;
    });

    let stationManager = createStationManager(createStationServer(new MockWebSocketBridge()));
    addDefaultNetworkTimes(stationManager);

    const mockPlaybackState = new PlaybackState(
        MockContextUri, MockCurrentTrackUri, false /*paused*/,
        10000 /*raw_position_ms*/, new Date(), MockServerEtag1);

    // assume server has already set the current track
    mockMusicPlayer.playbackState.context_uri = mockPlaybackState.context_uri;
    mockMusicPlayer.playbackState.current_track_uri = mockPlaybackState.current_track_uri;

    await expect(stationManager.applyServerPlaybackState(mockPlaybackState)).resolves.toBeUndefined();

    const expectedPlaybackState = Object.assign({}, mockPlaybackState, {
        raw_position_ms: mockPlaybackState.raw_position_ms + SEEK_OVERCORRECT_MS,
    })
    verify_music_player_playback_state(mockMusicPlayer, expectedPlaybackState);
    expect(stationManager.serverEtag).toEqual(mockPlaybackState.etag);
});

test.skip('station manager correctly handles precondition failed', async () => {
    let mockMusicPlayer: MockMusicPlayer = undefined;
    createSpotifyMusicPlayer.mockImplementation(options => {
        mockMusicPlayer = new MockMusicPlayer(options);
        return mockMusicPlayer;
    });

    let mockWebSocketBridge = new MockWebSocketBridge();
    let stationManager = createStationManager(createStationServer(mockWebSocketBridge));
    addDefaultNetworkTimes(stationManager);

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

    await expect(donePromise).resolves.toBeUndefined();
});

test('station manager requests a fresh access token when needed', async () => {
    let mockMusicPlayer: MockMusicPlayer = undefined;
    createSpotifyMusicPlayer.mockImplementation(options => {
        mockMusicPlayer = new MockMusicPlayer(options);
        return mockMusicPlayer;
    });

    createStationManager(createStationServer(new MockWebSocketBridge()));

    fetch.mockResponseOnce(JSON.stringify({
        'token': MockAccessToken2,
        'token_expiration_time': MockAccessTokenExpirationTime2,
    }));

    await expect(mockMusicPlayer.requestOAuthToken()).resolves.toEqual(MockAccessToken2);
});

class ServerPlaybackState {
    constructor(
        public context_uri: string,
        public current_track_uri: string,
        public paused: boolean,
        public raw_position_ms: number,
        public sample_time: Date,
        public last_updated_time?: Date,
    ) {
    }
}
