const sinon = require('sinon');
const http = require('http');
const https = require('https');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { SNSClient } = require('@aws-sdk/client-sns');
const { S3Client } = require('@aws-sdk/client-s3');
const { LambdaClient } = require('@aws-sdk/client-lambda');
const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');

process.env.USE_SECRETS_MANAGER = 'false';
process.env.AWS_EC2_METADATA_DISABLED = 'true';
process.env.AWS_REGION = 'eu-west-1';
process.env.AWS_ACCESS_KEY_ID = 'unit-test';
process.env.AWS_SECRET_ACCESS_KEY = 'unit-test';
delete process.env.AWS_PROFILE;
delete process.env.AWS_SESSION_TOKEN;

const blocked = () => { throw new Error('Network requests are forbidden in unit tests'); };
http.request = blocked;
https.request = blocked;
http.get = blocked;
https.get = blocked;

const request = sinon.stub();
const sends = [DynamoDBDocumentClient, SNSClient, S3Client, LambdaClient, SecretsManagerClient]
	.map((Client) => sinon.stub(Client.prototype, 'send').callsFake((command) => {
		const name = command.constructor.name.replace(/Command$/, '');
		return request(name[0].toLowerCase() + name.slice(1), command.input);
	}));
function resetRequests() {
	request.reset();
	request.callsFake((operation) => { throw new Error(`Unstubbed AWS request: ${operation}`); });
	// Legacy payment tests trigger fire-and-forget notifications.
	request.withArgs('publish').resolves({ MessageId: 'unit-test-message' });
}
resetRequests();

exports.request = request;
exports.mochaHooks = {
	beforeEach() { resetRequests(); },
	afterAll() { sends.forEach((send) => send.restore()); },
};
