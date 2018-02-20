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

	const items = JSON.parse(event.body).Items;
	penaltyDocuments.updateDocuments(items, context, callback);
};
