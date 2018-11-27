import supertest from 'supertest';
import AWS from 'aws-sdk';
import expect from 'expect';


const url = 'http://localhost:3000/documents';
const request = supertest(url);
let docClient;

describe('payment deletion reflection', () => {
	before(() => {
		AWS.config.update({
			region: 'eu-west-1',
			endpoint: 'http://localhost:8000',
		});
		docClient = new AWS.DynamoDB.DocumentClient();
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
				let penaltyGroup = await getGroupById('46xu68x7o6b');
				expect(penaltyGroup.Item.PaymentStatus).toEqual('PAID');
				await new Promise((resolve, reject) => {
					request.put('/updateMultipleUponPaymentDelete')
						.set('Context-Type', 'application/json')
						.set('authorization', 'allow')
						.send({
							penaltyDocumentIds: ['820500000878_FPN', '820500000877_FPN'],
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
				penaltyGroup = await getGroupById('46xu68x7o6b');
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
