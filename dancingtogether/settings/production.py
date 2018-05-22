from .base import *

# Webpack

if not DEBUG:
    WEBPACK_LOADER['DEFAULT'].update({
        'BUNDLE_DIR_NAME':
        'dist/',
        'STATS_FILE':
        os.path.join(BASE_DIR, 'webpack-stats-prod.json'),
    })

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
