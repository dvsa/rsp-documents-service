/* eslint-disable no-use-before-define */

import expect from 'expect';
import sinon from 'sinon';
import _ from 'lodash';
import { doc } from 'serverless-dynamodb-client';

import PenaltyGroupService from './penaltyGroups';
import mockPenaltyGroupsData from '../../mock-data/fake-penalty-groups.json';
import mockPenaltiesData from '../../mock-data/fake-penalty-notice.json';

describe('PenaltyGroupService', () => {
	let penaltyGroupSvc;
	let mockDbQuery;
	let callbackSpy;

	beforeEach(() => {
		mockDbQuery = sinon.stub(doc, 'query');
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
				whenDbWithLimitAndOffset(mockDbQuery, batchSize, offset)
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
				whenDbWithLimitAndOffset(mockDbQuery, batchSize, offset)
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

	describe('updatePenaltyGroupWithPayment', () => {
		let mockPaymentInfo;
		let mockBatchWrite;
		let mockPut;
		let mockGetPenaltiesWithIds;
		let mockGetPenaltyGroupById;
		const mockPenaltyGroup = _.find(mockPenaltyGroupsData, ['ID', '46xu68x7o6b']);
		const mockPenalties = mockPenaltiesData.filter((p) => {
			return mockPenaltyGroup.PenaltyDocumentIds.includes(p.ID);
		});
		const expectedBatchWriteParams = getExpectedBatchParams(mockPenalties);
		const expectedPutParams = getExpectedPutParams(mockPenaltyGroup);
		beforeEach(() => {
			callbackSpy = sinon.spy(() => ('callback result'));
			mockPaymentInfo = {
				id: 'id',
				paymentStatus: 'UNPAID',
				penaltyType: 'FPN',
			};
			mockBatchWrite = sinon.stub(doc, 'batchWrite')
				.returns({
					promise: () => Promise.resolve('batchWrite resolved'),
				});
			mockPut = sinon.stub(doc, 'put')
				.returns({
					promise: () => Promise.resolve('put resolved'),
				});
			mockGetPenaltyGroupById = sinon.stub(penaltyGroupSvc, '_getPenaltyGroupById').callsFake(() => mockPenaltyGroup);
			mockGetPenaltiesWithIds = sinon.stub(penaltyGroupSvc, '_getPenaltiesWithIds').callsFake(() => mockPenalties);
		});

		it('call the correct methods when invoked and returns a success', async () => {
			await penaltyGroupSvc.updatePenaltyGroupWithPayment(
				mockPaymentInfo,
				callbackSpy,
			);
			expect(mockGetPenaltyGroupById.called).toBe(true);
			expect(mockGetPenaltiesWithIds.called).toBe(true);
			expect(mockPut.getCall(0).args[0]).toEqual(expectedPutParams);
			expect(mockBatchWrite.getCall(0).args[0]).toEqual(expectedBatchWriteParams);
			sinon.assert.calledWith(callbackSpy, null, sinon.match({
				statusCode: 200,
				body: JSON.stringify(mockPenaltyGroup),
			}));
		});
	});
});

const whenDbWithLimitAndOffset = (mockDbQuery, limit, offset) => {
	return mockDbQuery
		.withArgs({
			TableName: 'penaltyGroups',
			IndexName: 'ByOffset',
			Limit: limit,
			KeyConditionExpression: '#Origin = :Origin and #Offset > :Offset',
			ExpressionAttributeNames: { '#Offset': 'Offset', '#Origin': 'Origin' },
			ExpressionAttributeValues: { ':Offset': offset, ':Origin': 'APP' },
		});
};

function getExpectedBatchParams(mockPenalties) {
	return {
		RequestItems: {
			penaltyDocuments: [
				{
					PutRequest: {
						Item: mockPenalties[0],
					},
				},
				{
					PutRequest: {
						Item: mockPenalties[1],
					},
				},
			],
		},
	};
}

function getExpectedPutParams(penaltyGroup) {
	return {
		TableName: 'penaltyGroups',
		Item: penaltyGroup,
		ConditionExpression: 'attribute_exists(#ID)',
		ExpressionAttributeNames: {
			'#ID': 'ID',
		},
	};
}
