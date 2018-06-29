from django.conf import settings
from django.db import models
from django.urls import reverse
from django.utils import timezone


class SpotifyCredentials(models.Model):
    class Meta:
        verbose_name_plural = "spotify credentials"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    refresh_token = models.CharField(max_length=256)
    access_token = models.CharField(max_length=256)
    access_token_expiration_time = models.DateTimeField()


class Station(models.Model):
    title = models.CharField(max_length=256)

    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL, related_name='stations', through='Listener')

    def __str__(self):
        return self.title

    @property
    def group_name(self):
        return f'station-{self.id}'

    @property
    def admin_group_name(self):
        return f'station-admin-{self.id}'

    def get_absolute_url(self):
        return reverse('radio:detail', kwargs={'pk': self.pk})


class Listener(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    station = models.ForeignKey(Station, on_delete=models.CASCADE)

    is_admin = models.BooleanField()
    is_dj = models.BooleanField()


class PlaybackState(models.Model):
    station = models.OneToOneField(Station, on_delete=models.CASCADE)
    context_uri = models.CharField(max_length=256)
    current_track_uri = models.CharField(max_length=256)
    paused = models.NullBooleanField()
    raw_position_ms = models.PositiveIntegerField()
    sample_time = models.DateTimeField()
    last_updated_time = models.DateTimeField(auto_now=True)
