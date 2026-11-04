import expect from 'expect';
import AWS from 'aws-sdk';
import http from 'http';
import https from 'https';
import { doc } from 'serverless-dynamodb-client';
import { request } from './setup.cjs';

describe('unit suite network isolation', () => {
	it('blocks unstubbed AWS clients, including the shared DocumentClient', () => {
		const calls = [
			() => doc.get({ TableName: 'unit', Key: { ID: 'id' } }),
			() => new AWS.S3().getObject({ Bucket: 'unit', Key: 'unit' }),
			() => new AWS.Lambda().invoke({ FunctionName: 'unit' }),
			() => new AWS.SecretsManager().getSecretValue({ SecretId: 'unit' }),
		];
		calls.forEach((call) => expect(call).toThrow('Unstubbed AWS request'));
		expect(request.callCount).toBe(4);
	});
	it('handles callback and promise SNS calls entirely in memory', async () => {
		const sns = new AWS.SNS();
		expect(await sns.publish({ TopicArn: 'unit', Message: 'unit' }).promise()).toEqual({ MessageId: 'unit-test-message' });
		let callbackResult;
		sns.publish({ TopicArn: 'unit', Message: 'unit' }, (error, value) => {
			expect(error).toBeNull();
			callbackResult = value;
		});
		expect(callbackResult).toEqual({ MessageId: 'unit-test-message' });
		expect(request.callCount).toBe(2);
	});
	it('blocks direct HTTP and HTTPS as a backstop', () => {
		[http.request, https.request, http.get, https.get].forEach((send) => {
			expect(() => send('https://unit.invalid')).toThrow('Network requests are forbidden');
		});
	});
});
