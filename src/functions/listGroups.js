import '@babel/polyfill';
import { doc } from 'serverless-dynamodb-client';
import config from '../config';
import PenaltyGroupService from '../services/penaltyGroups';

let penaltyGroupService;

export default async (event, context, callback) => {
	if (!penaltyGroupService) {
		await config.bootstrap();
		penaltyGroupService = new PenaltyGroupService(
			doc,
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
			config.snsTopicArn(),
		);
	}
	const { Offset } = event.queryStringParameters;
	const numericOffset = Number(Offset);

	if (Number.isNaN(numericOffset)) {
		return callback({ statusCode: 400, body: 'No numeric Offset provided' });
	}

	return penaltyGroupService.listPenaltyGroups(numericOffset, callback);
};
