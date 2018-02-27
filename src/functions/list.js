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
	let offset = 'undefined';
	if (event.queryStringParameters != null && event.queryStringParameters !== undefined) {
		offset = event.queryStringParameters.Offset;
	}
	penaltyDocuments.getDocuments(offset, callback);

};
