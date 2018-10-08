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

const fromConfiguration = configKey => () => {
	return configuration[configKey];
};

const fromConfigurationWithDefault = (configKey, defaultValue) => () => {
	return fromConfiguration(configKey) || defaultValue;
};

export default {
	bootstrap,
	bucketName: fromConfiguration(configMetadata.bucketName),
	daysToHold: fromConfigurationWithDefault(configMetadata.daysToHold, 3),
	dynamodbMaxBatchSize: fromConfigurationWithDefault(configMetadata.dynamodbMaxBatchSize, 75),
	dynamodbPenaltyDocTable: fromConfiguration(configMetadata.dynamodbPenaltyDocTable),
	dynamodbPenaltyGroupTable: fromConfiguration(configMetadata.dynamodbPenaltyGroupTable),
	env: fromConfiguration(configMetadata.env),
	paymentsBatchFetchArn: fromConfiguration(configMetadata.paymentsBatchFetchArn),
	paymentUrl: fromConfiguration(configMetadata.paymentUrl),
	siteResource: fromConfiguration(configMetadata.siteResource),
	snsTopicArn: fromConfiguration(configMetadata.snsTopicArn),
	tokenServiceArn: fromConfiguration(configMetadata.tokenServiceArn),
};
