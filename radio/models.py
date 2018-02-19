from django.db import models

from accounts.models import User


class SpotifyCredentials(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    refresh_token = models.CharField(max_length=256)


class Station(models.Model):
    title = models.CharField(max_length=256)

    members = models.ManyToManyField(
        User, related_name='stations', through='Listener')
    pending_members = models.ManyToManyField(
        User, related_name='pending_stations', through='PendingListener')

    context_uri = models.CharField(max_length=256, default='')
    current_track_uri = models.CharField(max_length=256, default='')
    paused = models.NullBooleanField(default=None)

    def __str__(self):
        return self.title

    @property
    def group_name(self):
        return 'room-{}'.format(self.id)


class Listener(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    station = models.ForeignKey(Station, on_delete=models.CASCADE)

    is_admin = models.BooleanField()
    is_dj = models.BooleanField()


class PendingListener(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    room = models.ForeignKey(Station, on_delete=models.CASCADE)