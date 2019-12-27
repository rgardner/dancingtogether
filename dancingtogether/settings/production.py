from .base import *

import os

# https://docs.djangoproject.com/en/2.1/ref/middleware/#http-strict-transport-security

SECURE_HSTS_SECONDS = os.environ["DT_SECURE_HSTS_SECONDS"]
SECURE_HSTS_INCLUDE_SUBDOMAINS = True

# Sentry Error Reporting

RAVEN_CONFIG = {
    "dsn": os.environ["DT_RAVEN_CONFIG_DSN"],
}

# Webpack

STATICFILES_DIRS = [
    os.path.join(BASE_DIR, "static"),
    os.path.join(BASE_DIR, "assets"),
]

WEBPACK_LOADER = {
    "DEFAULT": {
        "BUNDLE_DIR_NAME": "bundles/",
        "STATS_FILE": os.path.join(BASE_DIR, "webpack-stats.prod.json"),
    },
}
