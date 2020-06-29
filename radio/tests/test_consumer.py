# Disable redefinition of outer name for pytest which uses this feature for
# fixtures.
# pylint: disable=redefined-outer-name

from contextlib import asynccontextmanager

from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
import dateutil.parser
from django.contrib.auth import get_user_model
from django.urls import path
from django.utils import timezone
import pytest

from accounts.models import User
from .. import consumers
from ..api.serializers import PlaybackStateSerializer
from ..consumers import StationConsumer
from ..models import Listener, PlaybackState, Station

MOCK_CONTEXT_URI1 = 'MockContextUri1'
MOCK_CONTEXT_URI2 = 'MockContextUri2'
NON_USER_EMAIL = 'nonuser@example.com'


@pytest.mark.skip(
    reason='Authentication does not work with StationCommunicator')
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_ping_pong(user1, station1):
    await create_listener(user1, station1)

    async with disconnecting(StationCommunicator(station1.id)) as communicator:
        start_time = timezone.now().isoformat()
        await communicator.ping(start_time)

        response = await communicator.receive_json_from()
        assert response['type'] == 'pong'
        assert response['start_time'] == start_time
        assert dateutil.parser.isoparse(response['server_time'])


@pytest.mark.skip(reason='Test bug: deserialization not working')
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_playback_state_changed_notifications(user1: User,
                                                    station1: Station):
    await create_listener(user1, station1, is_dj=False)
    playback_state = await create_playback_state(station1)

    async with disconnecting(StationCommunicator(
            station1.id)) as listener_communicator:
        # The DJ changes the playback state
        playback_state.context_uri = MOCK_CONTEXT_URI2
        await consumers.save_station_playback_state(playback_state)

        response = await listener_communicator.receive_json_from()
        assert response['type'] == 'playback_state_changed'

        response_playback_state = PlaybackStateSerializer(
            data=response['playbackstate'])
        assert response_playback_state.is_valid()


@pytest.mark.skip(
    reason='Authentication does not work with StationCommunicator')
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_dj_leaves_station(user1: User, station1: Station):
    await create_listener(user1, station1, is_dj=True)

    # precondition: station playback state exists and is playing
    await create_playback_state(station1, paused=False)

    async with disconnecting(StationCommunicator(
            station1.id)) as _communicator:
        pass

    new_playback_state = await get_playback_state(station1)
    assert new_playback_state.paused


# Fixtures


@pytest.fixture
def user1() -> User:
    return get_user_model().objects.create(username='testuser1',
                                           email='testuser1@example.com')


@pytest.fixture
def user2() -> User:
    return get_user_model().objects.create(username='testuser2',
                                           email='testuser2@example.com')


@pytest.fixture
def station1() -> Station:
    return Station.objects.create(title='TestStation1')


# Utils


@database_sync_to_async
def create_listener(user: User,
                    station: Station,
                    *,
                    is_admin=False,
                    is_dj=False) -> Listener:
    return Listener.objects.create(user=user,
                                   station=station,
                                   is_admin=is_admin,
                                   is_dj=is_dj)


@database_sync_to_async
def create_playback_state(station: Station, **kwargs):
    station_state = PlaybackState(station=station)
    station_state.paused = kwargs.get('paused', True)
    station_state.raw_position_ms = kwargs.get('raw_position_ms', 0)
    station_state.sample_time = timezone.now()
    station_state.save()
    return station_state


@database_sync_to_async
def get_playback_state(station: Station):
    return PlaybackState.objects.get(station=station)


def assert_client_server_states_are_equal(client_state, server_state):
    assert client_state.context_uri == server_state.context_uri
    assert client_state.current_track_uri == server_state.current_track_uri
    assert client_state.paused == server_state.paused
    assert client_state.raw_position_ms == server_state.raw_position_ms


@asynccontextmanager
async def disconnecting(communicator: WebsocketCommunicator):
    try:
        connected, _ = await communicator.connect()
        assert connected
        yield communicator
    finally:
        await communicator.disconnect()


class StationCommunicator(WebsocketCommunicator):
    def __init__(self, station_id: int):
        application = URLRouter([
            path('api/stations/<int:station_id>/stream/', StationConsumer),
        ])
        url = f'/api/stations/{station_id}/stream/'
        super().__init__(application, url)

    async def ping(self, start_time: str):
        await self.send_json_to({
            'command': 'ping',
            'start_time': start_time,
        })
