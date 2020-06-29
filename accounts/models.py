"""Accounts database models."""

from django.contrib.auth.models import AbstractUser


class User(AbstractUser):
    """Custom user model for Dancing Together specific customizations.

    Use `User` anytime you need a concrete user model.

    https://docs.djangoproject.com/en/3.0/topics/auth/customizing/#using-a-custom-user-model-when-starting-a-project
    """
    def __str__(self):
        return f'user-{self.id}'
