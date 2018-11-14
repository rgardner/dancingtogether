import logging

from django.contrib import auth
from rest_framework import serializers

from ..models import Listener, PlaybackState, SpotifyCredentials, Station

logger = logging.getLogger(__name__)


class PlaybackStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlaybackState
        fields = ('station_id', 'context_uri', 'current_track_uri', 'paused',
                  'raw_position_ms', 'sample_time', 'last_updated_time')

    def update(self, instance, validated_data):
        for field in PlaybackStateSerializer.Meta.fields:
            if field != 'last_updated_time':
                new_value = validated_data.get(field, getattr(instance, field))
                setattr(instance, field, new_value)

        instance.save()
        return instance


class StationSerializer(serializers.HyperlinkedModelSerializer):
    playbackstate = PlaybackStateSerializer()

    class Meta:
        model = Station
        fields = ('title', 'playbackstate')

    def update(self, instance, validated_data):
        if 'playbackstate' in validated_data:
            try:
                playback_state = PlaybackStateSerializer().update(
                    instance.playbackstate, validated_data['playbackstate'])
            except PlaybackState.DoesNotExist:
                validated_data['playbackstate']['station_id'] = instance.id
                playback_state = PlaybackStateSerializer().create(
                    validated_data['playbackstate'])

            instance.playbackstate = playback_state

        return instance


class ListenerSerializer(serializers.ModelSerializer):
    user = serializers.SlugRelatedField(
        queryset=auth.get_user_model().objects.all(),
        slug_field='username',
    )
    station = serializers.PrimaryKeyRelatedField(
        queryset=Station.objects.all())

    class Meta:
        model = Listener
        fields = ('id', 'user', 'station', 'is_admin', 'is_dj')


class AccessTokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=256)
    token_expiration_time = serializers.DateTimeField()
