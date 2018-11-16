// @ts-check
/* eslint-env es6 */
import 'babel-polyfill';
import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';

/**
 * Penalty documents service
 * @type PenaltyDocument
 */
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

	console.log(event);

	const paymentInfo = {
		penaltyDocuments: event.body.penaltyDocuments,
	};

	console.log(JSON.stringify(paymentInfo, null, 2));
	// id body document
	penaltyDocuments.updateDocumentsUponPaymentDelete(paymentInfo, callback);
};
