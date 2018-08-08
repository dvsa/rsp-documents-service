/* eslint-disable no-use-before-define */

import expect from 'expect';
import sinon from 'sinon';
import { doc } from 'serverless-dynamodb-client';

import PenaltyGroupService from './penaltyGroups';

describe('PenaltyGroupService', () => {
	let penaltyGroupSvc;
	let dbQueryStub;
	let callbackSpy;

	beforeEach(() => {
		penaltyGroupSvc = new PenaltyGroupService(doc, 'penaltyDocuments', 'penaltyGroups');
	});

	describe('listPenaltyGroups', () => {
		let groups;
		const offset = 100;
		beforeEach(() => {
			dbQueryStub = sinon.stub(doc, 'query');
			callbackSpy = sinon.spy(() => ('callback result'));
			groups = [
				{
					ID: '1234567890a',
					offset: 101,
				},
				{
					ID: 'abcdefghij0',
					offset: 102,
				},
			];
		});
		afterEach(() => {
			doc.query.restore();
		});

		describe('when database call is successful', () => {
			beforeEach(() => {
				const batchSize = 2;
				penaltyGroupSvc.maxBatchSize = batchSize;
				whenDbCalledWithLimitAndOffset(dbQueryStub, batchSize, offset)
					.returns({
						promise: () => Promise.resolve({
							data: {
								Items: groups,
								Count: 2,
								ScannedCount: 2,
							},
						}),
					});
			});
			it('should respond 200 returning all data from the database response', async () => {
				const result = await penaltyGroupSvc.listPenaltyGroups(offset, callbackSpy);

				sinon.assert.calledWith(callbackSpy, null, sinon.match({
					statusCode: 200,
					body: JSON.stringify({ data: { Items: groups, Count: 2, ScannedCount: 2 } }),
				}));
				expect(result).toBe('callback result');
			});
		});

		describe('when database throws an error', () => {
			beforeEach(() => {
				const batchSize = 100;
				penaltyGroupSvc.maxBatchSize = batchSize;
				whenDbCalledWithLimitAndOffset(dbQueryStub, batchSize, offset)
					.throws({});
			});
			it('should return a 500 with the error', async () => {
				const result = await penaltyGroupSvc.listPenaltyGroups(offset, callbackSpy);

				sinon.assert.calledWith(callbackSpy, null, sinon.match({
					statusCode: 500,
					body: {},
				}));
				expect(result).toBe('callback result');
			});
		});
	});

	describe('delete', () => {
		context('when database returns enabled penalty group with document IDs', () => {
			let dbGetStub;
			let dbUpdateStub;
			beforeEach(() => {
				dbGetStub = sinon.stub(doc, 'get');
				dbGetStub.returns({
					promise: () => Promise.resolve({
						ID: 'abc123def45',
						Enabled: true,
						PenaltyDocumentIds: ['doc1', 'doc2'],
					}),
				});
				dbUpdateStub = sinon.stub(doc, 'update');
			});
			afterEach(() => {
				doc.get.restore();
				doc.update.restore();
			});
			xit('should set Enabled to be false for the group, followed by each document', async () => {
				await penaltyGroupSvc.delete();
				sinon.assert.callOrder(
					dbUpdateStub.withArgs(sinon.match({ TableName: 'penaltyGroups', Key: { ID: 'abc123def45' } })),
					dbUpdateStub.withArgs(sinon.match({ TableName: 'penaltyDocuments', Key: { ID: 'doc1' } })),
					dbUpdateStub.withArgs(sinon.match({ TableName: 'penaltyDocuments', Key: { ID: 'doc2' } })),
				);
			});
		});
	});
});

const whenDbCalledWithLimitAndOffset = (mockDb, limit, offset) => {
	return mockDb
		.withArgs({
			TableName: 'penaltyGroups',
			IndexName: 'ByOffset',
			Limit: limit,
			KeyConditionExpression: '#Origin = :Origin and #Offset > :Offset',
			ExpressionAttributeNames: { '#Offset': 'Offset', '#Origin': 'Origin' },
			ExpressionAttributeValues: { ':Offset': offset, ':Origin': 'APP' },
		});
};
