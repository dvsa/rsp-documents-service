import 'babel-polyfill';
import { doc } from 'serverless-dynamodb-client';
import PenaltyGroup from '../services/penaltyGroups';
import config from '../config';


let penaltyGroups;
export default async (event, context, callback) => {
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
	console.log(data);
	penaltyGroups.createPenaltyGroup(data, callback);
};
