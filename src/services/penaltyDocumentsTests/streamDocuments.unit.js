import expect from 'expect';
import sinon from 'sinon';
import { marshall } from '@aws-sdk/util-dynamodb';
import { doc } from '../../utils/dynamodb';
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
		it('sends a message with the earliest offset so clients fetch every change', async () => {
			const response = await penaltyDocumentsService.streamDocuments({
				Records: [{
					dynamodb: {
						NewImage: marshall({ Offset: 100 }),
					},
				}, {
					dynamodb: {
						NewImage: marshall({ Offset: 300 }),
					},
				}, {
					dynamodb: {
						NewImage: marshall({ Offset: 200 }),
					},
				}],
			});
			expect(response).toBe('Successfully processed 3 records.');
			expect(sendSnsMessageSpy.calledOnce).toBe(true);
			const message = JSON.parse(sendSnsMessageSpy.firstCall.args[0].Message);
			expect(JSON.parse(message.APNS).offset).toBe(100);
			expect(JSON.parse(message.APNS_SANDBOX).offset).toBe(100);
		});
	});
});
