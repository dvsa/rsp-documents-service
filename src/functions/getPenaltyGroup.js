import 'babel-polyfill';
import { doc } from 'serverless-dynamodb-client';
import PenaltyGroup from '../services/penaltyGroups';
import config from '../config';

let penaltyGroupService;
export default async (event, context, callback) => {
	if (!penaltyGroupService) {
		await config.bootstrap();
		penaltyGroupService = new PenaltyGroup(
			doc,
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
			config.snsTopicArn(),
		);
	}
	penaltyGroupService.getPenaltyGroup(event.pathParameters.id, callback);
};
