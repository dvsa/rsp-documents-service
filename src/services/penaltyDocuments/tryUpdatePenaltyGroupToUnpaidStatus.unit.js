import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import mockPenaltyDocumentsService from './service.unit';
import hashToken from '../../utils/hash';
import getUnixTime from '../../utils/time';
import getMockPenalties from '../../../mock-data/mock-penalty-notice';
import mockPenaltyGroupsData from '../../../mock-data/fake-penalty-groups.json';


describe('_tryUpdatePenaltyGroupToUnpaidStatus', () => {
	let mockPenaltyGroup;
	let mockPenaltyDocument;
	let penaltyDocuments;

	beforeEach(() => {
		penaltyDocuments = mockPenaltyDocumentsService(doc);
		mockPenaltyGroup = mockPenaltyGroupsData.find((group) => { return group.ID === '46xu68x7o6b'; });
		mockPenaltyGroup.PaymentStatus = 'PAID';
		sinon.stub(doc, 'get').returns({
			promise: () => Promise.resolve({
				Item: mockPenaltyGroup,
			}),
		});
		sinon.stub(doc, 'put')
			.returns({
				promise: () => Promise.resolve('put resolved'),
			});

		mockPenaltyDocument = getMockPenalties().find((penalty) => {
			return penalty.penaltyGroupId === mockPenaltyGroup.ID;
		});
		mockPenaltyDocument.Hash = hashToken('46xu68x7o6b', mockPenaltyDocument.Value, mockPenaltyDocument.Enabled);
		mockPenaltyDocument.Offset = getUnixTime();
	});

	afterEach(() => {
		doc.get.restore();
		doc.put.restore();
	});

	it("doesn't update when the new payment status is paid", async () => {
		// eslint-disable-next-line no-underscore-dangle
		const promiseResponse = await penaltyDocuments._tryUpdatePenaltyGroupToUnpaidStatus(mockPenaltyDocument, 'PAID');
		expect(promiseResponse).toBeUndefined();
	});

	it('updates group with unpaid status when initial status is paid', async () => {
		// eslint-disable-next-line no-underscore-dangle
		const promiseResponse = await penaltyDocuments._tryUpdatePenaltyGroupToUnpaidStatus(mockPenaltyDocument, 'UNPAID');
		expect(promiseResponse).toBeDefined();
	});
});
