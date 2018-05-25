import logging

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.cache import never_cache

from .models import Listener
from . import spotify

logger = logging.getLogger(__name__)


@login_required
def index(request):
    stations = request.user.stations.all()
    pending_stations = request.user.pending_stations.all()
    return render(
        request,
        'station_index.html',
        context={
            'stations': stations,
            'pending_stations': pending_stations,
        })


@login_required
@spotify.authorization_required
@spotify.fresh_access_token_required
def station(request, station_id):
    listener = get_object_or_404(
        Listener, user_id=request.user.id, station_id=station_id)
    access_token = spotify.load_access_token(request.user.id).token
    return render(
        request,
        'station.html',
        context={
            'station_id': station_id,
            'access_token': access_token,
            'is_dj': listener.is_dj,
            'is_admin': listener.is_admin,
            'player_name': settings.SPOTIFY_PLAYER_NAME,
        })


def oauth_callback(request):
    result = request.GET

    # Validate OAuth state parameter
    expected_state = spotify.get_url_safe_oauth_request_state(request)
    if result['state'] != expected_state:
        logger.warning('User received invalid oauth request state response')
        return HttpResponse('Invalid OAuth state', status_code=400)

    if 'error' in result:
        error = result['error']
        logger.warning(f'User rejected the oauth permissions: {error}')
        return redirect('/')
    else:
        code = result['code']
        spotify.AccessToken.request_refresh_and_access_token(
            code, request.user)
        # TODO(rogardn): redirect to original destination before oauth request
        return redirect('/stations')
