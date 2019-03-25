import 'babel-polyfill';
import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';

let penaltyDocuments;

export default async (event, context, callback) => {
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

	let offset = 0;
	let exclusiveStartKey = 'undefined';

	if (event.queryStringParameters != null && event.queryStringParameters.Offset !== undefined) {
		offset = event.queryStringParameters.Offset;
	}

	if (event.queryStringParameters != null &&
		typeof event.queryStringParameters.NextID !== 'undefined') {
		// @ts-ignore
		exclusiveStartKey = {
			ID: event.queryStringParameters.NextID,
			Offset: Number(event.queryStringParameters.NextOffset),
			Origin: 'APP',
		};
	}


	penaltyDocuments.getDocuments(offset, exclusiveStartKey, callback);
};
