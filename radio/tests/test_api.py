from django.contrib import auth
from django.test import TestCase, override_settings
from django.utils import timezone
import pytest
from rest_framework import status
from rest_framework.test import APITestCase

from ..models import SpotifyCredentials
from . import mocks


class AccessTokenTests(APITestCase):
    def setUp(self):
        password = 'testpassword'
        self.user1 = create_user1(password)
        assert self.client.login(
            username=self.user1.username, password=password)
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
        response = self.client.post('/api/v1/users/2/accesstoken/refresh/')
        assert response.status_code == status.HTTP_403_FORBIDDEN


def create_user1(password):
    return auth.get_user_model().objects.create_user(
        username='testuser1', email='testuser1@example.com', password=password)


def create_user2():
    return auth.get_user_model().objects.create_user(
        username='testuser2', email='testuser2@example.com')


def create_spotify_credentials(user):
    return SpotifyCredentials.objects.create(
        user=user, access_token_expiration_time=timezone.now())
