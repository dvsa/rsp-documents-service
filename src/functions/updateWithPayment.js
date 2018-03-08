import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';

const penaltyDocuments = new PenaltyDocument(
	doc,
	process.env.DYNAMODB_TABLE,
	process.env.BUCKETNAME,
	process.env.SNSTOPICARN,
	process.env.SITERESOURCE,
	process.env.PAYMENTURL,
	process.env.TOKEN_SERVICE_ARN,
);

export default (event, context, callback) => {

	console.log(JSON.stringify(event, null, 2));
	const data = event.body;

	console.log(`id ${data.id} status ${data.paymentStatus}`);
	// id body document
	penaltyDocuments.updateDocumentWithPayment(data.id, data.paymentStatus, callback);
};
