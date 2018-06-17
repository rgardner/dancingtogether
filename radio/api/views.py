import logging

import dateutil
from django.http import Http404
from rest_framework import status, viewsets
from rest_framework.response import Response

from ..models import PlaybackState, Station
from .serializers import StationSerializer

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
