import fetchMock from "jest-fetch-mock";
import * as React from "react";
import * as renderer from "react-test-renderer";

import { PlaybackState } from "../music_player";
import {
  IListener,
  SEEK_OVERCORRECT_MS,
  ServerError,
  StationManager,
  StationServer,
} from "../station";
import { ListenerRole } from "../util";
import { IWebSocketBridge, WebSocketListenCallback } from "../websocket_bridge";
jest.mock("../spotify_music_player");

import MockMusicPlayer from "../__mocks__/spotify_music_player";

const MOCK_USER_ID = 1;
const MOCK_USERNAME1 = "MOCK_USERNAME1";
const MOCK_STATION_ID = 1;
const MOCK_STATION_NAME = "MOCK_STATION_NAME";
const MOCK_CROSS_SITE_REQUEST_FORGERY_TOKEN =
  "MOCK_CROSS_SITE_REQUEST_FORGERY_TOKEN";
const MOCK_CONTEXT_URI = "MOCK_CONTEXT_URI";
const MOCK_CURRENT_TRACK_URI = "MOCK_CURRENT_TRACK_URI";
const MOCK_SERVER_ETAG1 = new Date("2018-05-20T20:57:33.992Z");
const MOCK_SERVER_ETAG2 = new Date("2018-05-20T20:58:33.992Z");
const MOCK_PLAYER_NAME = "MOCK_PLAYER_NAME";
const MOCK_ACCESS_TOKEN1 = "MOCK_ACCESS_TOKEN1";
const MOCK_ACCESS_TOKEN2 = "MOCK_ACCESS_TOKEN2";
const MOCK_ACCESS_TOKEN_EXPIRATION_TIME1 = new Date("2018-05-20T20:59:33.992Z");
const MOCK_ACCESS_TOKEN_EXPIRATION_TIME2 = new Date("2018-05-20T21:60:33.992Z");
const DEBUG = false;

beforeEach(() => {
  // Mock StationManager.getAdjustedPlaybackPosition, as it adjusts based on
  // the client/server time offset via Date.getTime, which is
  // non-deterministic
  const getAdjustedPlaybackPosition = jest
    .fn()
    .mockImplementation((serverState) => {
      return serverState.raw_position_ms;
    });
  StationManager.prototype.getAdjustedPlaybackPosition = getAdjustedPlaybackPosition.bind(
    StationManager
  );

  fetchMock.resetMocks();
});

class MockWebSocketBridge implements IWebSocketBridge {
  private callback?: WebSocketListenCallback;
  private receiveDataCallback?: (data: any) => void;

  // IWebSocketBridge

  // tslint:disable-next-line:no-empty
  public connect(_path: string) {}

  public listen(callback: WebSocketListenCallback) {
    this.callback = callback;
  }

  public send(data: any) {
    this.receiveDataCallback!(data);
    this.receiveDataCallback = undefined;
  }

  // Mock functions

  public fire(data: any) {
    this.callback!(data);
  }

  public receiveData(): Promise<any> {
    return new Promise((resolve) => {
      this.receiveDataCallback = resolve;
    });
  }
}

function createStationServer(mockWebSocketBridge: MockWebSocketBridge) {
  return new StationServer(
    MOCK_STATION_ID,
    MOCK_CROSS_SITE_REQUEST_FORGERY_TOKEN,
    mockWebSocketBridge
  );
}

describe("station server", () => {
  it("can send a ping", async () => {
    expect.assertions(2);
    const mockWebSocketBridge = new MockWebSocketBridge();
    const stationServer = createStationServer(mockWebSocketBridge);

    mockWebSocketBridge.receiveData().then((data) => {
      expect(data).toEqual(
        expect.objectContaining({
          command: "ping",
          start_time: expect.any(Date),
        })
      );
      mockWebSocketBridge.fire({
        server_time: new Date(),
        start_time: data.start_time,
        type: "pong",
      });
    });

    await expect(stationServer.sendPingRequest()).resolves.toEqual(
      expect.objectContaining({
        serverTime: expect.any(Date),
        startTime: expect.any(Date),
      })
    );
  });

  it("can send a playback state", async () => {
    expect.assertions(2);
    const stationServer = createStationServer(new MockWebSocketBridge());

    // Mock server response
    const sampleTime = new Date();
    const responsePlaybackState = new ServerPlaybackState(
      MOCK_CONTEXT_URI,
      MOCK_CURRENT_TRACK_URI,
      true /*paused*/,
      1000 /*raw_position_ms*/,
      sampleTime,
      MOCK_SERVER_ETAG2
    );
    fetchMock.mockResponseOnce(
      JSON.stringify({
        playbackstate: responsePlaybackState,
      })
    );

    const currentPlaybackState = new ServerPlaybackState(
      MOCK_CONTEXT_URI,
      MOCK_CURRENT_TRACK_URI,
      true /*paused*/,
      1000 /*raw_position_ms*/,
      sampleTime
    );

    const expectedResponsePlaybackState = new PlaybackState(
      MOCK_CONTEXT_URI,
      MOCK_CURRENT_TRACK_URI,
      true /*paused*/,
      1000 /*raw_position_ms*/,
      sampleTime,
      MOCK_SERVER_ETAG2
    );
    await expect(
      stationServer.sendPlaybackState(currentPlaybackState)
    ).resolves.toEqual(expectedResponsePlaybackState);

    expect(fetchMock.mock.calls.length).toEqual(1);
  });

  it("can get the playback state", async () => {
    expect.assertions(2);
    const stationServer = createStationServer(new MockWebSocketBridge());

    // Mock server response
    const sampleTime = new Date();
    const responsePlaybackState = new ServerPlaybackState(
      MOCK_CONTEXT_URI,
      MOCK_CURRENT_TRACK_URI,
      true /*paused*/,
      1000 /*raw_position_ms*/,
      sampleTime,
      MOCK_SERVER_ETAG2
    );
    fetchMock.mockResponseOnce(
      JSON.stringify({
        playbackstate: responsePlaybackState,
      })
    );

    const expectedResponsePlaybackState = new PlaybackState(
      MOCK_CONTEXT_URI,
      MOCK_CURRENT_TRACK_URI,
      true /*paused*/,
      1000 /*raw_position_ms*/,
      sampleTime,
      MOCK_SERVER_ETAG2
    );
    await expect(stationServer.getPlaybackState()).resolves.toEqual(
      expectedResponsePlaybackState
    );

    expect(fetchMock.mock.calls.length).toEqual(1);
  });

  it("fires notifications for station state changes", async () => {
    expect.assertions(1);
    const mockWebSocketBridge = new MockWebSocketBridge();
    const stationServer = createStationServer(mockWebSocketBridge);

    const sampleTime = new Date();
    const mockPlaybackState = new PlaybackState(
      MOCK_CONTEXT_URI,
      MOCK_CURRENT_TRACK_URI,
      true /*paused*/,
      0 /*raw_position_ms*/,
      sampleTime,
      MOCK_SERVER_ETAG1
    );

    stationServer.on("playback_state_changed", (data: PlaybackState) => {
      expect(data).toEqual(mockPlaybackState);
    });
    mockWebSocketBridge.fire({
      playbackstate: new ServerPlaybackState(
        MOCK_CONTEXT_URI,
        MOCK_CURRENT_TRACK_URI,
        true /*paused*/,
        0 /*raw_position_ms*/,
        sampleTime,
        MOCK_SERVER_ETAG1
      ),
      type: "playback_state_changed",
    });
  });

  it("fires notifications for errors", async () => {
    expect.assertions(2);
    const mockWebSocketBridge = new MockWebSocketBridge();
    const stationServer = createStationServer(mockWebSocketBridge);

    const mockError1 = {
      error: "client_error",
      message: "failed to join station",
    };
    stationServer.onOnce("error", (error: ServerError, message: string) => {
      expect(error).toEqual(ServerError.ClientError);
      expect(message).toEqual(mockError1.message);
    });

    mockWebSocketBridge.fire(mockError1);
  });

  function createServerListener(listener: IListener) {
    return {
      id: listener.id,
      is_admin: listener.isAdmin,
      is_dj: listener.isDJ,
      station: listener.stationId,
      user: listener.username,
    };
  }

  it("can get listeners", async () => {
    const stationServer = createStationServer(new MockWebSocketBridge());

    // Mock server response
    const listener = {
      id: 2,
      isAdmin: false,
      isDJ: false,
      stationId: MOCK_STATION_ID,
      username: MOCK_USERNAME1,
    };
    const responseListeners = [createServerListener(listener)];
    fetchMock.mockResponseOnce(JSON.stringify(responseListeners));

    await expect(stationServer.getListeners()).resolves.toEqual([listener]);

    expect(fetchMock.mock.calls.length).toEqual(1);
  });

  test("station server can invite listeners", async () => {
    const stationServer = createStationServer(new MockWebSocketBridge());

    // Mock server response
    const listener = {
      id: 2,
      isAdmin: false,
      isDJ: false,
      stationId: MOCK_STATION_ID,
      username: MOCK_USERNAME1,
    };
    fetchMock.mockResponseOnce(JSON.stringify(createServerListener(listener)));

    await expect(
      stationServer.inviteListener(
        listener.username,
        listener.isAdmin,
        listener.isDJ
      )
    ).resolves.toEqual(listener);

    expect(fetchMock.mock.calls.length).toEqual(1);
  });
});

function createStationManager(stationServer: StationServer) {
  return renderer.create(
    <StationManager
      userId={MOCK_USER_ID}
      listenerRole={ListenerRole.None}
      stationTitle={MOCK_STATION_NAME}
      server={stationServer}
      clientName={MOCK_PLAYER_NAME}
      accessToken={MOCK_ACCESS_TOKEN1}
      accessTokenExpirationTime={MOCK_ACCESS_TOKEN_EXPIRATION_TIME1}
      debug={DEBUG}
    />
  );
}

function addDefaultNetworkTimes(stationManager: StationManager) {
  stationManager.state.roundTripTimes.push(0);
  stationManager.state.clientServerTimeOffsets.push(0);
}

describe("station manager", () => {
  it("correctly adjusts client server time offset", async () => {
    const stationManager = createStationManager(
      createStationServer(new MockWebSocketBridge())
    ).root.instance;

    const startTime = new Date("2018-05-31T00:00:01.000Z");
    const serverTime = new Date("2018-05-31T00:00:03.000Z");
    const currentTime = new Date("2018-05-31T00:00:02.000Z");
    stationManager.adjustServerTimeOffset(startTime, serverTime, currentTime);

    expect(stationManager.state.roundTripTimes.length).toBe(1);
    expect(stationManager.state.roundTripTimes.entries()).toEqual([1000]);
    expect(stationManager.state.clientServerTimeOffsets.length).toBe(1);
    expect(stationManager.state.clientServerTimeOffsets.entries()).toEqual([
      1500,
    ]);
  });

  function verify_music_player_playback_state(
    mockMusicPlayer: MockMusicPlayer,
    playbackState: PlaybackState
  ) {
    expect(mockMusicPlayer.playbackState.context_uri).toEqual(
      playbackState.context_uri
    );
    expect(mockMusicPlayer.playbackState.current_track_uri).toEqual(
      playbackState.current_track_uri
    );
    expect(mockMusicPlayer.playbackState.paused).toBe(playbackState.paused);
    expect(mockMusicPlayer.playbackState.raw_position_ms).toBe(
      playbackState.raw_position_ms
    );
  }

  it("correctly adjusts playback state when server is paused", async () => {
    const stationManager = createStationManager(
      createStationServer(new MockWebSocketBridge())
    ).root.instance;
    addDefaultNetworkTimes(stationManager);

    const mockPlaybackState = new PlaybackState(
      MOCK_CONTEXT_URI,
      MOCK_CURRENT_TRACK_URI,
      true /*paused*/,
      0 /*raw_position_ms*/,
      new Date(),
      MOCK_SERVER_ETAG1
    );

    // assume server has already set the current track
    const mockMusicPlayer = stationManager.getMusicPlayer() as MockMusicPlayer;
    mockMusicPlayer!.playbackState.context_uri = mockPlaybackState.context_uri;
    mockMusicPlayer!.playbackState.current_track_uri =
      mockPlaybackState.current_track_uri;

    await expect(
      stationManager.applyServerPlaybackState(mockPlaybackState)
    ).resolves.toBeUndefined();

    verify_music_player_playback_state(mockMusicPlayer!, mockPlaybackState);
    expect(stationManager.state.serverEtag).toEqual(mockPlaybackState.etag);
  });

  it("correctly adjusts playback state when server is playing", async () => {
    const stationManager = createStationManager(
      createStationServer(new MockWebSocketBridge())
    ).root.instance;
    addDefaultNetworkTimes(stationManager);

    const mockPlaybackState = new PlaybackState(
      MOCK_CONTEXT_URI,
      MOCK_CURRENT_TRACK_URI,
      false /*paused*/,
      10000 /*raw_position_ms*/,
      new Date(),
      MOCK_SERVER_ETAG1
    );

    // assume server has already set the current track
    const mockMusicPlayer = stationManager.getMusicPlayer() as MockMusicPlayer;
    mockMusicPlayer!.playbackState.context_uri = mockPlaybackState.context_uri;
    mockMusicPlayer!.playbackState.current_track_uri =
      mockPlaybackState.current_track_uri;

    await expect(
      stationManager.applyServerPlaybackState(mockPlaybackState)
    ).resolves.toBeUndefined();

    const expectedPlaybackState = Object.assign({}, mockPlaybackState, {
      raw_position_ms: mockPlaybackState.raw_position_ms + SEEK_OVERCORRECT_MS,
    });
    verify_music_player_playback_state(mockMusicPlayer!, expectedPlaybackState);
    expect(stationManager.state.serverEtag).toEqual(mockPlaybackState.etag);
  });

  it.skip("correctly handles precondition failed", async () => {
    const mockWebSocketBridge = new MockWebSocketBridge();
    const stationManager = createStationManager(
      createStationServer(mockWebSocketBridge)
    ).root.instance;
    addDefaultNetworkTimes(stationManager);

    const mockPlaybackState = new PlaybackState(
      MOCK_CONTEXT_URI,
      MOCK_CURRENT_TRACK_URI,
      true /*paused*/,
      0 /*raw_position_ms*/,
      new Date()
    );

    // Set up callback for server receiving get request and response
    // assume server has already set the current track
    const mockMusicPlayer = stationManager.getMusicPlayer() as MockMusicPlayer;
    mockWebSocketBridge.receiveData().then((data) => {
      expect(data).toEqual(
        expect.objectContaining({
          command: "get_playback_state",
          request_id: expect.any(Number),
          state: mockMusicPlayer.playbackState,
        })
      );

      // Server would update current track on behalf of client
      mockMusicPlayer.playbackState.context_uri = mockPlaybackState.context_uri;
      mockMusicPlayer.playbackState.current_track_uri =
        mockPlaybackState.current_track_uri;

      const responsePlaybackState = mockPlaybackState;
      responsePlaybackState.etag = MOCK_SERVER_ETAG1;
      mockWebSocketBridge.fire({
        request_id: data.request_id,
        state: responsePlaybackState,
        type: "ensure_playback_state",
      });
    });

    // Set up callback for music player state change correct
    const donePromise = new Promise((resolve) => {
      mockMusicPlayer.on(
        "player_state_changed",
        (playbackState: PlaybackState) => {
          expect(playbackState.context_uri).toEqual(
            mockPlaybackState.context_uri
          );
          expect(playbackState.current_track_uri).toEqual(
            mockPlaybackState.current_track_uri
          );
          expect(playbackState.paused).toBe(mockPlaybackState.paused);
          expect(playbackState.raw_position_ms).toBe(
            mockPlaybackState.raw_position_ms
          );
          resolve();
        }
      );
    });

    await expect(donePromise).resolves.toBeUndefined();
  });

  it("requests a fresh access token when needed", async () => {
    const stationManager = createStationManager(
      createStationServer(new MockWebSocketBridge())
    );

    fetchMock.mockResponseOnce(
      JSON.stringify({
        token: MOCK_ACCESS_TOKEN2,
        token_expiration_time: MOCK_ACCESS_TOKEN_EXPIRATION_TIME2,
      })
    );

    const mockMusicPlayer = stationManager.root.instance.getMusicPlayer() as MockMusicPlayer;
    await expect(mockMusicPlayer!.requestOAuthToken()).resolves.toEqual(
      MOCK_ACCESS_TOKEN2
    );
  });
});

class ServerPlaybackState {
  // tslint:disable:variable-name
  constructor(
    public context_uri: string,
    public current_track_uri: string,
    public paused: boolean,
    public raw_position_ms: number,
    public sample_time: Date,
    public last_updated_time?: Date
  ) {}
  // tslint:enable:variable-name
}
