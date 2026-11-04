const { OWNER } = require('./fixtures.cjs');

function localUrl(value, defaultPort) {
	const url = new URL(value);
	if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
		|| url.username || url.password || url.search || url.hash
		|| url.port !== String(defaultPort)) {
		throw new Error(`Only loopback HTTP on port ${defaultPort} is permitted`);
	}
	return url.toString().replace(/\/$/, '');
}

function configuration(env = process.env) {
	if (env.CI && env.CI !== 'false') throw new Error('Local integration tools must not run in CI');
	if (env.INTEGRATION_CONFIRM_LOCAL !== 'yes') {
		throw new Error('Set INTEGRATION_CONFIRM_LOCAL=yes after verifying the API uses local DynamoDB and no stream notifications');
	}
	const baseUrl = localUrl(env.INTEGRATION_BASE_URL || 'http://localhost:3000/dev', 3000);
	const dynamoUrl = localUrl(env.INTEGRATION_DYNAMODB_URL || 'http://localhost:8000', 8000);
	const lambdaUrl = localUrl(env.INTEGRATION_LAMBDA_URL || 'http://localhost:3002', 3002);
	const functionPrefix = env.INTEGRATION_FUNCTION_PREFIX || 'RSP-BackendApi-dev';
	if (!/^[A-Za-z0-9_-]+$/.test(functionPrefix)) throw new Error('Invalid offline function prefix');
	if (new URL(dynamoUrl).pathname !== '/') throw new Error('DynamoDB URL must not have a path');
	return {
		baseUrl, dynamoUrl, lambdaUrl, functionPrefix,
	};
}

function client(endpoint) {
	// Explicit fake credentials and endpoint: never resolve a profile or the AWS credential chain.
	const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
	const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
	return DynamoDBDocument.from(new DynamoDBClient({
		endpoint,
		region: 'eu-west-1',
		credentials: { accessKeyId: 'localIntegration', secretAccessKey: 'localIntegration' },
		maxAttempts: 1,
		requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
	}), { marshallOptions: { removeUndefinedValues: true } });
}

function entries(data, includeCreated = false) {
	const all = [
		...data.documents.map((item) => ({ table: 'penaltyDocuments', item })),
		...data.groups.map((item) => ({ table: 'penaltyGroups', item })),
	];
	if (includeCreated) {
		all.push({ table: 'penaltyDocuments', item: data.create });
		all.push(...data.createVariants.map((item) => ({ table: 'penaltyDocuments', item })));
		all.push({ table: 'penaltyDocuments', item: data.dummy });
		all.push(...data.groupPayload.Penalties.map((item) => ({ table: 'penaltyDocuments', item })));
		all.push({ table: 'penaltyGroups', item: { ID: data.createdGroupId } });
		all.push({ table: 'penaltyDocuments', item: { ID: '990099999999_FPN' } });
		all.push({ table: 'penaltyGroups', item: { ID: 'rspintegrationmissing' } });
	}
	return all;
}

function owned(item) {
	return item && item.IntegrationFixture === OWNER;
}

async function snapshot(db, data) {
	const originals = [];
	for (const entry of entries(data, true)) {
		const { Item } = await db.get({ TableName: entry.table, Key: { ID: entry.item.ID }, ConsistentRead: true });
		// Created records must be absent; never replace an existing user's record.
		const seeded = entries(data).some((candidate) => candidate.item.ID === entry.item.ID);
		if (Item && (!seeded || !owned(Item))) throw new Error('Fixture ID collision; no records were seeded');
		originals.push({ ...entry, original: Item });
	}
	return originals;
}

async function seed(db, data) {
	for (const entry of entries(data)) {
		await db.put({
			TableName: entry.table,
			Item: entry.item,
			ConditionExpression: 'attribute_not_exists(ID) OR IntegrationFixture = :owner',
			ExpressionAttributeValues: { ':owner': OWNER },
		});
	}
}

async function restore(db, originals, createdIds = new Set()) {
	for (const entry of originals) {
		const key = `${entry.table}/${entry.item.ID}`;
		const { Item } = await db.get({ TableName: entry.table, Key: { ID: entry.item.ID }, ConsistentRead: true });
		if (!Item) {
			if (entry.original) {
				await db.put({
					TableName: entry.table,
					Item: entry.original,
					ConditionExpression: 'attribute_not_exists(ID)',
				});
			}
			continue;
		}
		const marked = owned(Item);
		const created = createdIds.has(key) && (
			(entry.table === 'penaltyDocuments' && Item.Value?.paymentToken === OWNER)
			|| (entry.table === 'penaltyGroups'
				&& JSON.stringify(Item.PenaltyDocumentIds) === JSON.stringify(
					originals.filter((e) => createdIds.has(`${e.table}/${e.item.ID}`)
						&& e.table === 'penaltyDocuments' && e.item.Value?.inPenaltyGroup === true)
						.map((e) => e.item.ID),
				))
		);
		if (!marked && !created) throw new Error('Cleanup ownership check failed; inspect reserved fixture records locally');
		const condition = marked
			? { ConditionExpression: 'IntegrationFixture = :owner', ExpressionAttributeValues: { ':owner': OWNER } }
			: {
				ConditionExpression: entry.table === 'penaltyDocuments' ? '#v.paymentToken = :owner' : 'PenaltyDocumentIds = :ids',
				ExpressionAttributeValues: entry.table === 'penaltyDocuments' ? { ':owner': OWNER } : { ':ids': Item.PenaltyDocumentIds },
				...(entry.table === 'penaltyDocuments' ? { ExpressionAttributeNames: { '#v': 'Value' } } : {}),
			};
		if (entry.original) await db.put({ TableName: entry.table, Item: entry.original, ...condition });
		else await db.delete({ TableName: entry.table, Key: { ID: entry.item.ID }, ...condition });
	}
}

module.exports = {
	localUrl, configuration, client, entries, snapshot, seed, restore, owned,
};
