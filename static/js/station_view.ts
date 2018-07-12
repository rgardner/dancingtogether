import * as $ from 'jquery';
import { PlaybackState } from './music_player';
import { Listener, ServerError } from './station';
import {
    CircularArray, ListenerRole, median, wait
} from './util';

const MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS = 1000;

export class ViewManager {
    stationView: StationView;
    musicPositionView = new MusicPositionView();
    listenerView = new StationListenerView();
    djView: StationDJView;
    adminView: StationAdminView;
    debugView: StationDebugView;

    constructor(listenerRole: ListenerRole, stationTitle: string, debug: boolean) {
        this.stationView = new StationView(stationTitle);
        this.djView = new StationDJView(listenerRole);
        this.adminView = new StationAdminView(listenerRole);
        this.debugView = new StationDebugView(debug);
    }
}

class StationView {
    private state = new class {
        stationTitle = '';
        playbackState?: PlaybackState;
        isConnected = false;
        errorMessage?: string;
    };

    constructor(stationTitle: string) {
        this.state.stationTitle = stationTitle;
        this.render();
    }

    setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    render() {
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

class StationAdminView {
    private state = new class {
        isEnabled = false;
        isReady = false;
        listeners: Array<Listener> = [];
        inviteSentMessage = '';
        listenerDeleteMessage = '';
    };
    observers = new Map([
        ['invite_listener', $.Callbacks()],
        ['delete_listener', $.Callbacks()],
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

    showListenerInviteResult(username: string, error?: ServerError) {
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

    showListenerDeleteResult(message: string) {
        this.setState(() => ({ listenerDeleteMessage: message }));
        wait(10000).then(() => this.setState(() => ({ listenerDeleteMessage: '' })));
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
                const username = $('#invite-listener-username').val() as string;
                if (username.length > 0) {
                    this.observers.get('invite_listener')!.fire(username);
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

    makeListenerTableRow(username: string, listenerId: number) {
        let $row = $('<tr>');
        $('<td>').html(username).appendTo($row);
        $('<button>', {
            type: 'submit',
            class: 'btn btn-warning btn-sm',
            click: () => {
                this.observers.get('delete_listener')!.fire(listenerId);
            },
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

class StationDebugView {
    private state = new class {
        isEnabled = false;
        roundTripTimes = new CircularArray<number>(5);
        clientServerTimeOffsets = new CircularArray<number>(5);
        logMessages = new CircularArray<string>(100);
    };

    constructor(debug: boolean) {
        this.state.isEnabled = debug;
        this.render();
    }

    setState(updater: any) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    render() {
        if (this.state.isEnabled) {
            $('#debug-view').show();
        } else {
            $('#debug-view').hide();
            return;
        }

        $('#debug-view-round-trip-times').html();
        if (this.state.roundTripTimes.length > 0) {
            const medianRoundTripTime = median(this.state.roundTripTimes.array);
            const joinedRoundTripTimes = this.state.roundTripTimes.array.map(time => `${time}ms`).join();
            const content = `Round Trip Times: Median: ${medianRoundTripTime}ms. All: ${joinedRoundTripTimes}.`;
            $('#debug-view-round-trip-times').html(content);
        }

        $('#debug-view-client-server-time-offests').html();
        if (this.state.clientServerTimeOffsets.length > 0) {
            const medianClientServerTimeOffset = median(this.state.clientServerTimeOffsets.array);
            const joinedClientServerTimeOffsets = this.state.clientServerTimeOffsets.array.map(time => `${time}ms`).join();
            const content = `Client Server Time Offsets: Median: ${medianClientServerTimeOffset}ms. All: ${joinedClientServerTimeOffsets}.`;
            $('#debug-view-client-server-time-offsets').html(content);
        }

        $('#debug-log li').remove();
        this.state.logMessages.array.forEach(logMessage => {
            $('li').html(logMessage).appendTo($('#debug-log'));
        });
    }
}
