import logging
from typing import Optional

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .exceptions import ClientError
from .models import Listener, Station

logger = logging.getLogger(__name__)


class StationConsumer(AsyncJsonWebsocketConsumer):

    # WebSocket event handlers

    async def connect(self):
        """Called during initial websocket handshaking."""
        logger.debug(f"{self.scope['user']} connected to the MusicConsumer")
        if self.scope['user'].is_anonymous:
            await self.close()
        else:
            await self.accept()
        self.station_id = None

    async def receive_json(self, content):
        """Called when we get a text frame."""
        logger.info('received message: ', content)
        command = content.get('command', None)
        try:
            if command == 'join':
                await self.join_station(content['station'])

            elif command == 'leave':
                await self.leave_station(content['station'])

            elif command == 'dj_state_change':
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

    async def join_station(self, station_id):
        station = await get_station_or_error(station_id, self.scope['user'])

        await self.channel_layer.group_send(station.group_name, {
            'type': 'station.join',
            'station_id': station_id,
            'username': self.scope['user'].username,
        })

        self.station_id = station_id
        await self.channel_layer.group_add(station.group_name, self.channel_name)
        await self.send_json({'join': station_id})

    async def leave_station(self, station_id):
        station = await get_station_or_error(station_id, self.scope['user'])

        await self.channel_layer.group_send(station.group_name, {
            'type': 'station.leave',
            'station_id': station_id,
            'username': self.scope['user'].username,
        })

        self.station_id = None
        await self.channel_layer.group_discard(str(station_id), self.channel_name)
        await self.send_json({'leave': str(station_id)})

    async def update_dj_state(self, state):
        station = await get_station_or_error(self.station_id, self.scope['user'])
        await self.channel_layer.group_send(station.group_name, {
            'type': 'station.dj_state_change',
            'state': state,
        })
        self.last_dj_state = state

    async def update_listener_state(self, state):
        # TODO: detect if intentional change and disconnect the client if so
        # for now, ignore the request.
        pass

    async def send_station(self, station_id, message):
        user = self.scope['user']
        logger.debug(f'{user.username} sent {message} to {station_id}')
        if station_id != self.station_id:
            raise ClientError("station_ACCESS_DENIED", "access denied")

        station = await get_station_or_error(station_id, user)

        await self.channel_layer.group_send(station.group_name, {
            'type': 'station.message',
            'station_id': station_id,
            'username': user.username,
            'message': message,
        })

    # Handlers for messages sent over the channel layer

    async def station_dj_state_change(self, event):
        await self.send_json(
            {
                'type': 'dj_state_change',
                'state': event['state'],
            },
        )

    async def station_join(self, event):
        """Called when someone has joined our chat."""
        # Send a message down to the client
        await self.send_json(
            {
                'msg_type': 'enter',
                'station': event['station_id'],
                'username': event['username'],
            },
        )

    async def station_leave(self, event):
        """Called when someone has left our chat."""
        # Send a message down to the client
        await self.send_json(
            {
                'msg_type': 'leave',
                'station': event['station_id'],
                'username': event['username'],
            },
        )

    async def station_message(self, event):
        """Called when someone has messaged our chat."""
        # Send a message down to the client
        await self.send_json({
            'msg_type': 'message',
            'station': event['station_id'],
            'username': event['username'],
            'message': event['message'],
        })


@database_sync_to_async
def get_station_or_error(station_id: Optional[int], user):
    """Fetch station for user and check permissions."""
    if user.is_anonymous:
        logger.warn(f'Anonymous user attempted to stream a station: {user}')
        raise ClientError('access_denied', 'You must be signed in to stream music')

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
        raise ClientError('access_denied', 'You must be signed in to stream music')

    if station_id is None:
        logger.warn(f'Client did not join the station')
        raise ClientError('bad_request', 'You must join a station first')

    try:
        listener_relationship = Listener.objects.get(
            user_id=user.id, station_id=station_id)
    except Listener.DoesNotExit:
        raise ClientError('forbidden', 'This station is not available')

    return listener_relationship
