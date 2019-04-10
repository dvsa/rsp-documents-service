import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import mockPenaltyDocumentsService from './service.unit';

describe('updateDocumentWithPayment', () => {
	context('when a penalty is paid', () => {
		it('updates the document to be paid', () => {});

		it('sends a payment confirmation', () => {});
	});

	context('when a document does not already exist', () => {
		it('creates a dummy penalty document', () => {});
	});

	context('when dynamodb get responds with an error', () => {
		it('responds with 400 bad request', () => {});
	});

	context('when dynamodb put responds with an error', () => {
		it('responds with 400 bad request', () => {});
	});
});
