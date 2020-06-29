"""Development settings suitable for running Dancing Together locally."""

# Development settings load and override base settings, so unused imports are
# by design.
from .base import *  # pylint: disable=unused-wildcard-import,wildcard-import

# Database
# https://docs.djangoproject.com/en/2.0/ref/settings/#databases

DATABASES['default'] = dj_database_url.config(conn_max_age=DB_CONN_MAX_AGE,
                                              ssl_require=False)

# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/2.0/howto/static-files/

STATICFILES_DIRS = [
    os.path.join(BASE_DIR, 'static'),
]

# Webpack

WEBPACK_LOADER = {
    'DEFAULT': {
        'BUNDLE_DIR_NAME': 'bundles/',
        'STATS_FILE': os.path.join(BASE_DIR, 'webpack-stats.dev.json'),
    },
}
