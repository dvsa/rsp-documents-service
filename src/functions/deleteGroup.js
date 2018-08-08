import { doc } from 'serverless-dynamodb-client';

import PenaltyGroupService from '../services/penaltyGroups';

const penaltyGroupService = new PenaltyGroupService(
	doc,
	process.env.DYNAMODB_PENALTY_DOC_TABLE,
	process.env.DYNAMODB_PENALTY_GROUP_TABLE,
);

export default (event, context, callback) => {
	penaltyGroupService.delete(event.pathParameters.id, callback);
};
