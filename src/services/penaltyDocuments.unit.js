import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import PenaltyDocumentsService from './penaltyDocuments';
import mockPenaltyGroupsData from '../../mock-data/fake-penalty-groups.json';
import mockPaymentsData from '../../mock-data/fake-penalty-payment.json';
import getMockPenalties from '../../mock-data/mock-penalty-notice';


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

	describe('getDocuments', () => {
		beforeEach(() => {
			const mockPenalties = getMockPenalties();
			sinon.stub(doc, 'query').returns({
				promise: () => Promise.resolve({
					Items: mockPenalties,
					Count: mockPenalties.length,
				}),
			});
		});

		afterEach(() => {
			doc.query.restore();
			penaltyDocumentsService.getPaymentInformationViaInvocation.restore();
		});

		context('when no payments are made', () => {
			beforeEach(() => {
				sinon.stub(penaltyDocumentsService, 'getPaymentInformationViaInvocation').callsFake(() => ({
					payments: [],
				}));
			});

			it('responds with OK status', async () => {
				const response = await penaltyDocumentsService.getDocuments(0);
				expect(response.statusCode).toBe(200);
			});
		});

		context('when a payment is made', () => {
			beforeEach(() => {
				sinon.stub(penaltyDocumentsService, 'getPaymentInformationViaInvocation').callsFake(() => ({
					payments: [
						mockPaymentsData.find(mockPayment => mockPayment.ID === '820500000877_FPN'),
					],
				}));
			});

			it('responds with payment info', async () => {
				const response = await penaltyDocumentsService.getDocuments(0);
				expect(response.statusCode).toBe(200);
				const body = JSON.parse(response.body);
				expect(body.Items.find(item => item.ID === '820500000877_FPN').Value.paymentStatus).toBe('PAID');
				expect(body.Items.find(item => item.ID === '820500000871_FPN').Value.paymentStatus).toBe('UNPAID');
			});
		});
	});

	describe('updateMultipleUponPaymentDelete', () => {
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
					Item: getMockPenalties().find(pen => pen.id === '820500000877_FPN'),
				}),
			});
			const mockPenaltyGroup = mockPenaltyGroupsData.find((group) => { return group.ID === '46xu68x7o6b'; });
			sinon.stub(penaltyDocumentsService, '_tryUpdatePenaltyGroupToUnpaidStatus').callsFake(() => mockPenaltyGroup);
			sinon.stub(penaltyDocumentsService, '_updateDocumentsToUnpaidStatus').callsFake(() => ['820500000877_FPN']);
			const response = await penaltyDocumentsService.updateMultipleUponPaymentDelete({ penaltyDocumentIds: ['820500000877_FPN'] });
			expect(response.statusCode).toBe(200);
		});
	});
});
