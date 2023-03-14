import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';
import { logInfo } from '../utils/logger';

let penaltyDocuments;
export const handler = async (event) => {
	logInfo('handler', { message: 'Starting app...' });
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

	const id = event.pathParameters.id ? event.pathParameters.id : event.body.id;

	if (!id) {
		throw new Error('ID not found');
	}

	logInfo('handler', {
		message: 'initialized app. Getting id from request',
		idPath: event.pathParameters ? event.pathParameters.id : 'no path param',
		idBody: event.body ? event.body.id : 'no body id',
	});

	const resp = penaltyDocuments.getDocument(id);
	logInfo('GetResponse', resp);
	return resp;
};

export default handler;
