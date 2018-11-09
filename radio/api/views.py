import logging

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
        access_token.refresh()
        access_token.save()

        serializer = AccessTokenSerializer(access_token)
        return Response(serializer.data)
