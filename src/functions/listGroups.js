import { doc } from 'serverless-dynamodb-client';

import PenaltyGroupService from '../services/penaltyGroups';

const penaltyGroupService = new PenaltyGroupService(
	doc,
	process.env.DYNAMODB_PENALTY_DOC_TABLE,
	process.env.DYNAMODB_PENALTY_GROUP_TABLE,
);

export default (event, context, callback) => {
	const { offset } = event.queryStringParameters;
	const numericOffset = Number(offset);

	if (Number.isNaN(numericOffset)) {
		return callback({ statusCode: 400, body: 'No numeric Offset provided' });
	}

	return penaltyGroupService.listPenaltyGroups(numericOffset, callback);
};
