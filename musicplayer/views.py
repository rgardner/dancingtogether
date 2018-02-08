from django.contrib.auth.decorators import login_required
from django.http import HttpResponse


@login_required()
def room(request, room_id=None):
    return HttpResponse("Hello, world. You're trying to go to {}".format(room_id))
