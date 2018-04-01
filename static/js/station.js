'use strict';

/*global Spotify*/
/*global ReconnectingWebSocket*/

const SERVER_HEARTBEAT_INTERVAL_MS = 3000;
const MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS = 1000;

class StationApp { // eslint-disable-line no-unused-vars
    constructor(user_is_dj, user_is_admin, access_token, station_id) {
        this.musicPlayer = new StationMusicPlayer('Dancing Together', access_token);
        this.stationServer = new StationServer(station_id, this.musicPlayer);
        this.view = new StationView(user_is_dj, user_is_admin, this.musicPlayer, this.stationServer);
    }
}

class StationMusicPlayer {
    constructor(client_name, access_token) {
        this.isReady = false;
        this.player = null;
        this.deviceId = null;
        this.storedSpotifyCallbacks = [];

        window.onSpotifyWebPlaybackSDKReady = () => {
            this.player = new Spotify.Player({
                name: client_name,
                getOAuthToken: cb => { cb(access_token); },
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

        this.player.on('player_state_changed', state => {
            this.onPlayerStateChanged(state);
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
        console.log('Ready with Device ID', deviceId);
        this.deviceId = deviceId;
        this.isReady = true;
    }

    onPlayerStateChanged(state) {
        console.log('Player state changed', state);
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

class StationServer {
    constructor(stationId, musicPlayer) {
        this.stationId = stationId;
        this.musicPlayer = musicPlayer;
        this.bindSpotifyActions();
        this.socket = null;
    }

    on(eventName, cb) {
        // TODO: add callback mechanism
        eventName;
        cb;
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
        console.log(`Connecting to ${ws_path}`);
        this.socket = new ReconnectingWebSocket(ws_path);
        this.bindSocketActions();
        this.enableHeartbeat();
    }

    enableHeartbeat() {
        window.setInterval(() => {
            this.musicPlayer.player.getCurrentState().then(state => {
                console.log('Heartbeat: sending current state to server');
                if (state) {
                    this.sendPlayerState(state);
                }
            });
        }, SERVER_HEARTBEAT_INTERVAL_MS);
    }

    // Socket Callbacks

    onOpen() {
        console.log('Connected to station socket');
        StationView.displayConnectionStatusMessage(true /*isConnected*/);

        console.log('Joining station', this.stationId);
        this.socket.send(JSON.stringify({
            'command': 'join',
            'station': this.stationId,
            'device_id': this.musicPlayer.deviceId
        }));
    }

    onClose() {
        console.log('Disconnected from station socket');
        StationView.displayConnectionStatusMessage(false /*isConnected*/);
    }

    onMessage(message) {
        console.log('Got websocket message ' + message.data);
        const data = JSON.parse(message.data);

        if (data.error) {
            console.log(data.error);
            return;
        }

        if (data.join) {
            console.log(`Joining station ${data.join}`);
            $('#station-name').html(data.join);
        } else if (data.leave) {
            console.log('Leaving station ' + data.leave);
        } else if (data.type === 'dj_state_change') {
            console.log('DJ State Change: ', data.change_type);

            if (data.change_type === 'set_paused') {
                this.musicPlayer.player.pause().then(() => {
                    console.log('DJ caused station to pause');
                });
            } else if (data.change_type === 'set_resumed') {
                this.musicPlayer.player.resume().then(() => {
                    console.log('DJ caused station to resume');
                });
            } else if (data.change_type === 'seek_current_track') {
                this.musicPlayer.player.seek(data.position_ms).then(() => {
                    console.log('DJ caused track to seek');
                });
            }

        } else if (data.message || data.msg_type != 0) {
            console.log('received message: ', data.message, 'from: ', data.username);

            const msgdiv = $('#admin-messages');
            var ok_msg = '';
            if (data.msg_type === 'enter') {
                // User joined station
                ok_msg = '<div class="contextual-message text-muted">' + data.username +
                        ' joined the station' +
                        '</div>';
            } else if (data.msg_type === 'leave') {
                // User left station
                ok_msg = '<div class="contextual-message text-muted">' + data.username +
                        ' left the station' +
                        '</div>';
            } else {
                console.error('Unsupported message type!');
                return;
            }

            msgdiv.append(ok_msg);
            msgdiv.scrollTop(msgdiv.prop('scrollHeight'));
        } else {
            console.error('Cannot handle message!');
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

    sendListenerInvite(listenerEmail) {
        // TODO: send invite message to server
        listenerEmail;
    }
}

// View Management

class StationView {
    constructor(user_is_dj, user_is_admin, musicPlayer, stationServer) {
        this.musicPlayer = musicPlayer;
        this.bindSpotifyActions();
        this.musicPositionView = new MusicPositionView(musicPlayer);
        this.listenerView = new StationListenerView(musicPlayer);
        this.djView = new StationDJView(user_is_dj, musicPlayer);
        this.adminView = new StationAdminView(user_is_admin, stationServer);
    }

    bindSpotifyActions() {
        this.musicPlayer.on('player_state_changed', state => {
            this.update(state);
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

    update(playbackState) {
        // Update album art
        $('#album-art').empty();
        $('<img/>', {
            src: playbackState.track_window.current_track.album.images[0].url,
            alt: playbackState.track_window.current_track.album.name
        }).appendTo('#album-art');

        // Update track title and track artist
        $('#playback-track-title').html(playbackState.track_window.current_track.name);
        $('#playback-track-artist').html(playbackState.track_window.current_track.artists[0].name);

        // Update duration, current position is handled in MusicPositionView
        $('#playback-duration').html(msToTimeString(playbackState.duration));
    }

    updateVolumeControls(volume) {
        this.listenerView.updateVolumeControls(volume);
    }
}

class MusicPositionView {
    constructor(musicPlayer) {
        this.musicPlayer = musicPlayer;
        this.bindSpotifyActions();
        this.refreshTimeoutId = null;
        this.positionMS = 0.0;
    }

    bindSpotifyActions() {
        this.musicPlayer.on('player_state_changed', state => {
            this.update(state);
        });
    }

    update(playbackState) {
        this.positionMS = playbackState.position;
        this.draw();

        if (playbackState.paused) {
            this.ensureDisableRefresh();
        } else {
            this.ensureEnableRefresh();
        }
    }

    draw() {
        $('#playback-current-position').html(msToTimeString(this.positionMS));
    }

    ensureEnableRefresh() {
        if (this.refreshTimeoutId === null) {
            this.refreshTimeoutId = window.setInterval(() => {
                this.draw();
                this.positionMS += 1000;
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
        this.musicPlayer = musicPlayer;
        this.bindSpotifyActions();
        this.musicVolume = new MusicVolume(musicPlayer);
        this.bindUIActions();
        this.updateVolumeControls(MusicVolume.getCachedVolume());
    }

    bindSpotifyActions() {
        this.musicPlayer.on('ready', () => {
            this.initVolumeControls();
        });
    }

    bindUIActions() {
        $('#mute-button').on('click', () => {
            this.muteUnmuteStation();
        });

        $('#volume-slider').change(() => {
            this.changeVolume();
        });
    }

    initVolumeControls() {
        this.musicVolume.getVolume().then((volume) => {
            this.updateVolumeControls(volume);
        });

        $('#listener-controls :button').prop('disabled', false);
    }

    muteUnmuteStation() {
        this.musicVolume.mute().then(newVolume => {
            console.log(`${(newVolume === 0.0) ? 'Muting' : 'Umuting'} playback`);
            this.updateVolumeControls(newVolume);
        });
    }

    changeVolume() {
        if (this.musicPlayer) {
            const newVolume = parseFloat($('#volume-slider').val());
            this.musicVolume.setVolume(newVolume).then(() => {
                this.updateVolumeControls(newVolume);
            });
        }
    }

    updateVolumeControls(volume) {
        if (volume === 0.0) {
            $('#mute-button').html('<i class="fas fa-volume-off"></i>');
        } else {
            $('#mute-button').html('<i class="fas fa-volume-up"></i>');
        }

        $('#volume-slider').val(volume);
    }
}

class StationDJView {
    constructor(userIsDJ, musicPlayer) {
        this.isEnabled = userIsDJ;
        this.musicPlayer = musicPlayer;
        this.bindSpotifyActions();
        this.bindUIActions();

        if (!this.isEnabled) {
            $('#dj-controls').hide();
        }
    }

    bindSpotifyActions() {
        this.musicPlayer.on('ready', () => {
            if (this.isEnabled) {
                $('#dj-controls :button').prop('disabled', false);
            }
        });

        this.musicPlayer.on('player_state_changed', state => {
            this.update(state);
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

    playPause() {
        if (this.isEnabled && this.musicPlayer.isReady) {
            this.musicPlayer.player.togglePlay();
        }
    }

    previousTrack() {
        if (this.isEnabled && this.musicPlayer.isReady) {
            this.musicPlayer.player.previousTrack();
        }
    }

    nextTrack() {
        if (this.isEnabled && this.musicPlayer.isReady) {
            this.musicPlayer.player.nextTrack();
        }
    }

    update(playbackState) {
        if (playbackState.paused) {
            $('#play-pause-button').html('<i class="fas fa-play"></i>');
        } else {
            $('#play-pause-button').html('<i class="fas fa-pause"></i>');
        }
    }
}

class StationAdminView {
    constructor(user_is_admin, stationServer) {
        this.isEnabled = user_is_admin;
        this.stationServer = stationServer;
        this.bindUIActions();

        if (!this.isEnabled) {
            $('#admin-view').hide();
        }
    }

    bindUIActions() {
        $('#invite-listener-form').submit(e => {
            // Stop form from submitting normally
            e.preventDefault();

            this.inviteListener();
        });
    }

    bindServerActions() {
        this.stationServer.on('invite_sent', () => {
            this.finishSendingInvite();
        });
    }

    inviteListener() {
        const listenerEmail = $('#invite-listener-email').val();
        this.stationServer.sendListenerInvite(listenerEmail);
    }

    finishSendingInvite() {
        $('#admin-invite-sent').html('Invite sent!');
        setTimeout(() => {
            $('#admin-invite-sent').hide();
        }, 5000);

        $('#invite-listener-email').val('');
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
