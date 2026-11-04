import supertest from 'supertest';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import expect from 'expect';

const url = 'http://localhost:3000/documents';
const request = supertest(url);
let docClient;

describe('payment deletion reflection', () => {
	before(() => {
		const client = DynamoDBDocument.from(new DynamoDBClient({
			region: 'eu-west-1',
			endpoint: 'http://localhost:8000',
			credentials: { accessKeyId: 'legacyLocal', secretAccessKey: 'legacyLocal' },
		}), { marshallOptions: { removeUndefinedValues: true } });
		docClient = { get: (input) => ({ promise: () => client.get(input) }) };
	});

	context('updating upon payment deletion', () => {
		context('update single doc', () => {
			it('updates a single document', (done) => {
				request.put('/updateUponPaymentDelete')
					.set('Context-Type', 'application/json')
					.set('authorization', 'allow')
					.send({
						id: '820500000812_FPN',
						paymentStatus: 'UNPAID',
					})
					.expect(200)
					.end((err) => {
						if (err) throw err;
						done();
					});
			});
		});
		context('update multi docs', () => {
			it('updates multiple documents', async () => {
				let penaltyGroup = await getGroupById('46xu68x7o6c');
				expect(penaltyGroup.Item.PaymentStatus).toEqual('PAID');
				await new Promise((resolve, reject) => {
					request.put('/updateMultipleUponPaymentDelete')
						.set('Context-Type', 'application/json')
						.set('authorization', 'allow')
						.send({
							penaltyDocumentIds: ['820500000812_FPN', '820500000822_FPN'],
						})
						.expect(200)
						.end((err) => {
							if (err) {
								reject(err);
							} else {
								resolve();
							}
						});
				});
				penaltyGroup = await getGroupById('46xu68x7o6c');
				expect(penaltyGroup.Item.PaymentStatus).toEqual('UNPAID');
			});
		});
	});
});

function getGroupById(id) {
	const getParams = {
		Key: { ID: id },
		TableName: 'penaltyGroups',
	};
	return docClient.get(getParams).promise();
}
