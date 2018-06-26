import logging

from asgiref.sync import async_to_sync
import dateutil
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.views import APIView
from rest_framework.response import Response

from .. import spotify
from ..models import Listener, PlaybackState, SpotifyCredentials, Station
from ..spotify import AccessToken
from .serializers import (AccessTokenSerializer, ListenerSerializer,
                          StationSerializer)

logger = logging.getLogger(__name__)


class StationViewSet(viewsets.ModelViewSet):
    """
    API endpoint that allows stations to be viewed or edited.
    """
    queryset = Station.objects.all()
    serializer_class = StationSerializer

    def get_playback_state(self, station_pk):
        try:
            return PlaybackState.objects.get(station=station_pk)
        except PlaybackState.DoesNotExist:
            return Http404()

    def retrieve(self, request, pk=None):
        response = super().retrieve(request, pk)
        response['Cache-Control'] = 'no-cache'
        self.add_response_headers(response, pk)
        return response

    def partial_update(self, request, pk=None):
        if_unmodified_since_header = request.META.get(
            'HTTP_IF_UNMODIFIED_SINCE')
        if if_unmodified_since_header is not None:
            playback_state = self.get_playback_state(pk)
            client_last_updated_time = dateutil.parser.isoparse(
                if_unmodified_since_header)
            if playback_state.last_updated_time != client_last_updated_time:
                return Response(status=status.HTTP_412_PRECONDITION_FAILED)

        response = super().partial_update(request, pk)
        self.add_response_headers(response, pk)
        return response

    def add_response_headers(self, response, pk=None):
        if status.is_success(response.status_code):
            playback_state = self.get_playback_state(pk)
            response['Last-Modified'] = playback_state.last_updated_time


class ListenerViewSet(viewsets.ModelViewSet):
    serializer_class = ListenerSerializer

    def get_queryset(self):
        return Listener.objects.filter(station=self.kwargs['station_pk'])


class BelongsToUser(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.user == request.user


class RefreshAccessToken(APIView):
    permission_classes = (BelongsToUser, )

    def get_object(self):
        obj = get_object_or_404(
            self.get_queryset(), user_id=self.kwargs['user_pk'])
        self.check_object_permissions(self.request, obj)
        return AccessToken.from_db_model(obj)

    def get_queryset(self):
        return SpotifyCredentials.objects.all()

    def post(self, request, format=None, user_pk=None):
        access_token = self.get_object()
        async_to_sync(access_token.refresh)()
        spotify.save_access_token(access_token)

        serializer = AccessTokenSerializer(access_token)
        return Response(serializer.data)
