import sinon from 'sinon';
import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import mockPenaltyDocumentsService from './service.unit';
import getMockPenalties from '../../../mock-data/mock-penalty-notice';

describe('deleteDocument', () => {
	let penaltyDocuments = mockPenaltyDocumentsService(doc);
	beforeEach(() => {
		penaltyDocuments = mockPenaltyDocumentsService(doc);
	});
	context('when a document is unpaid', () => {
		beforeEach(() => {
			sinon.stub(penaltyDocuments, 'getPaymentInformationViaInvocation').returns(Promise.resolve({
				payments: [],
			}));
		});
		afterEach(() => {
			penaltyDocuments.getPaymentInformationViaInvocation.restore();
		});

		context('when a document is deleted', () => {
			let dbUpdate;

			beforeEach(() => {
				dbUpdate = sinon.stub(doc, 'update').returns({
					promise: () => Promise.resolve(),
				});
			});

			afterEach(() => {
				doc.update.restore();
			});

			it('response with status code 200', async () => {
				const id = '820500000877_FPN';
				const body = getMockPenalties().find(pen => pen.ID === '820500000877_FPN');
				const response = await penaltyDocuments.deleteDocument(id, body);
				expect(response.statusCode).toBe(200);
				const dbUpdateParams = dbUpdate.getCall(0).args[0];
				expect(dbUpdateParams.ExpressionAttributeValues[':not_enabled']).toBe(false);
				expect(dbUpdateParams.Key.ID).toBe('820500000877_FPN');
				expect(dbUpdateParams.ExpressionAttributeValues[':Hash']).not.toEqual(body.Value.Hash);
			});
		});
	});

	context('when a document is paid', () => {
		it('responds with an error', () => {});
	});
});
