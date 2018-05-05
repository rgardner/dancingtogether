import asyncio
from datetime import datetime, timedelta
import hashlib
import logging
import time
from typing import Tuple
import urllib.parse

import aiohttp
from asgiref.sync import async_to_sync
from django.conf import settings
from django.shortcuts import redirect
from django.utils import timezone
import requests

from .exceptions import (AccessTokenExpired, SpotifyAccountNotPremium,
                         SpotifyDeviceNotFound, SpotifyServerError)
from .models import SpotifyCredentials

logger = logging.getLogger(__name__)

# View decorators


def authorization_required(view_func):
    def _wrapped_view_func(request, *args, **kwargs):
        if not hasattr(request.user, 'spotifycredentials'):
            return request_spotify_authorization(request)
        else:
            return view_func(request, *args, **kwargs)

    return _wrapped_view_func


def fresh_access_token_required(view_func):
    """Ensures the access token is fresh and caches it in the session."""

    def _wrapped_view_func(request, *args, **kwargs):
        access_token = load_access_token(request.user)
        if access_token.has_expired():
            async_to_sync(access_token.refresh)()

        request.session['access_token'] = access_token.token
        return view_func(request, *args, **kwargs)

    return _wrapped_view_func


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

    async def refresh(self, session=None):
        if session is None:
            async with aiohttp.ClientSession() as this_session:
                await self._refresh(this_session)
        else:
            await self._refresh(session)

    async def _refresh(self, session):
        data = {
            'grant_type': 'refresh_token',
            'refresh_token': self.refresh_token,
            'client_id': settings.SPOTIFY_CLIENT_ID,
            'client_secret': settings.SPOTIFY_CLIENT_SECRET,
        }
        async with session.post(
                settings.SPOTIFY_TOKEN_API_URL, data=data) as resp:
            if resp.status == requests.codes.ok:
                resp_data = await resp.json()
                self._access_token = resp_data['access_token']
                expires_in = int(resp_data['expires_in'])
                expires_in = timedelta(seconds=expires_in)
                self._access_token_expiration_time = timezone.now() + expires_in
                save_access_token(self)
            else:
                logger.error(await resp.text())

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
        save_access_token(access_token)


def save_access_token(access_token: AccessToken):
    try:
        creds = SpotifyCredentials.objects.get(user_id=access_token.user.id)
    except SpotifyCredentials.DoesNotExist:
        creds = SpotifyCredentials(
            user_id=access_token.user.id,
            refresh_token=access_token.refresh_token)

    creds.access_token = access_token.token
    creds.access_token_expiration_time = access_token.token_expiration_time
    creds.save()


def load_access_token(user_id) -> AccessToken:
    creds = SpotifyCredentials.objects.get(user_id=user_id)
    return AccessToken(creds.user, creds.refresh_token, creds.access_token,
                       creds.access_token_expiration_time)


# Web API Client


class SpotifyWebAPIClient:
    throttled_until = None

    async def player_play(self, session, user_id, access_token, device_id,
                          context_uri, uri):
        """
        https://beta.developer.spotify.com/documentation/web-api/reference/player/start-a-users-playback/
        """
        headers = {'Authorization': f'Bearer {access_token}'}
        query_params = {'device_id': device_id}
        data = {'context_uri': context_uri, 'offset': {'uri': uri}}

        for _ in range(5):
            if self.is_throttled():
                logger.warning(
                    f'Spotify Web API request throttled until {self.throttled_until}'
                )
                return

            async with session.put(
                    settings.SPOTIFY_PLAYER_PLAY_API_URL,
                    headers=headers,
                    params=query_params,
                    json=data) as resp:
                if resp.status == requests.codes.accepted:
                    # device is temporarily unavailable
                    await asyncio.sleep(5)  # seconds
                    continue
                elif resp.status == requests.codes.no_content:
                    # successful request
                    return
                elif resp.status == requests.codes.unauthorized:
                    raise AccessTokenExpired()
                elif resp.status == requests.codes.forbidden:
                    raise SpotifyAccountNotPremium()
                elif resp.status == requests.codes.not_found:
                    raise SpotifyDeviceNotFound()
                elif resp.status == requests.codes.too_many_requests:
                    # API rate limit exceeded. This applies to all web playback calls
                    self.start_throttling(
                        timedelta(seconds=int(resp.headers['Retry-After'])))
                    return
                else:
                    if requests.codes.server_error <= resp.status <= requests.codes.service_unavailable:
                        self.start_throttling(timedelta(minutes=5))

                    text = await resp.text()
                    logger.error(
                        f'user-{user_id} received unexpected Spotify Web API response {text}'
                    )
                    raise SpotifyServerError()

    @classmethod
    def start_throttling(cls, retry_after: timedelta):
        logger.warning(
            f'Spotify Web API throttle is now in effect for {retry_after}')
        cls.throttled_until = datetime.now() + retry_after

    @classmethod
    def is_throttled(cls) -> bool:
        return ((cls.throttled_until is not None)
                and (datetime.now() < cls.throttled_until))
