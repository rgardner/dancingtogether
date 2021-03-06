"""Test settings suitable for testing Dancing Together."""

# Test settings load and override base settings, so unused imports are by
# design.
from .base import *  # pylint: disable=unused-wildcard-import,wildcard-import

# Database
# https://docs.djangoproject.com/en/2.0/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
    },
}

STATICFILES_DIRS = [
    os.path.join(BASE_DIR, 'static'),
]

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
