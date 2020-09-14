const path = require('path');

module.exports = {
  entry: './hook.js',
  output: {
    library: 'PMAnalyzer',
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/
      }
    ]
  }
};
