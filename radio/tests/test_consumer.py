import dataclasses
from datetime import timedelta

from asgiref.sync import async_to_sync
from async_generator import asynccontextmanager
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
import dateutil.parser
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import path
from django.utils import timezone
from django.utils.six import BytesIO
import pytest
from rest_framework.parsers import JSONParser

from .. import consumers, models
from ..api.serializers import PlaybackStateSerializer
from ..consumers import StationConsumer
from ..models import Listener, PlaybackState, SpotifyCredentials, Station
from . import mocks

MOCK_CONTEXT_URI1 = 'MockContextUri1'
MOCK_CONTEXT_URI2 = 'MockContextUri2'
NON_USER_EMAIL = 'nonuser@example.com'


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_ping_pong(user1, station1):
    await create_listener(user1, station1)

    async with disconnecting(StationCommunicator(station1.id,
                                                 user1)) as communicator:
        start_time = timezone.now().isoformat()
        await communicator.ping(start_time)

        response = await communicator.receive_json_from()
        assert response['type'] == 'pong'
        assert response['start_time'] == start_time
        assert dateutil.parser.isoparse(response['server_time'])


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_admin_commands_require_admin(user1, station1):
    """
    Assert admin commands require the user to be an admin of the station.
    """
    await create_listener(user1, station1, is_admin=False)

    async with disconnecting(StationCommunicator(station1.id,
                                                 user1)) as communicator:
        request_id = 1
        await communicator.get_listeners(request_id)
        response = await communicator.receive_json_from()
        assert response['error'] == 'forbidden'

        request_id = 2
        await communicator.send_listener_invite(request_id, listener_email='')
        response = await communicator.receive_json_from()
        assert response['error'] == 'forbidden'


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_get_listeners(user1, station1):
    """
    Assert get_listeners works as expected.
    """
    await create_listener(user1, station1, is_admin=True)

    async with disconnecting(StationCommunicator(station1.id,
                                                 user1)) as communicator:
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


@pytest.mark.skip(reason='not implemented')
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_send_listener_invite(user1, user2, station1):
    """
    Assert send_listener_invite works as expected.
    """
    await create_listener(user1, station1, is_admin=True)

    async with disconnecting(StationCommunicator(station1.id,
                                                 user1)) as communicator:
        request_id = 1
        await communicator.send_listener_invite(request_id, user2.email)
        response = await communicator.receive_json_from()
        assert response == {
            'type': 'send_listener_invite_result',
            'request_id': request_id,
            'result': 'success',
            'is_new_user': False,
        }

        request_id = 2
        await communicator.send_listener_invite(request_id, NON_USER_EMAIL)
        response = await communicator.receive_json_from()
        assert response == {
            'type': 'send_listener_invite_result',
            'request_id': request_id,
            'result': 'success',
            'is_new_user': True,
        }


@pytest.mark.skip(reason='Test bug: deserialization not working')
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_playback_state_changed_notifications(user1, station1):
    await create_listener(user1, station1, is_dj=False)
    playback_state = await create_playback_state(station1)

    async with disconnecting(StationCommunicator(
            station1.id, user1)) as listener_communicator:
        # The DJ changes the playback state
        playback_state.context_uri = MOCK_CONTEXT_URI2
        await consumers.save_station_playback_state(playback_state)

        response = await listener_communicator.receive_json_from()
        assert response['type'] == 'playback_state_changed'

        response_playback_state = PlaybackStateSerializer(
            data=response['playbackstate'])
        assert response_playback_state.is_valid()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_dj_leaves_station(user1, station1):
    await create_listener(user1, station1, is_dj=True)

    # precondition: station playback state exists and is playing
    await create_playback_state(station1, paused=False)

    async with disconnecting(StationCommunicator(station1.id,
                                                 user1)) as _communicator:
        pass

    new_playback_state = await get_playback_state(station1)
    assert new_playback_state.paused


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_refresh_access_token(user1, station1):
    await create_listener(user1, station1)
    await create_spotify_credentials(user1)

    port = mocks.get_free_port()
    mocks.start_mock_spotify_server(port)

    with override_settings(
            SPOTIFY_TOKEN_API_URL=f'http://localhost:{port}/api/token'):
        async with disconnecting(StationCommunicator(station1.id,
                                                     user1)) as communicator:
            await communicator.refresh_access_token()

            response = await communicator.receive_json_from()
            assert response == {
                'type': 'access_token_change',
                'access_token': mocks.TEST_ACCESS_TOKEN,
            }


# Fixtures


@pytest.fixture
def user1():
    return get_user_model().objects.create(
        username='testuser1', email='testuser1@example.com')


@pytest.fixture
def user2():
    return get_user_model().objects.create(
        username='testuser2', email='testuser2@example.com')


@pytest.fixture
def station1():
    return Station.objects.create(title='TestStation1')


# Utils


@database_sync_to_async
def create_listener(user, station, *, is_admin=False, is_dj=False):
    return Listener.objects.create(
        user=user, station=station, is_admin=is_admin, is_dj=is_dj)


@database_sync_to_async
def create_playback_state(station, **kwargs):
    station_state = models.PlaybackState(station=station)
    station_state.paused = kwargs.get('paused', True)
    station_state.raw_position_ms = kwargs.get('raw_position_ms', 0)
    station_state.sample_time = timezone.now()
    station_state.save()
    return station_state


@database_sync_to_async
def get_playback_state(station):
    return models.PlaybackState.objects.get(station=station)


@database_sync_to_async
def create_spotify_credentials(user):
    return SpotifyCredentials.objects.create(
        user=user, access_token_expiration_time=timezone.now())


def assert_client_server_states_are_equal(client_state, server_state):
    assert client_state.context_uri == server_state.context_uri
    assert client_state.current_track_uri == server_state.current_track_uri
    assert client_state.paused == server_state.paused
    assert client_state.raw_position_ms == server_state.raw_position_ms


@asynccontextmanager
async def disconnecting(communicator):
    try:
        connected, _ = await communicator.connect()
        assert connected
        yield communicator
    finally:
        await communicator.disconnect()


class StationCommunicator(WebsocketCommunicator):
    def __init__(self, station_id, user):
        application = URLRouter([
            path('api/stations/<int:station_id>/stream/', StationConsumer),
        ])
        url = f'/api/stations/{station_id}/stream/'
        super().__init__(application, url)

    async def ping(self, start_time):
        await self.send_json_to({
            'command': 'ping',
            'start_time': start_time,
        })

    async def refresh_access_token(self):
        await self.send_json_to({
            'command': 'refresh_access_token',
        })

    async def get_listeners(self, request_id):
        await self.send_json_to({
            'command': 'get_listeners',
            'request_id': request_id,
        })

    async def send_listener_invite(self, request_id, listener_email):
        await self.send_json_to({
            'command': 'send_listener_invite',
            'request_id': request_id,
            'listener_email': listener_email,
        })
