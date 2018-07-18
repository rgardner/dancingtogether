import * as $ from 'jquery';
import { PlaybackState } from './music_player';
import { IListener, ServerError } from './station';
import { ListenerRole, wait } from './util';

const MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS = 1000;

export class ViewManager {
    public stationView: StationView;
    public musicPositionView = new MusicPositionView();
    public listenerView = new StationListenerView();
    public djView: StationDJView;
    public adminView: StationAdminView;

    constructor(listenerRole: ListenerRole, stationTitle: string, debug: boolean) {
        this.stationView = new StationView(stationTitle);
        this.djView = new StationDJView(listenerRole);
        this.adminView = new StationAdminView(listenerRole);
    }
}

class StationView {
    private state = new class {
        public stationTitle = '';
        public playbackState?: PlaybackState;
        public isConnected = false;
        public errorMessage?: string;
    };

    constructor(stationTitle: string) {
        this.state.stationTitle = stationTitle;
        this.render();
    }

    public setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    public render() {
        $('#station-title').html(this.state.stationTitle);

        $('#connection-status').removeClass().empty();
        if (this.state.isConnected) {
            $('#connection-status').addClass('bg-success').html('Connected');
        } else if (this.state.errorMessage) {
            $('#connection-status').addClass('bg-danger').html('Not Connected');
        } else {
            $('#connection-status').addClass('bg-info').html('Not Connected');
        }

        $('#connection-status-error').empty();
        if (this.state.errorMessage) {
            $('#connection-status-error').html(this.state.errorMessage);
        }

        if (this.state.playbackState) {
            // Update album art
            $('#album-art').empty();
            $('<img/>', {
                alt: this.state.playbackState.album_name,
                src: this.state.playbackState.album_image_url,
            }).appendTo('#album-art');

            // Update track title and track artist
            $('#playback-track-title').html(this.state.playbackState.current_track_name as string);
            $('#playback-track-artist').html(this.state.playbackState.artist_name as string);

            // Update duration, current position is handled in MusicPositionView
            $('#playback-duration').html(msToTimeString(this.state.playbackState.duration as number));
        }
    }
}

class MusicPositionView {
    private state = new class {
        public positionMS: number = 0.0;
        public paused?: boolean;
    };
    private refreshTimeoutId?: number;

    constructor() {
        this.render();
    }

    public setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));

        if ((this.state.paused === undefined) || this.state.paused) {
            this.ensureDisableRefresh();
        } else {
            this.ensureEnableRefresh();
        }

        this.render();
    }

    public render() {
        $('#playback-current-position').html(msToTimeString(this.state.positionMS));
    }

    private ensureEnableRefresh() {
        if (!this.refreshTimeoutId) {
            this.refreshTimeoutId = window.setInterval(() => {
                this.render();
                this.state.positionMS += MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS;
            }, MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS);
        }
    }

    private ensureDisableRefresh() {
        if (this.refreshTimeoutId) {
            window.clearInterval(this.refreshTimeoutId);
            this.refreshTimeoutId = undefined;
        }
    }
}

class StationListenerView {
    private state = new class {
        public isReady: boolean = false;
        public volume: number = 0.8;
    };
    private observers = new Map([
        ['muteButtonClick', $.Callbacks()],
        ['volumeSliderChange', $.Callbacks()],
    ]);

    constructor() {
        this.bindUIActions();
        this.render();
    }

    public on(eventName: string, cb: (...args: any[]) => void) {
        this.observers.get(eventName)!.add(cb);
    }

    public removeListener(eventName: string) {
        this.observers.get(eventName)!.empty();
    }

    public setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    public render() {
        $('#listener-controls :button').prop('disabled', !this.state.isReady);
        if (this.state.volume !== null) {
            if (this.state.volume === 0.0) {
                $('#mute-button').html('<i class="fas fa-volume-off"></i>');
            } else {
                $('#mute-button').html('<i class="fas fa-volume-up"></i>');
            }

            $('#volume-slider').val(this.state.volume);
        }
    }

    private bindUIActions() {
        $('#mute-button').on('click', () => {
            this.observers.get('muteButtonClick')!.fire();
        });

        $('#volume-slider').change(() => {
            const newVolume = parseFloat($('#volume-slider').val() as string);
            this.observers.get('volumeSliderChange')!.fire(newVolume);
        });
    }
}

class StationDJView {
    private state = new class {
        public isEnabled = false;
        public isReady = false;
        public playbackState?: PlaybackState;
    };
    private observers = new Map([
        ['playPauseButtonClick', $.Callbacks()],
        ['previousTrackButtonClick', $.Callbacks()],
        ['nextTrackButtonClick', $.Callbacks()],
    ]);

    constructor(listenerRole: ListenerRole) {
        this.state.isEnabled = ((listenerRole & ListenerRole.DJ) === ListenerRole.DJ);
        this.bindUIActions();
        this.render();
    }

    public on(eventName: string, cb: any) {
        this.observers.get(eventName)!.add(cb);
    }

    public removeListener(eventName: string) {
        this.observers.get(eventName)!.empty();
    }

    public setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    public render() {
        if (this.state.isEnabled) {
            $('#dj-controls').show();
        } else {
            $('#dj-controls').hide();
            return;
        }

        if (this.state.playbackState) {
            $('#dj-controls :button').prop('disabled', !this.state.isReady);
            if (this.state.playbackState.paused) {
                $('#play-pause-button').html('<i class="fas fa-play"></i>');
            } else {
                $('#play-pause-button').html('<i class="fas fa-pause"></i>');
            }
        }
    }

    private bindUIActions() {
        $('#play-pause-button').on('click', () => {
            this.observers.get('playPauseButtonClick')!.fire();
        });

        $('#previous-track-button').on('click', () => {
            this.observers.get('previousTrackButtonClick')!.fire();
        });

        $('#next-track-button').on('click', () => {
            this.observers.get('nextTrackButtonClick')!.fire();
        });
    }
}

class StationAdminView {
    private state = new class {
        public isEnabled = false;
        public isReady = false;
        public listeners: IListener[] = [];
        public inviteSentMessage = '';
        public listenerDeleteMessage = '';
    };
    private observers = new Map([
        ['invite_listener', $.Callbacks()],
        ['delete_listener', $.Callbacks()],
    ]);

    constructor(listenerRole: ListenerRole) {
        this.state.isEnabled = ((listenerRole & ListenerRole.Admin) === ListenerRole.Admin);
        this.bindUIActions();
        this.render();
    }

    public on(eventName: string, cb: any) {
        this.observers.get(eventName)!.add(cb);
    }

    public setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    public showListenerInviteResult(username: string, error?: ServerError) {
        $('#invite-listener-email').val('');

        let message = '';
        if (!error) {
            message = `${username} is now a listener`;
        } else if (error === ServerError.ListenerAlreadyExistsError) {
            message = `Error: ${username} is already a listener`;
        } else {
            message = `An error occurred while inviting ${username}`;
        }

        this.setState(() => ({ inviteSentMessage: message }));
        wait(10000).then(() => this.setState(() => ({ inviteSentMessage: '' })));
    }

    public showListenerDeleteResult(message: string) {
        this.setState(() => ({ listenerDeleteMessage: message }));
        wait(10000).then(() => this.setState(() => ({ listenerDeleteMessage: '' })));
    }

    public render() {
        if (this.state.isEnabled) {
            $('#admin-view').show();
        } else {
            $('#admin-view').hide();
            return;
        }

        $('#admin-view :input,:button').prop('disabled', false);

        $('#listeners-table tr').remove();
        this.state.listeners.forEach((listener) => {
            this.makeListenerTableRow(listener.username, listener.id).appendTo('#listeners-table');
        });

        if (this.state.inviteSentMessage) {
            $('#admin-invite-sent').html(this.state.inviteSentMessage);
            $('#admin-invite-sent').show();
        } else {
            $('#admin-invite-sent').hide();
        }

        if (this.state.listenerDeleteMessage) {
            $('#admin-listener-delete-message').html(`Listener delete failed: ${this.state.listenerDeleteMessage}`);
            $('#admin-listener-delete-message').show();
        } else {
            $('#admin-listener-delete-message').hide();
        }
    }

    private bindUIActions() {
        $('#invite-listener-email').keyup(e => {
            // Also submit form if the user hits the enter key
            if (e.keyCode === 13) {
                $('#invite-listener-form').submit();
            }
        });

        $('#invite-listener-form').submit(e => {
            e.preventDefault();
            if (this.state.isEnabled) {
                const username = $('#invite-listener-username').val() as string;
                if (username.length > 0) {
                    this.observers.get('invite_listener')!.fire(username);
                }
            }
        });
    }

    private makeListenerTableRow(username: string, listenerId: number) {
        const $row = $('<tr>');
        $('<td>').html(username).appendTo($row);
        $('<button>', {
            class: 'btn btn-warning btn-sm',
            click: () => {
                this.observers.get('delete_listener')!.fire(listenerId);
            },
            type: 'submit',
        }).html('Remove').appendTo($('<td>')).appendTo($row);
        return $row;
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
