from .base import *

STATICFILES_DIRS = [
    os.path.join(BASE_DIR, "static"),
]

# Webpack

WEBPACK_LOADER = {
    "DEFAULT": {
        "BUNDLE_DIR_NAME": "bundles/",
        "STATS_FILE": os.path.join(BASE_DIR, "webpack-stats.dev.json"),
    },
}
