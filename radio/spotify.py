import asyncio
from datetime import datetime, timedelta
from functools import wraps
import hashlib
from http import HTTPStatus
import logging
import time
from typing import Tuple
import urllib.parse

from django.conf import settings
from django.shortcuts import redirect
from django.utils import timezone
import requests

from .models import SpotifyCredentials

logger = logging.getLogger(__name__)

# View decorators


class AuthorizationRequiredMixin:
    """
    Verify that the current user has authorized the application to use Spotify.
    """

    def dispatch(self, request, *args, **kwargs):
        if not hasattr(request.user, 'spotifycredentials'):
            return request_spotify_authorization(request)

        return super().dispatch(request, *args, **kwargs)


class FreshAccessTokenRequiredMixin:
    """
    Ensures the Spotify access token is fresh and cached in the current session.
    """

    def dispatch(self, request, *args, **kwargs):
        access_token = AccessToken.load(request.user)
        if access_token.has_expired():
            access_token.refresh()
            access_token.save()

        request.session['access_token'] = access_token.token
        return super().dispatch(request, *args, **kwargs)


# Spotify OAuth Common


def get_oauth_redirect_uri():
    return f'{settings.SITE_URL}/stations/request-authorization-callback'


def get_url_safe_oauth_request_state(request):
    session_id = request.COOKIES['sessionid']
    m = hashlib.sha256()
    m.update(session_id.encode())
    return m.hexdigest()


# Spotify OAuth Step 1: Request Spotify authorization


def request_spotify_authorization(request):
    url = build_request_authorization_url(request)
    return redirect(url)


def build_request_authorization_url(request):
    url = 'https://accounts.spotify.com/authorize'
    scope = 'streaming user-modify-playback-state user-read-birthdate user-read-email user-read-private'
    query_params = {
        'client_id': settings.SPOTIFY_CLIENT_ID,
        'response_type': 'code',
        'redirect_uri': get_oauth_redirect_uri(),
        'state': get_url_safe_oauth_request_state(request),
        'scope': scope,
    }

    query_params = urllib.parse.urlencode(query_params)
    return f'{url}?{query_params}'


# Spotify OAuth Step 2: Request access and refresh tokens


class AccessToken:
    def __init__(self, user, refresh_token, access_token,
                 access_token_expiration_time):
        self.user = user
        self.refresh_token = refresh_token
        self._access_token = access_token
        self._access_token_expiration_time = access_token_expiration_time

    def __str__(self):
        return self.token

    @property
    def token(self):
        return self._access_token

    @property
    def token_expiration_time(self):
        return self._access_token_expiration_time

    def is_valid(self):
        return ((self.token is not None)
                and (self.token_expiration_time is not None))

    def has_expired(self):
        return timezone.now() > self.token_expiration_time

    def refresh(self):
        data = {
            'grant_type': 'refresh_token',
            'refresh_token': self.refresh_token,
            'client_id': settings.SPOTIFY_CLIENT_ID,
            'client_secret': settings.SPOTIFY_CLIENT_SECRET,
        }
        response = requests.post(settings.SPOTIFY_TOKEN_API_URL, data=data)
        if response.status_code == HTTPStatus.OK.value:
            response_data = response.json()
            self._access_token = response_data['access_token']
            expires_in = int(response_data['expires_in'])
            expires_in = timedelta(seconds=expires_in)
            self._access_token_expiration_time = timezone.now() + expires_in
        else:
            logger.error(response.text)
            response.raise_for_status()

    @classmethod
    def load(cls, user_id):
        """Load the user's access token from the database."""
        creds = SpotifyCredentials.objects.get(user_id=user_id)
        return cls.from_db_model(creds)

    def save(self):
        """Save the access token to the database."""
        try:
            creds = SpotifyCredentials.objects.get(
                user_id=access_token.user.id)
        except SpotifyCredentials.DoesNotExist:
            creds = SpotifyCredentials(
                user_id=access_token.user.id,
                refresh_token=access_token.refresh_token)

        creds.access_token = access_token.token
        creds.access_token_expiration_time = access_token.token_expiration_time
        creds.save()

    @classmethod
    def from_db_model(cls, creds: SpotifyCredentials):
        return cls(creds.user, creds.refresh_token, creds.access_token,
                   creds.access_token_expiration_time)

    @staticmethod
    def request_refresh_and_access_token(code, user):
        data = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': get_oauth_redirect_uri(),
            'client_id': settings.SPOTIFY_CLIENT_ID,
            'client_secret': settings.SPOTIFY_CLIENT_SECRET,
        }

        r = requests.post(settings.SPOTIFY_TOKEN_API_URL, data)

        response_data = r.json()
        expires_in = int(response_data['expires_in'])
        expires_in = timedelta(seconds=expires_in)
        expiration_time = timezone.now() + expires_in
        access_token = AccessToken(user, response_data['refresh_token'],
                                   response_data['access_token'],
                                   expiration_time)
        access_token.save()
