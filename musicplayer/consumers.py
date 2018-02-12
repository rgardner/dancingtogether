import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from .exceptions import ClientError
from .models import Room

logger = logging.getLogger(__name__)


class MusicConsumer(AsyncJsonWebsocketConsumer):

    # WebSocket event handlers

    async def connect(self):
        """Called during initial websocket handshaking."""
        logger.debug('{} connected to the MusicConsumer'.format(self.scope['user']))
        if self.scope['user'].is_anonymous:
            await self.close()
        else:
            await self.accept()
        self.room_id = None

    async def receive_json(self, content):
        """Called when we get a text frame."""
        logger.info('received message: ', content)
        command = content.get('command', None)
        try:
            if command == 'join':
                await self.join_room(content['room'])
            elif command == 'leave':
                await self.leave_room(content['room'])
            elif command == 'send':
                await self.send_room(content['room'], content['message'])
        except ClientError as e:
            await self.send_json({'error': e.code, 'message': e.message})

    async def disconnect(self, code):
        """Called when the WebSocket closes for any reason."""
        try:
            await self.leave_room(self.room_id)
        except ClientError:
            pass

    # Command helper methods called by receive_json

    async def join_room(self, room_id):
        room = await get_room_or_error(room_id, self.scope['user'])

        await self.channel_layer.group_send(room.group_name, {
            'type': 'room.join',
            'room_id': room_id,
            'username': self.scope['user'].username,
        })

        self.room_id = room_id
        await self.channel_layer.group_add(room.group_name, self.channel_name)
        await self.send_json({'join': room_id})

    async def leave_room(self, room_id):
        room = await get_room_or_error(room_id, self.scope['user'])

        await self.channel_layer.group_send(room.group_name, {
            'type': 'room.leave',
            'room_id': room_id,
            'username': self.scope['user'].username,
        })

        self.room_id = None
        await self.channel_layer.group_discard(str(room_id), self.channel_name)
        await self.send_json({'leave': str(room_id)})

    async def send_room(self, room_id, message):
        logger.debug('{} sent {} to {}'.format(self.scope['user'].username, message, room_id))
        if room_id != self.room_id:
            raise ClientError("ROOM_ACCESS_DENIED", "access denied")

        room = await get_room_or_error(room_id, self.scope['user'])

        await self.channel_layer.group_send(room.group_name, {
            'type': 'room.message',
            'room_id': room_id,
            'username': self.scope['user'].username,
            'message': message,
        })

    # Handlers for messages sent over the channel layer

    async def room_join(self, event):
        """Called when someone has joined our chat."""
        # Send a message down to the client
        await self.send_json(
            {
                'msg_type': 'enter',
                'room': event['room_id'],
                'username': event['username'],
            },
        )

    async def room_leave(self, event):
        """Called when someone has left our chat."""
        # Send a message down to the client
        await self.send_json(
            {
                'msg_type': 'leave',
                'room': event['room_id'],
                'username': event['username'],
            },
        )

    async def room_message(self, event):
        """Called when someone has messaged our chat."""
        # Send a message down to the client
        await self.send_json({
            'msg_type': 'message',
            'room': event['room_id'],
            'username': event['username'],
            'message': event['message'],
        })


@database_sync_to_async
def get_room_or_error(room_id, user):
    """Fetch room for user and check permissions."""
    assert user.is_authenticated

    try:
        room = Room.objects.get(pk=room_id)
    except Room.DoesNotExist:
        raise ClientError('invalid room', 'room_invalid')

    return room
