'use strict';

/*global Spotify*/
/*global ReconnectingWebSocket*/

const SERVER_HEARTBEAT_INTERVAL_MS = 3000;
const MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS = 1000;

class StationApp { // eslint-disable-line no-unused-vars
    constructor(userIsDJ, userIsAdmin, accessToken, stationId) {
        this.musicPlayer = new StationMusicPlayer('Dancing Together', accessToken);
        this.stationServer = new StationServer(stationId, this.musicPlayer);
        this.view = new StationView(userIsDJ, userIsAdmin, this.musicPlayer, this.stationServer);
    }
}

class StationMusicPlayer {
    constructor(client_name, accessToken) {
        this.isReady = false;
        this.player = null;
        this.deviceId = null;
        this.storedSpotifyCallbacks = [];

        window.onSpotifyWebPlaybackSDKReady = () => {
            this.player = new Spotify.Player({
                name: client_name,
                getOAuthToken: cb => { cb(accessToken); },
                volume: MusicVolume.getCachedVolume(),
            });

            this.bindSpotifyActions();
            this.player.connect();
        };
    }

    on(eventName, cb) {
        if (this.player) {
            this.player.on(eventName, cb);
        } else {
            this.storedSpotifyCallbacks.push([eventName, cb]);
        }
    }

    bindSpotifyActions() {
        this.storedSpotifyCallbacks.forEach(nameCBPair => {
            this.player.on(nameCBPair[0], nameCBPair[1]);
        });

        this.player.on('ready', ({ device_id }) => {
            this.onReady(device_id);
        });

        // Error handling

        this.player.on('initialization_error', ({ message }) => {
            this.onInitializationError(message);
        });

        this.player.on('authentication_error', ({ message }) => {
            this.onAuthenticationError(message);
        });

        this.player.on('account_error', ({ message }) => {
            this.onAccountError(message);
        });

        this.player.on('playback_error', ({ message }) => {
            this.onPlaybackError(message);
        });
    }

    onReady(deviceId) {
        this.deviceId = deviceId;
        this.isReady = true;
    }

    onInitializationError(message) {
        console.error('Failed to initialize', message);
        StationView.displayConnectionStatusMessage(false, 'Failed to initialize Spotify player.');
    }

    onAuthenticationError(message) {
        console.error('Failed to authenticate', message);
        StationView.displayConnectionStatusMessage(false, 'Invalid access token, please refresh the page.');
    }

    onAccountError(message) {
        console.error('Failed to validate Spotify account', message);
        StationView.displayConnectionStatusMessage(false,  'Dancing Together requires a Spotify Premium account.');
    }

    onPlaybackError(message) {
        console.error('Failed to perform playback', message);
        StationView.displayConnectionStatusMessage(true, 'Failed to play the current song.');
    }
}

// Public Events
// 'ready' -> Server is now ready to accept requests
// 'listener_change' -> The station's listeners have changed
class StationServer {
    constructor(stationId, musicPlayer) {
        this.stationId = stationId;
        this.musicPlayer = musicPlayer;
        this.bindSpotifyActions();
        this.socket = null;
        this.observers = {
            'ready': $.Callbacks(),
            'listener_change': $.Callbacks(),
            'get_listeners_result': $.Callbacks(),
            'send_listener_invite_result': $.Callbacks(),
        };
        this.heartbeatIntervalId = null;
        this.requestId = 0;
    }

    on(eventName, cb) {
        this.observers[eventName].add(cb);
    }

    onOnce(eventName, thisRequestId, cb) {
        const cbWrapper = (requestId, ...args) => {
            if (requestId === thisRequestId) {
                this.removeListener(eventName, cbWrapper);
                cb(...args);
            }
        };
        this.on(eventName, cbWrapper);
    }

    removeListener(eventName, cb) {
        this.observers[eventName].remove(cb);
    }

    bindSpotifyActions() {
        this.musicPlayer.on('ready', () => {
            this.connect();
        });

        this.musicPlayer.on('player_state_changed', state => {
            // Let the server determine what to do. Potential perf optimization
            // for both client and server is to only send this event if:
            // 1) the user is a dj (this can change during the stream)
            // 2) if this is a legitimate change and not just a random update
            if (state) {
                this.sendPlayerState(state);
            }
        });
    }

    bindSocketActions() {
        // Use arrow functions to capture this
        this.socket.onopen = () => { this.onOpen(); };
        this.socket.onclose = () => { this.onClose(); };
        this.socket.onmessage = message => { this.onMessage(message); };
    }

    connect() {
        // Correctly decide between ws:// and wss://
        const ws_scheme = window.location.protocol == 'https:' ? 'wss' : 'ws';
        const ws_path = ws_scheme + '://' + window.location.host + '/station/stream/';
        this.socket = new ReconnectingWebSocket(ws_path);
        this.bindSocketActions();
    }

    enableHeartbeat() {
        this.heartbeatIntervalId = window.setInterval(() => {
            this.musicPlayer.player.getCurrentState().then(state => {
                if (state) {
                    this.sendPlayerState(state);
                }
            });
        }, SERVER_HEARTBEAT_INTERVAL_MS);
    }

    disableHeartbeat() {
        window.clearInterval(this.heartbeatIntervalId);
        this.heartbeatIntervalId = null;
    }

    // Socket Callbacks

    onOpen() {
        StationView.displayConnectionStatusMessage(true /*isConnected*/);
        this.socket.send(JSON.stringify({
            'command': 'join',
            'station': this.stationId,
            'device_id': this.musicPlayer.deviceId
        }));
    }

    onClose() {
        StationView.displayConnectionStatusMessage(false /*isConnected*/);
    }

    onMessage(message) {
        const data = JSON.parse(message.data);
        if (data.error) {
            console.error(data.error);
            return;
        }

        if (data.join) {
            $('#station-name').html(data.join);
            this.enableHeartbeat();
            this.observers['ready'].fire();
        } else if (data.leave) {
            $('#station-name').html('');
            this.disableHeartbeat();
        } else if (data.type === 'dj_state_change') {
            if (data.change_type === 'set_paused') {
                this.musicPlayer.player.pause();
            } else if (data.change_type === 'set_resumed') {
                this.musicPlayer.player.resume();
            } else if (data.change_type === 'seek_current_track') {
                this.musicPlayer.player.seek(data.position_ms);
            }
        } else if (data.type === 'listener_change') {
            this.observers['listener_change'].fire(data.listener_change_type, data.listener);
        } else if (data.type === 'get_listeners_result') {
            this.observers[data.type].fire(data.request_id, data.listeners, data.pending_listeners);
        } else if (data.type === 'send_listener_invite_result') {
            this.observers[data.type].fire(data.request_id, data.result, data.is_new_user);
        } else {
            console.error('Unknown message from server: ', data);
        }
    }

    sendPlayerState(state) {
        state['current_time'] = new Date();
        this.socket.send(JSON.stringify({
            'command': 'player_state_change',
            'state_time': new Date(),
            'state': state,
        }));
    }

    getListeners() {
        return new Promise((resolve) => {
            const thisRequestId = ++this.requestId;
            this.onOnce('get_listeners_result', thisRequestId, (listeners, pendingListeners) => {
                resolve({listeners, pendingListeners});
            });

            this.socket.send(JSON.stringify({
                'command': 'get_listeners',
                'request_id': thisRequestId,
            }));
        });
    }

    sendListenerInvite(listenerEmail) {
        return new Promise((resolve) => {
            const thisRequestId = ++this.requestId;
            this.onOnce('send_listener_invite_result', thisRequestId, (result, isNewUser) => {
                resolve({result, isNewUser});
            });

            this.socket.send(JSON.stringify({
                'command': 'send_listener_invite',
                'request_id': thisRequestId,
                'listener_email': listenerEmail,
            }));
        });
    }
}

// View Management

class StationView {
    constructor(userIsDJ, userIsAdmin, musicPlayer, stationServer) {
        this.state = { playbackState: null };
        this.musicPlayer = musicPlayer;
        this.musicPositionView = new MusicPositionView(musicPlayer);
        this.listenerView = new StationListenerView(musicPlayer);
        this.djView = new StationDJView(userIsDJ, musicPlayer);
        this.adminView = new StationAdminView(userIsAdmin, stationServer);
        this.bindSpotifyActions();
        this.render();
    }

    bindSpotifyActions() {
        this.musicPlayer.on('player_state_changed', state => {
            this.setState(() => ({ playbackState: state }));
        });
    }

    static displayConnectionStatusMessage(isConnected, errorMessage = '') {
        $('#connection-status').removeClass().empty();
        $('#connection-status-error').empty();

        if (isConnected) {
            $('#connection-status').addClass('bg-success').html('Connected');
        } else if (errorMessage) {
            $('#connection-status').addClass('bg-danger').html('Not Connected');
        } else {
            $('#connection-status').addClass('bg-info').html('Not Connected');
        }

        if (errorMessage) {
            $('#connection-status-error').html(errorMessage);
        }
    }

    render() {
        if (this.state.playbackState === null) {
            return;
        }

        // Update album art
        $('#album-art').empty();
        $('<img/>', {
            src: this.state.playbackState.track_window.current_track.album.images[0].url,
            alt: this.state.playbackState.track_window.current_track.album.name
        }).appendTo('#album-art');

        // Update track title and track artist
        $('#playback-track-title').html(this.state.playbackState.track_window.current_track.name);
        $('#playback-track-artist').html(this.state.playbackState.track_window.current_track.artists[0].name);

        // Update duration, current position is handled in MusicPositionView
        $('#playback-duration').html(msToTimeString(this.state.playbackState.duration));
    }

    setState(updater) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }
}

class MusicPositionView {
    constructor(musicPlayer) {
        this.state = { positionMS: 0.0 };
        this.musicPlayer = musicPlayer;
        this.refreshTimeoutId = null;
        this.bindSpotifyActions();
        this.render();
    }

    bindSpotifyActions() {
        this.musicPlayer.on('player_state_changed', state => {
            this.setState(() => ({ positionMS: state.position }));

            if (state.paused) {
                this.ensureDisableRefresh();
            } else {
                this.ensureEnableRefresh();
            }
        });
    }

    render() {
        $('#playback-current-position').html(msToTimeString(this.state.positionMS));
    }

    setState(updater) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    ensureEnableRefresh() {
        if (this.refreshTimeoutId === null) {
            this.refreshTimeoutId = window.setInterval(() => {
                this.render();
                this.state.positionMS += MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS;
            }, MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS);
        }
    }

    ensureDisableRefresh() {
        if (this.refreshTimeoutId !== null) {
            window.clearInterval(this.refreshTimeoutId);
            this.refreshTimeoutId = null;
        }
    }
}

class MusicVolume {
    constructor(musicPlayer) {
        this.musicPlayer = musicPlayer;
        this.volume = MusicVolume.getCachedVolume();
        this.volumeBeforeMute = this.volume;
    }

    static getCachedVolume() {
        if (localStorage.getItem('musicVolume') !== null) {
            return localStorage['musicVolume'];
        } else {
            return 0.8;
        }
    }

    static setCachedVolume(volume) {
        localStorage['musicVolume'] = volume;
    }

    getVolume() {
        return new Promise((resolve, reject) => {
            if (this.musicPlayer.isReady) {
                this.musicPlayer.player.getVolume().then((volume) => {
                    resolve(volume);
                });
            } else {
                reject();
            }
        });
    }

    setVolume(volume) {
        return new Promise((resolve, reject) => {
            if (this.musicPlayer.isReady) {
                this.musicPlayer.player.setVolume(volume).then(() => {
                    MusicVolume.setCachedVolume(volume);
                    resolve();
                });
            } else {
                reject();
            }
        });
    }

    mute() {
        return new Promise((resolve, reject) => {
            if (this.musicPlayer.isReady) {
                this.getVolume().then(volume => {
                    // BUG: Spotify API returns null instead of 0.0.
                    // Tracked by https://github.com/rgardner/dancingtogether/issues/12

                    var newVolume = 0.0;
                    if ((volume === 0.0) || (volume === null)) {
                        // currently muted, so unmute
                        newVolume = this.volumeBeforeMute;
                    } else {
                        // currently unmuted, so mute and store current volume for restore
                        this.volumeBeforeMute = volume;
                        newVolume = 0.0;
                    }

                    this.setVolume(newVolume).then(() => resolve(newVolume));
                });
            } else {
                reject();
            }
        });
    }
}

class StationListenerView {
    constructor(musicPlayer) {
        this.state = {
            isReady: false,
            volume: MusicVolume.getCachedVolume(),
        };
        this.musicPlayer = musicPlayer;
        this.musicVolume = new MusicVolume(musicPlayer);
        this.bindSpotifyActions();
        this.bindUIActions();
        this.render();
    }

    bindSpotifyActions() {
        this.musicPlayer.on('ready', () => {
            this.setState(() => ({ isReady: true }));
            this.getVolume();
        });
    }

    bindUIActions() {
        $('#mute-button').on('click', () => {
            this.muteUnmuteVolume();
        });

        $('#volume-slider').change(() => {
            this.changeVolume();
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

    setState(updater) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    getVolume() {
        this.musicVolume.getVolume().then((volume) => {
            this.setState(() => ({ volume: volume }));
        });
    }

    changeVolume() {
        if (this.musicPlayer) {
            const newVolume = parseFloat($('#volume-slider').val());
            this.musicVolume.setVolume(newVolume).then(() => {
                this.setState(() => ({ volume: newVolume }));
            });
        }
    }

    muteUnmuteVolume() {
        this.musicVolume.mute().then(newVolume => {
            this.setState(() => ({ volume: newVolume }));
        });
    }
}

class StationDJView {
    constructor(userIsDJ, musicPlayer) {
        this.state = {
            isEnabled: userIsDJ,
            isReady: false,
            playbackState: null,
        };
        this.musicPlayer = musicPlayer;
        this.bindSpotifyActions();
        this.bindUIActions();
        this.render();
    }

    bindSpotifyActions() {
        this.musicPlayer.on('ready', () => {
            this.setState(() => ({ isReady: true}));
        });

        this.musicPlayer.on('player_state_changed', state => {
            this.setState(() => ({ playbackState: state }));
        });
    }

    bindUIActions() {
        $('#play-pause-button').on('click', () => {
            this.playPause();
        });

        $('#previous-track-button').on('click', () => {
            this.previousTrack();
        });

        $('#next-track-button').on('click', () => {
            this.nextTrack();
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

    setState(updater) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    playPause() {
        if (this.state.isEnabled && this.state.isReady) {
            this.musicPlayer.player.togglePlay();
        }
    }

    previousTrack() {
        if (this.state.isEnabled && this.state.isReady) {
            this.musicPlayer.player.previousTrack();
        }
    }

    nextTrack() {
        if (this.state.isEnabled && this.state.isReady) {
            this.musicPlayer.player.nextTrack();
        }
    }
}

class StationAdminView {
    constructor(userIsAdmin, stationServer) {
        this.state = {
            isEnabled: userIsAdmin,
            isReady: false,
            listeners: [],
            pendingListeners: [],
        };

        this.stationServer = stationServer;
        this.bindUIActions();
        this.bindServerActions();
        this.render();
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
                this.sendListenerInvite();
            }
        });
    }

    bindServerActions() {
        this.stationServer.on('ready', () => {
            this.setState(() => ({
                isReady: true,
            }));

            this.loadListeners();
        });

        this.stationServer.on('listener_change', (listener_change_type, listener) => {
            if (listener_change_type === 'join') {
                this.setState(prevState => {
                    let listeners = prevState.listeners;
                    const listenerIdx = listeners.findIndex(l => l.id == listener.id);
                    if (listenerIdx === -1) {
                        listeners.push(listener);
                    } else {
                        listeners[listenerIdx] = listener;
                    }
                    return { listeners: listeners };
                });
            } else if (listener_change_type === 'leave') {
                this.setState(prevState => {
                    let listeners = prevState.listeners;
                    listeners.splice(listeners.indexOf(listener), 1);
                    return { listeners: listeners };
                });
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
    }

    makeListenerTableRow(username, email) {
        var $row = $('<tr>');
        $('<td>').html(username).appendTo($row);
        $('<td>').html(email).appendTo($row);
        $('<td>').html($('<button>', {
            type: 'submit',
            class: 'btn btn-warning btn-sm',
            value: email,
        }).html('Remove')).appendTo($row);
        return $row;
    }

    setState(updater) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    loadListeners() {
        if (this.state.isEnabled) {
            this.stationServer.getListeners().then(({listeners, pendingListeners}) => {
                this.setState(() => ({
                    listeners: listeners,
                    pendingListeners: pendingListeners,
                }));
            });
        }
    }

    sendListenerInvite() {
        const listenerEmail = $('#invite-listener-email').val();
        if (listenerEmail.length === 0) {
            return;
        }

        this.stationServer.sendListenerInvite(listenerEmail).then((result, isNewUser) => {
            let message;
            if (result === 'ok') {
                message = (isNewUser ? 'Invite sent to new user!' : 'Invite sent!');
            } else if (result === 'err_user_exists') {
                message = `Error: ${listenerEmail} is already a listener`;
            } else {
                message = `An error occurred while inviting ${listenerEmail}`;
            }

            $('#admin-invite-sent').html(message);
            setTimeout(() => {
                $('#admin-invite-sent').hide();
            }, 10000);
            $('#invite-listener-email').val('');
        });
    }
}

// milliseconds -> 'm:ss', rounding down, and left-padding seconds
// '0' -> '0:00'
// '153790' -> '2:33'
// Does not support hours (most songs are <60mins)
function msToTimeString(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60).toString();
    const secondsRemainder = Math.floor(seconds % 60).toString();
    const secondsRemainderPad = (secondsRemainder.length === 1) ? '0' + secondsRemainder : secondsRemainder;
    return `${minutes}:${secondsRemainderPad}`;
}
