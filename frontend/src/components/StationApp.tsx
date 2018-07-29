import * as React from 'react';

import { PlaybackState } from "../music_player";
import { IListener } from '../station';
import { CircularArray, ListenerRole } from "../util";
import { MusicPlayer } from './MusicPlayer';
import { StationAdmin } from './StationAdmin';
import { StationDebug } from './StationDebug';

interface IStationAppProps {
    stationTitle: string;
    listenerRole: ListenerRole;
    isConnected: boolean;
    generalErrorMessage?: string;
    isReady: boolean;
    playbackState?: PlaybackState;
    volume?: number;
    listeners: IListener[];
    adminActionResponseStatus?: string;
    debug: boolean;
    roundTripTimes: CircularArray<number>;
    clientServerTimeOffsets: CircularArray<number>;
    onMuteButtonClick(): void;
    onVolumeSliderChange(newVolume: number): void;
    onPlayPauseButtonClick(): void;
    onPreviousTrackButtonClick(): void;
    onNextTrackButtonClick(): void;
    onListenerInviteSubmit(username: string): void;
    onListenerDeleteSubmit(listenerId: number): void;
}

export function StationApp(props: IStationAppProps) {
    let connectionStatus;
    if (props.isConnected) {
        connectionStatus = <span className="bg-success">Connected</span>;
    } else if (props.generalErrorMessage) {
        connectionStatus = <span className="bg-danger">Not Connected</span>;
    } else {
        connectionStatus = <span className="bg-info">Not Connected</span>;
    }

    return (
        <div>
            <h1>{props.stationTitle}</h1>
            <div className="row">
                <p>
                    Status: {connectionStatus}
                </p>
                <p>
                    {props.generalErrorMessage &&
                        <div>
                            <span className="bg-danger">{props.generalErrorMessage}</span><br />
                        </div>
                    }
                </p>
            </div>
            <div className="row">
                <div className="col">
                    <MusicPlayer
                        listenerRole={props.listenerRole}
                        playbackState={props.playbackState}
                        isConnected={props.isConnected}
                        isReady={props.isReady}
                        volume={props.volume}
                        onMuteButtonClick={props.onMuteButtonClick}
                        onVolumeSliderChange={props.onVolumeSliderChange}
                        onPlayPauseButtonClick={props.onPlayPauseButtonClick}
                        onPreviousTrackButtonClick={props.onPreviousTrackButtonClick}
                        onNextTrackButtonClick={props.onNextTrackButtonClick}
                    />
                </div>
                {((props.listenerRole & ListenerRole.Admin) === ListenerRole.Admin) &&
                    <div className="col">
                        <StationAdmin
                            isReady={props.isReady}
                            listeners={props.listeners}
                            responseStatus={props.adminActionResponseStatus}
                            onListenerInviteSubmit={props.onListenerInviteSubmit}
                            onListenerDeleteSubmit={props.onListenerDeleteSubmit}
                        />
                    </div>
                }
            </div>
            <div className="row">
                {props.debug &&
                    <StationDebug
                        roundTripTimes={props.roundTripTimes}
                        clientServerTimeOffsets={props.clientServerTimeOffsets}
                    />}
            </div>
        </div>
    );
}
