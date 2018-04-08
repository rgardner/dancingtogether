from async_generator import asynccontextmanager
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import override_settings
import pytest

from .consumers import StationConsumer
from .models import Listener, Station


@pytest.fixture
def user1():
    return get_user_model().objects.create(
        username='bob', email='bob@example.com')


@pytest.fixture
def station1():
    return Station.objects.create(title='TestStation1')


@database_sync_to_async
def create_listener(user, station, *, is_admin=False, is_dj=False):
    return Listener.objects.create(
        user=user, station=station, is_admin=is_admin, is_dj=is_dj)


@asynccontextmanager
async def disconnecting(communicator):
    try:
        connected, _ = await communicator.connect()
        assert connected
        yield communicator
    finally:
        await communicator.disconnect()


class StationCommunicator(WebsocketCommunicator):
    def __init__(self, user):
        super().__init__(StationConsumer, '/station/stream')
        self.scope['user'] = user

    async def test_join(self, station, device_id=None):
        await self.join(station, device_id)
        response = await self.receive_json_from()
        assert response == {'join': station.title}

    async def join(self, station, device_id=None):
        await self.send_json_to({
            'command': 'join',
            'station': station.id,
            'device_id': device_id or '',
        })

    async def leave(self, station_id):
        await self.send_json_to({
            'command': 'leave',
            'station': station_id,
        })

    async def get_listeners(self, request_id):
        await self.send_json_to({
            'command': 'get_listeners',
            'request_id': request_id,
        })


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_simple_join_leave(user1, station1):
    """
    Assert that a single user can join and leave a station.
    """
    await create_listener(user1, station1)

    with override_settings(
            CHANNEL_LAYERS={
                "default": {
                    "BACKEND": "channels.layers.InMemoryChannelLayer",
                    "TEST_CONFIG": {
                        "expiry": 100500,
                    },
                },
            }):
        async with disconnecting(StationCommunicator(user1)) as communicator:
            await communicator.test_join(station1)

            await communicator.leave(station1.id)
            response = await communicator.receive_json_from()
            assert response == {'leave': station1.id}


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_non_admin_get_listeners(user1, station1):
    await create_listener(user1, station1, is_admin=False)

    with override_settings(
            CHANNEL_LAYERS={
                "default": {
                    "BACKEND": "channels.layers.InMemoryChannelLayer",
                    "TEST_CONFIG": {
                        "expiry": 100500,
                    },
                },
            }):
        async with disconnecting(StationCommunicator(user1)) as communicator:
            await communicator.test_join(station1)

            request_id = 1
            await communicator.get_listeners(request_id)
            response = await communicator.receive_json_from()
            assert response['error'] == 'forbidden'


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_get_listeners(user1, station1):
    """
    Assert that a single user can join and leave a station.
    """
    await create_listener(user1, station1, is_admin=True)

    with override_settings(
            CHANNEL_LAYERS={
                "default": {
                    "BACKEND": "channels.layers.InMemoryChannelLayer",
                    "TEST_CONFIG": {
                        "expiry": 100500,
                    },
                },
            }):
        async with disconnecting(StationCommunicator(user1)) as communicator:
            await communicator.test_join(station1)

            request_id = 1
            await communicator.get_listeners(request_id)

            response = await communicator.receive_json_from()
            assert response == {
                'type':
                'get_listeners_result',
                'request_id':
                request_id,
                'listeners': [{
                    'id': user1.id,
                    'username': user1.username,
                    'email': user1.email
                }],
                'pending_listeners': [],
            }
