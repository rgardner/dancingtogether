import * as $ from 'jquery';

import { IMusicPlayer, IPlayerInit, PlaybackState } from '../music_player';

export default class MockMusicPlayer implements IMusicPlayer {
    public playbackState = new PlaybackState('', '', true, 0, new Date());
    private getOAuthToken: (cb: (accessToken: string) => void) => void;
    private observers = new Map([
        ['player_state_changed', $.Callbacks()],
    ]);

    // IMusicPlayer

    constructor(options: IPlayerInit) {
        this.getOAuthToken = options.getOAuthToken;
    }

    public getAccessToken() { return ''; }

    // tslint:disable-next-line:no-empty
    public setAccessToken(_value: string) { }

    public connect(): Promise<boolean> { return Promise.resolve(true); }

    public on(eventName: string, cb: any) {
        let callbacks = this.observers.get(eventName);
        if (!callbacks) {
            callbacks = $.Callbacks();
            this.observers.set(eventName, callbacks);
        }

        callbacks.add(cb);
    }

    public removeListener(eventName: string) {
        this.observers.get(eventName)!.empty();
    }

    public getCurrentState(): Promise<PlaybackState> {
        return Promise.resolve(this.playbackState);
    }

    public getVolume(): Promise<number> { return Promise.reject('not implemented'); }

    public setVolume(_value: number): Promise<void> { return Promise.reject('not implemented'); }

    public play(_contextUri: string, _currentTrackUri: string): Promise<void> {
        return Promise.reject('not implemented');
    }

    public pause(): Promise<void> {
        this.playbackState.paused = true;
        this.firePlayerStateChange();
        return Promise.resolve();
    }

    public resume(): Promise<void> {
        this.playbackState.paused = false;
        this.firePlayerStateChange();
        return Promise.resolve();
    }

    public togglePlay(): Promise<void> {
        this.playbackState.paused = !this.playbackState.paused;
        this.firePlayerStateChange();
        return Promise.resolve();
    }

    public seek(positionMS: number): Promise<void> {
        this.playbackState.raw_position_ms = positionMS;
        this.firePlayerStateChange();
        return Promise.resolve();
    }

    public previousTrack(): Promise<void> { return Promise.reject("not implemented"); }
    public nextTrack(): Promise<void> { return Promise.reject("not implemented"); }

    // Mock functions

    public requestOAuthToken(): Promise<string> {
        return new Promise(resolve => {
            this.getOAuthToken(resolve);
        });
    }

    public fire(eventName: string, payload: any) {
        this.observers.get(eventName)!.fire(payload);
    }

    public firePlayerStateChange() {
        this.getCurrentState().then(playbackState => {
            const newPlaybackState = Object.assign({}, playbackState, {
                sample_time: new Date(),
            });
            this.observers.get('player_state_changed')!.fire(newPlaybackState)
        });
    }
}
