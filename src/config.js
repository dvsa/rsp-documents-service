import { SecretsManager } from 'aws-sdk';

const configMetadata = {
	bucketName: 'BUCKETNAME',
	daysToHold: 'DAYS_TO_HOLD',
	dynamodbMaxBatchSize: 'DYNAMODB_MAX_BATCH_SIZE',
	dynamodbPenaltyDocTable: 'DYNAMODB_PENALTY_DOC_TABLE',
	dynamodbPenaltyGroupTable: 'DYNAMODB_PENALTY_GROUP_TABLE',
	env: 'ENV',
	paymentsBatchFetchArn: 'PAYMENTS_BATCH_FETCH_ARN',
	paymentUrl: 'PAYMENTURL',
	siteResource: 'SITERESOURCE',
	snsTopicArn: 'SNSTOPICARN',
	tokenServiceArn: 'TOKEN_SERVICE_ARN',
};

let configuration = {};
async function bootstrap() {
	return new Promise((resolve, reject) => {
		if (process.env.USE_SECRETS_MANAGER === 'true') {
			const SecretId = process.env.SECRETS_MANAGER_SECRET_NAME;
			console.log(`Pulling config from AWS Secrets Manager for secret ${SecretId}...`);
			const secretsManagerClient = new SecretsManager({ region: process.env.REGION });
			secretsManagerClient.getSecretValue({ SecretId }, (err, secretsManagerResponse) => {
				if (err) {
					console.log(err);
					reject(err);
				}
				configuration = JSON.parse(secretsManagerResponse.SecretString);
				console.log(`Cached ${Object.keys(configuration).length} config items from secrets manager`);
				resolve(configuration);
			});
		} else {
			console.log('Using envvars for config');
			configuration = Object.values(configMetadata)
				.reduce((config, envkey) => ({ [envkey]: process.env[envkey], ...config }), configuration);
			console.log('Finished getting envvars');
			resolve(configuration);
		}
	});
}

const bucketName = () => {
	return configuration[configMetadata.bucketName];
};

const daysToHold = () => {
	return configuration[configMetadata.daysToHold] || 3;
};

const dynamodbMaxBatchSize = () => {
	return configuration[configMetadata.dynamodbMaxBatchSize];
};

const dynamodbPenaltyDocTable = () => {
	return configuration[configMetadata.dynamodbPenaltyDocTable];
};

const dynamodbPenaltyGroupTable = () => {
	return configuration[configMetadata.dynamodbPenaltyGroupTable];
};

const env = () => {
	return configuration[configMetadata.env];
};

const paymentsBatchFetchArn = () => {
	return configuration[configMetadata.paymentsBatchFetchArn];
};

const paymentUrl = () => {
	return configuration[configMetadata.paymentUrl];
};

const siteResource = () => {
	return configuration[configMetadata.siteResource];
};

const snsTopicArn = () => {
	return configuration[configMetadata.snsTopicArn];
};

const tokenServiceArn = () => {
	return configuration[configMetadata.tokenServiceArn];
};


export default {
	bootstrap,
	bucketName,
	daysToHold,
	dynamodbMaxBatchSize,
	dynamodbPenaltyDocTable,
	dynamodbPenaltyGroupTable,
	env,
	paymentsBatchFetchArn,
	paymentUrl,
	siteResource,
	snsTopicArn,
	tokenServiceArn,
};
