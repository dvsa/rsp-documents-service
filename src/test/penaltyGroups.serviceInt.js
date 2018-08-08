/* eslint-disable no-use-before-define */

import supertest from 'supertest';
import expect from 'expect';
import AWS from 'aws-sdk';
import _ from 'lodash';

const url = 'http://localhost:3000/penaltyGroup';
const request = supertest(url);
const groupId = '46xu68x7o6b';

describe('penaltyGroups', () => {

	before(() => {
		AWS.config.update({
			region: 'eu-west-1',
			endpoint: 'http://localhost:8000',
		});
	});

	context('GET', () => {
		context('an individual penalty group', () => {
			it('should return all penalty groups', (done) => {
				request
					.get(`/${groupId}`)
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.ID).toEqual(groupId);
						expect(res.body.Timestamp).toBe(15329454.234729);
						expect(res.body.VehicleRegistration).toBe('11 ABC');
						expect(res.body.Location).toBe('Trowell Services');
						expect(res.body.Payments).toHaveLength(1);
						expect(res.body.Payments[0].PaymentCategory).toBe('FPN');
						expect(res.body.Payments[0].PaymentStatus).toBe('UNPAID');
						expect(res.body.Payments[0].TotalAmount).toBe(130);
						expect(res.body.Payments[0].Penalties).toHaveLength(2);
						expect(res.body.Payments[0].Penalties[0].ID).toBe('820500000877_FPN');
						expect(res.body.Payments[0].Penalties[0].Value).toBeDefined();
						expect(res.body.Payments[0].Penalties[1].ID).toBe('820500000878_FPN');
						expect(res.body.Payments[0].Penalties[1].Value).toBeDefined();
						expect(res.body.PenaltyDocumentIds).toBeUndefined();
						expect(res.body.IsEnabled).toBe(true);
						done();
					});
			});
		});
		context('a batch of penalty groups after an offset', async () => {
			let penaltyGroupIds;
			let startOffset;
			before(async () => {
				startOffset = Date.now() / 1000;
				penaltyGroupIds = await insertNPenaltyGroupsIncrementingFromOffset(76, startOffset);
			});
			after(async () => {
				await removePenaltyGroupsById(penaltyGroupIds);
			});
			it('should return the batch size with LastEvaluatedKey until the last batch', async () => {
				const batch1 = await request
					.get('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.query({ Offset: startOffset - 1 })
					.expect(200);
				expect(batch1.body.LastEvaluatedKey.Offset).toBeDefined();
				expect(batch1.body.Items).toHaveLength(75);

				const lastEvaluatedOffset = batch1.body.LastEvaluatedKey.Offset;

				const batch2 = await request
					.get('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.query({ Offset: lastEvaluatedOffset })
					.expect(200);
				expect(batch2.body.LastEvaluatedKey).toBeUndefined();
				expect(batch2.body.Items).toHaveLength(1);
			});
		});
	});

	context('POST', () => {
		context('a new penalty group', () => {
			it('should return created penalty group with generated ID', (done) => {
				const fakePenaltyGroupPayload = {
					Timestamp: 1532945465.234729,
					SiteCode: -72,
					Location: 'Trowell Services',
					VehicleRegistration: '11 ABC',
					Penalties: [
						{
							ID: 'p1',
							Hash: 'somehash',
							Enabled: true,
							Value: {
								penaltyType: 'FPN',
								inPenaltyGroup: true,
								penaltyAmount: 150,
								paymentToken: '1234abcdef',
								referenceNo: '12345678',
								vehicleDetails: {
									regNo: 'AA123',
								},
								officerName: 'Joe Bloggs',
								officerID: 'XYZ',
								dateTime: 1532000305,
								siteCode: 3,
							},
						},
						{
							ID: 'p2',
							Hash: 'somehash',
							Enabled: true,
							Value: {
								penaltyType: 'IM',
								inPenaltyGroup: true,
								penaltyAmount: 80,
								paymentToken: '1234abcdef',
								referenceNo: '87654321',
								vehicleDetails: {
									regNo: 'BB123',
								},
								officerName: 'Joe Bloggs',
								officerID: 'XYZ',
								dateTime: 1532000305,
								siteCode: 3,
							},
						},
					],
				};
				request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(fakePenaltyGroupPayload)
					.expect(201)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.ID).toBe('46xu68x7wps');
						expect(res.body.Origin).toEqual('APP');
						expect(res.body.Timestamp).toBe(1532945465.234729);
						expect(res.body.Offset).toBeCloseTo(Date.now() / 1000, 1);
						expect(res.body.Location).toBe('Trowell Services');
						expect(res.body.VehicleRegistration).toBe('11 ABC');
						expect(res.body.TotalAmount).toBe(230);
						expect(res.body.PaymentStatus).toBe('UNPAID');
						expect(res.body.Penalties).toHaveLength(2);
						expect(res.body.Penalties[0].inPenaltyGroup).toBe(true);
						expect(res.body.Penalties[1].inPenaltyGroup).toBe(true);
						expect(res.body.PenaltyGroupIds).toBeUndefined();
						expect(res.body.IsEnabled).toBe(true);
						done();
					});
			});
		});
	});

});

async function insertNPenaltyGroupsIncrementingFromOffset(groupCount, startOffset) {
	const putRequests = Array.from({ length: groupCount }, (v, k) => (
		{
			PutRequest: {
				Item: {
					ID: `test${k + 1}`,
					Offset: startOffset + k,
					Origin: 'APP',
				},
			},
		}
	));
	const docClient = new AWS.DynamoDB.DocumentClient();
	const batchPutRequests = _.chunk(putRequests, 25);
	try {
		const putPromises = batchPutRequests.map((p) => {
			const params = {
				RequestItems: {
					penaltyGroups: p,
				},
			};
			return docClient.batchWrite(params).promise();
		});
		await Promise.all(putPromises);
	} catch (error) {
		console.log(`Error inserting penalty groups :${error}`);
	}
	return putRequests.map(r => String(r.PutRequest.Item.ID));
}

async function removePenaltyGroupsById(ids) {
	const docClient = new AWS.DynamoDB.DocumentClient();
	const deletePromises = ids.map((id) => {
		const params = {
			Key: {
				ID: id,
			},
			TableName: 'penaltyGroups',
		};
		return docClient.delete(params).promise();
	});
	try {
		await Promise.all(deletePromises);
	} catch (error) {
		console.log(`Error cleaning up penalty groups ${error}`);
	}
}
