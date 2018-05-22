export class PlaybackState2 {
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

    getCurrentState(): Promise<PlaybackState2 | null>;

    getVolume(): Promise<number>;
    setVolume(value: number): Promise<void>;

    pause(): Promise<void>;
    resume(): Promise<void>;
    togglePlay(): Promise<void>;

    seek(positionMS: number): Promise<void>;

    previousTrack(): Promise<void>;
    nextTrack(): Promise<void>;
}
