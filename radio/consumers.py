import logging
from typing import Optional

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer, JsonWebsocketConsumer

from . import spotify
from .exceptions import ClientError
from .models import Listener, SpotifyCredentials, Station

logger = logging.getLogger(__name__)


class PlaybackState:
    def __init__(self, context_uri, current_track_uri, paused, position_ms):
        self._context_uri = context_uri
        self._current_track_uri = current_track_uri
        self._paused = paused
        self._position_ms = position_ms

    @property
    def context_uri(self):
        return self._context_uri

    @property
    def current_track_uri(self):
        return self._current_track_uri

    @property
    def paused(self):
        return self._paused

    @property
    def position_ms(self):
        return self._position_ms

    @staticmethod
    def from_client_state(state):
        context_uri = state['context']['uri']
        current_track_uri = state['track_window']['current_track']['uri']
        paused = state['paused']
        position = state['position']
        return PlaybackState(context_uri, current_track_uri, paused, position)

    @staticmethod
    def from_station(station):
        return PlaybackState(station.context_uri, station.current_track_uri,
                             station.paused, station.position_ms)


class StationConsumer(AsyncJsonWebsocketConsumer):

    # WebSocket event handlers

    async def connect(self):
        """Called during initial websocket handshaking."""
        logger.debug(f'{self.scope["user"]} connected to StationConsumer')
        if self.scope['user'].is_anonymous:
            logger.warn(
                f'anonymous user ({self.scope["user"]}) attempted to connect to station'
            )
            await self.close()
        else:
            await self.accept()

        self.station_id = None
        self.device_id = None
        self.is_admin = None
        self.is_dj = None

    async def receive_json(self, content):
        """Called when we get a text frame."""
        command = content.get('command', None)
        logger.debug(f'received command ({command}) from {self.scope["user"]}')

        try:
            if command == 'join':
                await self.join_station(content['station'],
                                        content['device_id'])

            elif command == 'leave':
                await self.leave_station(content['station'])

            elif command == 'player_state_change':
                listener = await get_listener_or_error(self.station_id,
                                                       self.scope['user'])
                if listener.is_dj:
                    await self.update_dj_state(content['state'])
                else:
                    await self.update_listener_state(content['state'])

        except ClientError as e:
            await self.send_json({'error': e.code, 'message': e.message})

    async def disconnect(self, code):
        """Called when the WebSocket closes for any reason."""
        try:
            await self.leave_station(self.station_id)
        except ClientError:
            pass

    # Command helper methods called by receive_json

    async def join_station(self, station_id, device_id):
        listener = await get_listener_or_error(station_id, self.scope['user'])
        self.station_id = station_id
        self.device_id = device_id
        self.is_admin = listener.is_admin
        self.is_dj = listener.is_admin

        station = await get_station_or_error(station_id, self.scope['user'])
        await self.channel_layer.group_add(station.group_name,
                                           self.channel_name)

        if self.is_admin:
            await self.channel_layer.group_add(station.admin_group_name,
                                               self.channel_name)

        # Message admins that a user has joined the station
        await self.channel_layer.group_send(
            station.admin_group_name, {
                'type': 'station.join',
                'username': self.scope['user'].username,
            })

        # Catch up to current playback state
        await self.spotify_start_resume_playback(
            self.scope['user'].id, self.device_id, station.context_uri,
            station.current_track_uri)

        # Reply to client to finish setting up station
        await self.send_json({'join': station.title})

    async def leave_station(self, station_id):
        station = await get_station_or_error(station_id, self.scope['user'])
        await self.channel_layer.group_send(
            station.admin_group_name, {
                'type': 'station.leave',
                'username': self.scope['user'].username,
            })

        await self.channel_layer.group_discard(station.group_name,
                                               self.channel_name)

        if self.is_admin:
            await self.channel_layer.group_discard(station.admin_group_name,
                                                   self.channel_name)

        self.station_id = None
        self.device_id = None
        self.is_admin = None
        self.is_dj = None

        # Reply to client to finish tearing down station
        await self.send_json({'leave': station_id})

    async def update_dj_state(self, state):
        user = self.scope['user']
        logger.debug(f'DJ {user} is updating station state...')
        station = await get_station_or_error(self.station_id, user)
        previous_state = PlaybackState.from_station(station)
        state = PlaybackState.from_client_state(state)

        # How do we keep the listeners in sync when the DJ changes the playback
        # state? Here, we determine what the difference between the two states
        # are issue commands to keep them in sync. Need to know whether to use
        # Web API or client API.

        same_context = (previous_state.context_uri == state.context_uri)
        same_track = (
            previous_state.current_track_uri == state.current_track_uri)
        same_context_and_track = (same_context and same_track)

        if same_context_and_track and (previous_state.paused != state.paused):
            # The DJ play/pause the current track
            pause_resume = 'pause' if state.paused else 'resume'
            logger.debug(
                f'DJ {user} caused {station.group_name} to {pause_resume}')
            await self.channel_layer.group_send(
                station.group_name, {
                    'type': 'station.toggle_play_pause',
                    'sender_user_id': self.scope['user'].id,
                    'paused': state.paused,
                })

        elif (same_context_and_track
              and (abs(station.position_ms - state.position_ms) > 10_000)):
            # The DJ seeked in the current track
            seek_change = state.position_ms - station.position_ms
            logger.debug(
                f'DJ {user} caused {station.group_name} to seek {seek_change}')
            await self.channel_layer.group_send(
                station.group_name, {
                    'type': 'station.seek_current_track',
                    'sender_user_id': self.scope['user'].id,
                    'position_ms': state.position_ms,
                })

        elif not same_context_and_track:
            # The DJ set a new playlist or switched tracks
            logger.debug(
                f'DJ {user} caused {station.group_name} to change context or track'
            )
            await self.channel_layer.group_send(
                station.group_name, {
                    'type': 'station.start_resume_playback',
                    'sender_user_id': self.scope['user'].id,
                    'context_uri': state.context_uri,
                    'current_track_uri': state.current_track_uri,
                })

        await update_station(station, state)

        self.last_dj_state = state

    async def update_listener_state(self, state):
        # TODO: detect if intentional change and disconnect the client if so
        # for now, ignore the request.
        logger.debug('update_listener_state called')
        pass

    # Handlers for messages sent over the channel layer

    async def station_join(self, event):
        """Called when someone has joined our chat."""
        # Send a message down to the client
        await self.send_json({
            'msg_type': 'enter',
            'username': event['username'],
        }, )

    async def station_leave(self, event):
        """Called when someone has left our chat."""
        # Send a message down to the client
        await self.send_json({
            'msg_type': 'leave',
            'username': event['username'],
        }, )

    async def station_toggle_play_pause(self, event):
        sender_user_id = event['sender_user_id']
        if sender_user_id != self.scope['user'].id:
            logger.debug(f'{self.scope["user"]} pausing or resuming...')
            change_type = 'set_paused' if event['paused'] else 'set_resumed'
            await self.send_json({
                'type': 'dj_state_change',
                'change_type': change_type,
            })

    async def station_seek_current_track(self, event):
        sender_user_id = event['sender_user_id']
        if sender_user_id != self.scope['user'].id:
            logger.debug(f'{self.scope["user"]} seeking...')
            position_ms = event['position_ms']
            await self.send_json({
                'type': 'dj_state_change',
                'change_type': 'seek_current_track',
                'position_ms': position_ms,
            })

    async def station_start_resume_playback(self, event):
        sender_user_id = event['sender_user_id']
        if sender_user_id != self.scope['user'].id:
            logger.debug(f'{self.scope["user"]} starting playback...')
            await self.spotify_start_resume_playback(
                self.scope['user'].id, self.device_id, event['context_uri'],
                event['current_track_uri'])

    # Utils

    async def spotify_start_resume_playback(self, user_id, device_id,
                                            context_uri, uri):
        await self.channel_layer.send(
            'spotify-dispatcher', {
                'type': 'spotify.start_resume_playback',
                'user_id': user_id,
                'device_id': device_id,
                'context_uri': context_uri,
                'uri': uri,
            })


class SpotifyConsumer(JsonWebsocketConsumer):
    """Background worker to send requests to the Spotify Web API."""

    def spotify_start_resume_playback(self, event):
        user_id = event['user_id']
        device_id = event['device_id']
        context_uri = event['context_uri']
        uri = event['uri']
        logger.debug(f'{user_id} starting playback...')

        creds = SpotifyCredentials.objects.get(pk=user_id)
        spotify.start_resume_playback(creds.access_token, device_id,
                                      context_uri, uri, user_id)


@database_sync_to_async
def get_station_or_error(station_id: Optional[int], user):
    """Fetch station for user and check permissions."""
    if user.is_anonymous:
        logger.warn(f'Anonymous user attempted to stream a station: {user}')
        raise ClientError('access_denied',
                          'You must be signed in to stream music')

    if station_id is None:
        logger.warn(f'Client did not join the station')
        raise ClientError('bad_request', 'You must join a station first')

    try:
        station = Station.objects.get(pk=station_id)
    except Station.DoesNotExist:
        raise ClientError('invalid_station', 'invalid station')

    return station


@database_sync_to_async
def get_listener_or_error(station_id: Optional[int], user):
    if user.is_anonymous:
        logger.warn(f'Anonymous user ({user}) attempted to stream a station')
        raise ClientError('access_denied',
                          'You must be signed in to stream music')

    if station_id is None:
        logger.warn(f'{user} did not join the station')
        raise ClientError('bad_request', 'You must join a station first')

    try:
        listener = Listener.objects.get(user_id=user.id, station_id=station_id)
    except Listener.DoesNotExist:
        raise ClientError('forbidden', 'This station is not available')

    return listener


@database_sync_to_async
def update_station(station, state: PlaybackState):
    station.context_uri = state.context_uri
    station.current_track_uri = state.current_track_uri
    station.paused = state.paused
    station.position_ms = state.position_ms
    station.save()
