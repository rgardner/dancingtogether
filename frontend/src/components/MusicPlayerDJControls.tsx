import { faPause, faPlay, faStepBackward, faStepForward } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import * as React from 'react';

export interface IMusicPlayerDJControlsProps {
    isReady: boolean;
    paused?: boolean;
    onPlayPauseButtonClick(): void;
    onPreviousTrackButtonClick(): void;
    onNextTrackButtonClick(): void;
}

export function MusicPlayerDJControls(props: IMusicPlayerDJControlsProps) {
    let playPauseIcon;
    if (props.paused) {

        playPauseIcon = <FontAwesomeIcon icon={faPlay} />;
    } else {
        playPauseIcon = <FontAwesomeIcon icon={faPause} />;
    }

    return (
        <div>
            <button
                className="btn"
                type="submit"
                aria-pressed="false"
                disabled={!props.isReady}
                onClick={props.onPreviousTrackButtonClick}
            >
                <FontAwesomeIcon icon={faStepBackward} />
            </button>

            <button
                className="btn"
                type="submit"
                aria-pressed="false"
                disabled={!props.isReady}
                onClick={props.onPlayPauseButtonClick}
            >
                {playPauseIcon}
            </button>

            <button
                className="btn"
                type="submit"
                aria-pressed="false"
                disabled={!props.isReady}
                onClick={props.onNextTrackButtonClick}
            >
                <FontAwesomeIcon icon={faStepForward} />
            </button>
        </div>
    );
}
