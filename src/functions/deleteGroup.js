import { doc } from 'serverless-dynamodb-client';
import { logInfo } from '../utils/logger';

import config from '../config';
import PenaltyGroupService from '../services/penaltyGroups';

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
	logInfo('deletePayload', { idPathParameters: event.pathParameters.id });
	const resp = penaltyGroupService.delete(event.pathParameters.id);
	logInfo('deleteResponse', resp);
	return resp;

};

export default handler;
