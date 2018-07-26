import { faVolumeOff, faVolumeUp } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import * as React from 'react';

export interface IMusicPlayerListenerControlsProps {
    isReady: boolean;
    volume?: number;
    onMuteButtonClick(): void;
    onVolumeSliderChange(newVolume: number): void;
}

export class MusicPlayerListenerControls extends React.Component<IMusicPlayerListenerControlsProps, {}> {
    constructor(props: IMusicPlayerListenerControlsProps) {
        super(props);

        this.handleVolumeSliderChange = this.handleVolumeSliderChange.bind(this);
    }

    public render() {
        let muteButtonIcon;
        if ((this.props.volume === undefined) || (this.props.volume === 0)) {
            muteButtonIcon = <FontAwesomeIcon icon={faVolumeOff} />;
        } else {
            muteButtonIcon = <FontAwesomeIcon icon={faVolumeUp} />;
        }

        return (
            <div>
                <button
                    id="mute-button"
                    className="btn"
                    type="submit"
                    aria-pressed="false"
                    onClick={this.props.onMuteButtonClick}
                    disabled={!this.props.isReady}
                >
                    {muteButtonIcon}
                </button>

                <input
                    id="volume-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={this.props.volume}
                    onChange={this.handleVolumeSliderChange}
                    disabled={!this.props.isReady}
                />
            </div>
        );

    }

    private handleVolumeSliderChange(event: any) {
        this.props.onVolumeSliderChange(event.target.value);
    }
}
