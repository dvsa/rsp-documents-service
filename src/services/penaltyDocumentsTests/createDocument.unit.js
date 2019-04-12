import sinon from 'sinon';
import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import mockPenaltyDocumentsService from './service.unit';
import getMockPenalties from '../../../mock-data/mock-penalty-notice';


describe('createDocument', () => {
	context('when a document is created', () => {
		let penaltyDocuments = mockPenaltyDocumentsService(doc);
		let dbPut;

		beforeEach(() => {
			dbPut = sinon.stub(doc, 'put').returns({
				promise: () => (Promise.resolve()),
			});
			penaltyDocuments = mockPenaltyDocumentsService(doc);
		});

		afterEach(() => {
			doc.put.restore();
		});

		context('when a payment does not exist for the penalty', () => {
			beforeEach(() => {
				sinon.stub(penaltyDocuments, 'getPaymentInformationViaInvocation').returns(Promise.resolve({
					payments: [],
				}));
			});

			afterEach(() => {
				penaltyDocuments.getPaymentInformationViaInvocation.restore();
			});

			it('responds with the unpaid penalty', async () => {
				const response = await penaltyDocuments.createDocument(getMockPenalties().find(pen => pen.ID === '820500000877_FPN'));
				expect(response.statusCode).toBe(200);
				const putParams = dbPut.getCall(0).args[0];
				expect(putParams.Item.Value.paymentStatus).toBe('UNPAID');
			});
		});
		context('when a payment exists for the penalty', () => {
			beforeEach(() => {
				sinon.stub(penaltyDocuments, 'getPaymentInformationViaInvocation').returns(Promise.resolve({
					payments: [{
						ID: '820500000877_FPN',
						PenaltyStatus: 'PAID',
						PaymentDetail: {
							AuthCode: '001234',
							PaymentDate: 132546543514,
							PaymentRef: 'ECMS-01-20180219-791641-D750042A',
							PaymentMethod: 'CARD',
							PaymentAmount: 50,
						},
					}],
				}));
			});

			afterEach(() => {
				penaltyDocuments.getPaymentInformationViaInvocation.restore();
			});

			it('responds with the paid penalty and payment details', async () => {
				const response = await penaltyDocuments.createDocument(getMockPenalties().find(pen => pen.ID === '820500000877_FPN'));
				expect(response.statusCode).toBe(200);
				const responseBody = JSON.parse(response.body);
				expect(responseBody.Value.paymentStatus).toBe('PAID');
			});
		});
	});
});
