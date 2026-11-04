import expect from 'expect';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import http from 'http';
import https from 'https';
import { doc } from '../utils/dynamodb';
import { request } from './setup.cjs';

describe('unit suite network isolation', () => {
	it('blocks unstubbed SDK v3 clients, including the shared DocumentClient', () => {
		const calls = [
			() => doc.get({ TableName: 'unit', Key: { ID: 'id' } }).promise(),
			() => new S3Client({}).send(new GetObjectCommand({ Bucket: 'unit', Key: 'unit' })),
			() => new LambdaClient({}).send(new InvokeCommand({ FunctionName: 'unit' })),
			() => new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: 'unit' })),
		];
		calls.forEach((call) => expect(call).toThrow('Unstubbed AWS request'));
		expect(request.callCount).toBe(4);
	});
	it('handles SDK v3 SNS calls entirely in memory', async () => {
		const sns = new SNSClient({});
		expect(await sns.send(new PublishCommand({ TopicArn: 'unit', Message: 'unit' }))).toEqual({ MessageId: 'unit-test-message' });
		expect(request.callCount).toBe(1);
	});
	it('blocks direct HTTP and HTTPS as a backstop', () => {
		[http.request, https.request, http.get, https.get].forEach((send) => {
			expect(() => send('https://unit.invalid')).toThrow('Network requests are forbidden');
		});
	});
});
