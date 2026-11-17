import expect from 'expect';
import config from './config';
import { aws } from './test/helpers';

describe('configuration sources', () => {
	let environment;
	beforeEach(() => {
		environment = { ...process.env };
		delete process.env.USE_SECRETS_MANAGER;
	});
	afterEach(async () => {
		process.env = environment;
		// Avoid leaking a Secrets Manager configuration into subsequent suites.
		const useSecrets = process.env.USE_SECRETS_MANAGER;
		process.env.USE_SECRETS_MANAGER = 'true';
		aws('getSecretValue', { SecretString: '{}' });
		await config.bootstrap();
		process.env.USE_SECRETS_MANAGER = 'false';
		await config.bootstrap();
		if (useSecrets === undefined) delete process.env.USE_SECRETS_MANAGER;
		else process.env.USE_SECRETS_MANAGER = useSecrets;
	});

	it('reads all environment values and uses defaults only when unset', async () => {
		const names = {
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
		Object.values(names).forEach((name) => { process.env[name] = `test-${name}`; });
		const result = await config.bootstrap();
		Object.entries(names).forEach(([method, name]) => {
			expect(result[name]).toBe(`test-${name}`);
			expect(config[method]()).toBe(`test-${name}`);
		});
		process.env.USE_SECRETS_MANAGER = 'true';
		aws('getSecretValue', { SecretString: '{}' });
		await config.bootstrap();
		expect(config.daysToHold()).toBe(3);
		expect(config.dynamodbMaxBatchSize()).toBe(75);
	});

	it('loads and replaces configuration from Secrets Manager', async () => {
		process.env.USE_SECRETS_MANAGER = 'true';
		process.env.SECRETS_MANAGER_SECRET_NAME = 'unit-secret';
		const secret = { BUCKETNAME: 'secret-bucket', DAYS_TO_HOLD: 7 };
		const getSecret = aws('getSecretValue', { SecretString: JSON.stringify(secret) });
		expect(await config.bootstrap()).toEqual(secret);
		expect(getSecret.firstCall.args[1]).toEqual({ SecretId: 'unit-secret' });
		expect(config.bucketName()).toBe('secret-bucket');
		expect(config.daysToHold()).toBe(7);
	});

	it('propagates secret retrieval errors', async () => {
		process.env.USE_SECRETS_MANAGER = 'true';
		aws('getSecretValue', undefined, new Error('secret unavailable'));
		await expect(config.bootstrap()).rejects.toThrow('secret unavailable');
	});
});
