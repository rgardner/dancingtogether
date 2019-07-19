from http import HTTPStatus

from accounts.models import User
from django.contrib import auth
from django.test import TestCase
import pytest

from ..models import Listener, SpotifyCredentials, Station

MOCK_USERNAME = 'MockUsername'
MOCK_PASSWORD = 'MockPassword'


class RadioViewsTests(TestCase):
    def tearDown(self):
        self.client.logout()

    def test_user_can_only_see_stations_they_are_members_of_index(self):
        user = create_user()
        self.client.force_login(user)
        station1 = create_station()
        create_listener(station1, user)
        station2 = create_station()

        response = self.client.get('/stations/')

        assert station1 in response.context['stations']
        assert station2 not in response.context['stations']

    def test_user_needs_to_be_logged_in_to_access_station_index(self):
        response = self.client.get('/stations/')
        self.assertRedirects(response, '/accounts/login/?next=/stations/')

    def test_user_can_only_access_stations_they_are_members_of(self):
        user = create_user()
        self.client.force_login(user)

        response = self.client.get('/stations/1/')

        assert response.status_code == HTTPStatus.NOT_FOUND.value

    def test_user_can_delete_station(self):
        user = create_user()
        self.client.force_login(user)
        station = create_station()
        create_listener(station, user, is_admin=True)

        response = self.client.post(f'/stations/{station.id}/delete/')

        self.assertRedirects(response, '/stations/')
        with pytest.raises(Station.DoesNotExist):
            Station.objects.get(id=station.id)

    def test_user_needs_to_be_logged_in_to_delete_station(self):
        response = self.client.post('/stations/1/delete/')
        self.assertRedirects(response,
                             '/accounts/login/?next=/stations/1/delete/')

    def test_user_can_only_delete_stations_they_are_admins_of(self):
        user = create_user()
        self.client.force_login(user)
        station = create_station()
        create_listener(station, user)

        response = self.client.post(f'/stations/{station.id}/delete/')

        self.assertRedirects(response, '/stations/')


def create_user(username=MOCK_USERNAME) -> User:
    return auth.get_user_model().objects.create_user(username=MOCK_USERNAME,
                                                     password=MOCK_PASSWORD)


def create_station() -> Station:
    return Station.objects.create(title='Station1')


def create_listener(station: Station, user: User, is_admin=False,
                    is_dj=False) -> Listener:
    return Listener.objects.create(station=station,
                                   user=user,
                                   is_admin=is_admin,
                                   is_dj=is_dj)
