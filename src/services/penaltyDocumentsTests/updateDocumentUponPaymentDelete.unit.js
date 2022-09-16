import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import mockPenaltyDocumentsService from './service.unit';
import mockPenaltyDocuments from '../../../mock-data/fake-penalty-notice.json';

describe('updateDocumentUponPaymentDelete', () => {
	let penaltyDocumentsService;
	let paymentInfo;
	beforeEach(() => {
		penaltyDocumentsService = mockPenaltyDocumentsService(doc);
		paymentInfo = {
			id: mockPenaltyDocuments[0].ID,
			paymentStatus: 'UNPAID',
		};
	});

	context('when document exists', () => {
		beforeEach(() => {
			sinon.stub(doc, 'get').returns({
				promise: () => (Promise.resolve({
					Item: mockPenaltyDocuments[0],
				})),
			});
			sinon.stub(doc, 'put').returns({
				promise: () => (Promise.resolve()),
			});
		});

		afterEach(() => {
			doc.get.restore();
			doc.put.restore();
		});

		it('responds with 200 OK', async () => {
			const res = await penaltyDocumentsService.updateDocumentUponPaymentDelete(paymentInfo);
			expect(res.statusCode).toBe(200);
		});
	});

	context('when the document does not already exist', () => {
		beforeEach(() => {
			sinon.stub(doc, 'get').returns({
				promise: () => (Promise.reject()),
			});
		});

		afterEach(() => {
			doc.get.restore();
		});

		it('responds with 400 bad request', async () => {
			const res = await penaltyDocumentsService.updateDocumentUponPaymentDelete(paymentInfo);
			expect(res.statusCode).toBe(400);
		});
	});

	context('when the put request fails', () => {
		beforeEach(() => {
			sinon.stub(doc, 'get').returns({
				promise: () => (Promise.resolve({
					Item: mockPenaltyDocuments[0],
				})),
			});
			sinon.stub(doc, 'put').returns({
				promise: () => (Promise.reject()),
			});
		});

		afterEach(() => {
			doc.get.restore();
			doc.put.restore();
		});

		it('responds with 400 bad request', async () => {
			const res = await penaltyDocumentsService.updateDocumentUponPaymentDelete(paymentInfo);
			expect(res.statusCode).toBe(400);
		});
	});
});
