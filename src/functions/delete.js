import { doc } from 'serverless-dynamodb-client';
import { logInfo } from '../utils/logger';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';

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
	logInfo('CreatePayload', data);
	const resp = penaltyDocuments.deleteDocument(event.pathParameters.id, data);
	logInfo('CreateResponse', resp);
	return resp;

};

export default handler;
