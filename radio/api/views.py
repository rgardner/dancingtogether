import logging
from typing import Optional

from django.shortcuts import get_object_or_404
from rest_framework import permissions, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.views import APIView
from rest_framework.request import Request
from rest_framework.response import Response

from ..models import Listener, SpotifyCredentials, Station
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

    def get_object(self):
        return get_object_or_404(self.get_queryset(), id=self.kwargs['pk'])

    def get_queryset(self):
        return self.request.user.stations.all()


class ListenerViewSet(viewsets.ModelViewSet):
    serializer_class = ListenerSerializer

    def get_object(self):
        return get_object_or_404(self.get_queryset(), id=self.kwargs['pk'])

    def get_queryset(self):
        station_id = self.kwargs['station_pk']
        get_object_or_404(self.request.user.stations.all(), id=station_id)

        listener = Listener.objects.get(station=station_id,
                                        user=self.request.user)
        if not listener.is_admin:
            raise PermissionDenied()

        return Listener.objects.filter(station=station_id)

    # pylint: disable=arguments-differ
    def create(self, request: Request, station_pk=None):
        get_object_or_404(self.request.user.stations.all(), id=station_pk)

        listener = Listener.objects.get(station=station_pk,
                                        user=self.request.user)
        if not listener.is_admin:
            raise PermissionDenied()

        return super().create(request)


class BelongsToUser(permissions.BasePermission):
    def has_object_permission(self, request: Request, view, obj):
        return obj.user == request.user


class RefreshAccessToken(APIView):
    permission_classes = (BelongsToUser, )

    def get_object(self):
        obj = get_object_or_404(self.get_queryset(),
                                user_id=self.kwargs['user_pk'])
        self.check_object_permissions(self.request, obj)
        return AccessToken.from_db_model(obj)

    # Overridden from APIView
    # pylint: disable=no-self-use
    def get_queryset(self):
        return SpotifyCredentials.objects.all()

    def post(
        self,
        request: Request,
        format=None,  # pylint: disable=redefined-builtin,unused-argument
        user_pk: Optional[int] = None):  # pylint: disable=unused-argument
        access_token = self.get_object()
        access_token.refresh()
        access_token.save()

        serializer = AccessTokenSerializer(access_token)
        return Response(serializer.data)
