import expect from 'expect';
import Validation from 'rsp-validation';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import PenaltyDocumentsService from './penaltyDocuments';
import hashToken from '../utils/hash';
import getUnixTime from '../utils/time';
import mockPenaltyGroupsData from '../../mock-data/fake-penalty-groups.json';
import mockPenaltiesData from '../../mock-data/fake-penalty-notice.json';
import mockUpdatePenaltyData from '../../mock-data/fake-update-pen.json';


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

	describe('updateDocumentWithPayment', () => {
		let createDocumentStub;
		beforeEach(() => {
			sinon.stub(doc, 'get').returns({
				// No existing penalty document
				promise: () => Promise.resolve({}),
			});
			createDocumentStub = sinon.stub(penaltyDocumentsService, 'createDocument').callsFake((penaltyDoc, callback) => {
				callback(null, { statusCode: 200 });
			});
		});

		afterEach(() => {
			doc.get.restore();
			createDocumentStub.restore();
		});

		it('calls back with OK status', async () => {
			const paymentInfo = mockUpdatePenaltyData.body;
			await penaltyDocumentsService.updateDocumentWithPayment(paymentInfo, callbackSpy);

			// validate input createDocument is correct without testing internals
			const createDocumentParams = createDocumentStub.firstCall.args[0];
			const validation = Validation.penaltyDocumentValidation(createDocumentParams);
			expect(validation.valid).toBe(true);

			sinon.assert.calledWith(callbackSpy, null, sinon.match({
				statusCode: 200,
			}));
		});
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
