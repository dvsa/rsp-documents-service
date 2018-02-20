import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';

const penaltyDocuments = new PenaltyDocument(
	doc,
	process.env.DYNAMODB_TABLE,
	process.env.BUCKETNAME,
	process.env.SNSTOPICARN,
	process.env.SITERESOURCE,
);

export default (event, context, callback) => {

	const data = JSON.parse(event.body);
	// id body document
	penaltyDocuments.createDocument(data, callback);
};
