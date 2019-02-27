/* eslint-env es6 */
import 'babel-polyfill';
import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';

/** @type PenaltyDocument */
let penaltyDocuments;
const updateWithReceipt = async (event, context, callback) => {
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

	let { body } = event;

	if (typeof body === 'string') {
		// body is a string if invoked via http request rather than directly.
		body = JSON.parse(event.body);
	}

	const { penaltyReference, receiptReference } = body;

	console.log(body);

	penaltyDocuments.updateDocumentWithReceipt(penaltyReference, receiptReference, callback);
};

export default updateWithReceipt;
