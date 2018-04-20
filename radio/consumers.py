import asyncio
from datetime import datetime
import enum
import logging
from typing import Optional

import aiohttp
from asgiref.sync import async_to_sync
import channels.auth
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer, JsonWebsocketConsumer
import dateutil.parser

from . import models
from . import spotify
from .exceptions import AccessTokenExpired, ClientError
from .models import Listener, PendingListener, Station
from .spotify import AccessToken, SpotifyWebAPIClient

logger = logging.getLogger(__name__)

# This is used to determine if a client is too far ahead/behind the stream
# and should be caught up via seeking
DEFAULT_SEEK_THRESHOLD_MS = 4000


class StationState(enum.Enum):
    NotConnected = enum.auto()
    Connecting = enum.auto()
    Connected = enum.auto()
    Disconnecting = enum.auto()


class PlaybackState:
    def __init__(self, context_uri, current_track_uri, paused, position_ms,
                 sample_time):
        self.context_uri = context_uri
        self.current_track_uri = current_track_uri
        self.paused = paused
        self._raw_position_ms = position_ms
        self.sample_time = sample_time

    @staticmethod
    def from_client_state(state_time, state):
        context_uri = state['context']['uri']
        current_track_uri = state['track_window']['current_track']['uri']
        paused = state['paused']

        # If the track is not paused, account for message latency and adjust
        # to the expected current position.
        position = state['position']
        sample_time = dateutil.parser.parse(state_time)

        return PlaybackState(context_uri, current_track_uri, paused, position,
                             sample_time)

    @staticmethod
    def from_station_state(station_state: models.PlaybackState):
        return PlaybackState(station_state.context_uri,
                             station_state.current_track_uri,
                             station_state.paused, station_state.position_ms,
                             station_state.last_updated_time)

    @property
    def position_ms(self):
        if self.paused:
            return self._raw_position_ms
        else:
            # Assume music has been playing continuously and adjust based on
            # elapsed time since sample was taken
            elapsed_time = datetime.now(
                self.sample_time.tzinfo) - self.sample_time
            millis = (elapsed_time.seconds * 1000) + (
                elapsed_time.microseconds / 1000)
            return self._raw_position_ms + millis

    def as_dict(self):
        return {
            'context_uri': self.context_uri,
            'current_track_uri': self.current_track_uri,
            'paused': self.paused,
            'raw_position_ms': self._raw_position_ms,
            'sample_time': self.sample_time.isoformat(),
        }


def needs_start_playback(old_state, new_state):
    # The DJ set a new playlist or switched tracks
    return ((old_state.context_uri != new_state.context_uri)
            or (old_state.current_track_uri != new_state.current_track_uri))


# Station Decorators


def station_join_required(func):
    def wrap(self, *args, **kwargs):
        if self.state != StationState.Connected:
            raise ClientError('bad_request',
                              'user has not connected to station')
        else:
            return func(self, *args, **kwargs)

    return wrap


def station_admin_required(func):
    def wrap(self, *args, **kwargs):
        if not self.is_admin:
            raise ClientError(
                'forbidden',
                'user does not have permission to request listeners')
        else:
            return func(self, *args, **kwargs)

    return wrap


class StationConsumer(AsyncJsonWebsocketConsumer):
    def __init__(self, scope):
        super().__init__(scope)
        self.spotify_client = SpotifyWebAPIClient()

    # WebSocket event handlers

    async def connect(self):
        """Called during initial websocket handshaking."""
        try:
            self.user = await channels.auth.get_user(self.scope)
        except:
            self.user = self.scope['user']

        if self.user.is_anonymous:
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
        try:
            if command == 'join':
                await self.join_station(content['station'],
                                        content['device_id'])

            elif command == 'leave':
                await self.leave_station(content['station'])

            elif command == 'ping':
                await self.send_pong(content['start_time'])

            elif command == 'player_state_change':
                listener = await get_listener_or_error(self.station_id,
                                                       self.user)
                if listener.is_dj:
                    await self.update_dj_state(content['state_time'],
                                               content['state'])
                else:
                    await self.update_listener_state(content['state_time'],
                                                     content['state'])

            elif command == 'refresh_access_token':
                await self.refresh_access_token()

            elif command == 'get_listeners':
                await self.get_listeners(content['request_id'])

            elif command == 'send_listener_invite':
                await self.send_listener_invite(content['request_id'],
                                                content['listener_email'])

        except ClientError as e:
            await self.send_json({'error': e.code, 'message': e.message})

    async def disconnect(self, code):
        """Called when the WebSocket closes for any reason."""
        try:
            if self.state != StationState.NotConnected:
                await self.leave_station(self.station_id)
        except ClientError as e:
            logger.error(f'Station client error: {e.code}: {e.message}')

    # Command helper methods called by receive_json

    async def join_station(self, station_id, device_id):
        self.state = StationState.Connecting
        listener = await get_listener_or_error(station_id, self.user)
        self.station_id = station_id
        self.device_id = device_id
        self.is_admin = listener.is_admin
        self.is_dj = listener.is_admin

        station = await get_station_or_error(station_id, self.user)
        await self.channel_layer.group_add(station.group_name,
                                           self.channel_name)

        if self.is_admin:
            await self.channel_layer.group_add(station.admin_group_name,
                                               self.channel_name)

        # Message admins that a user has joined the station
        await self.admin_group_send_join(station.admin_group_name,
                                         self.user.username, self.user.email)

        # Catch up to current playback state. The current solution is sub-
        # optimal. The context and track need to be loaded first. Otherwise,
        # there's nothing to pause or seek! The user will experience a brief
        # moment of music playing before the seek and paused events are
        # processed. The call to sleep below is necessary because without it,
        # the client won't have processed the start_resume_playback event yet
        # by the time it receives pause and seek events.

        if hasattr(station, 'playbackstate'):
            station_state = PlaybackState.from_station_state(
                station.playbackstate)
            await self.start_resume_playback(self.user.id, self.device_id,
                                             station_state.context_uri,
                                             station_state.current_track_uri)
            await self.ensure_playback_state(station_state.as_dict())

        # Reply to client to finish setting up station
        await self.send_json({'join': station.title})
        self.state = StationState.Connected

    @station_join_required
    async def leave_station(self, station_id):
        self.state = StationState.Disconnecting
        station = await get_station_or_error(station_id, self.user)
        await self.admin_group_send_leave(station.admin_group_name,
                                          self.user.username, self.user.email)

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

    async def send_pong(self, start_time):
        await self.send_json({'type': 'pong', 'start_time': start_time})

    @station_join_required
    async def update_dj_state(self, state_time, state):
        user = self.user
        station = await get_station_or_error(self.station_id, user)
        state = PlaybackState.from_client_state(state_time, state)
        if hasattr(station, 'playbackstate'):
            station_state = station.playbackstate
            previous_state = PlaybackState.from_station_state(station_state)

            if needs_start_playback(previous_state, state):
                logger.debug(
                    f'DJ {user} caused {station.group_name} to change context or track'
                )
                await self.group_send_start_resume_playback(
                    station.group_name, state.context_uri,
                    state.current_track_uri)

            await self.group_send_ensure_playback_state(
                station.group_name, state)

        else:
            # Copied from join
            #
            # Catch up to current playback state. The current solution is sub-
            # optimal. The context and track need to be loaded first. Otherwise,
            # there's nothing to pause or seek! The user will experience a brief
            # moment of music playing before the seek and paused events are
            # processed. The call to sleep below is necessary because without it,
            # the client won't have processed the start_resume_playback event yet
            # by the time it receives pause and seek events.

            await self.group_send_start_resume_playback(
                station.group_name, state.context_uri, state.current_track_uri)
            await self.group_send_ensure_playback_state(
                station.group_name, state)

            station_state = models.PlaybackState(station_id=station.id)

        await update_station_state(station_state, state)

    @station_join_required
    async def update_listener_state(self, state_time, state):
        user = self.user
        station = await get_station_or_error(self.station_id, user)
        if hasattr(station, 'playbackstate'):
            station_state = station.playbackstate
            station_state = PlaybackState.from_station_state(station_state)
            state = PlaybackState.from_client_state(state_time, state)

            if needs_start_playback(state, station_state):
                await self.start_resume_playback(
                    user.id, self.device_id, station_state.context_uri,
                    station_state.current_track_uri)

            await self.group_send_ensure_playback_state(
                station.group_name, station_state)

    async def refresh_access_token(self) -> AccessToken:
        access_token = await get_access_token(self.user.id)
        async with aiohttp.ClientSession() as session:
            await access_token.refresh(session)
        await self.send_json({
            'type': 'access_token_change',
            'access_token': access_token.token,
        })
        return access_token

    @station_join_required
    @station_admin_required
    async def get_listeners(self, request_id):
        listeners = await get_listeners(self.station_id)
        pending_listeners = await get_pending_listeners(self.station_id)
        filter_user = lambda user: { 'id': user.id, 'username': user.username, 'email': user.email }
        await self.send_json({
            'type':
            'get_listeners_result',
            'request_id':
            request_id,
            'listeners': [filter_user(l.user) for l in listeners],
            'pending_listeners':
            [filter_user(l.user) for l in pending_listeners],
        })

    @station_join_required
    @station_admin_required
    async def send_listener_invite(self, request_id, listener_email):
        await self.send_json({
            'type': 'send_listener_invite_result',
            'request_id': request_id,
            'result': 'not_implemented',
            'is_new_user': False,
        })

    # Sending group messages

    async def admin_group_send_join(self, group_name, username, email):
        await self.channel_layer.group_send(
            group_name, {
                'type': 'station.join',
                'sender_user_id': self.user.id,
                'username': username,
                'email': email,
            })

    async def admin_group_send_leave(self, group_name, username, email):
        await self.channel_layer.group_send(
            group_name, {
                'type': 'station.leave',
                'sender_user_id': self.user.id,
                'username': username,
                'email': email,
            })

    async def group_send_start_resume_playback(self, group_name, context_uri,
                                               current_track_uri):
        await self.channel_layer.group_send(
            group_name, {
                'type': 'station.start_resume_playback',
                'sender_user_id': self.user.id,
                'context_uri': context_uri,
                'current_track_uri': current_track_uri,
            })

    async def group_send_ensure_playback_state(self, group_name,
                                               state: PlaybackState):
        await self.channel_layer.group_send(
            group_name, {
                'type': 'station.ensure_playback_state',
                'sender_user_id': self.user.id,
                'state': state.as_dict(),
            })

    # Handlers for messages sent over the channel layer

    async def station_join(self, event):
        """Called when someone has joined our station."""
        sender_user_id = event['sender_user_id']
        if sender_user_id != self.user.id:
            await self.send_json({
                'type': 'listener_change',
                'listener_change_type': 'join',
                'listener': {
                    'username': event['username'],
                    'email': event['email'],
                }
            })

    async def station_leave(self, event):
        """Called when someone has left our station."""
        sender_user_id = event['sender_user_id']
        if sender_user_id != self.user.id:
            await self.send_json({
                'type': 'listener_change',
                'listener_change_type': 'leave',
                'listener': {
                    'username': event['username'],
                    'email': event['email'],
                }
            })

    async def station_start_resume_playback(self, event):
        sender_user_id = event['sender_user_id']
        if sender_user_id != self.user.id:
            await self.start_resume_playback(self.user.id, self.device_id,
                                             event['context_uri'],
                                             event['current_track_uri'])

    async def station_ensure_playback_state(self, event):
        sender_user_id = event['sender_user_id']
        if sender_user_id != self.user.id:
            await self.ensure_playback_state(event['state'])

    # Utils

    async def start_resume_playback(self, user_id, device_id, context_uri,
                                    uri):
        logger.debug(f'{self.user} starting playback...')
        access_token = await get_access_token(user_id)
        async with aiohttp.ClientSession() as session:
            try:
                await self.spotify_client.player_play(session, user_id,
                                                      access_token, device_id,
                                                      context_uri, uri)
            except AccessTokenExpired:
                access_token = await self.refresh_access_token()
                await self.spotify_client.player_play(session, user_id,
                                                      access_token, device_id,
                                                      context_uri, uri)

    async def ensure_playback_state(self, state):
        await self.send_json({
            'type': 'ensure_playback_state',
            'state': state,
        })


# Database


@database_sync_to_async
def get_station_or_error(station_id, user):
    """Fetch station for user and check permissions."""
    assert not user.is_anonymous, 'Anonymous users cannot connect to station'
    assert station_id is not None

    try:
        station = Station.objects.get(pk=station_id)
    except Station.DoesNotExist:
        raise ClientError('invalid_station', 'invalid station')

    return station


@database_sync_to_async
def get_listener_or_error(station_id, user):
    assert not user.is_anonymous, 'Anonymous users cannot connect to station'
    assert station_id is not None

    try:
        listener = Listener.objects.get(user_id=user.id, station_id=station_id)
    except Listener.DoesNotExist:
        raise ClientError('forbidden', 'This station is not available')

    return listener


@database_sync_to_async
def get_listeners(station_id):
    return Listener.objects.filter(station_id=station_id)


@database_sync_to_async
def get_pending_listeners(station_id):
    return PendingListener.objects.filter(room_id=station_id)


@database_sync_to_async
def update_station_state(station_state, state: PlaybackState):
    station_state.context_uri = state.context_uri
    station_state.current_track_uri = state.current_track_uri
    station_state.paused = state.paused
    station_state.position_ms = state.position_ms
    station_state.save()


@database_sync_to_async
def get_access_token(user_id):
    return spotify.load_access_token(user_id)
