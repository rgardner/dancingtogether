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
    getAccessToken(): string;
    setAccessToken(value: string): void;

    connect(): Promise<boolean>;

    on(eventName: string, cb: (...args: any[]) => void): void;

    getCurrentState(): Promise<PlaybackState | null>;

    getVolume(): Promise<number>;
    setVolume(value: number): Promise<void>;

    pause(): Promise<void>;
    resume(): Promise<void>;
    togglePlay(): Promise<void>;

    seek(positionMS: number): Promise<void>;

    previousTrack(): Promise<void>;
    nextTrack(): Promise<void>;
}

export class SpotifyMusicPlayer implements MusicPlayer {
    impl: Spotify.SpotifyPlayer;
    playerStateChangeObservers = $.Callbacks();

    constructor(clientName: string, private accessToken: string) {
        this.impl = new Spotify.Player({
            name: clientName,
            getOAuthToken: cb => { cb(this.getAccessToken()); },
            volume: 0.8, // TODO: use cached volume
        });

    }

    getAccessToken(): string { return this.accessToken; }
    setAccessToken(value: string) { this.accessToken = value; }

    connect(): Promise<boolean> { return this.impl.connect(); }

    on(eventName: string, cb: (_args: any[]) => void) {
        // @ts-ignore: Spotify.SpotifyPlayer requires multiple overloads
        return this.impl.on(eventName, cb);
    }

    getCurrentState(): Promise<PlaybackState | null> {
        return this.impl.getCurrentState().then(state => {
            return (state ? createPlaybackStateFromSpotify(state) : null);
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

export function createPlaybackStateFromSpotify(state: Spotify.PlaybackState) {
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
