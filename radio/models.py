from django.db import models
from django.utils import timezone

from accounts.models import User


class SpotifyCredentials(models.Model):
    class Meta:
        verbose_name_plural = "spotify credentials"

    user = models.OneToOneField(User, on_delete=models.CASCADE)
    refresh_token = models.CharField(max_length=256)
    access_token = models.CharField(max_length=256)
    access_token_expiration_time = models.DateTimeField()


class Station(models.Model):
    title = models.CharField(max_length=256)

    members = models.ManyToManyField(
        User, related_name='stations', through='Listener')
    pending_members = models.ManyToManyField(
        User, related_name='pending_stations', through='PendingListener')

    def __str__(self):
        return self.title

    @property
    def group_name(self):
        return f'station-{self.id}'

    @property
    def admin_group_name(self):
        return f'station-admin-{self.id}'


class Listener(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    station = models.ForeignKey(Station, on_delete=models.CASCADE)

    is_admin = models.BooleanField()
    is_dj = models.BooleanField()


class PendingListener(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    room = models.ForeignKey(Station, on_delete=models.CASCADE)


class PlaybackState(models.Model):
    station = models.OneToOneField(Station, on_delete=models.CASCADE)
    context_uri = models.CharField(max_length=256)
    current_track_uri = models.CharField(max_length=256)
    paused = models.NullBooleanField()
    position_ms = models.PositiveIntegerField()
    last_updated_time = models.DateTimeField(auto_now=True)
