import logging
from typing import Optional

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer, JsonWebsocketConsumer

from . import spotify
from .exceptions import ClientError
from .models import Listener, Station

logger = logging.getLogger(__name__)


class PlaybackState:
    def __init__(self, context_uri, current_track_uri, paused, position_ms):
        self._context_uri = context_uri
        self._current_track_uri = current_track_uri
        self._paused = paused
        self._position = position_ms

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
        logger.debug(
            f"user {self.scope['user'].id} connected to StationConsumer")
        if self.scope['user'].is_anonymous:
            await self.close()
        else:
            await self.accept()

        self.station_id = None
        self.device_id = None

    async def receive_json(self, content):
        """Called when we get a text frame."""
        command = content.get('command', None)
        logger.debug(f'received command: {command}')
        try:
            if command == 'join':
                await self.join_station(content['station'],
                                        content['device_id'])

            elif command == 'leave':
                await self.leave_station(content['station'])

            elif command == 'player_state_change':
                listener_relationship = await get_listener_relationship_or_error(
                    self.station_id, self.scope['user'])
                if listener_relationship.is_dj:
                    await self.update_dj_state(content['state'])
                else:
                    await self.update_listener_state(content['state'])

            elif command == 'send':
                await self.send_station(content['station'], content['message'])
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
        self.station_id = station_id
        self.device_id = device_id

        # Message group that user has joined station. Do this before joining
        # group to prevent receiving own join message
        station = await get_station_or_error(station_id, self.scope['user'])
        await self.channel_layer.group_send(
            station.group_name, {
                'type': 'station.join',
                'station_id': station_id,
                'username': self.scope['user'].username,
            })

        await self.channel_layer.group_add(station.group_name,
                                           self.channel_name)
        await self.send_json({'join': station_id})

    async def leave_station(self, station_id):
        station = await get_station_or_error(station_id, self.scope['user'])
        await self.channel_layer.group_send(
            station.group_name, {
                'type': 'station.leave',
                'station_id': station_id,
                'username': self.scope['user'].username,
            })

        await self.channel_layer.group_discard(station.group_name,
                                               self.channel_name)
        await self.send_json({'leave': str(station_id)})

        self.station_id = None

    async def update_dj_state(self, state):
        logger.debug('update_dj_state called')
        station = await get_station_or_error(self.station_id,
                                             self.scope['user'])
        previous_state = PlaybackState.from_station(station)

        # How do we keep the listeners in sync when the DJ changes the playback
        # state? Here, we determine what the difference between the two states
        # are issue commands to keep them in sync. Need to know whether to use
        # Web API or client API.

        state = PlaybackState.from_client_state(state)
        if ((previous_state.context_uri == state.context_uri) and
            (previous_state.current_track_uri == state.current_track_uri)
                and (previous_state.paused != state.paused)):
            # The DJ play/pause the current track
            await self.channel_layer.group_send(
                station.group_name, {
                    'type': 'station.toggle_play_pause',
                    'paused': state.paused,
                })

        elif ((previous_state.context_uri == state.context_uri)
              and (previous_state.current_track_uri == state.current_track_uri)
              and (previous_state.paused == state.paused)
              and (abs(station.position_ms - state.position_ms) > 2000)):
            # The DJ seeked in the current track
            await self.channel_layer.group_send(
                station.group_name, {
                    'type': 'station.seek_current_track',
                    'position_ms': state.position_ms,
                })

        else:
            # The DJ set a new playlist or switched tracks
            await self.channel_layer.group_send(
                station.group_name, {
                    'type': 'station.start_resume_playback',
                    'position_ms': state.position_ms,
                })
            await update_station(station, state)

        self.last_dj_state = state

    async def update_listener_state(self, state):
        # TODO: detect if intentional change and disconnect the client if so
        # for now, ignore the request.
        logger.debug('update_listener_state called')
        pass

    async def send_station(self, station_id, message):
        user = self.scope['user']
        logger.debug(f'{user.id} sent {message} to {station_id}')
        if station_id != self.station_id:
            raise ClientError("station_ACCESS_DENIED", "access denied")

        station = await get_station_or_error(station_id, user)

        await self.channel_layer.group_send(
            station.group_name, {
                'type': 'station.message',
                'station_id': station_id,
                'username': user.username,
                'message': message,
            })

    # Handlers for messages sent over the channel layer

    async def station_join(self, event):
        """Called when someone has joined our chat."""
        # Send a message down to the client
        await self.send_json({
            'msg_type': 'enter',
            'station': event['station_id'],
            'username': event['username'],
        }, )

    async def station_leave(self, event):
        """Called when someone has left our chat."""
        # Send a message down to the client
        await self.send_json({
            'msg_type': 'leave',
            'station': event['station_id'],
            'username': event['username'],
        }, )

    async def station_toggle_play_pause(self, event):
        paused = event['paused']
        await self.send_json({
            'type': 'toggle_play_pause',
            'paused': paused,
        })

    async def station_seek_current_track(self, event):
        position_ms = event['position_ms']
        await self.send_json({
            'type': 'seek_current_track',
            'position_ms': position_ms,
        })

    async def station_start_resume_playback(self, event):
        await self.channel_layer.send(
            'spotify-dispatcher', {
                'user_id': self.scope['user'].id,
                'device_id': self.device_id,
                'context_uri': event['context_uri'],
                'uri': event['current_track_uri'],
            })
        # TODO: consider sending event to client to notify them that the DJ
        # changed the current state

    async def station_message(self, event):
        """Called when someone has messaged our chat."""
        # Send a message down to the client
        await self.send_json({
            'msg_type': 'message',
            'station': event['station_id'],
            'username': event['username'],
            'message': event['message'],
        })


class SpotifyConsumer(JsonWebsocketConsumer):
    """Background worker to send requests to the Spotify Web API."""

    def spotify_startresumeplayback(self, event):
        logger.debug('spotify_start_resume_playback_called')
        user_id = event['user_id']
        device_id = event['device_id']
        context_uri = event['context_uri']
        uri = event['uri']

        user = User.objects.get(pk=user_id)
        spotify.start_resume_playback(user.spotifycredentials.access_token,
                                      device_id, context_uri, uri)


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
def get_listener_relationship_or_error(station_id: Optional[int], user):
    if user.is_anonymous:
        logger.warn(f'Anonymous user attempted to stream a station: {user}')
        raise ClientError('access_denied',
                          'You must be signed in to stream music')

    if station_id is None:
        logger.warn(f'Client did not join the station')
        raise ClientError('bad_request', 'You must join a station first')

    try:
        listener_relationship = Listener.objects.get(
            user_id=user.id, station_id=station_id)
    except Listener.DoesNotExit:
        raise ClientError('forbidden', 'This station is not available')

    return listener_relationship


@database_sync_to_async
def update_station(station, state: PlaybackState):
    station.context_uri = state.context_uri
    station.current_track_uri = state.current_track_uri
    station.paused = state.paused
    station.position_ms = state.position_ms
    station.save()
