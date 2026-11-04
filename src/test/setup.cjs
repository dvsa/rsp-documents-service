const AWS = require('aws-sdk');
const sinon = require('sinon');
const http = require('http');
const https = require('https');

process.env.USE_SECRETS_MANAGER = 'false';
process.env.AWS_EC2_METADATA_DISABLED = 'true';

// Install before application modules are loaded, including module-scoped AWS clients.
// Never resolve real credentials or permit even an accidental local/cloud request.
AWS.config.update({
	region: 'eu-west-1',
	credentials: new AWS.Credentials('unit-test', 'unit-test'),
});
const blocked = () => { throw new Error('Network requests are forbidden in unit tests'); };
http.request = blocked;
https.request = blocked;
http.get = blocked;
https.get = blocked;

const request = sinon.stub(AWS.Service.prototype, 'makeRequest');
function resetRequests() {
	request.reset();
	request.callsFake(function unexpected(operation) {
		throw new Error(`Unstubbed AWS request: ${this.serviceIdentifier}.${operation}`);
	});
	// Legacy payment tests trigger fire-and-forget notifications.
	request.withArgs('publish').callsFake((operation, params, callback) => {
		const result = { MessageId: 'unit-test-message' };
		if (callback) callback(null, result);
		return { promise: async () => result };
	});
}
resetRequests();

exports.request = request;
exports.mochaHooks = {
	beforeEach() { resetRequests(); },
	afterAll() { request.restore(); },
};
