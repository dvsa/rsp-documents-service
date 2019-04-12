/* eslint-disable no-use-before-define */

import expect from 'expect';
import sinon from 'sinon';
import _ from 'lodash';
import { doc } from 'serverless-dynamodb-client';

import PenaltyGroupService from './penaltyGroups';
import mockPenaltyGroupsData from '../../mock-data/fake-penalty-groups.json';
import mockPenaltiesData from '../../mock-data/fake-penalty-notice.json';
import mockCreatePenaltyGroupData from '../../mock-data/fake-create-penalty-group.json';

describe('PenaltyGroupService', () => {
	let penaltyGroupSvc;
	let mockDbQuery;

	beforeEach(() => {
		mockDbQuery = sinon.stub(doc, 'query');
		penaltyGroupSvc = new PenaltyGroupService(doc, 'penaltyDocuments', 'penaltyGroups', process.env.SNSTOPICARN);
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
				const result = await penaltyGroupSvc.listPenaltyGroups(offset);

				expect(result.statusCode).toBe(200);
				expect(result.body).toBe(JSON.stringify({
					data: { Items: groups, Count: 2, ScannedCount: 2 },
				}));
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
				const result = await penaltyGroupSvc.listPenaltyGroups(offset);

				expect(result.statusCode).toBe(500);
				expect(result.body).toBe('{}');
			});
		});
	});

	describe('delete', () => {
		let dbGetStub;
		let dbBatchGetStub;
		let dbUpdateStub;

		beforeEach(() => {
			dbGetStub = sinon.stub(doc, 'get');
			dbBatchGetStub = sinon.stub(doc, 'batchGet');
			dbUpdateStub = sinon.stub(doc, 'update');
		});
		afterEach(() => {
			doc.get.restore();
			doc.batchGet.restore();
			doc.update.restore();
		});

		context('when database returns enabled penalty group with document IDs', () => {
			beforeEach(() => {
				dbGetStub.returns({
					promise: () => Promise.resolve({
						Item: {
							ID: 'abc123def45',
							Enabled: true,
							PenaltyDocumentIds: ['doc1', 'doc2'],
						},
					}),
				});
				dbBatchGetStub.returns({
					promise: () => Promise.resolve({
						Responses: {
							penaltyDocuments: [
								{
									ID: 'doc1',
									Value: {},
								},
								{
									ID: 'doc2',
									Value: {},
								},
							],
						},
					}),
				});
				dbUpdateStub.returns({
					promise: () => Promise.resolve(),
				});
			});

			it('should set Enabled to be false for the group, followed by each document', async () => {
				const response = await penaltyGroupSvc.delete('abc123def45');
				sinon.assert.callOrder(
					dbUpdateStub.withArgs(sinon.match({ TableName: 'penaltyGroups', Key: { ID: 'abc123def45' } })),
					dbUpdateStub.withArgs(sinon.match({ TableName: 'penaltyDocuments', Key: { ID: 'doc1' } })),
					dbUpdateStub.withArgs(sinon.match({ TableName: 'penaltyDocuments', Key: { ID: 'doc2' } })),
				);
				expect(response.statusCode).toBe(204);
			});
		});

		context('when database request rejects', () => {
			beforeEach(() => {
				dbGetStub.returns({
					promise: () => Promise.reject(new Error('error')),
				});
			});

			it('should respond with status 400 including the error', async () => {
				const response = await penaltyGroupSvc.delete('abc123def45');
				expect(response.statusCode).toBe(400);
				expect(response.body).toContain('error');
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

		afterEach(() => {
			mockBatchWrite.restore();
			mockPut.restore();
			mockGetPenaltyGroupById.restore();
			mockGetPenaltiesWithIds.restore();
		});

		it('call the correct methods when invoked and returns a success', async () => {
			const response = await penaltyGroupSvc.updatePenaltyGroupWithPayment(mockPaymentInfo);
			expect(mockGetPenaltyGroupById.called).toBe(true);
			expect(mockGetPenaltiesWithIds.called).toBe(true);
			expect(mockPut.getCall(0).args[0]).toEqual(expectedPutParams);
			expect(mockBatchWrite.getCall(0).args[0]).toEqual(expectedBatchWriteParams);
			expect(response.statusCode).toBe(200);
			expect(response.body).toBe(JSON.stringify(mockPenaltyGroup));
		});
	});

	describe('createPenaltyGroup', () => {
		let penaltyGroup;
		let mockBatchWrite;

		beforeEach(() => {
			penaltyGroup = JSON.parse(JSON.stringify(mockCreatePenaltyGroupData));
			mockBatchWrite = sinon.stub(doc, 'batchWrite')
				.returns({
					promise: () => Promise.resolve('batchWrite resolved'),
				});
		});

		afterEach(() => {
			mockBatchWrite.restore();
		});

		it('responds with correct response when group successfully created', async () => {
			sinon.stub(penaltyGroupSvc, '_getPenaltyDocumentsWithIds').callsFake(() => []);
			const response = await penaltyGroupSvc.createPenaltyGroup(penaltyGroup);
			expect(response.statusCode).toBe(201);
		});

		it('responds with error code when payload fails validation', async () => {
			penaltyGroup.SiteCode = 'invalid';
			const response = await penaltyGroupSvc.createPenaltyGroup(penaltyGroup);
			expect(response.statusCode).toBe(400);
			expect(JSON.parse(response.body).errCode).toBe('GroupValidation');
		});

		it('responds with correct error response when a reference already exists', async () => {
			sinon.stub(penaltyGroupSvc, '_getPenaltyDocumentsWithIds').callsFake(ids => ids.map(id => ({
				ID: id,
				Enabled: true,
			})));
			const response = await penaltyGroupSvc.createPenaltyGroup(penaltyGroup);
			const responseBody = JSON.parse(response.body);
			expect(response.statusCode).toBe(400);
			expect(responseBody.errCode).toBe('GroupDuplicateReference');
			expect(responseBody.errMessage).toBe('One or more penalties already exist with the supplied reference codes');
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
