/* eslint-env es6 */
import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';
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

	const data = JSON.parse(event.body);

	logInfo('updateWithPaymentStartTimeReq', event.body);
	const resp = penaltyDocuments.updateDocumentWithPaymentStartTime(data.id);
	logInfo('updateWithPaymentStartTimeRes', resp);
	return resp;
};

export default handler;
