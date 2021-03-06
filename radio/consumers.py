from datetime import datetime, timezone
import enum
import logging

from asgiref.sync import async_to_sync
import channels.auth
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db.models import signals

from . import models
from .api.serializers import PlaybackStateSerializer
from .exceptions import ClientError
from .models import Listener, Station

logger = logging.getLogger(__name__)


class StationState(enum.Enum):
    NotConnected = enum.auto()
    Connected = enum.auto()


# Station Decorators


def station_join_required(func):
    def wrap(self, *args, **kwargs):
        if self.state != StationState.Connected:
            raise ClientError('bad_request',
                              'user has not connected to station')
        return func(self, *args, **kwargs)

    return wrap


def station_admin_required(func):
    def wrap(self, *args, **kwargs):
        if not self.is_admin:
            raise ClientError(
                'forbidden',
                'user does not have permission to request listeners')
        return func(self, *args, **kwargs)

    return wrap


class StationConsumer(AsyncJsonWebsocketConsumer):
    # pylint: disable=attribute-defined-outside-init

    # WebSocket event handlers

    @property
    def station_id(self):
        return self.scope['url_route']['kwargs']['station_id']

    async def connect(self):
        """Called during initial websocket handshaking."""
        try:
            self.user = await channels.auth.get_user(self.scope)
        except:  # pylint: disable=bare-except
            # TODO: Replace bare except with specific exception
            self.user = self.scope['user']

        if self.user.is_anonymous:
            await self.close()
        else:
            await self.accept()

        self.state = StationState.NotConnected
        self.is_admin = None
        self.is_dj = None

        await self.join_station()

    async def receive_json(self, content, **kwargs):
        """Called when we get a text frame."""
        command = content.get('command', None)
        try:
            if command == 'ping':
                await self.send_pong(content['start_time'])

        except ClientError as exc:
            await self.send_json({'error': exc.code, 'message': exc.message})

    async def disconnect(self, code):
        """Called when the WebSocket closes for any reason."""
        try:
            if self.state != StationState.NotConnected:
                await self.leave_station()
        except ClientError as exc:
            logger.error('Station client error: %d: %s', exc.code, exc.message)

    # Command helper methods called by receive_json

    async def join_station(self):
        listener = await get_listener_or_error(self.station_id, self.user)
        self.is_admin = listener.is_admin
        self.is_dj = listener.is_dj

        station = await get_station_or_error(self.station_id, self.user)
        await self.channel_layer.group_add(station.group_name,
                                           self.channel_name)

        if self.is_admin:
            await self.channel_layer.group_add(station.admin_group_name,
                                               self.channel_name)

        # Message admins that a user has joined the station
        await self.admin_group_send_join(station.admin_group_name,
                                         self.user.username, self.user.email)

        # Subscribe for PlaybackState change notifications
        signals.post_save.connect(self.notify_playback_state_changed)

        # Reply to client to finish setting up station
        self.state = StationState.Connected
        await self.send_json({'join': station.title})

    @station_join_required
    async def leave_station(self):
        station = await get_station_or_error(self.station_id, self.user)
        await self.admin_group_send_leave(station.admin_group_name,
                                          self.user.username, self.user.email)

        await self.channel_layer.group_discard(station.group_name,
                                               self.channel_name)

        if self.is_admin:
            await self.channel_layer.group_discard(station.admin_group_name,
                                                   self.channel_name)

        if self.is_dj:
            await ensure_station_playback_state_is_paused(station)

        self.state = StationState.NotConnected
        self.is_admin = None
        self.is_dj = None

    async def send_pong(self, start_time):
        await self.send_json({
            'type':
            'pong',
            'start_time':
            start_time,
            'server_time':
            datetime.now(timezone.utc).isoformat(),
        })

    # Playback State Change Notification Management

    def notify_playback_state_changed(self, sender, **kwargs):
        if sender is not models.PlaybackState:
            return

        playback_state = kwargs['instance']
        if playback_state.station_id != self.station_id:
            # This notification is not for this station
            return

        if self.is_dj:
            # The DJ caused this change and should not be notified
            return

        async_to_sync(self.send_playback_state_changed)(playback_state)

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

    async def send_playback_state_changed(self, playback_state):
        serializer = PlaybackStateSerializer(playback_state)
        await self.send_json({
            'type': 'playback_state_changed',
            'playbackstate': serializer.data,
        })


async def ensure_station_playback_state_is_paused(station):
    playback_state = getattr(station, 'playbackstate', None)
    if (playback_state is not None) and (not playback_state.paused):
        playback_state.paused = True
        await save_station_playback_state(playback_state)


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
def save_station_playback_state(station_state):
    station_state.save()
