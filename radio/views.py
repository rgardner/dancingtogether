import logging

from django.contrib.auth.decorators import login_required
from django.http import HttpResponse
from django.shortcuts import redirect, render

from . import spotify

logger = logging.getLogger(__name__)


def index(request):
    return render(request, 'station_index.html')


@login_required
@spotify.authorization_required
@spotify.fresh_access_token_required
def station(request, station_id):
    access_token = spotify.load_access_token(request.user).token
    return render(
        request, 'station.html', context={
            'access_token': access_token,
            'station_id': station_id,
        })


def oauth_callback(request):
    result = request.GET

    # Validate OAuth state parameter
    expected_state = spotify.get_url_safe_oauth_request_state(request)
    if result['state'] != expected_state:
        logger.warn('User received invalid oauth request state response')
        return HttpResponse('Invalid OAuth state', status_code=400)

    if 'error' in result:
        error = result['error']
        logger.warn(f'User rejected the oauth permissions: {error}')
        return redirect('/')
    else:
        code = result['code']
        spotify.AccessToken.request_refresh_and_access_token(code, request)
        # TODO(rogardn): redirect to original destination before oauth request
        return redirect('/stations')
