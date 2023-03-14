/* eslint-env es6 */
import { doc } from 'serverless-dynamodb-client';
import config from '../config';
import PenaltyDocument from '../services/penaltyDocuments';
import { logInfo } from '../utils/logger';

let penaltyDocuments;
export const handler = async (event) => {
	if (!penaltyDocuments) {
		await config.bootstrap();
		penaltyDocuments = new PenaltyDocument(
			doc,
			config.dynamodbPenaltyDocTable(),
			config.bucketName(),
			config.snsTopicArn(),
			config.siteResource(),
			config.paymentUrl(),
			config.tokenServiceArn(),
			config.daysToHold(),
			config.paymentsBatchFetchArn(),
		);
	}

	const paymentInfo = {
		id: event.body.id,
		paymentStatus: event.body.paymentStatus,
		paymentAmount: event.body.paymentAmount,
		penaltyRefNo: event.body.penaltyRefNo,
		penaltyType: event.body.penaltyType,
		paymentToken: event.body.paymentToken,
	};

	logInfo('updateWithPaymentReq', event.body);
	const resp = penaltyDocuments.updateDocumentWithPayment(paymentInfo);
	logInfo('updateWithPaymentRes', resp);
	return resp;
};

export default handler;
