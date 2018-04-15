from .base import *

# Database
# https://docs.djangoproject.com/en/2.0/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
    },
}

# Test

TEST_RUNNER = 'dancingtogether.runner.PytestTestRunner'
