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
	let exclusiveStartKey = 'undefined';

	if (event.queryStringParameters != null && event.queryStringParameters.Offset !== undefined) {
		offset = event.queryStringParameters.Offset;
	}

	if (event.queryStringParameters != null &&
		event.queryStringParameters.ExclusiveStartKey !== undefined) {
		exclusiveStartKey = event.queryStringParameters.ExclusiveStartKey;
	}

	penaltyDocuments.getDocuments(offset, exclusiveStartKey, callback);

};
