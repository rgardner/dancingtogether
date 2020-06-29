from accounts.models import User
from ..models import Listener, Station


def create_station() -> Station:
    return Station.objects.create(title='Station1')


def create_listener(station: Station,
                    user: User,
                    is_admin=False,
                    is_dj=True) -> Listener:
    return Listener.objects.create(station=station,
                                   user=user,
                                   is_admin=is_admin,
                                   is_dj=is_dj)
