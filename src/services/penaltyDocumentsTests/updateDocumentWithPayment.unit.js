import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import mockPenaltyDocumentsService from './service.unit';
import getMockPenalties from '../../../mock-data/mock-penalty-notice';

describe('updateDocumentWithPayment', () => {
	let penaltyDocuments = mockPenaltyDocumentsService(doc);
	let paymentInfo;

	beforeEach(() => {
		paymentInfo = {
			id: '',
			penaltyRefNo: '820500000880_IM',
			paymentToken: '',
			paymentAmount: 80,
			paymentStatus: 'PAID',
			penaltyType: 'IM',
		};
	});

	context('when a penalty exists', () => {
		let mockPut;

		beforeEach(() => {
			penaltyDocuments = mockPenaltyDocumentsService(doc);
			const penaltyDocument = getMockPenalties().find((pen) => pen.ID === '820500000880_IM');
			console.error(penaltyDocument);
			sinon.stub(doc, 'get').returns({
				promise: () => Promise.resolve({ Item: penaltyDocument }),
			});
		});

		afterEach(() => {
			doc.get.restore();
		});

		context('when a penalty is paid', () => {
			let sendPaymentNotification;

			beforeEach(() => {
				mockPut = sinon.stub(doc, 'put').returns({
					promise: () => Promise.resolve(),
				});
				sendPaymentNotification = sinon.stub(penaltyDocuments, 'sendPaymentNotification').returns(Promise.resolve());
			});

			afterEach(() => {
				doc.put.restore();
				sendPaymentNotification.restore();
			});

			it('updates the document to be paid', async () => {
				const response = await penaltyDocuments.updateDocumentWithPayment(paymentInfo);
				expect(response.statusCode).toBe(200);
				const penaltyDocument = getMockPenalties().find((pen) => pen.ID === '820500000880_IM');
				penaltyDocument.Value.paymentStatus = 'PAID';
				// Expect hash, offset and payment status to be changed.
				const putParams = mockPut.getCall(0).args[0];
				expect(putParams.Item.Hash).not.toEqual('6a1e32a2a319c7674fbd83f34cb07b35fdc1cecab261fd02450da821c359d74d');
				expect(putParams.Item.Offset).not.toEqual(1521331200);
				expect(putParams.Item.Value.paymentStatus).toEqual('PAID');

				sinon.assert.calledOnce(sendPaymentNotification);
			});
		});

		context('when dynamodb put responds with an error', () => {
			beforeEach(() => {
				mockPut = sinon.stub(doc, 'put').returns({
					promise: () => Promise.reject(new Error('DynamoDB put failed')),
				});
			});

			afterEach(() => {
				doc.put.restore();
			});

			it('responds with 400 bad request', async () => {
				const response = await penaltyDocuments.updateDocumentWithPayment(paymentInfo);
				expect(response.statusCode).toBe(400);
			});
		});
	});

	context('when a document does not already exist', () => {
		let putStub;
		let createDocument;
		let sendPaymentNotification;

		beforeEach(() => {
			sinon.stub(doc, 'get').returns({
				promise: () => (
					Promise.resolve({
						data: {},
					})
				),
			});
			putStub = sinon.stub(doc, 'put').returns({
				promise: Promise.resolve(),
			});

			createDocument = sinon.stub(penaltyDocuments, 'createDocument').returns(Promise.resolve());
			sendPaymentNotification = sinon.stub(penaltyDocuments, 'sendPaymentNotification').returns(Promise.resolve());
		});

		afterEach(() => {
			doc.get.restore();
			doc.put.restore();
			penaltyDocuments.createDocument.restore();
			penaltyDocuments.sendPaymentNotification.restore();
		});

		it('creates a dummy penalty document', async () => {
			const response = await penaltyDocuments.updateDocumentWithPayment(paymentInfo);
			expect(response.statusCode).toBe(200);
			sinon.assert.calledOnce(createDocument);
			sinon.assert.notCalled(putStub);
			sinon.assert.notCalled(sendPaymentNotification);
			const createDocumentParams = createDocument.getCall(0).args[0];
			expect(createDocumentParams.Value.paymentStatus).toBe('PAID');
		});
	});

	context('when dynamodb get responds with an error', () => {
		beforeEach(() => {
			sinon.stub(doc, 'get').returns({
				promise: () => (
					Promise.reject(new Error('Error message'))
				),
			});
		});

		afterEach(() => {
			doc.get.restore();
		});

		it('responds with 400 bad request', async () => {
			const response = await penaltyDocuments.updateDocumentWithPayment(paymentInfo);
			expect(response.statusCode).toBe(400);
		});
	});
});
