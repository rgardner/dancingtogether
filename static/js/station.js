'use strict';

/*global Spotify*/
/*global ReconnectingWebSocket*/

class StationApp { // eslint-disable-line no-unused-vars
    constructor(user_is_dj, access_token, station_id) {
        this.view = new StationView(user_is_dj);
        this.stationServer = new StationServer(station_id, this.view);
        this.musicPlayer = null;

        window.onSpotifyWebPlaybackSDKReady = () => {
            this.musicPlayer = new StationMusicPlayer('Dancing Together', access_token, this.view, this.stationServer);
        };
    }
}

class StationMusicPlayer {
    constructor(client_name, access_token, view, stationServer) {
        this.view = view;
        this.stationServer = stationServer;
        this.deviceId = null;

        this.player = new Spotify.Player({
            name: client_name,
            getOAuthToken: cb => { cb(access_token); },
            volume: MusicVolume.getCachedVolume(),
        });

        this.bindSpotifyActions();
        this.player.connect();
    }

    bindSpotifyActions() {
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
        this.view.setMusicPlayer(this);
        this.stationServer.setMusicPlayer(this);
    }

    onPlayerStateChanged(state) {
        console.log('Player state changed', state);

        // Let the server determine what to do. Potential perf optimization
        // for both client and server is to only send this event if:
        // 1) the user is a dj (this can change during the stream)
        // 2) if this is a legitimate change and not just a random update
        this.stationServer.sendPlayerState(state);

        this.view.update(state);
    }

    onInitializationError(message) {
        console.error('Failed to initialize', message);
        this.view.displayConnectionStatusMessage(false, 'Failed to initialize Spotify player.');
    }

    onAuthenticationError(message) {
        console.error('Failed to authenticate', message);
        this.view.displayConnectionStatusMessage(false, 'Invalid access token, please refresh the page.');
    }

    onAccountError(message) {
        console.error('Failed to validate Spotify account', message);
        this.view.displayConnectionStatusMessage(false,  'Dancing Together requires a Spotify Premium account.');
    }

    onPlaybackError(message) {
        console.error('Failed to perform playback', message);
        this.view.displayConnectionStatusMessage(true, 'Failed to play the current song.');
    }
}

class StationServer {
    constructor(stationId, view) {
        this.stationId = stationId;
        this.view = view;
        this.musicPlayer = null;
        this.socket = null;
    }

    setMusicPlayer(musicPlayer) {
        this.musicPlayer = musicPlayer;
        this.connect();
    }

    connect() {
        // Correctly decide between ws:// and wss://
        const ws_scheme = window.location.protocol == 'https:' ? 'wss' : 'ws';
        const ws_path = ws_scheme + '://' + window.location.host + '/station/stream/';
        console.log(`Connecting to ${ws_path}`);
        this.socket = new ReconnectingWebSocket(ws_path);
        this.bindSocketActions();
    }

    bindSocketActions() {
        // Use arrow functions to capture this
        this.socket.onopen = () => { this.onOpen(); };
        this.socket.onclose = () => { this.onClose(); };
        this.socket.onmessage = message => { this.onMessage(message); };
    }

    sendPlayerState(state) {
        this.socket.send(JSON.stringify({
            'command': 'player_state_change',
            'state': state
        }));
    }

    onOpen() {
        console.log('Connected to station socket');
        this.view.displayConnectionStatusMessage(true /*isConnected*/);

        console.log('Joining station', this.stationId);
        this.socket.send(JSON.stringify({
            'command': 'join',
            'station': this.stationId,
            'device_id': this.musicPlayer.deviceId
        }));
    }

    onClose() {
        console.log('Disconnected from station socket');
        this.view.displayConnectionStatusMessage(false /*isConnected*/);
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
}

// View Management

class StationView {
    constructor(user_is_dj) {
        this.musicPositionView = new MusicPositionView();
        this.listener = new StationListenerView();
        this.dj = new StationDJView(user_is_dj);
    }

    setMusicPlayer(musicPlayer) {
        this.listener.setMusicPlayer(musicPlayer);
        if (this.dj) {
            this.dj.setMusicPlayer(musicPlayer);
        }
    }

    displayConnectionStatusMessage(isConnected, errorMessage = '') {
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
        this.listener.update(playbackState);

        // Update album art
        $('#album-art').empty();
        $('<img/>', {
            src: playbackState.track_window.current_track.album.images[0].url,
            alt: playbackState.track_window.current_track.album.name
        }).appendTo('#album-art');

        // Update track title and track artist
        $('#playback-track-title').html(playbackState.track_window.current_track.name);
        $('#playback-track-artist').html(playbackState.track_window.current_track.artists[0].name);

        // Update current position and duration
        this.musicPositionView.update(playbackState);
        $('#playback-duration').html(msToTimeString(playbackState.duration));
    }

    updateVolumeControls(volume) {
        this.listener.updateVolumeControls(volume);
    }
}

class MusicPositionView {
    constructor() {
        this.refreshTimeoutId = null;
        this.positionMS = 0.0;
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
            }, 1000);
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
    constructor() {
        this.musicPlayer = null;
        this.volume = MusicVolume.getCachedVolume();
        this.volumeBeforeMute = this.volume;
    }

    setMusicPlayer(musicPlayer) {
        this.musicPlayer = musicPlayer;
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
            if (this.musicPlayer) {
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
            if (this.musicPlayer) {
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
            if (this.musicPlayer) {
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
    constructor() {
        this.musicPlayer = null;
        this.musicVolume = new MusicVolume();
        this.bindUIActions();
    }

    setMusicPlayer(musicPlayer) {
        this.musicPlayer = musicPlayer;
        this.musicVolume.setMusicPlayer(musicPlayer);
        this.musicVolume.getVolume().then((volume) => {
            this.updateVolumeControls(volume);
        });

        $('#listener-controls :button').prop('disabled', false);
    }

    bindUIActions() {
        $('#mute-button').on('click', () => {
            this.muteUnmuteStation();
        });

        $('#volume-slider').change(() => {
            this.changeVolume();
        });
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

    update(playbackState) {
        // Update Play/Pause Button
        if (playbackState.paused) {
            $('#play-pause-button').html('<i class="fas fa-play"></i>');
        } else {
            $('#play-pause-button').html('<i class="fas fa-pause"></i>');
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
    constructor(userIsDJ) {
        this.isEnabled = userIsDJ;
        this.musicPlayer = null;
        this.bindUIActions();

        if (!this.isEnabled) {
            $('#dj-controls').hide();
        }
    }

    setMusicPlayer(musicPlayer) {
        this.musicPlayer = musicPlayer;
        if (this.isEnabled) {
            $('#dj-controls :button').prop('disabled', false);
        }
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
        if (this.isEnabled && this.musicPlayer) {
            this.musicPlayer.player.togglePlay();
        }
    }

    previousTrack() {
        if (this.isEnabled && this.musicPlayer) {
            this.musicPlayer.player.previousTrack();
        }
    }

    nextTrack() {
        if (this.isEnabled && this.musicPlayer) {
            this.musicPlayer.player.nextTrack();
        }
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
