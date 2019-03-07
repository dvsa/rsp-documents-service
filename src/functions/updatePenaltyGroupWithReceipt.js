/* eslint-env es6 */
import 'babel-polyfill';
import { doc } from 'serverless-dynamodb-client';
import PenaltyGroupService from '../services/penaltyGroups';
import config from '../config';

/** @type {PenaltyGroupService} */
let penaltyGroupService;
const updatePenaltyGroupWithReceipt = async (event, context, callback) => {
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
	const {
		penaltyId, receiptReference, penaltyType, receiptReferences,
	} = paymentInfo;

	penaltyGroupService.updatePenaltyGroupWithReceipt(
		penaltyId,
		penaltyType,
		receiptReference,
		receiptReferences,
		callback,
	);
};

export default updatePenaltyGroupWithReceipt;
