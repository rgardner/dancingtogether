from django.db import models

from accounts.models import User


class SpotifyCredentials(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    refresh_token = models.CharField(max_length=256)


class Room(models.Model):
    title = models.CharField(max_length=256)

    members = models.ManyToManyField(User, through='Membership')
    pending_members = models.ManyToManyField(User, related_name='pending_rooms', through='PendingMembership')

    def __str__(self):
        return self.title

    @property
    def group_name(self):
        return 'room-{}'.format(self.id)


class Membership(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    room = models.ForeignKey(Room, on_delete=models.CASCADE)

    is_admin = models.BooleanField()
    is_dj = models.BooleanField()


class PendingMembership(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    room = models.ForeignKey(Room, on_delete=models.CASCADE)
