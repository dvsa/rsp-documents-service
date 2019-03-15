import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import PenaltyDocumentsService from './penaltyDocuments';
import hashToken from '../utils/hash';
import getUnixTime from '../utils/time';
import mockPenaltyGroupsData from '../../mock-data/fake-penalty-groups.json';
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
		doc.put.restore();
		callbackSpy.resetHistory();
	});

	describe('updateDocumentsUponPaymentDelete', () => {
		after(() => {
			doc.get.restore();
		});

		it('calls back with OK status', async () => {
			/**
			 * Mock for db.get in updateDocumentUponPaymentDelete.
			 * _tryUpdatePenaltyGroupToUnpaidStatus is stubbed so will not be called.
			 */
			sinon.stub(doc, 'get').returns({
				promise: () => Promise.resolve({
					Item: mockPenaltiesData.find(pen => pen.id === '820500000877_FPN'),
				}),
			});
			const mockPenaltyGroup = mockPenaltyGroupsData.find((group) => { return group.ID === '46xu68x7o6b'; });
			sinon.stub(penaltyDocumentsService, '_tryUpdatePenaltyGroupToUnpaidStatus').callsFake(() => mockPenaltyGroup);
			sinon.stub(penaltyDocumentsService, '_updateDocumentsToUnpaidStatus').callsFake(() => ['820500000877_FPN']);
			await penaltyDocumentsService.updateMultipleUponPaymentDelete({ penaltyDocumentIds: ['820500000877_FPN'] }, callbackSpy);
			sinon.assert.calledWith(callbackSpy, null, sinon.match({
				statusCode: 200,
			}));
		});
	});

	describe('updateDocumentWithReceipt', () => {
		const receiptReference = 'ECMS-1456231-AC13512';
		let mockPenalty;
		before(() => {
			mockPenalty = Object.assign({}, mockPenaltiesData[0]);
			mockPenalty.PendingTransactions = [{
				ReceiptReference: receiptReference,
				PenaltyType: 'IM',
				ReceiptTimestamp: 13959881123.123,
			}];
			sinon.stub(doc, 'update').returns({
				promise: () => Promise.resolve(mockPenalty),
			});
		});

		after(() => {
			doc.update.restore();
		});

		it('calls the correct methods when invoked and returns a success', async () => {
			await penaltyDocumentsService.updateDocumentWithReceipt(
				mockPenalty.ID,
				receiptReference,
				{},
				callbackSpy,
			);
			sinon.assert.calledWith(callbackSpy, null, sinon.match({
				statusCode: 200,
				body: JSON.stringify(mockPenalty),
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

		afterEach(() => {
			doc.get.restore();
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

	describe('streamDocuments', () => {
		let event;

		beforeEach(() => {
			event = {
				Records: [
					{
						dynamodb: {
							newImage: mockPenaltiesData[0],
						},
					},
					{
						dynamodb: {
							newImage: mockPenaltiesData[1],
						},
					},
				],
			};
		});

		context('when streamDocuments is called with multiple documents', () => {
			let snsStub;
			beforeEach(() => {
				snsStub = sinon.stub(penaltyDocumentsService, 'sendSnsMessage').callsFake(() => Promise.resolve());
			});

			afterEach(() => {
				snsStub.restore();
			});

			it('calls back with the number of records processed', async () => {
				await penaltyDocumentsService.streamDocuments(event, null, callbackSpy);
				sinon.assert.calledWith(callbackSpy, null, sinon.match('Successfully processed 2 records.'));
			});
		});

		context('when SNS throws an error', () => {
			let snsStub;
			const snsError = 'SNS error message';

			beforeEach(() => {
				snsStub = sinon.stub(penaltyDocumentsService, 'sendSnsMessage').callsFake(() => Promise.reject(snsError));
			});

			afterEach(() => {
				snsStub.restore();
			});

			it('calls back with an error message', async () => {
				await penaltyDocumentsService.streamDocuments(event, null, callbackSpy);
				const errorMessage = `Unable to send message. Error JSON: ${JSON.stringify(snsError, null, 2)}`;
				sinon.assert.calledWith(callbackSpy, sinon.match(errorMessage));
			});
		});
	});
});
