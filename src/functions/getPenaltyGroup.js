import { doc } from 'serverless-dynamodb-client';
import PenaltyGroup from '../services/penaltyGroups';
import config from '../config';
import { logInfo } from '../utils/logger';

let penaltyGroupService;
export const handler = async (event) => {
	if (!penaltyGroupService) {
		await config.bootstrap();
		penaltyGroupService = new PenaltyGroup(
			doc,
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
			config.snsTopicArn(),
		);
	}
	logInfo('getPenaltyGroupRequest', { pathParams: event.pathParameters, id: event.pathParameters.id });
	const resp = penaltyGroupService.getPenaltyGroup(event.pathParameters.id);
	logInfo('getPenaltyGroupResponse', resp);
	return resp;
};

export default handler;
