import createResponse from './createResponse';
import HttpStatus from './httpStatusCode';
import createErrorResponse from './createErrorResponse';

export default async function removeReceipts(
	tableName, penaltyReference,
	receiptReferences, callback,
) {
	/** @type {{[id: string]: string}} */
	const names = {};

	receiptReferences.forEach((receiptReference, index) => {
		names[`:p${index}`] = receiptReference;
	});

	const updateExpression = Object.keys(receiptReferences).map(ref => `PendingTransactions.${ref}`).join(', ');

	const updateParams = {
		TableName: tableName,
		Key: { ID: penaltyReference },
		UpdateExpression: `REMOVE ${updateExpression}`,
		ExpressionAttributeNames: names,
	};

	try {
		const response = await this.db.update(updateParams).promise();
		callback(null, createResponse({
			statusCode: HttpStatus.OK,
			body: response,
		}));
	} catch (err) {
		callback(null, createErrorResponse({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, err }));
	}
}
