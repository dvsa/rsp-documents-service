import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import mockPenaltyDocumentsService from './service.unit';
import getMockPenalties from '../../../mock-data/mock-penalty-notice';
import mockPaymentsData from '../../../mock-data/fake-penalty-payment.json';


describe('getDocuments', () => {
	let penaltyDocuments;

	beforeEach(() => {
		penaltyDocuments = mockPenaltyDocumentsService(doc);
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
		penaltyDocuments.getPaymentInformationViaInvocation.restore();
	});

	context('when no payments are made', () => {
		beforeEach(() => {
			sinon.stub(penaltyDocuments, 'getPaymentInformationViaInvocation').callsFake(() => ({
				payments: [],
			}));
		});

		it('responds with OK status', async () => {
			const response = await penaltyDocuments.getDocuments(0);
			expect(response.statusCode).toBe(200);
		});
	});

	context('when a payment is made', () => {
		beforeEach(() => {
			sinon.stub(penaltyDocuments, 'getPaymentInformationViaInvocation').callsFake(() => ({
				payments: [
					mockPaymentsData.find(mockPayment => mockPayment.ID === '820500000877_FPN'),
				],
			}));
		});

		it('responds with payment info', async () => {
			const response = await penaltyDocuments.getDocuments(0);
			expect(response.statusCode).toBe(200);
			const body = JSON.parse(response.body);
			expect(body.Items.find(item => item.ID === '820500000877_FPN').Value.paymentStatus).toBe('PAID');
			expect(body.Items.find(item => item.ID === '820500000871_FPN').Value.paymentStatus).toBe('UNPAID');
		});
	});
});
