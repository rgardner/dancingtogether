from .base import *

# Database
# https://docs.djangoproject.com/en/2.0/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
    },
}

# Test
# https://docs.djangoproject.com/en/2.0/topics/testing/

TEST_RUNNER = 'dancingtogether.runner.PytestTestRunner'

# Channel layer definitions
# http://channels.readthedocs.io/en/latest/topics/channel_layers.html

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
        'TEST_CONFIG': {
            'expiry': 100500,
        },
    },
}
