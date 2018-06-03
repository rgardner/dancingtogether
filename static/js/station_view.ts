import * as $ from 'jquery';
import { ListenerRole, wait } from './util';
import { PlaybackState } from './music_player';

const MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS = 1000;

export class ViewManager {
    stationView = new StationView();
    musicPositionView = new MusicPositionView();
    listenerView = new StationListenerView();
    djView: StationDJView;
    adminView: StationAdminView;

    constructor(listenerRole: ListenerRole) {
        this.djView = new StationDJView(listenerRole);
        this.adminView = new StationAdminView(listenerRole);
    }
}

class StationView {
    private state = new class {
        stationName = '';
        playbackState?: PlaybackState;
        isConnected = false;
        errorMessage?: string;
    };

    constructor() {
        this.render();
    }

    setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    render() {
        $('#station-name').html(this.state.stationName);

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
                src: this.state.playbackState.album_image_url,
                alt: this.state.playbackState.album_name,
            }).appendTo('#album-art');

            // Update track title and track artist
            $('#playback-track-title').html(<string>this.state.playbackState.current_track_name);
            $('#playback-track-artist').html(<string>this.state.playbackState.artist_name);

            // Update duration, current position is handled in MusicPositionView
            $('#playback-duration').html(msToTimeString(<number>this.state.playbackState.duration));
        }
    }
}

class MusicPositionView {
    private state = new class {
        positionMS: number = 0.0;
        paused?: boolean;
    };
    refreshTimeoutId?: number;

    constructor() {
        this.render();
    }

    setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));

        if ((this.state.paused === undefined) || this.state.paused) {
            this.ensureDisableRefresh();
        } else {
            this.ensureEnableRefresh();
        }

        this.render();
    }

    ensureEnableRefresh() {
        if (!this.refreshTimeoutId) {
            this.refreshTimeoutId = window.setInterval(() => {
                this.render();
                this.state.positionMS += MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS;
            }, MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS);
        }
    }

    ensureDisableRefresh() {
        if (this.refreshTimeoutId) {
            window.clearInterval(this.refreshTimeoutId);
            this.refreshTimeoutId = undefined;
        }
    }

    render() {
        $('#playback-current-position').html(msToTimeString(this.state.positionMS));
    }
}

class StationListenerView {
    private state = new class {
        isReady: boolean = false;
        volume: number = 0.8;
    };
    observers = new Map([
        ['muteButtonClick', $.Callbacks()],
        ['volumeSliderChange', $.Callbacks()],
    ]);

    constructor() {
        this.bindUIActions();
        this.render();
    }

    on(eventName: string, cb: (...args: any[]) => void) {
        this.observers.get(eventName)!.add(cb);
    }

    removeListener(eventName: string) {
        this.observers.get(eventName)!.empty();
    }

    setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    bindUIActions() {
        $('#mute-button').on('click', () => {
            this.observers.get('muteButtonClick')!.fire();
        });

        $('#volume-slider').change(() => {
            const newVolume = parseFloat($('#volume-slider').val() as string);
            this.observers.get('volumeSliderChange')!.fire(newVolume);
        });
    }

    render() {
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
}

class StationDJView {
    private state = new class {
        isEnabled = false;
        isReady = false;
        playbackState?: PlaybackState;
    };
    observers = new Map([
        ['playPauseButtonClick', $.Callbacks()],
        ['previousTrackButtonClick', $.Callbacks()],
        ['nextTrackButtonClick', $.Callbacks()],
    ]);

    constructor(listenerRole: ListenerRole) {
        this.state.isEnabled = ((listenerRole & ListenerRole.DJ) === ListenerRole.DJ);
        this.bindUIActions();
        this.render();
    }

    on(eventName: string, cb: Function) {
        this.observers.get(eventName)!.add(cb);
    }

    removeListener(eventName: string) {
        this.observers.get(eventName)!.empty();
    }

    setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    bindUIActions() {
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

    render() {
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
}

interface Listener {
    id: number;
    username: string;
    email: string;
}

class StationAdminView {
    private state = new class {
        isEnabled = false;
        isReady = false;
        listeners: Array<Listener> = [];
        pendingListeners: Array<Listener> = [];
        inviteSentMessage = '';
    };
    observers = new Map([
        ['invite_listener', $.Callbacks()],
    ]);

    constructor(listenerRole: ListenerRole) {
        this.state.isEnabled = ((listenerRole & ListenerRole.Admin) === ListenerRole.Admin);
        this.bindUIActions();
        this.render();
    }

    on(eventName: string, cb: Function) {
        this.observers.get(eventName)!.add(cb);
    }

    setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    addOrRemoveListener(listenerChangeType: string, listener: Listener) {
        if (listenerChangeType === 'join') {
            this.setState((prevState: any) => {
                let listeners = prevState.listeners;
                const listenerIdx = listeners.findIndex((l: Listener) => l.id == listener.id);
                if (listenerIdx === -1) {
                    listeners.push(listener);
                } else {
                    listeners[listenerIdx] = listener;
                }
                return { listeners: listeners };
            });
        } else if (listenerChangeType === 'leave') {
            this.setState((prevState: any) => {
                let listeners = prevState.listeners;
                listeners.splice(listeners.indexOf(listener), 1);
                return { listeners: listeners };
            });
        }
    }

    showListenerInviteResult(result: string, isNewUser: boolean, listenerEmail: string) {
        $('#invite-listener-email').val('');

        let message = '';
        if (result === 'ok') {
            message = (isNewUser ? 'Invite sent to new user!' : 'Invite sent!');
        } else if (result === 'err_user_exists') {
            message = `Error: ${listenerEmail} is already a listener`;
        } else {
            message = `An error occurred while inviting ${listenerEmail}`;
        }

        this.setState(() => ({ inviteSentMessage: message }));
        wait(10000).then(() => this.setState({ inviteSentMessage: '' }));
    }

    bindUIActions() {
        $('#invite-listener-email').keyup(e => {
            // Also submit form if the user hits the enter key
            if (e.keyCode === 13) {
                $('#invite-listener-form').submit();
            }
        });

        $('#invite-listener-form').submit(e => {
            e.preventDefault();
            if (this.state.isEnabled) {
                const listenerEmail = $('#invite-listener-email').val() as string;
                if (listenerEmail.length !== 0) {
                    this.observers.get('invite_listener')!.fire(listenerEmail);
                }
            }
        });
    }

    render() {
        if (this.state.isEnabled) {
            $('#admin-view').show();
        } else {
            $('#admin-view').hide();
            return;
        }

        $('#admin-view :input,:button').prop('disabled', false);

        $('#listeners-table tr').remove();
        this.state.listeners.forEach(({ username, email }) => {
            this.makeListenerTableRow(username, email).appendTo('#listeners-table');
        });

        $('#pending-listeners-table tr').remove();
        this.state.pendingListeners.forEach(({ username, email }) => {
            this.makeListenerTableRow(username, email).appendTo('#pending-listeners-table');
        });

        if (this.state.inviteSentMessage) {
            $('#admin-invite-sent').html(this.state.inviteSentMessage);
        } else {
            $('#admin-invite-sent').hide();
        }
    }

    makeListenerTableRow(username: string, email: string) {
        let $row = $('<tr>');
        $('<td>').html(username).appendTo($row);
        $('<td>').html(email).appendTo($row);
        $('<button', {
            type: 'submit',
            class: 'btn btn-warning btn-sm',
            value: email,
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
