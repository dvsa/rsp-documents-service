import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import mockPenaltyDocumentsService from './service.unit';

describe('streamDocuments', () => {
	let penaltyDocumentsService = mockPenaltyDocumentsService(doc);
	const sendSnsMessageSpy = sinon.spy();

	beforeEach(() => {
		penaltyDocumentsService = mockPenaltyDocumentsService(doc);
		sinon.stub(penaltyDocumentsService, 'sendSnsMessage').callsFake((params) => {
			sendSnsMessageSpy(params);
			return Promise.resolve();
		});
	});

	afterEach(() => {
		penaltyDocumentsService.sendSnsMessage.restore();
		sendSnsMessageSpy.resetHistory();
	});

	context('when called with multiple records', () => {
		it('sends a message with the latest offset', async () => {
			const response = await penaltyDocumentsService.streamDocuments({
				Records: [{
					dynamodb: {
						NewImage: JSON.stringify({
							item: {
								Offset: 100,
							},
						}),
					},
				}, {
					dynamodb: {
						NewImage: JSON.stringify({
							item: {
								Offset: 300,
							},
						}),
					},
				}, {
					dynamodb: {
						NewImage: JSON.stringify({
							item: {
								Offset: 200,
							},
						}),
					},
				}],
			});
			expect(response).toBe('Successfully processed 3 records.');
			expect(sendSnsMessageSpy.calledWith({
				Offset: 300,
			}));
		});
	});
});
