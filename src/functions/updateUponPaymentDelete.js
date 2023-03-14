// @ts-check
/* eslint-env es6 */
import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';
import config from '../config';
import { logInfo } from '../utils/logger';

/**
 * Penalty documents service
 * @type PenaltyDocument
 */
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

	let { body } = event;

	if (typeof body === 'string') {
		// body is a string if invoked via http request rather than directly.
		body = JSON.parse(event.body);
	}

	const paymentInfo = {
		id: body.id,
		paymentStatus: body.paymentStatus,
	};

	logInfo('updateUponPaymentDeleteReq', body);

	const resp = penaltyDocuments.updateDocumentUponPaymentDelete(paymentInfo);
	logInfo('updateUponPaymentDeleteRes', resp);
	return resp;
};

export default handler;
