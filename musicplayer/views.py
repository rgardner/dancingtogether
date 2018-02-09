from django.http import HttpResponse


def room(request, room_id=None):
    return HttpResponse("Hello, world. You're trying to go to {}".format(room_id))
