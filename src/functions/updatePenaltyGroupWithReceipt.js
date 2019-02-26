/* eslint-env es6 */
import 'babel-polyfill';
import { doc } from 'serverless-dynamodb-client';
import PenaltyGroupService from '../services/penaltyGroups';
import config from '../config';

/** @typedef {{ penaltyId: string, receiptReference: string, penaltyType: 'FPN'|'CDN'|'IM' }}
 * UpdatePenaltyGroupResponse */

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

	/** @type UpdatePenaltyGroupResponse */
	let paymentInfo = event.body;
	if (typeof paymentInfo === 'string') {
		paymentInfo = JSON.parse(event.body);
	}
	const { penaltyId, receiptReference, penaltyType } = paymentInfo;
	// id body document
	penaltyGroupService.updatePenaltyGroupWithReceipt(
		penaltyId,
		penaltyType,
		receiptReference,
		callback,
	);
};

export default updatePenaltyGroupWithReceipt;
