import '@babel/polyfill';
import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';

let penaltyDocuments;
export default async (event) => {
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
	return penaltyDocuments.deleteDocument(event.pathParameters.id);

};
