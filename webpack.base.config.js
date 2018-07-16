var path = require("path");

module.exports = {
    context: __dirname,
    entry: {
        station: './static/js/station.tsx',
    },
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
        extensions: ['.ts', '.tsx', '.js'],
    },
    output: {
        filename: "[name]-[hash].js",
        path: path.resolve('./assets/bundles/'),
    },
};
