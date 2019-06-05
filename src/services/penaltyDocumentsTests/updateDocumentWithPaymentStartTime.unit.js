import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import mockPenaltyDocumentsService from './service.unit';


describe('updateDocumentWithPaymentStartTime', () => {
	const penaltyDocuments = mockPenaltyDocumentsService(doc);
  let penaltyDocumentId = '820500000877_FPN';

  context('when a penalty exists', () => {
    beforeEach(() => {
      sinon.stub(doc, 'update').returns({
        promise: () => Promise.resolve(),
      });
    });

    afterEach(() => {
      doc.update.restore();
    });

    it('updates the document', async () => {
      const response = await penaltyDocuments.updateDocumentWithPaymentStartTime(penaltyDocumentId);
      expect(response.statusCode).toBe(200);
    });
  });

  context('when the update fails', () => {
    beforeEach(() => {
      sinon.stub(doc, 'update').returns({
        promise: () => Promise.reject(new Error('Penalty does not exists')),
      });
    });

    afterEach(() => {
      doc.update.restore();
    });

    it('responds with bad request', async () => {
      const response = await penaltyDocuments.updateDocumentWithPaymentStartTime(penaltyDocumentId);
      expect(response.statusCode).toBe(400);
    });
  });
});
