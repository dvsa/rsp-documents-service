import { doc } from 'serverless-dynamodb-client';
import PenaltyDocument from '../services/penaltyDocuments';

const penaltyDocuments = new PenaltyDocument(
	doc,
	process.env.DYNAMODB_TABLE,
	process.env.BUCKETNAME,
	process.env.SNSTOPICARN,
	process.env.SITERESOURCE,
	process.env.TOKEN_SERVICE_ARN,
);

export default (event, context, callback) => {
	penaltyDocuments.getDocumentByToken(event.pathParameters.token, callback);
};
