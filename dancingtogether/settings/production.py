from .base import *

# Channel layer definitions
# http://channels.readthedocs.io/en/latest/topics/channel_layers.html

CHANNEL_LAYERS = {
    'default': {
        # This example app uses the Redis channel layer implementation channels_redis
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [os.environ['REDIS_URL']],
        },
    },
}
