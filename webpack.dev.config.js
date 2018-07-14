var BundleTracker = require('webpack-bundle-tracker');

var config = require('./webpack.base.config');

config.mode = 'development';

config.devtool = 'eval-source-map';

config.plugins = [
    new BundleTracker({ filename: './webpack-stats.json' }),
];

module.exports = config;
