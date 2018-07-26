import * as React from 'react';

import { PlaybackState } from '../music_player';
import { ListenerRole } from '../util';
import { MusicPlaybackState } from './MusicPlaybackState';
import { MusicPlayerDJControls } from './MusicPlayerDJControls';
import { MusicPlayerListenerControls } from './MusicPlayerListenerControls';

export interface IMusicPlayerViewProps {
    listenerRole: ListenerRole;
    isConnected: boolean;
    playbackState?: PlaybackState;
    isReady: boolean;
    volume?: number;
    onMuteButtonClick(): void;
    onVolumeSliderChange(newVolume: number): void;
    onPlayPauseButtonClick(): void;
    onPreviousTrackButtonClick(): void;
    onNextTrackButtonClick(): void;
}

export function MusicPlayerView(props: IMusicPlayerViewProps) {
    return (
        <div>
            {props.playbackState &&
                <div>
                    <MusicPlaybackState
                        playbackState={props.playbackState}
                    />

                    <MusicPlayerListenerControls
                        isReady={props.isReady}
                        volume={props.volume}
                        onMuteButtonClick={props.onMuteButtonClick}
                        onVolumeSliderChange={props.onVolumeSliderChange}
                    />

                    {((props.listenerRole & ListenerRole.DJ) === ListenerRole.DJ) &&
                        <MusicPlayerDJControls
                            isReady={props.isReady}
                            paused={!props.playbackState || props.playbackState.paused}
                            onPlayPauseButtonClick={props.onPlayPauseButtonClick}
                            onPreviousTrackButtonClick={props.onPreviousTrackButtonClick}
                            onNextTrackButtonClick={props.onNextTrackButtonClick}
                        />
                    }
                </div>
            }
        </div>
    );
}
