import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import mockPenaltyDocumentsService from './service.unit';
import mockPenaltyDocuments from '../../../mock-data/fake-penalty-notice.json';

describe('getDocumentByToken', () => {
	let penaltyDocumentsService = mockPenaltyDocumentsService(doc);

	beforeEach(() => {
		penaltyDocumentsService = mockPenaltyDocumentsService(doc);
		sinon.stub(penaltyDocumentsService, 'invokeTokenServiceLambda').callsFake(() => {
			return Promise.resolve({
				Payload: JSON.stringify({
					body: JSON.stringify(mockPenaltyDocuments[0]),
				}),
				statusCode: 200,
			});
		});
	});

	afterEach(() => {
		penaltyDocumentsService.invokeTokenServiceLambda.restore();
	});

	context('when called with an existing document token', () => {
		beforeEach(() => {
			sinon.stub(penaltyDocumentsService, 'getDocument').callsFake(() => {
				return Promise.resolve({
					body: JSON.stringify(mockPenaltyDocuments[0]),
					statusCode: 200,
				});
			});
		});

		afterEach(() => {
			penaltyDocumentsService.getDocument.restore();
		});

		it('responds with the penalty document', async () => {
			const documentResponse = await penaltyDocumentsService.getDocumentByToken('c50f7829620bc8ba');
			expect(documentResponse.statusCode).toBe(200);
			const responseBody = JSON.parse(documentResponse.body);
			expect(responseBody.Value.paymentToken).toBe('c50f7829620bc8ba');
		});
	});

	context('when called with an non-existing document token without payment data', () => {
		beforeEach(() => {
			sinon.stub(penaltyDocumentsService, 'getDocument').callsFake(() => {
				return Promise.resolve({
					statusCode: 404,
				});
			});
			sinon.stub(penaltyDocumentsService, 'getPaymentInformationViaInvocation').callsFake(() => {
				return Promise.resolve({
					payments: [],
				});
			});
		});

		afterEach(() => {
			penaltyDocumentsService.getDocument.restore();
			penaltyDocumentsService.getPaymentInformationViaInvocation.restore();
		});

		it('responds with the decrypted token', async () => {
			const documentResponse = await penaltyDocumentsService.getDocumentByToken('c50f7829620bc8ba');
			expect(documentResponse.statusCode).toBe(200);
			const responseBody = JSON.parse(documentResponse.body);
			expect(responseBody.Value.paymentToken).toBe('c50f7829620bc8ba');
			expect(responseBody.Value.paymentStatus).toBe('UNPAID');
		});
	});
});
