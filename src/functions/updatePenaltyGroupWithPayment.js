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

	let paymentInfo = event.body;
	if (typeof paymentInfo === 'string') {
		paymentInfo = JSON.parse(event.body);
	}
	// id body document
	logInfo('updateMultiUponPaymentDeleteReq', paymentInfo);
	const resp = penaltyGroupService.updatePenaltyGroupWithPayment(paymentInfo);
	logInfo('updateMultiUponPaymentDeleteRes', resp);

	return resp;
};

export default handler;
