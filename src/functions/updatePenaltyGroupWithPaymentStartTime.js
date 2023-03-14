/* eslint-env es6 */
import { doc } from 'serverless-dynamodb-client';
import PenaltyGroupService from '../services/penaltyGroups';
import config from '../config';
import { logInfo } from '../utils/logger';

/** @type {PenaltyGroupService} */
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

	const data = JSON.parse(event.body);

	logInfo('updatePenaltyGroupWithPaymentStartTimeReq', data);
	const resp = penaltyGroupService.updatePenaltyGroupWithPaymentStartTime(data.id, data.penaltyType);
	logInfo('updatePenaltyGroupWithPaymentStartTimeRes', resp);
	return resp;

};

export default handler;
