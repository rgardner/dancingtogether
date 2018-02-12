import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .exceptions import ClientError
from .models import Station

logger = logging.getLogger(__name__)


class StationConsumer(AsyncJsonWebsocketConsumer):

    # WebSocket event handlers

    async def connect(self):
        """Called during initial websocket handshaking."""
        logger.debug('{} connected to the MusicConsumer'.format(self.scope['user']))
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

    async def send_station(self, station_id, message):
        logger.debug('{} sent {} to {}'.format(self.scope['user'].username, message, station_id))
        if station_id != self.station_id:
            raise ClientError("station_ACCESS_DENIED", "access denied")

        station = await get_station_or_error(station_id, self.scope['user'])

        await self.channel_layer.group_send(station.group_name, {
            'type': 'station.message',
            'station_id': station_id,
            'username': self.scope['user'].username,
            'message': message,
        })

    # Handlers for messages sent over the channel layer

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
def get_station_or_error(station_id, user):
    """Fetch station for user and check permissions."""
    assert user.is_authenticated

    try:
        station = Station.objects.get(pk=station_id)
    except Station.DoesNotExist:
        raise ClientError('invalid station', 'station_invalid')

    return station
