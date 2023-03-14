import { doc } from 'serverless-dynamodb-client';
import PenaltyGroup from '../services/penaltyGroups';
import config from '../config';
import { logInfo } from '../utils/logger';

/** @type PenaltyGroup */
let penaltyGroups;
export const handler = async (event) => {
	if (!penaltyGroups) {
		await config.bootstrap();
		penaltyGroups = new PenaltyGroup(
			doc,
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
			config.snsTopicArn(),
		);
	}
	const data = JSON.parse(event.body);
	logInfo('CreatePayload', data);
	const resp = penaltyGroups.createPenaltyGroup(data);
	logInfo('CreateResponse', resp);
	return resp;
};

export default handler;
