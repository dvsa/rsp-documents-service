/* eslint-disable no-use-before-define */

import expect from 'expect';
import sinon from 'sinon';
import { doc } from 'serverless-dynamodb-client';

import PenaltyGroupService from './penaltyGroups';

describe('PenaltyGroupService', () => {
	let penaltyGroupSvc;
	let mockDb;
	let callbackSpy;

	beforeEach(() => {
		mockDb = sinon.stub(doc, 'query');
		callbackSpy = sinon.spy(() => ('callback result'));
		penaltyGroupSvc = new PenaltyGroupService(doc, 'penaltyDocuments', 'penaltyGroups');
	});

	afterEach(() => {
		doc.query.restore();
	});

	describe('listPenaltyGroups', () => {
		let groups;
		const offset = 100;
		beforeEach(() => {
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
		describe('when database call is successful', () => {
			beforeEach(() => {
				const batchSize = 2;
				penaltyGroupSvc.maxBatchSize = batchSize;
				whenDbWithLimitAndOffset(mockDb, batchSize, offset)
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
				whenDbWithLimitAndOffset(mockDb, batchSize, offset)
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
});

const whenDbWithLimitAndOffset = (mockDb, limit, offset) => {
	return mockDb
		.withArgs({
			TableName: 'penaltyGroups',
			IndexName: 'ByOffset',
			Limit: limit,
			KeyConditionExpression: '#Origin = :Origin and #Offset >= :Offset',
			ExpressionAttributeNames: { '#Offset': 'Offset', '#Origin': 'Origin' },
			ExpressionAttributeValues: { ':Offset': offset, ':Origin': 'APP' },
		});
};
