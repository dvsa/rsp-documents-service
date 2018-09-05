import { doc } from 'serverless-dynamodb-client';
import PenaltyGroup from '../services/penaltyGroups';

const penaltyGroups = new PenaltyGroup(
	doc,
	process.env.DYNAMODB_PENALTY_DOC_TABLE,
	process.env.DYNAMODB_PENALTY_GROUP_TABLE,
	process.env.SNSTOPICARN,
);

export default (event, context, callback) => {
	const data = JSON.parse(event.body);
	penaltyGroups.createPenaltyGroup(data, callback);
};
