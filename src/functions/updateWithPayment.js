/* eslint-env es6 */
import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';

const penaltyDocuments = new PenaltyDocument(
	doc,
	process.env.DYNAMODB_PENALTY_DOC_TABLE,
	process.env.BUCKETNAME,
	process.env.SNSTOPICARN,
	process.env.SITERESOURCE,
	process.env.PAYMENTURL,
	process.env.TOKEN_SERVICE_ARN,
	process.env.DAYS_TO_HOLD || 3,
	process.env.PAYMENTS_BATCH_FETCH_ARN,
);

export default (event, context, callback) => {

	const paymentInfo = {
		id: event.body.id,
		paymentStatus: event.body.paymentStatus,
		paymentAmount: event.body.paymentAmount,
		penaltyRefNo: event.body.penaltyRefNo,
		penaltyType: event.body.penaltyType,
		paymentToken: event.body.paymentToken,
	};

	console.log(JSON.stringify(paymentInfo, null, 2));
	// id body document
	penaltyDocuments.updateDocumentWithPayment(paymentInfo, callback);
};
