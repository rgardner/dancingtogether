from .base import *

import os

# Sentry Error Reporting

RAVEN_CONFIG = {
    'dsn': os.environ['DT_RAVEN_CONFIG_DSN'],
    'release': os.environ['DT_RAVEN_CONFIG_RELEASE'],
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
