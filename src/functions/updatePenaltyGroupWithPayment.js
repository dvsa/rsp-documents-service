/* eslint-env es6 */
import { doc } from 'serverless-dynamodb-client';
import PenaltyGroupService from '../services/penaltyGroups';

const penaltyGroupService = new PenaltyGroupService(
	doc,
	process.env.DYNAMODB_PENALTY_GROUP_TABLE,
	process.env.BUCKETNAME,
	process.env.SNSTOPICARN,
	process.env.SITERESOURCE,
	process.env.PAYMENTURL,
	process.env.TOKEN_SERVICE_ARN,
	process.env.DAYS_TO_HOLD || 3,
);

export default (event, context, callback) => {

	const paymentInfo = {
		id: event.body.id,
		paymentStatus: event.body.paymentStatus,
	};

	console.log(JSON.stringify(paymentInfo, null, 2));
	// id body document
	penaltyGroupService.updatePenaltyGroupWithPayment(paymentInfo, callback);
};
