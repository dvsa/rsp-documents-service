import 'babel-polyfill';

import config from '../config';
import PenaltyGroupService from '../services/penaltyGroups';

let penaltyGroupService;
export default async (event, context, callback) => {
	if (!penaltyGroupService) {
		await config.bootstrap();
		penaltyGroupService = new PenaltyGroupService(
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
			config.snsTopicArn(),
		);
	}
	penaltyGroupService.delete(event.pathParameters.id, callback);
};
