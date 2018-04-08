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
def create_listener(user, station):
    return Listener.objects.create(
        user=user, station=station, is_admin=False, is_dj=False)


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
        communicator = WebsocketCommunicator(StationConsumer,
                                             '/station/stream')
        communicator.scope['user'] = user1
        communicator.scope['session'] = {}
        connected, _ = await communicator.connect()
        assert connected

        await communicator.send_json_to({
            'command': 'join',
            'station': station1.id,
            'device_id': 'jafsdifja',
        })

        response = await communicator.receive_json_from()
        assert response == {'join': station1.title}

        await communicator.send_json_to({
            'command': 'leave',
            'station': station1.id,
        })

        response = await communicator.receive_json_from()
        assert response == {'leave': station1.id}
