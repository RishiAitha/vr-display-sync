const path = require('path');

module.exports = {
    mode: process.env.NODE_ENV || 'development',
    entry: {
        index: './src/index.js',
        vr: './src/vr.js',
        desktop: './src/desktop.js',
        screen: './src/screen.js',
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        clean: true, // Cleans old files in dist
    },
};
