import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import PenaltyDocumentsService from '../penaltyDocuments';
import mockPenaltyGroupsData from '../../../mock-data/fake-penalty-groups.json';
import getMockPenalties from '../../../mock-data/mock-penalty-notice';


describe('PenaltyDocuments service', () => {
	/**
	 * @type PenaltyDocumentsService
	 */
	let penaltyDocumentsService;

	describe('updateMultipleUponPaymentDelete', () => {
		beforeEach(() => {
			penaltyDocumentsService = new PenaltyDocumentsService(doc, 'penaltyDocuments', '', '', '', '', '', 3, '');
			sinon.stub(doc, 'put')
				.returns({
					promise: () => Promise.resolve('put resolved'),
				});

			sinon.stub(doc, 'get').returns({
				promise: () => Promise.resolve({
					Item: getMockPenalties().find(pen => pen.id === '820500000877_FPN'),
				}),
			});
		});
		afterEach(() => {
			doc.put.restore();
			doc.get.restore();
		});

		it('calls back with OK status', async () => {
			const mockPenaltyGroup = mockPenaltyGroupsData.find((group) => { return group.ID === '46xu68x7o6b'; });
			sinon.stub(penaltyDocumentsService, '_tryUpdatePenaltyGroupToUnpaidStatus').callsFake(() => mockPenaltyGroup);
			sinon.stub(penaltyDocumentsService, '_updateDocumentsToUnpaidStatus').callsFake(() => ['820500000877_FPN']);
			const response = await penaltyDocumentsService.updateMultipleUponPaymentDelete({ penaltyDocumentIds: ['820500000877_FPN'] });
			expect(response.statusCode).toBe(200);
		});
	});
});
