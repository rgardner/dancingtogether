from datetime import datetime, timedelta
import hashlib
import urllib.parse

import dateutil.parser
from django.shortcuts import redirect
import requests

from dancingtogether import settings
from .models import SpotifyCredentials

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
        access_token = AccessToken(request)
        if (not access_token.is_valid()) or access_token.has_expired():
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
    base = 'https://accounts.spotify.com/authorize'
    scope = 'streaming user-read-birthdate user-read-email user-read-private'
    query_params = {
        'client_id': settings.SPOTIFY_CLIENT_ID,
        'response_type': 'code',
        'redirect_uri': get_oauth_redirect_uri(),
        'state': get_url_safe_oauth_request_state(request),
        'scope': scope,
    }

    query_params = urllib.parse.urlencode(query_params)
    return '{}?{}'.format(base, query_params)


# Spotify OAuth Step 2: Request access and refresh tokens


class AccessToken:
    def __init__(self, request):
        self._request = request

    @property
    def token(self):
        return self._request.session.get('spotify_access_token')

    def is_valid(self):
        return (('spotify_access_token' in self._request.session)
            and ('spotify_access_token_expiration_time' in self._request.session))

    def has_expired(self):
        now = datetime.utcnow()
        expiration_time = self._request.session['spotify_access_token_expiration_time']
        expiration_time = dateutil.parser.parse(expiration_time)
        return now > expiration_time

    def refresh(self):
        refresh_token = self._request.user.spotifycredentials.refresh_token
        AccessToken.refresh_token(refresh_token, self._request)

    @staticmethod
    def request_refresh_and_access_token(code, request):
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
        creds = SpotifyCredentials()
        creds.user = request.user
        creds.refresh_token = response_data['refresh_token']
        creds.save()

        request.session['spotify_access_token'] = response_data['access_token']
        expires_in = int(response_data['expires_in'])
        expires_in = timedelta(seconds=expires_in)
        expiration_time = datetime.utcnow() + expires_in
        request.session['spotify_access_token_expiration_time'] = expiration_time.isoformat()

    @staticmethod
    def refresh_token(refresh_token, request):
        url = 'https://accounts.spotify.com/api/token'
        data = {
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token,
            'client_id': settings.SPOTIFY_CLIENT_ID,
            'client_secret': settings.SPOTIFY_CLIENT_SECRET,
        }

        r = requests.post(url, data)

        response_data = r.json()
        request.session['spotify_access_token'] = response_data['access_token']
        expires_in = int(response_data['expires_in'])
        expires_in = timedelta(seconds=expires_in)
        expiration_time = datetime.utcnow() + expires_in
        request.session['spotify_access_token_expiration_time'] = expiration_time.isoformat()
