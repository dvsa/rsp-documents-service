import 'babel-polyfill';
import PenaltyGroup from '../services/penaltyGroups';
import config from '../config';


let penaltyGroups;
export default async (event, context, callback) => {
	if (!penaltyGroups) {
		await config.bootstrap();
		penaltyGroups = new PenaltyGroup(
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
			config.snsTopicArn(),
		);
	}
	const data = JSON.parse(event.body);
	penaltyGroups.createPenaltyGroup(data, callback);
};
