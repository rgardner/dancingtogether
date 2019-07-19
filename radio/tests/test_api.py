from http import HTTPStatus
import json

from accounts.models import User
from django.contrib import auth
from django.test import TestCase, override_settings
from django.utils import timezone
import pytest
from rest_framework.test import APITestCase

from ..api.serializers import PlaybackStateSerializer, StationSerializer
from ..models import Listener, PlaybackState, SpotifyCredentials, Station
from . import mocks

MOCK_USERNAME1 = 'MockUsername1'
MOCK_USERNAME2 = 'MockUsername2'


class StationTests(APITestCase):
    def setUp(self):
        password = 'testpassword'
        self.user1 = create_user1(password)
        assert self.client.login(username=self.user1.username,
                                 password=password)
        create_spotify_credentials(self.user1)

    def tearDown(self):
        self.client.logout()

    def test_can_list_stations(self):
        response = self.client.get('/api/v1/stations/')
        assert response.status_code == HTTPStatus.OK
        assert not response.data

        station = create_station()
        create_listener(station, self.user1)
        response = self.client.get('/api/v1/stations/')
        assert response.status_code == HTTPStatus.OK
        assert len(response.data) == 1
        assert response.data[0] == StationSerializer(station).data

    def test_can_only_list_authorized_stations(self):
        # Create a station that user1 is not a listener of
        create_station()

        response = self.client.get('/api/v1/stations/')
        assert response.status_code == HTTPStatus.OK
        assert not response.data

    def test_can_update_stations(self):
        station = create_station()
        create_listener(station, self.user1)
        playback_state = create_playback_state(station)

        response = self.client.patch(f'/api/v1/stations/{station.id}/',
                                     data={
                                         'playbackstate': {
                                             'raw_position_ms': 1,
                                         },
                                     },
                                     format='json')
        assert response.status_code == HTTPStatus.OK
        assert PlaybackState.objects.get(
            station_id=station.id).raw_position_ms == 1

    def test_user_can_only_update_authorized_stations(self):
        station = create_station()
        playback_state = create_playback_state(station)
        playback_state.raw_position_ms = 1

        response = self.client.patch(f'/api/v1/stations/{station.id}/',
                                     data={
                                         'playbackstate.raw_position_ms': 1,
                                     },
                                     format='json')
        assert response.status_code == HTTPStatus.NOT_FOUND


class ListenerTests(APITestCase):
    def setUp(self):
        password = 'testpassword'
        self.user1 = create_user1(password)
        assert self.client.login(username=self.user1.username,
                                 password=password)
        create_spotify_credentials(self.user1)

        self.station = create_station()
        self.listener = create_listener(self.station,
                                        self.user1,
                                        is_admin=True)

    def tearDown(self):
        self.client.logout()
        auth.get_user_model().objects.all().delete()

    def test_can_create_listener(self):
        username2 = create_user2().username

        data = {
            'user': username2,
            'station': self.station.id,
            'is_admin': False,
            'is_dj': False,
        }
        response = self.client.post(
            f'/api/v1/stations/{self.station.id}/listeners/', data=data)
        assert response.status_code == HTTPStatus.CREATED.value

    def test_can_only_create_listener_if_authorized(self):
        station2 = create_station()
        username2 = create_user2().username

        # user1 is not a listener of station2
        data = {
            'user': username2,
            'station': self.station.id,
            'is_admin': False,
            'is_dj': False,
        }
        response = self.client.post(
            f'/api/v1/stations/{station2.id}/listeners/', data=data)
        assert response.status_code == HTTPStatus.NOT_FOUND.value

        # user1 is not an admin of station2
        create_listener(station2, self.user1, is_admin=False)
        data = {
            'user': username2,
            'station': self.station.id,
            'is_admin': False,
            'is_dj': False,
        }
        response = self.client.post(
            f'/api/v1/stations/{station2.id}/listeners/', data=data)
        assert response.status_code == HTTPStatus.FORBIDDEN.value

    def test_cannot_create_listener_for_nonexistent_user(self):
        data = {
            'user': 'NonexistentUsername',
            'station': self.station.id,
            'is_admin': False,
            'is_dj': False,
        }
        response = self.client.post(
            f'/api/v1/stations/{self.station.id}/listeners/', data=data)
        assert response.status_code == HTTPStatus.BAD_REQUEST.value

    def test_can_get_listeners(self):
        user2 = create_user2()
        listener2 = create_listener(self.station,
                                    user2,
                                    is_admin=False,
                                    is_dj=True)

        response = self.client.get(
            f'/api/v1/stations/{self.station.id}/listeners/')

        data = {
            self.listener.id: {
                'id': self.listener.id,
                'user': MOCK_USERNAME1,
                'station': self.station.id,
                'is_admin': True,
                'is_dj': True
            },
            listener2.id: {
                'id': listener2.id,
                'user': user2.username,
                'station': self.station.id,
                'is_admin': False,
                'is_dj': True
            }
        }
        actual_data = {
            listener['id']: dict(listener)
            for listener in response.data
        }
        assert actual_data == data

    def test_can_only_get_listeners_if_authorized(self):
        station2 = create_station()

        # user1 is not a listener of station2
        response = self.client.get(
            f'/api/v1/stations/{station2.id}/listeners/')
        assert response.status_code == HTTPStatus.NOT_FOUND.value

        # user1 is not an admin of station2
        create_listener(station2, self.user1, is_admin=False)
        response = self.client.get(
            f'/api/v1/stations/{station2.id}/listeners/')
        assert response.status_code == HTTPStatus.FORBIDDEN.value

    def test_can_delete_listener(self):
        user = create_user2()
        listener_id = create_listener(self.station, user).id

        response = self.client.delete(
            f'/api/v1/stations/{self.station.id}/listeners/{listener_id}/')
        assert response.status_code == HTTPStatus.NO_CONTENT.value

    def test_can_only_delete_listener_if_authorized(self):
        station2 = create_station()
        user2 = create_user2()
        listener_id = create_listener(station2, user2).id

        # user1 is not a listener of station2
        response = self.client.delete(
            f'/api/v1/stations/{station2.id}/listeners/{listener_id}/')
        assert response.status_code == HTTPStatus.NOT_FOUND.value

        # user1 is not an admin of station2
        create_listener(station2, self.user1, is_admin=False)
        response = self.client.delete(
            f'/api/v1/stations/{station2.id}/listeners/{listener_id}/')
        assert response.status_code == HTTPStatus.FORBIDDEN.value


class AccessTokenTests(APITestCase):
    def setUp(self):
        password = 'testpassword'
        self.user1 = create_user1(password)
        assert self.client.login(username=self.user1.username,
                                 password=password)
        create_spotify_credentials(self.user1)

    def tearDown(self):
        self.client.logout()

    def test_can_refresh_own_access_token(self):
        port = mocks.get_free_port()
        mocks.start_mock_spotify_server(port)

        with override_settings(
                SPOTIFY_TOKEN_API_URL=f'http://localhost:{port}/api/token'):

            response = self.client.post(
                f'/api/v1/users/{self.user1.id}/accesstoken/refresh/')
            assert response.data['token'] == mocks.TEST_ACCESS_TOKEN

    def test_cannot_refresh_someone_elses_access_token(self):
        user2 = create_user2()
        create_spotify_credentials(user2)

        # As user1, attempt to refresh user2's access token
        response = self.client.post(
            f'/api/v1/users/{user2.id}/accesstoken/refresh/')
        assert response.status_code == HTTPStatus.FORBIDDEN.value


def create_user1(password: str) -> User:
    return auth.get_user_model().objects.create_user(
        username=MOCK_USERNAME1,
        email='testuser1@example.com',
        password=password)


def create_user2() -> User:
    return auth.get_user_model().objects.create_user(
        username=MOCK_USERNAME2, email='testuser2@example.com')


def create_station() -> Station:
    return Station.objects.create(title='Station1')


def create_listener(station: Station, user: User, is_admin=False,
                    is_dj=True) -> Listener:
    return Listener.objects.create(station=station,
                                   user=user,
                                   is_admin=is_admin,
                                   is_dj=is_dj)


def create_spotify_credentials(user: User) -> SpotifyCredentials:
    return SpotifyCredentials.objects.create(
        user=user, access_token_expiration_time=timezone.now())


def create_playback_state(station: Station, paused=True,
                          raw_position_ms=0) -> PlaybackState:
    station_state = PlaybackState(station=station)
    station_state.paused = paused
    station_state.raw_position_ms = raw_position_ms
    station_state.sample_time = timezone.now()
    station_state.save()
    return station_state
