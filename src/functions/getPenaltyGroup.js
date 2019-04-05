import 'babel-polyfill';
import PenaltyGroup from '../services/penaltyGroups';
import config from '../config';

let penaltyGroupService;
export default async (event, context, callback) => {
	if (!penaltyGroupService) {
		await config.bootstrap();
		penaltyGroupService = new PenaltyGroup(
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
			config.snsTopicArn(),
		);
	}
	penaltyGroupService.getPenaltyGroup(event.pathParameters.id, callback);
};
