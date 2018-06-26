import * as $ from 'jquery';

export class PlaybackState {
    constructor(public context_uri: string,
        public current_track_uri: string, public paused: boolean,
        public raw_position_ms: number, public sample_time: Date,
        public etag?: Date, public album_image_url?: string,
        public album_name?: string, public current_track_name?: string, public artist_name?: string,
        public duration?: number) {
    }
}

export interface MusicPlayer {
    connect(): Promise<boolean>;

    on(eventName: string, cb: (...args: any[]) => void): void;
    removeListener(eventName: string): void;

    getCurrentState(): Promise<PlaybackState | null>;

    getVolume(): Promise<number>;
    setVolume(value: number): Promise<void>;

    play(contextUri: string, currentTrackUri: string): Promise<void>;

    pause(): Promise<void>;
    resume(): Promise<void>;
    togglePlay(): Promise<void>;

    seek(positionMS: number): Promise<void>;

    previousTrack(): Promise<void>;
    nextTrack(): Promise<void>;
}

export interface PlayerInit {
    clientName: string;
    getOAuthToken(cb: (token: string) => void): void;
    initialVolume?: number;
}

export function createSpotifyMusicPlayer(options: PlayerInit): MusicPlayer {
    return new SpotifyMusicPlayer(options);
}

class SpotifyMusicPlayer implements MusicPlayer {
    impl: Spotify.SpotifyPlayer;
    getOAuthToken: (cb: (accessToken: string) => void) => void;
    deviceId?: string;
    observers = new Map([
        ['authentication_error', $.Callbacks()],
        ['account_error', $.Callbacks()],
        ['too_many_requests_error', $.Callbacks()],
    ]);

    constructor(options: PlayerInit) {
        this.impl = new Spotify.Player({
            name: options.clientName,
            getOAuthToken: options.getOAuthToken,
            volume: options.initialVolume,
        });
        this.getOAuthToken = options.getOAuthToken;

        this.impl.on('ready', ({ device_id }) => {
            this.deviceId = device_id;
        });
    }

    connect(): Promise<boolean> { return this.impl.connect(); }

    on(eventName: string, cb: (_args: any[]) => void) {
        if (eventName === 'player_state_changed') {
            this.impl.on(eventName, playbackState => {
                cb(<any>createPlaybackStateFromSpotify(playbackState));
            });
        } else if (eventName === 'too_many_requests_error') {
            this.observers.get(eventName)!.add(cb);
        } else {
            // @ts-ignore: Spotify.SpotifyPlayer requires multiple overloads
            this.impl.on(eventName, cb);

            if ((eventName === 'authentication_error') || (eventName === 'account_error')) {
                this.observers.get(eventName)!.add(cb);
            }
        }
    }

    removeListener(eventName: string) {
        // @ts-ignore: Spotify.SpotifyPlayer requires multiple overloads
        this.impl.removeListener(eventName);
    }

    getCurrentState(): Promise<PlaybackState | null> {
        return this.impl.getCurrentState().then(state => {
            return (state ? createPlaybackStateFromSpotify(state) : null);
        });
    }

    getVolume(): Promise<number> { return this.impl.getVolume(); }
    setVolume(value: number): Promise<void> { return this.impl.setVolume(value); }

    play(contextUri: string, currentTrackUri: string): Promise<void> {
        return this.playWithRetry(contextUri, currentTrackUri);
    }

    playWithRetry(contextUri: string, currentTrackUri: string, retryCount = 0): Promise<void> {
        if (!this.deviceId) {
            return Promise.reject('Spotify is not ready: no deviceId');
        }

        return this.putStartResumePlaybackRequest(contextUri, currentTrackUri)
            .then(response => {
                switch (response.status) {
                    case 202:
                        // device is temporarily unavailable
                        ++retryCount;
                        if (retryCount < 5) {
                            return this.playWithRetry(contextUri, currentTrackUri, retryCount);
                        } else {
                            return Promise.reject('Device is unavailable after 5 retries');
                        }
                    case 204:
                        // successful request
                        break;
                    case 401:
                        this.observers.get('authentication_error')!.fire(response.json());
                        break;
                    case 403:
                        this.observers.get('account_error')!.fire(response.json());
                        break;
                    case 429:
                        this.observers.get('too_many_requests_error')!.fire(response.headers.get('Retry-After'));
                        break;
                    default:
                        break;
                }

                return Promise.resolve();
            });
    }

    putStartResumePlaybackRequest(contextUri: string, currentTrackUri: string): Promise<Response> {
        const baseUrl = 'https://api.spotify.com/v1/me/player/play';
        const queryParams = `device_id=${this.deviceId}`;
        const url = `${baseUrl}?${queryParams}`;

        return new Promise(resolve => {
            this.getOAuthToken(resolve);
        }).then(accessToken => {
            return fetch(url, {
                body: JSON.stringify({
                    'context_uri': contextUri,
                    'offset': { 'uri': currentTrackUri },
                }),
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
                method: 'PUT',
            });
        });
    }

    pause(): Promise<void> { return this.impl.pause(); }
    resume(): Promise<void> { return this.impl.resume(); }
    togglePlay(): Promise<void> { return this.impl.togglePlay(); }

    seek(positionMS: number): Promise<void> { return this.impl.seek(positionMS); }

    previousTrack(): Promise<void> { return this.impl.previousTrack(); }
    nextTrack(): Promise<void> { return this.impl.nextTrack(); }
}

function createPlaybackStateFromSpotify(state: Spotify.PlaybackState) {
    return new PlaybackState(
        <string>state.context.uri,
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
        state.duration,
    );
}
