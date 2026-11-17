const path = require('path');
const lambdaNames = require('./lambdas.json');

/** @type {import('webpack').Configuration} */
const configuration = {
	entry: Object.fromEntries(lambdaNames.lambdas.map((name) => [
		name, `./src/functions/${name === 'streamDocuments' ? 'stream' : name}.js`,
	])),

	output: {
		filename: '[name]/app.js',
		libraryTarget: 'commonjs2',
		path: path.resolve('.webpack'),
		// Keep SDK v3 dynamic imports inside each independently deployed Lambda.
		asyncChunks: false,
	},

	// Resolve .ts and .js extensions
	resolve: {
		extensions: ['.ts', '.js'],
	},

	// Target node
	target: 'node',

	externals: {
		fsevents: 'require(\'fsevents\')',
	},

	module: {
		rules: [
			{
				test: /\.m?js$/,
				exclude: /node_modules/,
				use: {
					loader: 'babel-loader',
					options: {
						presets: [
							['@babel/preset-env'],
						],
					},
				},
			},
		],
	},

};

module.exports = configuration;
