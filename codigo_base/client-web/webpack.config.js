const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    mode: 'development',
    entry: './src/index.js',              // <- tú completas: ¿cuál es tu archivo de entrada?
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),              // <- tú completas: necesita una ruta ABSOLUTA, con path.resolve(__dirname, 'dist')
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/index.html',         // <- tú completas: ¿cuál es tu html de origen?
        }),
    ],
    devServer: {
        static: './dist',
        port: 8080,
        open: true,
    },
    resolve: {
        fallback: {
            fs: false,
            net: false,
            tls: false,
            dns: false,
        },
    },
};