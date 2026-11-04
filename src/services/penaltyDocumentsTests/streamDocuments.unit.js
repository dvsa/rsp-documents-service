import expect from 'expect';
import { doc } from 'serverless-dynamodb-client';
import sinon from 'sinon';
import { DynamoDB } from 'aws-sdk';
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
						NewImage: DynamoDB.Converter.marshall({ Offset: 100 }),
					},
				}, {
					dynamodb: {
						NewImage: DynamoDB.Converter.marshall({ Offset: 300 }),
					},
				}, {
					dynamodb: {
						NewImage: DynamoDB.Converter.marshall({ Offset: 200 }),
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
