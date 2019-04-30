import '@babel/polyfill';
import { doc } from 'serverless-dynamodb-client';

import config from '../config';
import PenaltyGroupService from '../services/penaltyGroups';

let penaltyGroupService;
export default async (event) => {
	if (!penaltyGroupService) {
		await config.bootstrap();
		penaltyGroupService = new PenaltyGroupService(
			doc,
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
			config.snsTopicArn(),
		);
	}
	return penaltyGroupService.delete(event.pathParameters.id);
};
