import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
	DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand,
	BatchGetCommand, BatchWriteCommand, DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

export function databaseOptions(env = process.env) {
	return {
		region: env.REGION || 'eu-west-1',
		...(env.IS_OFFLINE ? { endpoint: 'http://localhost:8000' } : {}),
	};
}

const client = DynamoDBDocumentClient.from(
	new DynamoDBClient(databaseOptions()),
	{ marshallOptions: { removeUndefinedValues: true } },
);

/** @returns {never} */
export function databaseError(error) {
	// v3 rejects non-finite numbers before sending and uses name instead of v2's code.
	if (/^Special numeric value (NaN|Infinity|-Infinity) is not allowed$/.test(error.message)) {
		error.name = 'ValidationException';
	}
	if (error.code === undefined && error.name !== 'Error') error.code = error.name;
	throw error;
}

// Preserve the injected database interface while using only SDK v3 underneath.
export const doc = {
	get: (input) => ({ promise: () => client.send(new GetCommand(input)).catch(databaseError) }),
	put: (input) => ({ promise: () => client.send(new PutCommand(input)).catch(databaseError) }),
	query: (input) => ({ promise: () => client.send(new QueryCommand(input)).catch(databaseError) }),
	update: (input) => ({ promise: () => client.send(new UpdateCommand(input)).catch(databaseError) }),
	batchGet: (input) => ({ promise: () => client.send(new BatchGetCommand(input)).catch(databaseError) }),
	batchWrite: (input) => ({ promise: () => client.send(new BatchWriteCommand(input)).catch(databaseError) }),
	delete: (input) => ({ promise: () => client.send(new DeleteCommand(input)).catch(databaseError) }),
};
