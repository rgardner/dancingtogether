"""Production settings suitable for running Dancing Together in production."""

# pylint: disable=wrong-import-order

# Production settings load and override base settings, so unused imports are
# by design.
from .base import *  # pylint: disable=unused-wildcard-import,wildcard-import

import os

# https://docs.djangoproject.com/en/2.1/ref/middleware/#http-strict-transport-security

SECURE_HSTS_SECONDS = os.environ['DT_SECURE_HSTS_SECONDS']
SECURE_HSTS_INCLUDE_SUBDOMAINS = True

# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/2.0/howto/static-files/

STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
STATIC_ROOT = os.path.join(BASE_DIR, "staticfiles")

# Sentry Error Reporting

RAVEN_CONFIG = {
    'dsn': os.environ['DT_RAVEN_CONFIG_DSN'],
}

# Webpack

STATICFILES_DIRS = [
    os.path.join(BASE_DIR, 'static'),
    os.path.join(BASE_DIR, 'assets'),
]

WEBPACK_LOADER = {
    'DEFAULT': {
        'BUNDLE_DIR_NAME': 'bundles/',
        'STATS_FILE': os.path.join(BASE_DIR, 'webpack-stats.prod.json'),
    },
}
