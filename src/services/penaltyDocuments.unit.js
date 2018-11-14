import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import PenaltyDocumentsService from './penaltyDocuments';
import mockPenaltyGroupsData from '../../mock-data/fake-penalty-groups.json';


describe('PenaltyDocuments service', () => {
	let penaltyDocumentsService;
	let callbackSpy;

	beforeEach(() => {
		penaltyDocumentsService = new PenaltyDocumentsService(doc, 'penaltyDocuments', '', '', '', '', '', '', '');
		callbackSpy = sinon.spy();
	});
	afterEach(() => {
		doc.get.restore();
		doc.put.restore();
		callbackSpy.resetHistory();
	});

	it('updateDocumentUponPaymentDelete', async () => {
		sinon.stub(doc, 'put')
			.returns({
				promise: () => Promise.resolve('put resolved'),
			});
		/**
		 * Mock for db.get in updateDocumentUponPaymentDelete.
		 * _tryUpdatePenaltyGroupToUnpaidStatus is stubbed so will not be called.
		 */
		sinon.stub(doc, 'get').returns({
			promise: () => Promise.resolve({
				Item: {
					Value: {},
					ID: 'abc123def45',
					Enabled: true,
					penaltyGroupId: 'groupIdPen',
					PenaltyDocumentIds: ['doc1', 'doc2'],
					inPenaltyGroup: true,
				},
			}),
		});
		const mockPenaltyGroup = mockPenaltyGroupsData.find((group) => { return group.ID === '46xu68x7o6b'; });
		sinon.stub(penaltyDocumentsService, '_tryUpdatePenaltyGroupToUnpaidStatus').callsFake(() => mockPenaltyGroup);
		await penaltyDocumentsService.updateDocumentUponPaymentDelete({ id: 'abcdefg123', paymentStatus: 'UNPAID' }, callbackSpy);
		sinon.assert.calledWith(callbackSpy, null, sinon.match({
			statusCode: 200,
		}));
	});
});
