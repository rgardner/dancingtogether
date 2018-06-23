import logging

from django.contrib import auth
from rest_framework import serializers

from ..models import Listener, PlaybackState, Station

logger = logging.getLogger(__name__)


class PlaybackStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlaybackState
        fields = ('context_uri', 'current_track_uri', 'paused',
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
            PlaybackStateSerializer().update(instance.playbackstate,
                                             validated_data['playbackstate'])
        return instance


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = auth.get_user_model()
        fields = ('id', 'username')


class ListenerSerializer(serializers.ModelSerializer):
    user = UserSerializer()

    class Meta:
        model = Listener
        fields = ('user', 'is_admin', 'is_dj')
