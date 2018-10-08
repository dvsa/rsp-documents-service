/* eslint-env es6 */
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

	const paymentInfo = {
		id: event.body.id,
		paymentStatus: event.body.paymentStatus,
	};

	console.log(JSON.stringify(paymentInfo, null, 2));
	// id body document
	penaltyDocuments.updateDocumentUponPaymentDelete(paymentInfo, callback);
};
