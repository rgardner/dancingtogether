var path = require("path");

module.exports = {
    context: __dirname,
    entry: {
        station: './static/js/station.ts',
    },
    devtool: 'inline-source-map',
    plugins: [],
    mode: 'none',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            }
        ],
    },
    resolve: {
        modules: ['node_modules'],
        extensions: ['.ts', '.js'],
    },
    output: {
        filename: "[name]-[hash].js",
        path: path.resolve('./assets/bundles/'),
    },
};
