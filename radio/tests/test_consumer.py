import dataclasses
from datetime import timedelta

from asgiref.sync import async_to_sync
from async_generator import asynccontextmanager
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
import pytest

from .. import consumers, models
from ..consumers import PlaybackState, StationConsumer
from ..models import Listener, SpotifyCredentials, Station
from . import mocks

NON_USER_EMAIL = 'nonuser@example.com'


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_simple_join_leave(user1, station1):
    """
    Assert a single user can join and leave a station.
    """
    await create_listener(user1, station1)

    async with disconnecting(StationCommunicator(user1)) as communicator:
        await communicator.test_join(station1)

        await communicator.leave(station1.id)
        response = await communicator.receive_json_from()
        assert response == {'leave': station1.id}


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_ping_pong(user1, station1):
    await create_listener(user1, station1)

    async with disconnecting(StationCommunicator(user1)) as communicator:
        await communicator.test_join(station1)

        start_time = timezone.now().isoformat()
        await communicator.ping(start_time)

        response = await communicator.receive_json_from()
        assert response == {'type': 'pong', 'start_time': start_time}


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_admin_commands_require_admin(user1, station1):
    """
    Assert admin commands require the user to be an admin of the station.
    """
    await create_listener(user1, station1, is_admin=False)

    async with disconnecting(StationCommunicator(user1)) as communicator:
        await communicator.test_join(station1)

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


@pytest.mark.skip(reason='not implemented')
@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_send_listener_invite(user1, user2, station1):
    """
    Assert send_listener_invite works as expected.
    """
    await create_listener(user1, station1, is_admin=True)

    async with disconnecting(StationCommunicator(user1)) as communicator:
        await communicator.test_join(station1)

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


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_simple_playback(user1, user2, station1):
    await create_listener(user1, station1, is_dj=True)
    await create_listener(user2, station1, is_dj=False)
    await create_spotify_credentials(user2)
    dj = user1
    listener = user2

    port = mocks.get_free_port()
    mocks.start_mock_spotify_server(port)

    with override_settings(
            SPOTIFY_PLAYER_PLAY_API_URL=f'http://localhost:{port}/player/play'
    ):
        async with disconnecting(StationCommunicator(dj)) as dj_communicator:
            await dj_communicator.test_join(station1)
            async with disconnecting(
                    StationCommunicator(listener)) as listener_communicator:
                await listener_communicator.test_join(station1)

                state = get_mock_client_state()
                await dj_communicator.player_state_change(state, etag='')

                response = await dj_communicator.receive_json_from()
                assert response['type'] == 'ensure_playback_state'
                server_state = PlaybackState(**response['state'])
                assert_client_server_states_are_equal(state, server_state)

                response = await listener_communicator.receive_json_from()
                assert response['type'] == 'ensure_playback_state'
                server_state2 = PlaybackState(**response['state'])
                assert server_state2 == server_state


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_dj_playback_join_existing_station(user1, station1):
    await create_listener(user1, station1, is_dj=True)
    await create_spotify_credentials(user1)
    initial_state = get_mock_client_state()
    await create_db_playback_state(station1, initial_state)

    port = mocks.get_free_port()
    mocks.start_mock_spotify_server(port)

    with override_settings(
            SPOTIFY_PLAYER_PLAY_API_URL=f'http://localhost:{port}/player/play'
    ):
        async with disconnecting(StationCommunicator(user1)) as communicator:
            await communicator.test_join(station1)
            response = await communicator.receive_json_from()
            server_state = PlaybackState(**response['state'])
            assert_client_server_states_are_equal(initial_state, server_state)

            state = get_mock_client_state()
            await communicator.player_state_change(state, etag='')
            response = await communicator.receive_json_from()
            assert response['error'] == 'precondition_failed'

            state = get_mock_client_state(raw_position_ms=100)
            await communicator.player_state_change(
                state, etag=server_state.etag)
            response = await communicator.receive_json_from()
            server_state = PlaybackState(**response['state'])
            assert_client_server_states_are_equal(state, server_state)


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_playback_error(user1, station1):
    await create_listener(user1, station1)
    await create_db_playback_state(station1)
    await create_spotify_credentials(user1)

    port = mocks.get_free_port()
    mocks.start_mock_spotify_server(port, mocks.MockSpotifyServerErrorHandler)

    with override_settings(
            SPOTIFY_PLAYER_PLAY_API_URL=f'http://localhost:{port}/player/play'
    ):
        async with disconnecting(StationCommunicator(user1)) as communicator:
            await communicator.test_join(station1)
            response = await communicator.receive_json_from()
            assert response['error'] == 'spotify_error'


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_refresh_access_token(user1, station1):
    await create_listener(user1, station1)
    await create_spotify_credentials(user1)

    port = mocks.get_free_port()
    mocks.start_mock_spotify_server(port)

    with override_settings(
            SPOTIFY_TOKEN_API_URL=f'http://localhost:{port}/api/token'):
        async with disconnecting(StationCommunicator(user1)) as communicator:
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
def create_db_playback_state(station, state=None):
    station_state = models.PlaybackState(station=station)
    if state is None:
        state = get_mock_client_state()
    async_to_sync(consumers.update_station_state)(station_state, state)


@database_sync_to_async
def create_spotify_credentials(user):
    return SpotifyCredentials.objects.create(
        user=user, access_token_expiration_time=timezone.now())


def get_mock_client_state(**kwargs) -> PlaybackState:
    return PlaybackState(
        context_uri=kwargs.get('context_uri', 'MockContextUri'),
        current_track_uri='MockCurrentTrackUri',
        paused=True,
        raw_position_ms=kwargs.get('raw_position_ms', 0),
        sample_time=timezone.now(),
        etag=None)


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

    async def ping(self, start_time):
        await self.send_json_to({
            'command': 'ping',
            'start_time': start_time,
        })

    async def player_state_change(self, state, etag):
        await self.send_json_to({
            'command': 'player_state_change',
            'state': state.as_dict(),
            'etag': etag,
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