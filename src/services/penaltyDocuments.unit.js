// @ts-check
import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import PenaltyDocumentsService from './penaltyDocuments';
import hashToken from '../utils/hash';
import getUnixTime from '../utils/time';
// @ts-ignore
import mockPenaltyGroupsData from '../../mock-data/fake-penalty-groups.json';
// @ts-ignore
import mockPenaltiesData from '../../mock-data/fake-penalty-notice.json';


describe('PenaltyDocuments service', () => {
	/**
	 * @type PenaltyDocumentsService
	 */
	let penaltyDocumentsService;
	let callbackSpy;

	beforeEach(() => {
		penaltyDocumentsService = new PenaltyDocumentsService(doc, 'penaltyDocuments', '', '', '', '', '', 3, '');
		callbackSpy = sinon.spy();
		sinon.stub(doc, 'put')
			.returns({
				promise: () => Promise.resolve('put resolved'),
			});
	});
	afterEach(() => {
		// @ts-ignore
		doc.get.restore();
		// @ts-ignore
		doc.put.restore();
		callbackSpy.resetHistory();
	});

	describe('updateDocumentsUponPaymentDelete', () => {
		it('calls back with OK status', async () => {
			/**
			 * Mock for db.get in updateDocumentUponPaymentDelete.
			 * _tryUpdatePenaltyGroupToUnpaidStatus is stubbed so will not be called.
			 */
			sinon.stub(doc, 'get').returns({
				promise: () => Promise.resolve({
					Item: {
						Value: {},
						ID: 'abc123def45',
						Enabled: true,
						penaltyGroupId: 'groupIdPen',
						inPenaltyGroup: true,
					},
				}),
			});
			const mockPenaltyGroup = mockPenaltyGroupsData.find((group) => { return group.ID === '46xu68x7o6b'; });
			sinon.stub(penaltyDocumentsService, '_tryUpdatePenaltyGroupToUnpaidStatus').callsFake(() => mockPenaltyGroup);
			sinon.stub(penaltyDocumentsService, '_updateDocumentsToUnpaidStatus').callsFake(() => ['abcdefg123']);
			await penaltyDocumentsService.updateDocumentsUponPaymentDelete({ penaltyDocumentIds: ['abcdefg123'] }, callbackSpy);
			sinon.assert.calledWith(callbackSpy, null, sinon.match({
				statusCode: 200,
			}));
		});
	});

	describe('_tryUpdatePenaltyGroupToUnpaidStatus', () => {
		let mockPenaltyGroup;
		let mockPenaltyDocument;

		beforeEach(() => {
			mockPenaltyGroup = mockPenaltyGroupsData.find((group) => { return group.ID === '46xu68x7o6b'; });
			mockPenaltyGroup.PaymentStatus = 'PAID';
			sinon.stub(doc, 'get').returns({
				promise: () => Promise.resolve({
					Item: mockPenaltyGroup,
				}),
			});

			mockPenaltyDocument = mockPenaltiesData.find((penalty) => {
				return penalty.penaltyGroupId === mockPenaltyGroup.ID;
			});
			mockPenaltyDocument.Hash = hashToken('46xu68x7o6b', mockPenaltyDocument.Value, mockPenaltyDocument.Enabled);
			mockPenaltyDocument.Offset = getUnixTime();
		});

		it("doesn't update when the new payment status is paid", async () => {
			// eslint-disable-next-line no-underscore-dangle
			const promiseResponse = await penaltyDocumentsService._tryUpdatePenaltyGroupToUnpaidStatus(mockPenaltyDocument, 'PAID');
			expect(promiseResponse).toBeUndefined();
		});

		it('updates group with unpaid status when initial status is paid', async () => {
			// eslint-disable-next-line no-underscore-dangle
			const promiseResponse = await penaltyDocumentsService._tryUpdatePenaltyGroupToUnpaidStatus(mockPenaltyDocument, 'UNPAID');
			expect(promiseResponse).toBeDefined();
		});
	});
});
