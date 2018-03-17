'use strict';

/*global Spotify*/
/*global ReconnectingWebSocket*/

$(window).on('load', () => {
    // Show Playback UI
    if (!window.user_is_dj) {
        $('#dj-controls').hide();
    }
});

window.onSpotifyWebPlaybackSDKReady = () => {
    window.player = new Spotify.Player({
        name: 'Dancing Together',
        getOAuthToken: cb => { cb(window.access_token); }
    });

    // Error handling
    window.player.on('initialization_error', ({ message }) => {
        console.error('Failed to initialize', message);
        displayConnectionStatusMessage(false, 'Failed to initialize Spotify player.');
    });
    window.player.on('authentication_error', ({ message }) => {
        console.error('Failed to authenticate', message);
        displayConnectionStatusMessage(false, 'Invalid access token, please refresh the page.');
    });
    window.player.on('account_error', ({ message }) => {
        console.error('Failed to validate Spotify account', message);
        displayConnectionStatusMessage(false,  'Dancing Together requires a Spotify Premium account.');
    });
    window.player.on('playback_error', ({ message }) => {
        console.error('Failed to perform playback', message);
        displayConnectionStatusMessage(true, 'Failed to play the current song.');
    });

    // Playback status updates
    window.player.on('player_state_changed', state => {
        console.log('Player state changed', state);

        // Let the server determine what to do. Potential perf optimization
        // for both client and server is to only send this event if:
        // 1) the user is a dj (this can change during the stream)
        // 2) if this is a legitimate change and not just a random update
        window.socket.send(JSON.stringify({
            'command': 'player_state_change',
            'state': state
        }));

        // Update Play/Pause button
        if (state.paused) {
            $('#playPauseButton').html('<i class="fas fa-play"></i>');
        } else {
            $('#playPauseButton').html('<i class="fas fa-pause"></i>');
        }

        // Update album art
        $('#album-art').empty();
        $('<img/>', {
            src: state.track_window.current_track.album.images[0].url,
            alt: state.track_window.current_track.album.name
        }).appendTo('#album-art');

        // Update track title and track artist
        $('#playback-track-title').html(state.track_window.current_track.name);
        $('#playback-track-artist').html(state.track_window.current_track.artists[0].name);
    });

    // Ready
    window.player.on('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);

        // Enable DJ or Listener Controls
        if (window.user_is_dj) {
            $('#dj-controls :button').prop('disabled', false);
        } else {
            $('#listener-controls :button').prop('disabled', false);
        }

        // Set up volume slider
        $('#volume-slider').change(() => {
            const newVolume = parseFloat($('#volume-slider').val());
            window.player.setVolume(newVolume).then(() => {
                console.log(`Changed volume to ${newVolume}`);
                updateVolumeControls(newVolume);
            });
        });

        // Set up connection to server
        setUpWebSocket(device_id);
    });

    // Connect to the player!
    window.player.connect();
};

function setUpWebSocket(device_id) {
    // Correctly decide between ws:// and wss://
    const ws_scheme = window.location.protocol == 'https:' ? 'wss' : 'ws';
    const ws_path = ws_scheme + '://' + window.location.host + '/station/stream/';
    console.log(`Connecting to ${ws_path}`);
    window.socket = new ReconnectingWebSocket(ws_path);

    window.socket.onopen = () => {
        console.log('Connected to station socket');
        displayConnectionStatusMessage(true /*isConnected*/);

        console.log('Joining station', window.station_id);
        window.socket.send(JSON.stringify({
            'command': 'join',
            'station': window.station_id,
            'device_id': device_id
        }));
    };

    window.socket.onclose = () => {
        console.log('Disconnected from station socket');
        displayConnectionStatusMessage(false /*isConnected*/);
    };

    window.socket.onmessage = message => {
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
                window.player.pause().then(() => {
                    console.log('DJ caused station to pause');
                });
            } else if (data.change_type === 'set_resumed') {
                window.player.resume().then(() => {
                    console.log('DJ caused station to resume');
                });
            } else if (data.change_type === 'seek_current_track') {
                window.player.seek(data.position_ms).then(() => {
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
    };
}

// UI Controls

function displayConnectionStatusMessage(isConnected, errorMessage = '') {
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

// Listener Controls

function updateVolumeControls(volume) {
    if (volume === 0.0) {
        $('#mute-button').html('<i class="fas fa-volume-off"></i>');
    } else {
        $('#mute-button').html('<i class="fas fa-volume-up"></i>');
    }

    $('#volume-slider').val(volume);
}

function handleMuteButtonClick(event) {
    window.player.getVolume().then(volume => {
        // BUG: Spotify API returns null instead of 0.0.
        // Tracked by https://github.com/rgardner/dancingtogether/issues/12

        var newVolume = 0.0;
        if ((volume === 0.0) || (volume === null)) {
            // currently muted, so unmute
            newVolume = window.unmuteVolume;
        } else {
            // currently unmuted, so mute and store current volume for restore
            window.unmuteVolume = volume;
            newVolume = 0.0;
        }

        window.player.setVolume(newVolume).then(() => {
            console.log(`${(newVolume === 0.0) ? 'Muting' : 'Umuting'} playback`);
            updateVolumeControls(newVolume);
        });
    });
}

// DJ Controls

function handlePreviousTrackButtonClick(event) {
    window.player.previousTrack().then(() => {
        console.log('Set to previous track');
    });
}

function handlePlayPauseButtonClick(event) {
    window.player.togglePlay().then(() => {
        console.log('Toggled playback');
    });
}

function handleNextTrackButtonClick(event) {
    window.player.nextTrack().then(() => {
        console.log('Set to next track');
    });
}
