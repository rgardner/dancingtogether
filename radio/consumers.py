import asyncio
import enum
import logging
from typing import Optional

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer, JsonWebsocketConsumer

from . import spotify
from .exceptions import ClientError
from .models import Listener, SpotifyCredentials, Station

logger = logging.getLogger(__name__)


class StationState(enum.Enum):
    NotConnected = enum.auto()
    Connecting = enum.auto()
    Connected = enum.auto()
    Disconnecting = enum.auto()


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


def needs_paused(old_state, new_state):
    # The DJ play/pause the current track
    return old_state.paused != new_state.paused


def needs_seek(old_state, new_state, threshold_ms=10_000):
    # The DJ seeked in the current track
    return abs(new_state.position_ms - old_state.position_ms) > threshold_ms


def needs_start_playback(old_state, new_state):
    # The DJ set a new playlist or switched tracks
    return ((old_state.context_uri != new_state.context_uri)
            or (old_state.current_track_uri != new_state.current_track_uri))


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

        self.state = StationState.NotConnected
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

            elif command == 'player_state_change':
                listener = await get_listener_or_error(self.station_id,
                                                       self.scope['user'])
                if listener.is_dj:
                    await self.update_dj_state(content['state'])
                else:
                    await self.update_listener_state(content['state'])

            elif command == 'leave':
                await self.leave_station(content['station'])

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
        self.state = StationState.Connecting
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
        await self.admin_group_send_join(station.admin_group_name,
                                         self.scope['user'].username)

        # Catch up to current playback state. The current solution is sub-
        # optimal. The context and track need to be loaded first. Otherwise,
        # there's nothing to pause or seek! The user will experience a brief
        # moment of music playing before the seek and paused events are
        # processed. The call to sleep below is necessary because without it,
        # the client won't have processed the start_resume_playback event yet
        # by the time it receives pause and seek events.

        await self.start_resume_playback(self.scope['user'].id, self.device_id,
                                         station.context_uri,
                                         station.current_track_uri)
        await asyncio.sleep(1)
        await self.toggle_play_pause(station.paused)
        await self.seek_current_track(station.position_ms)

        # Reply to client to finish setting up station
        await self.send_json({'join': station.title})
        self.state = StationState.Connected

    async def update_dj_state(self, state):
        if self.state != StationState.Connected:
            logger.debug(
                '{user} hasn"t finished connecting yet, ignoring state')
            return

        user = self.scope['user']
        logger.debug(f'DJ {user} is updating station state...')
        station = await get_station_or_error(self.station_id, user)
        previous_state = PlaybackState.from_station(station)
        state = PlaybackState.from_client_state(state)

        if needs_start_playback(previous_state, state):
            logger.debug(
                f'DJ {user} caused {station.group_name} to change context or track'
            )
            self.group_send_start_resume_playback(station.group_name, user.id,
                                                  state.context_uri,
                                                  state.current_track_uri)

        if needs_paused(previous_state, state):
            pause_resume = 'pause' if state.paused else 'resume'
            logger.debug(
                f'DJ {user} caused {station.group_name} to {pause_resume}')
            await self.group_send_toggle_play_pause(station.group_name,
                                                    user.id, state.paused)

        if needs_seek(previous_state, state):
            seek_change = state.position_ms - station.position_ms
            logger.debug(
                f'DJ {user} caused {station.group_name} to seek {seek_change}')
            await self.group_send_seek_current_track(
                station.group_name, user.id, state.position_ms)

        await update_station(station, state)

        self.last_dj_state = state

    async def update_listener_state(self, state):
        # TODO: detect if intentional change and disconnect the client if so
        # for now, ignore the request.
        logger.debug('update_listener_state called')
        pass

    async def leave_station(self, station_id):
        self.state = StationState.Disconnecting
        station = await get_station_or_error(station_id, self.scope['user'])
        await self.admin_group_send_leave(station.admin_group_name,
                                          self.scope['user'].username)

        await self.channel_layer.group_discard(station.group_name,
                                               self.channel_name)

        if self.is_admin:
            await self.channel_layer.group_discard(station.admin_group_name,
                                                   self.channel_name)

        self.state = StationState.NotConnected
        self.station_id = None
        self.device_id = None
        self.is_admin = None
        self.is_dj = None

        # Reply to client to finish tearing down station
        await self.send_json({'leave': station_id})

    # Sending group messages

    async def admin_group_send_join(self, group_name, username):
        await self.channel_layer.group_send(group_name, {
            'type': 'station.join',
            'username': username,
        })

    async def admin_group_send_leave(self, group_name, username):
        await self.channel_layer.group_send(group_name, {
            'type': 'station.leave',
            'username': username,
        })

    async def group_send_start_resume_playback(self, group_name, user_id,
                                               context_uri, current_track_uri):
        await self.channel_layer.group_send(
            group_name, {
                'type': 'station.start_resume_playback',
                'sender_user_id': user_id,
                'context_uri': context_uri,
                'current_track_uri': current_track_uri,
            })

    async def group_send_toggle_play_pause(self, group_name, user_id, paused):
        await self.channel_layer.group_send(
            group_name, {
                'type': 'station.toggle_play_pause',
                'sender_user_id': user_id,
                'paused': paused,
            })

    async def group_send_seek_current_track(self, group_name, user_id,
                                            position_ms):
        await self.channel_layer.group_send(
            group_name, {
                'type': 'station.seek_current_track',
                'sender_user_id': user_id,
                'position_ms': position_ms,
            })

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
            await self.toggle_play_pause(event['paused'])

    async def station_seek_current_track(self, event):
        sender_user_id = event['sender_user_id']
        if sender_user_id != self.scope['user'].id:
            await self.seek_current_track(event['position_ms'])

    async def station_start_resume_playback(self, event):
        sender_user_id = event['sender_user_id']
        if sender_user_id != self.scope['user'].id:
            await self.start_resume_playback(
                self.scope['user'].id, self.device_id, event['context_uri'],
                event['current_track_uri'])

    # Utils

    async def toggle_play_pause(self, paused):
        logger.debug(f'{self.scope["user"]} pausing or resuming...')
        change_type = 'set_paused' if paused else 'set_resumed'
        await self.send_json({
            'type': 'dj_state_change',
            'change_type': change_type,
        })

    async def seek_current_track(self, position_ms):
        logger.debug(f'{self.scope["user"]} seeking...')
        await self.send_json({
            'type': 'dj_state_change',
            'change_type': 'seek_current_track',
            'position_ms': position_ms,
        })

    async def start_resume_playback(self, user_id, device_id, context_uri,
                                    uri):
        logger.debug(f'{self.scope["user"]} starting playback...')
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
        logger.debug(f'{user_id} starting {context_uri}: {uri}')

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
