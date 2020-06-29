import * as $ from "jquery";

import { IMusicPlayer, IPlayerInit, PlaybackState } from "./music_player";

export default class SpotifyMusicPlayer implements IMusicPlayer {
  private impl: Spotify.SpotifyPlayer;
  private getOAuthToken: (cb: (accessToken: string) => void) => void;
  private deviceId?: string;
  private observers = new Map([
    ["authentication_error", $.Callbacks()],
    ["account_error", $.Callbacks()],
    ["too_many_requests_error", $.Callbacks()],
  ]);

  constructor(options: IPlayerInit) {
    this.impl = new Spotify.Player({
      getOAuthToken: options.getOAuthToken,
      name: options.clientName,
      volume: options.initialVolume,
    });
    this.getOAuthToken = options.getOAuthToken;

    this.impl.on("ready", ({ device_id }) => {
      this.deviceId = device_id;
    });
  }

  public connect(): Promise<boolean> {
    return this.impl.connect();
  }

  public on(eventName: string, cb: (_args: any[]) => void): void {
    if (eventName === "player_state_changed") {
      this.impl.on(eventName, (rawPlaybackState) => {
        const playbackState = rawPlaybackState
          ? createPlaybackStateFromSpotify(rawPlaybackState)
          : undefined;
        cb(playbackState as any);
      });
    } else if (eventName === "too_many_requests_error") {
      this.observers.get(eventName)!.add(cb);
    } else {
      // @ts-ignore: Spotify.SpotifyPlayer requires multiple overloads
      this.impl.on(eventName, cb);

      if (
        eventName === "authentication_error" ||
        eventName === "account_error"
      ) {
        this.observers.get(eventName)!.add(cb);
      }
    }
  }

  public removeListener(eventName: string): void {
    // @ts-ignore: Spotify.SpotifyPlayer requires multiple overloads
    this.impl.removeListener(eventName);
  }

  public async getCurrentState(): Promise<PlaybackState | null> {
    const state = await this.impl.getCurrentState();
    return state ? createPlaybackStateFromSpotify(state) : null;
  }

  public getVolume(): Promise<number> {
    return this.impl.getVolume();
  }
  public setVolume(value: number): Promise<void> {
    return this.impl.setVolume(value);
  }

  public play(contextUri: string, currentTrackUri: string): Promise<void> {
    return this.playWithRetry(contextUri, currentTrackUri);
  }

  public async playWithRetry(
    contextUri: string,
    currentTrackUri: string,
    retryCount = 0
  ): Promise<void> {
    if (!this.deviceId) {
      return Promise.reject("Spotify is not ready: no deviceId");
    }

    const response = await this.putStartResumePlaybackRequest(
      contextUri,
      currentTrackUri
    );
    switch (response.status) {
      case 202:
        // device is temporarily unavailable
        ++retryCount;
        if (retryCount < 5) {
          return this.playWithRetry(contextUri, currentTrackUri, retryCount);
        } else {
          throw new Error("Device is unavailable after 5 retries");
        }
      case 204:
        // successful request
        break;
      case 401:
        this.observers.get("authentication_error")!.fire(response.json());
        break;
      case 403:
        this.observers.get("account_error")!.fire(response.json());
        break;
      case 429:
        this.observers
          .get("too_many_requests_error")!
          .fire(response.headers.get("Retry-After"));
        break;
      default:
        break;
    }
  }

  public pause(): Promise<void> {
    return this.impl.pause();
  }
  public resume(): Promise<void> {
    return this.impl.resume();
  }
  public togglePlay(): Promise<void> {
    return this.impl.togglePlay();
  }

  public seek(positionMS: number): Promise<void> {
    return this.impl.seek(positionMS);
  }

  public previousTrack(): Promise<void> {
    return this.impl.previousTrack();
  }
  public nextTrack(): Promise<void> {
    return this.impl.nextTrack();
  }

  private putStartResumePlaybackRequest(
    contextUri: string,
    currentTrackUri: string
  ): Promise<Response> {
    const baseUrl = "https://api.spotify.com/v1/me/player/play";
    const queryParams = `device_id=${this.deviceId}`;
    const url = `${baseUrl}?${queryParams}`;

    return new Promise((resolve) => {
      this.getOAuthToken(resolve);
    }).then((accessToken) => {
      return fetch(url, {
        body: JSON.stringify({
          context_uri: contextUri,
          offset: { uri: currentTrackUri },
        }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: "PUT",
      });
    });
  }
}

function createPlaybackStateFromSpotify(
  state: Spotify.PlaybackState
): PlaybackState {
  return new PlaybackState(
    state.context.uri as string,
    state.track_window.current_track.uri,
    state.paused,
    state.position,
    // @ts-ignore: Spotify.PlaybackState does have timestamp
    new Date(state.timestamp),
    undefined,
    state.track_window.current_track.album.images[0].url,
    state.track_window.current_track.album.name,
    state.track_window.current_track.name,
    state.track_window.current_track.artists[0].name,
    state.duration
  );
}
