import { doc } from 'serverless-dynamodb-client';
import PenaltyGroup from '../services/penaltyGroups';
import config from '../config';

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
	return penaltyGroups.createPenaltyGroup(data);
};

export default handler;
