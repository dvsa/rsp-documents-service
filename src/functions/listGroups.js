import { doc } from 'serverless-dynamodb-client';
import config from '../config';
import PenaltyGroupService from '../services/penaltyGroups';
import { logInfo } from '../utils/logger';

let penaltyGroupService;

export const handler = async (event) => {
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
		return { statusCode: 400, body: 'No numeric Offset provided' };
	}

	logInfo('listGroupRequest', { queryParams: event.queryStringParameters });
	const resp = penaltyGroupService.listPenaltyGroups(numericOffset);
	logInfo('listGroupResponse', resp);

	return resp;
};

export default handler;
