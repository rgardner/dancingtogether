from django.contrib import auth
from django.db.utils import IntegrityError
import pytest

from ..models import Listener, Station


@pytest.mark.django_db(transaction=True)
def test_listeners_uniqueness(user1, station1):
    Listener.objects.create(
        user=user1, station=station1, is_admin=False, is_dj=False)
    with pytest.raises(IntegrityError):
        Listener.objects.create(
            user=user1, station=station1, is_admin=False, is_dj=False)


@pytest.fixture
def user1():
    return auth.get_user_model().objects.create(
        username='testuser1', email='testuser1@example.com')


@pytest.fixture
def station1():
    return Station.objects.create(title='Station1')
