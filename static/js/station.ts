'use strict';

declare var channels;

const SERVER_HEARTBEAT_INTERVAL_MS = 3000;
const MUSIC_POSITION_VIEW_REFRESH_INTERVAL_MS = 1000;
const MAX_SEEK_ERROR_MS = 2000;

class StationApp { // eslint-disable-line no-unused-vars
    readonly musicPlayer: StationMusicPlayer;
    readonly stationServer: StationServer;
    readonly view: StationView;

    constructor(userIsDJ, userIsAdmin, accessToken, stationId) {
        this.musicPlayer = new StationMusicPlayer('Dancing Together', accessToken);
        this.stationServer = new StationServer(stationId, this.musicPlayer);
        this.view = new StationView(userIsDJ, userIsAdmin, this.musicPlayer, this.stationServer);
    }
}

interface MusicPlayer {
    getCurrentState(): Promise<Spotify.PlaybackState>;

    getVolume(): Promise<number>;
    setVolume(value: number): Promise<void>;

    pause(): Promise<void>;
    resume(): Promise<void>;
    togglePlay(): Promise<void>;

    seek(positionMS: number): Promise<void>;

    previousTrack(): Promise<void>;
    nextTrack(): Promise<void>;
}

interface ListenCallback {
    (action, stream);
}

interface WebSocketBridge {
    socket: WebSocket;
    connect(path: string);
    listen(callback: ListenCallback);
}

class StationMusicPlayer {
    isReady: boolean = false;
    player?: Spotify.SpotifyPlayer = null;
    deviceId?: string = null;
    storedSpotifyCallbacks: Array<[string, Function]> = [];

    constructor(client_name, public accessToken: string) {
        window.onSpotifyWebPlaybackSDKReady = () => {
            this.player = new Spotify.Player({
                name: client_name,
                getOAuthToken: cb => { cb(this.getAccessToken()); },
                volume: MusicVolume.getCachedVolume(),
            });

            this.bindSpotifyActions();
            this.player.connect();
        };
    }

    on(eventName: string, cb: Function) {
        if (this.player) {
            // @ts-ignore
            this.player.on(eventName, cb);
        } else {
            this.storedSpotifyCallbacks.push([eventName, cb]);
        }
    }

    bindSpotifyActions() {
        this.storedSpotifyCallbacks.forEach(nameCBPair => {
            // @ts-ignore
            this.player.on(nameCBPair[0], nameCBPair[1]);
        });

        this.player.on('ready', ({ device_id }) => {
            this.deviceId = device_id;
            this.isReady = true;
        });

        this.player.on('initialization_error', () => {
            this.isReady = false;
        });

        this.player.on('authentication_error', () => {
            this.isReady = false;
        });

        this.player.on('account_error', () => {
            this.isReady = false;
        });
    }

    getAccessToken(): string {
        return this.accessToken;
    }

    setAccessToken(accessToken: string) {
        this.accessToken = accessToken;
    }

    getCurrentState(): Promise<Spotify.PlaybackState> { return this.player.getCurrentState(); }

    getVolume(): Promise<number> { return this.player.getVolume(); }
    setVolume(value: number): Promise<void> { return this.player.setVolume(value); }

    pause(): Promise<void> { return this.player.pause(); }
    resume(): Promise<void> { return this.player.resume(); }
    togglePlay(): Promise<void> { return this.player.togglePlay(); }

    freeze(duration: number): Promise<void> {
        return this.player.pause().then(() => wait(duration)).then(() => this.player.resume());
    }

    seek(positionMS): Promise<void> { return this.player.seek(positionMS); }

    previousTrack(): Promise<void> { return this.player.previousTrack(); }
    nextTrack(): Promise<void> { return this.player.nextTrack(); }
}

// Public Events
// 'ready' -> Server is now ready to accept requests
// 'listener_change' -> The station's listeners have changed
// 'error' -> An error occurred.
class StationServer {
    webSocketBridge?: any = null;
    observers: Map<string, JQueryCallback>;
    serverPings: CircularArray = new CircularArray(5);
    heartbeatIntervalId?: number = null;
    requestId: number = 0;
    clientPlaybackStateUpdateInProgress: boolean = false;
    clientEtag?: Date = null;
    serverEtag?: string = null;
    initialStateReady: boolean = false;

    constructor(readonly stationId: number, readonly musicPlayer: StationMusicPlayer) {
        this.bindSpotifyActions();
        this.observers = new Map([
            ['ready', $.Callbacks()],
            ['listener_change', $.Callbacks()],
            ['error', $.Callbacks()],
            // Private observers
            ['get_listeners_result', $.Callbacks()],
            ['send_listener_invite_result', $.Callbacks()],
        ]);
    }

    on(eventName: string, cb: Function) {
        this.observers.get(eventName).add(cb);
    }

    onOnce(eventName: string, thisRequestId: number, cb: Function) {
        const cbWrapper = (requestId, ...args) => {
            if (requestId === thisRequestId) {
                this.removeListener(eventName, cbWrapper);
                cb(...args);
            }
        };
        this.on(eventName, cbWrapper);
    }

    removeListener(eventName: string, cb: Function) {
        this.observers.get(eventName).remove(cb);
    }

    bindSpotifyActions() {
        this.musicPlayer.on('ready', () => {
            this.connect();
        });

        this.musicPlayer.on('player_state_changed', state => {
            if (state) {
                this.sendPlayerState(state);
            }
        });

        this.musicPlayer.on('authentication_error', () => {
            this.refreshAccessToken();
        });
    }

    bindWebSocketBridgeActions() {
        this.webSocketBridge.socket.onopen = () => { this.onOpen(); };
        this.webSocketBridge.listen(action => { this.onMessage(action); });
    }

    connect() {
        // Correctly decide between ws:// and wss://
        const wsScheme = window.location.protocol == 'https:' ? 'wss' : 'ws';
        const wsPath = wsScheme + '://' + window.location.host + '/station/stream/';
        this.webSocketBridge = new channels.WebSocketBridge();
        this.webSocketBridge.connect(wsPath);
        this.bindWebSocketBridgeActions();
    }

    enableHeartbeat() {
        this.heartbeatIntervalId = window.setInterval(() => {
            if (!this.clientPlaybackStateUpdateInProgress) {
                this.sendPing();
                this.musicPlayer.player.getCurrentState().then(state => {
                    if (state) {
                        this.sendPlayerState(state);
                    }
                });
            }
        }, SERVER_HEARTBEAT_INTERVAL_MS);
    }

    disableHeartbeat() {
        window.clearInterval(this.heartbeatIntervalId);
        this.heartbeatIntervalId = null;
    }

    // Socket Callbacks

    onOpen() {
        this.webSocketBridge.send({
            'command': 'join',
            'station': this.stationId,
            'device_id': this.musicPlayer.deviceId
        });
    }

    onMessage(action) {
        if (action.error) {
            this.syncPlaybackState();
            this.observers.get('error').fire(action.error, action.message);
        } else if (action.join) {
            this.enableHeartbeat();
            this.observers.get('ready').fire(action.join);
        } else if (action.leave) {
            $('#station-name').html('');
            this.disableHeartbeat();
        } else if (action.type === 'pong') {
            this.serverPings.push((new Date()).getTime() - new Date(action.start_time).getTime());
        } else if (action.type === 'ensure_playback_state') {
            this.ensurePlaybackState(action.state);
        } else if (action.type === 'access_token_change') {
            this.musicPlayer.setAccessToken(action.accessToken);
        } else if (action.type === 'listener_change') {
            this.observers['listener_change'].fire(action.listener_change_type, action.listener);
        } else if (action.type === 'get_listeners_result') {
            this.observers.get(action.type).fire(action.request_id, action.listeners, action.pending_listeners);
        } else if (action.type === 'send_listener_invite_result') {
            this.observers.get(action.type).fire(action.request_id, action.result, action.is_new_user);
        } else {
            console.error('Unknown message from server: ', action);
        }
    }

    sendPing() {
        this.webSocketBridge.send({
            'command': 'ping',
            'start_time': new Date(),
        });
    }

    sendPlayerState(state) {
        if (!this.initialStateReady || this.clientPlaybackStateUpdateInProgress
            || (this.clientEtag !== null) && (new Date(state.timestamp) < this.clientEtag)) {
            return;
        }

        this.webSocketBridge.send({
            'command': 'player_state_change',
            'state': PlaybackState.fromSpotify(state),
            'etag': this.serverEtag || '',
        });
    }

    syncPlaybackState() {
        if (!this.initialStateReady || this.clientPlaybackStateUpdateInProgress) {
            return;
        }

        this.musicPlayer.getCurrentState()
            .then(state => {
                if (!state) {
                    return;
                }

                this.webSocketBridge.send({
                    'command': 'get_playback_state',
                    'state': PlaybackState.fromSpotify(state),
                    'etag': '',
                });
            });
    }

    refreshAccessToken() {
        this.webSocketBridge.send({
            'command': 'refresh_access_token'
        });
    }

    getListeners() {
        return new Promise(resolve => {
            const thisRequestId = ++this.requestId;
            this.onOnce('get_listeners_result', thisRequestId, (listeners, pendingListeners) => {
                resolve({ listeners, pendingListeners });
            });

            this.webSocketBridge.send({
                'command': 'get_listeners',
                'request_id': thisRequestId,
            });
        });
    }

    sendListenerInvite(listenerEmail: string) {
        return new Promise((resolve) => {
            const thisRequestId = ++this.requestId;
            this.onOnce('send_listener_invite_result', thisRequestId, (result, isNewUser) => {
                resolve({ result, isNewUser });
            });

            this.webSocketBridge.send({
                'command': 'send_listener_invite',
                'request_id': thisRequestId,
                'listener_email': listenerEmail,
            });
        });
    }

    ensurePlaybackState(serverState) {
        if (this.clientPlaybackStateUpdateInProgress) {
            return;
        }

        this.clientPlaybackStateUpdateInProgress = true;
        const currentTrackReady = () => this.musicPlayer.getCurrentState().then(state => {
            if (state) {
                return state.track_window.current_track.uri === serverState.current_track_uri;
            } else {
                return false;
            }
        });
        Promise.race([retry(currentTrackReady), timeout(5000)])
            .then(() => this.musicPlayer.getCurrentState())
            .then(state => {
                if (!state) {
                    return Promise.reject('Spotify not ready');
                }

                if (serverState.paused) {
                    const pauseIfNeeded = (state.paused ? Promise.resolve() : this.musicPlayer.pause());
                    return pauseIfNeeded.then(() => this.musicPlayer.seek(serverState.position));
                } else {
                    const localPosition = state.position;
                    const serverPosition = this.getAdjustedPlaybackPosition(serverState);
                    if (Math.abs(localPosition - serverPosition) > MAX_SEEK_ERROR_MS) {
                        const newLocalPosition = serverPosition + 2000;
                        const currentPositionReady = () => this.musicPlayer.getCurrentState().then(state => {
                            if (state) {
                                return state.position > newLocalPosition;
                            } else {
                                return false;
                            }
                        });
                        return this.musicPlayer.seek(newLocalPosition)
                            .then(() => Promise.race([retry(currentPositionReady), timeout(5000)]))
                            .then(() => {
                                const serverPosition = this.getAdjustedPlaybackPosition(serverState);
                                if (((newLocalPosition > serverPosition) && (newLocalPosition < (serverPosition + MAX_SEEK_ERROR_MS)))) {
                                    return this.musicPlayer.freeze(localPosition - serverPosition);
                                } else {
                                    return this.musicPlayer.resume();
                                }
                            });
                    } else if (state.paused) {
                        return this.musicPlayer.resume();
                    } else {
                        return Promise.resolve();
                    }
                }
            })
            .then(() => this.musicPlayer.getCurrentState())
            .then(state => {
                // @ts-ignore
                this.clientEtag = new Date(state.timestamp);
                this.serverEtag = serverState.etag;
                this.initialStateReady = true;
                this.clientPlaybackStateUpdateInProgress = false;
            })
            .catch(e => {
                console.error(e);
                this.clientPlaybackStateUpdateInProgress = false;
                return wait(100).then(() => this.ensurePlaybackState(serverState));
            });
    }

    getMedianServerOneWayTime(): number {
        return ((this.serverPings.length === 0) ? 30 : (median(this.serverPings.entries()) / 2));
    }

    getAdjustedPlaybackPosition(serverState): number {
        let position = serverState.raw_position_ms;
        if (!serverState.paused) {
            const sampleTime = new Date(serverState.sample_time);
            const serverDelay = this.getMedianServerOneWayTime();
            position += ((new Date()).getTime() - (sampleTime.getTime() + serverDelay));
        }

        return position;
    }
}

// View Management

class StationView {
    private state = new class {
        playbackState?: Spotify.PlaybackState = null;
        isConnected: boolean = false;
        errorMessage?: string = null;
    };
    readonly musicPositionView: MusicPositionView;
    readonly listenerView: StationListenerView;
    readonly djView: StationDJView;
    readonly adminView: StationAdminView;

    constructor(userIsDJ, userIsAdmin, readonly musicPlayer: StationMusicPlayer, readonly stationServer: StationServer) {
        this.musicPositionView = new MusicPositionView(musicPlayer);
        this.listenerView = new StationListenerView(musicPlayer);
        this.djView = new StationDJView(userIsDJ, musicPlayer);
        this.adminView = new StationAdminView(userIsAdmin, stationServer);
        this.bindSpotifyActions();
        this.render();
    }

    bindSpotifyActions() {
        this.musicPlayer.on('ready', () => {
            this.setState(() => ({ isConnected: true }));
        });

        this.musicPlayer.on('initialization_error', ({ message }) => {
            this.setState(() => ({ isConnected: false, errorMessage: message }));
        });

        this.musicPlayer.on('account_error', ({ message }) => {
            this.setState(() => ({ isConnected: false, errorMessage: message }));
        });

        this.musicPlayer.on('player_state_changed', state => {
            this.setState(() => ({ playbackState: state }));
        });

        this.stationServer.on('error', (error, message) => {
            if (error != 'precondition_failed') {
                this.setState(() => ({ errorMessage: message }));
            }
        });
    }

    render() {
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

        if (this.state.playbackState !== null) {
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
    }

    setState(updater) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }
}

class MusicPositionView {
    private state = new class {
        positionMS: number = 0.0;
    };
    refreshTimeoutId?: number = null;

    constructor(readonly musicPlayer: StationMusicPlayer) {
        this.bindSpotifyActions();
        this.render();
    }

    bindSpotifyActions() {
        this.musicPlayer.on('player_state_changed', state => {
            if (state) {
                this.setState(() => ({ positionMS: state.position }));

                if (state.paused) {
                    this.ensureDisableRefresh();
                } else {
                    this.ensureEnableRefresh();
                }
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
    volume: number = MusicVolume.getCachedVolume();
    volumeBeforeMute: number;

    constructor(readonly musicPlayer) {
        this.volumeBeforeMute = this.volume;
    }

    static getCachedVolume(): number {
        if (localStorage.getItem('musicVolume') !== null) {
            return localStorage['musicVolume'];
        } else {
            return 0.8;
        }
    }

    static setCachedVolume(volume: number) {
        localStorage['musicVolume'] = volume;
    }

    getVolume(): Promise<number> {
        return new Promise(resolve => {
            if (this.musicPlayer.isReady) {
                this.musicPlayer.getVolume()
                    .then((volume) => {
                        resolve(volume);
                    });
            }
        });
    }

    setVolume(volume: number): Promise<void> {
        return new Promise(resolve => {
            if (this.musicPlayer.isReady) {
                this.musicPlayer.setVolume(volume)
                    .then(() => {
                        MusicVolume.setCachedVolume(volume);
                        resolve();
                    });
            }
        });
    }

    mute(): Promise<number> {
        return new Promise(resolve => {
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

                    return newVolume;
                }).then(newVolume => {
                    return this.setVolume(newVolume).then(() => Promise.resolve(newVolume));
                }).then(newVolume => {
                    return resolve(newVolume);
                });
            }
        });
    }
}

class StationListenerView {
    private state = new class {
        isReady: boolean = false;
        volume: number = MusicVolume.getCachedVolume();
    };
    musicVolume: MusicVolume;

    constructor(readonly musicPlayer) {
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
            const newVolume = parseFloat($('#volume-slider').val() as string);
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
    private state = new class {
        isEnabled: boolean;
        isReady: boolean = false;
        playbackState?: PlaybackState;
    };
    constructor(userIsDJ, readonly musicPlayer: StationMusicPlayer) {
        this.state.isEnabled = userIsDJ;
        this.bindSpotifyActions();
        this.bindUIActions();
        this.render();
    }

    bindSpotifyActions() {
        this.musicPlayer.on('ready', () => {
            this.setState(() => ({ isReady: true }));
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
            this.musicPlayer.togglePlay();
        }
    }

    previousTrack() {
        if (this.state.isEnabled && this.state.isReady) {
            this.musicPlayer.previousTrack();
        }
    }

    nextTrack() {
        if (this.state.isEnabled && this.state.isReady) {
            this.musicPlayer.nextTrack();
        }
    }
}

class StationAdminView {
    private state = new class {
        isEnabled: boolean;
        isReady: boolean = false;
        listeners: Array<Listener> = [];
        pendingListeners: Array<Listener> = [];
    };

    constructor(userIsAdmin, readonly stationServer: StationServer) {
        this.state.isEnabled = userIsAdmin;
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

    setState(updater) {
        // Merge previous state and new state
        this.state = Object.assign({}, this.state, updater(this.state));
        this.render();
    }

    loadListeners() {
        if (this.state.isEnabled) {
            this.stationServer.getListeners().then(({ listeners, pendingListeners }) => {
                this.setState(() => ({
                    listeners: listeners,
                    pendingListeners: pendingListeners,
                }));
            });
        }
    }

    sendListenerInvite() {
        const listenerEmail = $('#invite-listener-email').val() as string;
        if (listenerEmail.length === 0) {
            return;
        }

        this.stationServer.sendListenerInvite(listenerEmail).then(({ result, isNewUser }) => {
            let message;
            if (result === 'ok') {
                message = (isNewUser ? 'Invite sent to new user!' : 'Invite sent!');
            } else if (result === 'err_user_exists') {
                message = `Error: ${listenerEmail} is already a listener`;
            } else {
                message = `An error occurred while inviting ${listenerEmail}`;
            }

            $('#admin-invite-sent').html(message);
            wait(10000).then(() => $('#admin-invite-sent').hide());

            $('#invite-listener-email').val('');
        });
    }
}

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function timeout(ms: number) {
    return wait(ms).then(Promise.reject);
}

function retry(condition: () => Promise<boolean>): Promise<void> {
    return condition().then(b => (b ? Promise.resolve() : wait(250).then(() => retry(condition))));
}

class CircularArray {
    array: Array<any> = [];
    position: number = 0;
    constructor(readonly capacity: number) {
    }

    get length(): number {
        return this.array.length;
    }

    entries(): Array<any> {
        return this.array;
    }

    push(e: any) {
        this.array[this.position % this.capacity] = e;
        this.position++;
    }
}

interface Listener {
    id: number;
    username: string;
    email: string;
}

class PlaybackState {
    constructor(readonly context_uri: string,
        readonly current_track_uri: string, readonly paused: boolean,
        readonly raw_position_ms: number, readonly sample_time: Date) {
    }

    static fromSpotify(state) {
        return new PlaybackState(
            state['context']['uri'],
            state['track_window']['current_track']['uri'],
            state['paused'],
            state['position'],
            new Date(state['timestamp']));
    }

    static fromServer(state) {
        return new PlaybackState(
            state.context_uri,
            state.current_track_uri,
            state.paused,
            state.raw_position_ms,
            new Date(state.sample_time));
    }
}

function median(arr: Array<number>): number {
    return arr.concat().sort()[Math.floor(arr.length / 2)];
}

// milliseconds -> 'm:ss', rounding down, and left-padding seconds
// '0' -> '0:00'
// '153790' -> '2:33'
// Does not support hours (most songs are <60mins)
function msToTimeString(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60).toString();
    const secondsRemainder = Math.floor(seconds % 60).toString();
    const secondsRemainderPad = (secondsRemainder.length === 1) ? '0' + secondsRemainder : secondsRemainder;
    return `${minutes}:${secondsRemainderPad}`;
}
