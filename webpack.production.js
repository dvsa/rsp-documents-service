const fs = require('fs-extra');
const { merge } = require('webpack-merge');
const common = require('./webpack.common');
const archiver = require('archiver');

const LAMBDA_NAME = 'updateWithPayment';
const OUTPUT_FOLDER = './dist';
const REPO_NAME = 'cpms-sap-payments-lambda';
const BRANCH_NAME = 'branch';

class BundlePlugin {
	/**
     * @param {{ archives: any; assets?: any; }} params
     */
	constructor(params) {
		this.archives = params.archives;
		this.assets = params.assets || [];
	}

	apply(compiler) {
		compiler.hooks.afterEmit.tap('zip-pack-plugin', async () => {
			this.archives.forEach(async (archive) => {
				await BundlePlugin.createArchive(archive.inputPath, archive.outputPath, archive.outputName, archive.ignore);
			});

			this.assets.forEach((asset) => {
				fs.copySync(asset.inputPath, asset.outputPath);
			});
		});
	}

	static createArchive(inputPath, outputPath, outputName, ignore) {
		if (!fs.existsSync(outputPath)) {
			fs.mkdirSync(outputPath);
		}
		const output = fs.createWriteStream(`${outputPath}/${outputName}.zip`);
		const archive = archiver('zip');

		output.on('close', () => {
			console.log(`${archive.pointer()} total bytes`);
			console.log('archiver has been finalized and the output file descriptor has closed.');
		});
		archive.on('error', (err) => {
			throw err;
		});

		archive.pipe(output);
		archive.glob(
			'**/*',
			{
				cwd: inputPath,
				skip: ignore,
			},
		);
		return archive.finalize();
	}
}

const lambdaArr = [
	'create',
	'createPenaltyGroup',
	'delete',
	'deleteGroup',
	'get',
	'getDocumentByToken',
	'getPenaltyGroup',
	'list',
	'listGroups',
	'searchByVehicleRegistration',
	'sites',
	'stream',
	'updateMulti',
	'updateMultipleUponPaymentDelete',
	'updatePenaltyGroupWithPayment',
	'updatePenaltyGroupWithPaymentStartTime',
	'updateUponPaymentDelete',
	'updateWithPayment',
	'updateWithPaymentStartTime',
];

function getArchives() {
	return lambdaArr.map(lambdaName => ({
		inputPath: `.aws-sam/build/${lambdaName}`,
		outputPath: `${OUTPUT_FOLDER}`,
		outputName: `${lambdaName}`,
	}));
}


module.exports = () => {
	return merge(common, {
		mode: 'production',
		plugins: [
			// @ts-ignore
			new BundlePlugin({
				archives: getArchives(),
			}),
		],
	});
};
