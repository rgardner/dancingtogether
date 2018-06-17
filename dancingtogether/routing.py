from django.urls import path
from channels.routing import ChannelNameRouter, ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

import radio.consumers

# The channel routing defines what connections get handled by what consumers,
# selecting on either the connection type (ProtocolTypeRouter) or properties
# of the connection's scope (like URLRouter, which looks at scope["path"])
# For more, see http://channels.readthedocs.io/en/latest/topics/routing.html
application = ProtocolTypeRouter({
    # Channels will do this for you automatically. It's included here as an example.
    # "http": AsgiHandler,
    'websocket':
    AuthMiddlewareStack(
        URLRouter([
            path('api/stations/<int:station_id>/stream/',
                 radio.consumers.StationConsumer),
        ])),
})
