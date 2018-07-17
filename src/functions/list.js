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
);

export default (event, context, callback) => {
	let offset = 0;
	let exclusiveStartKey = 'undefined';

	if (event.queryStringParameters != null && event.queryStringParameters.Offset !== undefined) {
		offset = event.queryStringParameters.Offset;
	}

	if (event.queryStringParameters != null &&
		typeof event.queryStringParameters.NextID !== 'undefined') {
		exclusiveStartKey = {
			ID: event.queryStringParameters.NextID,
			Offset: Number(event.queryStringParameters.NextOffset),
			Origin: 'APP',
		};
	}


	penaltyDocuments.getDocuments(offset, exclusiveStartKey, callback);

};
