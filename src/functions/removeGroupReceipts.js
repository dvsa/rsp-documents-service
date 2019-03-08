/* eslint-env es6 */
import 'babel-polyfill';
import { doc } from 'serverless-dynamodb-client';
import GroupService from '../services/penaltyGroups';
import config from '../config';

/** @type GroupService */
let groupService;
const removeGroupReceipts = async (event, context, callback) => {
	if (!groupService) {
		await config.bootstrap();
		groupService = new GroupService(
			doc,
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
			config.snsTopicArn(),
		);
	}

	let { body } = event;

	if (typeof body === 'string') {
		// body is a string if invoked via http request rather than directly.
		body = JSON.parse(event.body);
	}

	const { receiptReferences } = body;

	console.log(body);

	groupService.removeGroupReceipts(event.pathParameters.id, receiptReferences, callback);
};

export default removeGroupReceipts;
