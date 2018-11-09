import logging

from django.conf import settings
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, redirect
from django.urls import reverse_lazy
from django.views import View, generic
from django.views.generic.edit import CreateView, DeleteView

from . import spotify
from .forms import StationForm
from .models import Listener, Station

logger = logging.getLogger(__name__)


class ListenerRequiredMixin:
    user_check_failure_path = ''

    def dispatch(self, request, *args, **kwargs):
        get_object_or_404(
            Listener, user=self.request.user, station_id=kwargs['pk'])
        return super().dispatch(request, *args, **kwargs)


class IndexView(LoginRequiredMixin, View):
    def get(self, request, *args, **kwargs):
        view = ListStationsView.as_view()
        return view(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        view = CreateStationView.as_view()
        return view(request, *args, **kwargs)


class ListStationsView(generic.ListView):
    model = Station
    context_object_name = 'stations'
    template_name = 'radio/index.html'

    def get_queryset(self):
        station_ids = Listener.objects.filter(
            user=self.request.user).values_list(
                'station_id', flat=True)
        return Station.objects.filter(id__in=station_ids)

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['form'] = StationForm
        return context


class CreateStationView(CreateView):
    model = Station
    form_class = StationForm
    template_name = 'radio/index.html'

    def form_valid(self, form):
        response = super().form_valid(form)

        # Creator is automatically an admin and DJ of this station
        Listener.objects.create(
            user=self.request.user,
            station=self.object,
            is_admin=True,
            is_dj=True)

        return response


class DetailStationView(LoginRequiredMixin, ListenerRequiredMixin,
                        spotify.AuthorizationRequiredMixin,
                        spotify.FreshAccessTokenRequiredMixin,
                        generic.DetailView):
    model = Station
    template_name = 'radio/detail.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)

        context['user_id'] = self.request.user.id
        context['debug'] = settings.DEBUG

        listener = get_object_or_404(
            Listener, user=self.request.user, station=context['object'])
        context['is_dj'] = listener.is_dj
        context['is_admin'] = listener.is_admin

        context['player_name'] = settings.SPOTIFY_PLAYER_NAME
        context['access_token'] = self.request.session['access_token']

        return context


class DeleteStationView(LoginRequiredMixin, ListenerRequiredMixin, DeleteView):
    model = Station
    success_url = reverse_lazy('radio:index')

    def post(self, request, *args, **kwargs):
        # precondition: ListenerRequiredMixin
        listener = Listener.objects.get(
            user=request.user, station_id=kwargs['pk'])
        if listener.is_admin:
            return super().post(request, *args, **kwargs)
        else:
            return redirect('/stations/')


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
