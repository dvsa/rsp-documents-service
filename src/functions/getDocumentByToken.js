import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';
import { logInfo } from '../utils/logger';

/** @type PenaltyDocument */
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
	logInfo('getDocumentByTokenRequest', { pathParams: event.pathParameters, token: event.pathParameters.token });
	const resp = penaltyDocuments.getDocumentByToken(event.pathParameters.token);
	logInfo('getDocumentByTokenResponse', resp);
	return resp;
};

export default handler;
