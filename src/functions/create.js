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
	// id body document
	delete data.Value.paymentStatus;
	logInfo('CreatePayload', data);
	const resp = penaltyDocuments.createDocument(data);
	logInfo('CreateResponse', resp);
	return resp;
};

export default handler;
