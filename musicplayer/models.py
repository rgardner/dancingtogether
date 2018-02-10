from django.db import models

from accounts.models import User


class SpotifyCredentials(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    refresh_token = models.CharField(max_length=256)
