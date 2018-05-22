var webpack = require('webpack');
var BundleTracker = require('webpack-bundle-tracker');

var config = require('./webpack.base.config.js');

config.mode = 'production';

config.output.path = require('path').resolve('./assets/dist');

config.plugins = config.plugins.concat([
    new BundleTracker({ filename: './webpack-stats-prod.json' }),
]);

module.exports = config;
