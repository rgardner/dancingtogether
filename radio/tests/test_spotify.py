from asgiref.sync import async_to_sync
from django.contrib import auth
from django.test import override_settings
from django.utils import timezone
import pytest

from .. import spotify
from ..models import SpotifyCredentials
from . import mocks


@pytest.mark.django_db(transaction=True)
def test_refresh_access_token(user1):
    create_spotify_credentials(user1)

    port = mocks.get_free_port()
    mocks.start_mock_spotify_server(port)

    with override_settings(
            SPOTIFY_TOKEN_API_URL=f'http://localhost:{port}/api/token'):

        access_token = spotify.load_access_token(user1.id)
        async_to_sync(access_token.refresh)()
        assert access_token.token == mocks.TEST_ACCESS_TOKEN


@pytest.fixture
def user1():
    return auth.get_user_model().objects.create(
        username='testuser1', email='testuser1@example.com')


def create_spotify_credentials(user):
    return SpotifyCredentials.objects.create(
        user=user, access_token_expiration_time=timezone.now())
