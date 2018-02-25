from datetime import datetime, timedelta
import hashlib
import logging
import time
from typing import Tuple
import urllib.parse

from django.shortcuts import redirect
from django.utils import timezone
import requests

from dancingtogether import settings
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
    def _wrapped_view_func(request, *args, **kwargs):
        access_token = load_access_token(request.user)
        if access_token.has_expired():
            access_token.refresh()
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
        self._user = user
        self._refresh_token = refresh_token
        self._access_token = access_token
        self._access_token_expiration_time = access_token_expiration_time

    @property
    def user(self):
        return self._user

    @property
    def refresh_token(self):
        return self._refresh_token

    @property
    def token(self):
        return self._access_token

    @property
    def token_expiration_time(self):
        return self._access_token_expiration_time

    def is_valid(self):
        return ((self._access_token is not None)
                and (self._access_token_expiration_time is not None))

    def has_expired(self):
        return timezone.now() > self._access_token_expiration_time

    def refresh(self):
        url = 'https://accounts.spotify.com/api/token'
        data = {
            'grant_type': 'refresh_token',
            'refresh_token': self.refresh_token,
            'client_id': settings.SPOTIFY_CLIENT_ID,
            'client_secret': settings.SPOTIFY_CLIENT_SECRET,
        }

        r = requests.post(url, data)
        response_data = r.json()
        self._access_token = response_data['access_token']
        expires_in = int(response_data['expires_in'])
        expires_in = timedelta(seconds=expires_in)
        self._access_token_expiration_time = datetime.utcnow() + expires_in
        save_access_token(self)

    @staticmethod
    def request_refresh_and_access_token(code, user):
        url = 'https://accounts.spotify.com/api/token'
        data = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': get_oauth_redirect_uri(),
            'client_id': settings.SPOTIFY_CLIENT_ID,
            'client_secret': settings.SPOTIFY_CLIENT_SECRET,
        }

        r = requests.post(url, data)

        response_data = r.json()
        expires_in = int(response_data['expires_in'])
        expires_in = timedelta(seconds=expires_in)
        expiration_time = datetime.utcnow() + expires_in
        access_token = AccessToken(user, response_data['refresh_token'],
                                   response_data['access_token'],
                                   expiration_time)
        save_access_token(access_token)


def save_access_token(access_token: AccessToken):
    creds = SpotifyCredentials.objects.filter(
        user_id=access_token.user.id).first()
    if creds is None:
        creds = SpotifyCredentials(
            user_id=access_token.user.id,
            refresh_token=access_token.refresh_token)

    creds.access_token = access_token.token
    creds.access_token_expiration_time = access_token.token_expiration_time
    creds.save()


def load_access_token(user):
    creds = user.spotifycredentials
    return AccessToken(user, creds.refresh_token, creds.access_token,
                       creds.access_token_expiration_time)


# Web API Client


def start_resume_playback(access_token, device_id, context_uri, uri):
    """
    https://beta.developer.spotify.com/documentation/web-api/reference/player/start-a-users-playback/
    """
    url = 'https://api.spotify.com/v1/me/player/play'
    headers = {'Authorization': f'Bearer {access_token}'}
    query_params = {'device_id': device_id}
    data = {'context_uri': context_uri, 'offset': {'uri': uri}}

    r = requests.put(url, headers=headers, params=query_params, json=data)
    if r.status_code == requests.codes.accepted:
        # device is temporarily unavailable, retry after 5 seconds, up to 5
        # retries
        for r in range(5):
            time.sleep(5)
            r = requests.post(
                url, headers=headers, params=query_params, json=data)
            if r.status_code != requests.codes.accepted:
                break

    if r.status_code == requests.codes.no_content:
        # successful request
        # do nothing
        logger.debug(f'start/resuming playback for {device_id}')

    elif r.status_code == requests.codes.not_found:
        # device is not found
        # TODO: refetch device id from user
        pass
    elif r.status_code == requests.codes.forbidden:
        # the user making the request is non-premium
        # TODO: alert user and prevent them from using the site
        pass
    else:
        logger.error(
            f'start resume playback API returned unexpected response: {r}')
