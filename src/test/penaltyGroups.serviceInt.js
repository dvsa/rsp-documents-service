/* eslint-disable no-use-before-define */

import supertest from 'supertest';
import expect from 'expect';
import AWS from 'aws-sdk';
import _ from 'lodash';
import testPenaltyGroupCreationPayload from './data/testPenaltyGroupCreationPayload';

const url = 'http://localhost:3000/penaltyGroup';
const request = supertest(url);
const groupId = '46xu68x7o6b';
const disabledGroupId = '87xu68s7o6c';
let docClient;

describe('penaltyGroups', () => {

	before(() => {
		AWS.config.update({
			region: 'eu-west-1',
			endpoint: 'http://localhost:8000',
		});
		docClient = new AWS.DynamoDB.DocumentClient();
		extendJestWithUnixSeconds();
	});

	context('GET', () => {
		context('an individual penalty group', () => {
			it('should return a penalty group by ID', (done) => {
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
						expect(res.body.VehicleRegistration).toBe('11 ABC, PL09 XMN');
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
						expect(res.body.Hash).toBe('abc123');
						expect(res.body.PenaltyDocumentIds).toBeUndefined();
						expect(res.body.Enabled).toBe(true);
						done();
					});
			});
			it('should respond 200 even when the penalty group is disabled', (done) => {
				request
					.get(`/${disabledGroupId}`)
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.expect(200)
					.expect('Content-Type', 'application/json')
					.end((err) => {
						if (err) throw err;
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
				request
					.post('/')
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.send(testPenaltyGroupCreationPayload.penaltyGroupPayload)
					.expect(201)
					.expect('Content-Type', 'application/json')
					.end((err, res) => {
						if (err) throw err;
						expect(res.body.ID).toBe('46xu68x7wps');
						expect(res.body.Origin).toEqual('APP');
						expect(res.body.Timestamp).toBe(1532945465.234729);
						expect(res.body.Offset).toBeCloseTo(Date.now() / 1000, 1);
						expect(res.body.Location).toBe('Trowell Services');
						expect(res.body.VehicleRegistration).toBe('11ABC');
						expect(res.body.TotalAmount).toBe(230);
						expect(res.body.PaymentStatus).toBe('UNPAID');
						expect(res.body.Penalties).toHaveLength(2);
						expect(res.body.Penalties[0].inPenaltyGroup).toBe(true);
						expect(res.body.Penalties[1].inPenaltyGroup).toBe(true);
						expect(res.body.Penalties[0].penaltyGroupId).toBe('46xu68x7wps');
						expect(res.body.Penalties[1].penaltyGroupId).toBe('46xu68x7wps');
						expect(res.body.PenaltyGroupIds).toBeUndefined();
						expect(res.body.Enabled).toBe(true);
						expect(res.body.Hash).toBeDefined();
						done();
					});
			});
			after(() => {
				removePenaltyGroupsById(['46xu68x7wps']);
				removePenaltyDocumentsById(['987654321012_FPN', '987654321555_FPN']);
			});
		});
		context('a new penalty group containing an already existing reference', () => {
			const clashingId = '987654321012_FPN';
			const nonClashingId = '987654321123_FPN';
			beforeEach(async () => {
				await insertSinglePenaltyWithId(clashingId);
			});
			afterEach(async () => {
				await removeSinglePenaltyWithId(clashingId);
			});
			it('should respond 400 indicating that there was a clash', async () => {
				const response = await request
					.post('/')
					.send(testPenaltyGroupCreationPayload.penaltyGroupPayload)
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.expect('Content-Type', 'application/json')
					.expect(400);

				expect(JSON.parse(response.text)).toBe('Bad request: There were clashing IDs (987654321012_FPN)');
				await assertPenaltyDocumentDoesntExist(nonClashingId);
			});
		});
	});

	context('DELETE', () => {
		context('when DELETE called against penalty group of ID', () => {
			let testPenaltyGroupId;
			let testDocIds;
			beforeEach(async () => {
				const { id, docIds } = await insertDeletionTestPenaltyGroup();
				testPenaltyGroupId = id;
				testDocIds = docIds;
			});
			afterEach(async () => {
				await removeDeleteTestPenaltyGroup(testPenaltyGroupId, testDocIds);
			});

			it('should mark the penalty group and all its documents as disabled and return 204', async () => {
				await request
					.delete(`/${testPenaltyGroupId}`)
					.set('Content-Type', 'application/json')
					.set('Authorization', 'allow')
					.expect('Content-Type', 'application/json')
					.expect(204);

				await assertPenaltyGroupDisabled(testPenaltyGroupId);
				await assertPenaltyDocumentsDisabled(testDocIds);
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

async function removePenaltyDocumentsById(ids) {
	const deletePromises = ids.map((id) => {
		const params = {
			Key: {
				ID: id,
			},
			TableName: 'penaltyDocuments',
		};
		return docClient.delete(params).promise();
	});
	try {
		await Promise.all(deletePromises);
	} catch (error) {
		console.log(`Error cleaning up penalty documents ${error}`);
	}
}

async function insertDeletionTestPenaltyGroup() {
	const docIds = ['deleteintegdoc01', 'deleteintegdoc02', 'deleteintegdoc03'];
	const groupPutRequest = {
		PutRequest: {
			Item: {
				ID: 'deleteinteg',
				Offset: Date.now(),
				Origin: 'APP',
				PenaltyDocumentIds: docIds,
				Enabled: true,
			},
		},
	};
	const documentPutRequests = docIds.map(id => ({
		PutRequest: {
			Item: {
				ID: id,
				Enabled: true,
				Hash: 'original-hash',
				Value: {},
			},
		},
	}));
	const params = {
		RequestItems: {
			penaltyGroups: [groupPutRequest],
			penaltyDocuments: documentPutRequests,
		},
	};

	await docClient.batchWrite(params).promise();

	return { id: 'deleteinteg', docIds };
}

async function removeDeleteTestPenaltyGroup(penaltyGroupId, penaltyDocumentIds) {
	await removePenaltyGroupsById([penaltyGroupId]);
	await removePenaltyDocumentsById(penaltyDocumentIds);
}

async function assertPenaltyGroupDisabled(penaltyGroupId) {
	const penaltyGroup = await docClient.get({
		TableName: 'penaltyGroups',
		Key: {
			ID: penaltyGroupId,
		},
	}).promise();

	expect(penaltyGroup.Item.Enabled).toBe(false);
	expect(penaltyGroup.Item.Offset).toBeWithinNUnixSeconds(Date.now() / 1000, 1);
}

async function assertPenaltyDocumentsDisabled(documentIds) {
	documentIds.forEach(async (id) => {
		const document = await docClient.get({
			TableName: 'penaltyDocuments',
			Key: {
				ID: id,
			},
		}).promise();
		expect(document.Item.Enabled).toBe(false);
		expect(document.Item.Offset).toBeWithinNUnixSeconds(Date.now() / 1000, 1);
		expect(document.Item.Hash).not.toBe('original-hash');
	});
}

async function insertSinglePenaltyWithId(id) {
	const putRequest = {
		TableName: 'penaltyDocuments',
		Item: {
			ID: id,
			Enabled: true,
			Hash: 'original-hash',
			Value: {},
		},
	};
	return docClient.put(putRequest).promise();
}

async function removeSinglePenaltyWithId(id) {
	const deleteRequest = {
		TableName: 'penaltyDocuments',
		Key: {
			ID: id,
		},
	};
	return docClient.delete(deleteRequest).promise();
}

async function assertPenaltyDocumentDoesntExist(id) {
	const getRequest = {
		TableName: 'penaltyDocuments',
		Key: {
			ID: id,
		},
	};
	const getResult = await docClient.get(getRequest).promise();
	expect(getResult).toMatchObject({});
}

function extendJestWithUnixSeconds() {
	expect.extend({
		toBeWithinNUnixSeconds(received, argument, n) {
			const pass = (Math.abs(received - argument) < n);
			if (pass) {
				return {
					pass: true,
					message: () => `expected ${received} not to be within ${n} unix seconds of ${argument}`,
				};
			}
			return {
				pass: false,
				message: () => `expected ${received} to be within ${n} unix seconds of ${argument}`,
			};
		},
	});
}
