import * as React from 'react';

import { PlaybackState } from '../music_player';

const MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS = 1000;

export interface IMusicPlaybackStatePositionProps {
    paused: boolean;
    position: number;
    duration: number;
}

export interface IMusicPlaybackStatePositionState {
    autoPosition: number;
}

export class MusicPlaybackStatePosition extends React.Component<IMusicPlaybackStatePositionProps, IMusicPlaybackStatePositionState> {
    private refreshTimeoutId?: number;

    constructor(props: IMusicPlaybackStatePositionProps) {
        super(props);

        this.state = {
            autoPosition: props.position,
        };
    }

    public componentDidMount() {
        if (this.props.paused) {
            this.ensureDisableRefresh();
        } else {
            this.ensureEnableRefresh();
        }
    }

    public componentWillUnmount() {
        this.ensureDisableRefresh();
    }

    public render() {
        return (
            <div>
                {msToTimeString(this.state.autoPosition)}/{msToTimeString(this.props.duration)}
            </div>
        );
    }

    private ensureEnableRefresh() {
        this.refreshTimeoutId = window.setInterval(() => {
            this.setState(state => ({
                autoPosition: state.autoPosition + MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS,
            }));
        }, MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS);
    }

    private ensureDisableRefresh() {
        window.clearInterval(this.refreshTimeoutId);
    }
}

// milliseconds -> 'm:ss', rounding down, and left-padding seconds
// '0' -> '0:00'
// '153790' -> '2:33'
// Does not support hours (most songs are <60mins)
function msToTimeString(ms: number) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60).toString();
    const secondsRemainder = Math.floor(seconds % 60).toString();
    const secondsRemainderPad = (secondsRemainder.length === 1) ? '0' + secondsRemainder : secondsRemainder;
    return `${minutes}:${secondsRemainderPad}`;
}

export interface IMusicPlaybackStateProps {
    playbackState: PlaybackState;
}

export function MusicPlaybackState(props: IMusicPlaybackStateProps) {
    return (
        <div>
            <div>
                <img
                    id="album-art"
                    alt={props.playbackState.album_name}
                    src={props.playbackState.album_image_url}
                />
            </div>
            {props.playbackState.current_track_name}<br />
            {props.playbackState.artist_name}<br />
            <MusicPlaybackStatePosition
                paused={props.playbackState.paused}
                position={props.playbackState.raw_position_ms}
                duration={props.playbackState.duration!}
                key={makeMusicPlaybackStatePositionKey(props.playbackState)}
            />
        </div>
    );
}

function makeMusicPlaybackStatePositionKey(playbackState: PlaybackState) {
    if (playbackState) {
        const pausedKeyPart = (playbackState.paused ? 'paused' : 'playing');
        const positionKeyPart = playbackState.raw_position_ms.toString();
        return (`${playbackState.context_uri}-${playbackState.current_track_uri}-` +
            `${pausedKeyPart}-${positionKeyPart}`);
    } else {
        return '';
    }
}
