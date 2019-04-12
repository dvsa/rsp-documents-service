import expect from 'expect';
import sinon from 'sinon';
import { doc } from 'serverless-dynamodb-client';
import mockPenaltyDocumentsService from './service.unit';
import getMockPenalties from '../../../mock-data/mock-penalty-notice';
import createResponse from '../../utils/createResponse';


describe('updateDocuments', () => {
	let penaltyDocuments;

	context('when a payment exists', () => {
		beforeEach(() => {
			penaltyDocuments = mockPenaltyDocumentsService(doc);
			sinon.stub(penaltyDocuments, 'getPaymentInformationViaInvocation').resolves({
				payments: [{
					ID: '820500000877_FPN',
					PenaltyStatus: 'PAID',
					PaymentDetail: {
						AuthCode: '001234',
						PaymentDate: 12521351123,
						PaymentRef: 'ECMS-1346152351-121351',
						PaymentMethod: 'CARD',
					},
				}],
			});
		});

		afterEach(() => {
			penaltyDocuments.getPaymentInformationViaInvocation.restore();
		});

		context('when update fails for a document', () => {
			let updateItem;

			beforeEach(() => {
				updateItem = sinon.stub(penaltyDocuments, 'updateItem');
				updateItem.returns(createResponse({ statusCode: 400 }));
			});

			afterEach(() => {
				updateItem.restore();
			});

			it('responds with an error for each document', async () => {
				const response = await penaltyDocuments.updateDocuments([getMockPenalties()[0]]);
				expect(response.statusCode).toBe(200);
				const resBody = JSON.parse(response.body);
				expect(resBody.Items[0].statusCode).toBe(400);
			});
		});

		context('when all documents are updated', () => {
			let updateItem;

			beforeEach(() => {
				updateItem = sinon.stub(penaltyDocuments, 'updateItem');
				updateItem.returns(createResponse({
					statusCode: 200,
					body: JSON.stringify({
						Items: [getMockPenalties()[0]],
					}),
				}));
			});

			afterEach(() => {
				updateItem.restore();
			});

			it('responds with the new values', async () => {
				const response = await penaltyDocuments.updateDocuments([getMockPenalties()[0]]);
				expect(response.statusCode).toBe(200);

				const resBody = JSON.parse(response.body);
				expect(resBody.Items[0].statusCode).toBe(200);

				const updateItemParams = updateItem.getCall(0).args[0];
				expect(updateItemParams.Value).toEqual({
					dateTime: 1476180720,
					inPenaltyGroup: true,
					nonEndorsableOffence: [],
					officerID: 'Blah111',
					officerName: 'Sherlock.Holmes@example.com',
					paymentAuthCode: '001234',
					paymentCodeDateTime: 1476180720,
					paymentDate: 12521351123,
					paymentDueDate: 479945600,
					paymentMethod: 'CARD',
					paymentRef: 'ECMS-1346152351-121351',
					paymentStatus: 'PAID',
					paymentToken: 'c50f7829620bc8ba',
					penaltyAmount: 50,
					penaltyType: 'FPN',
					placeWhereIssued: 'BLACKWALL TUNNEL A, PAVILLION WAY, METROPOLITAN',
					referenceNo: '820500000877',
					siteCode: 2,
					vehicleDetails: {
						regNo: 'OK08OK',
					},
				});
			});
		});
	});
});
