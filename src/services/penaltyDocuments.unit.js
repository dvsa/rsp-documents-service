import expect from 'expect';
import sinon from 'sinon';
import { DynamoDB } from 'aws-sdk';
import Service from './penaltyDocuments';
import config from '../config';
import hash from '../utils/hash';
import {
	aws, database, document, payment, payments, resolves, rejects,
} from '../test/helpers';

describe('penalty document behaviour with isolated AWS', () => {
	let db;
	let service;
	let clock;
	beforeEach(() => {
		db = database();
		service = new Service(db, 'documents', 'bucket', 'topic', 'sites.json', 'payment-url', 'token-arn', 3, 'payments-arn');
		service.maxBatchSize = 25;
		clock = sinon.useFakeTimers({ now: new Date(2024, 2, 15, 12).getTime(), toFake: ['Date'] });
		payments();
	});
	afterEach(() => clock.restore());

	describe('reading documents and payment information', () => {
		[null, undefined, [], [payment()]].forEach((value) => {
			it(`merges payment lookup ${JSON.stringify(value)}`, async () => {
				const item = document();
				resolves(db.get, { Item: item });
				const invoke = payments(value);
				const response = await service.getDocument(item.ID);
				expect(response.statusCode).toBe(200);
				const result = JSON.parse(response.body);
				expect(result.Origin).toBeUndefined();
				expect(result.Value.paymentStatus).toBe(value && value.length ? 'PAID' : 'UNPAID');
				if (value && value.length) {
					expect(result.Value).toMatchObject({
						paymentAuthCode: 'AUTH', paymentDate: 12345, paymentRef: 'REF', paymentMethod: 'CARD',
					});
				}
				expect(db.get.firstCall.args).toEqual([{ TableName: 'documents', Key: { ID: item.ID } }]);
				expect(invoke.firstCall.args[1]).toEqual({
					FunctionName: 'payments-arn', Payload: JSON.stringify({ body: JSON.stringify({ ids: [item.ID] }) }),
				});
			});
		});
		it('returns a not-found response and recognizes empty objects', async () => {
			resolves(db.get, {});
			expect(await service.getDocument('missing')).toMatchObject({ statusCode: 404, body: '{"error":"ITEM NOT FOUND"}' });
			expect(service.isEmpty({})).toBe(true);
			expect(service.isEmpty({ Item: {} })).toBe(false);
		});
		['database', 'payment service', 'invalid payment JSON'].forEach((failure) => {
			it(`returns errors from ${failure}`, async () => {
				resolves(db.get, { Item: document() });
				if (failure === 'database') rejects(db.get);
				else if (failure === 'payment service') aws('invoke', undefined, new Error('invocation failed'));
				else aws('invoke', { Payload: '{' });
				const result = await service.getDocument('id');
				expect(result.statusCode).toBe(400);
				expect(JSON.parse(result.body).message).toEqual(expect.any(String));
			});
		});
	});

	describe('creating and disabling documents', () => {
		it('defaults origin, strips client payment metadata and writes conditionally', async () => {
			const item = document();
			delete item.Origin;
			Object.assign(item, { paymentAuthCode: 'fake', paymentDate: 1, paymentRef: 'fake' });
			resolves(db.put);
			const response = await service.createDocument(item);
			expect(response.statusCode).toBe(200);
			const params = db.put.firstCall.args[0];
			expect(params).toMatchObject({
				TableName: 'documents',
				ConditionExpression: 'attribute_not_exists(#ID)',
				ExpressionAttributeNames: { '#ID': 'ID' },
				Item: {
					ID: item.ID, Enabled: true, Origin: 'APP', VehicleRegistration: item.Value.vehicleDetails.regNo, Offset: Date.now() / 1000,
				},
			});
			expect(params.Item.Hash).toBe(hash(item.ID, item.Value, true));
			expect(item).not.toHaveProperty('paymentAuthCode');
			expect(item).not.toHaveProperty('paymentDate');
			expect(item).not.toHaveProperty('paymentRef');
		});
		it('rejects schema errors without writing', async () => {
			const item = document();
			item.Value.penaltyType = 'invalid';
			expect((await service.createDocument(item)).statusCode).toBe(400);
			expect(db.put.called).toBe(false);
		});
		['put', 'invoke'].forEach((stage) => {
			it(`returns create errors at ${stage}`, async () => {
				if (stage === 'put') rejects(db.put);
				else aws('invoke', undefined, new Error('payment failed'));
				const response = await service.createDocument(document());
				expect(response.statusCode).toBe(400);
				expect(JSON.parse(response.body).message).toEqual(expect.any(String));
			});
		});
		[null, undefined, [], [payment()]].forEach((value) => {
			it(`checks authoritative payments before deletion: ${JSON.stringify(value)}`, async () => {
				payments(value);
				resolves(db.update);
				const item = document();
				const response = await service.deleteDocument(item.ID, item);
				if (value && value.length) {
					expect(response).toMatchObject({ statusCode: 400, body: '{"err":"Cannot remove document that is paid"}' });
					expect(db.update.called).toBe(false);
				} else {
					expect(response.statusCode).toBe(200);
					const params = db.update.firstCall.args[0];
					expect(params.ConditionExpression).toBe('attribute_exists(#ID) AND #Hash=:clientHash AND #Enabled = :Enabled');
					expect(params.ExpressionAttributeValues).toEqual({
						':clientHash': item.Hash,
						':Enabled': true,
						':Hash': hash(item.ID, item.Value, false),
						':not_enabled': false,
						':Offset': Date.now() / 1000,
					});
					expect(JSON.parse(response.body)).toMatchObject({ ID: item.ID, Enabled: false, Hash: hash(item.ID, item.Value, false) });
				}
			});
		});
		it('rejects invalid deletion data', async () => {
			const item = document();
			item.Value.penaltyType = 'invalid';
			expect((await service.deleteDocument(item.ID, item)).statusCode).toBe(400);
			expect(db.update.called).toBe(false);
		});
		['invoke', 'update'].forEach((stage) => {
			it(`reports deletion ${stage} errors`, async () => {
				if (stage === 'invoke') aws('invoke', undefined, new Error('payment failed'));
				else rejects(db.update);
				const item = document();
				expect((await service.deleteDocument(item.ID, item)).statusCode).toBe(400);
			});
		});
	});

	describe('listing documents', () => {
		[undefined, 0, 100].forEach((offset) => {
			it(`constructs the offset query for ${offset}`, async () => {
				resolves(db.query, { Count: 0, Items: [] });
				const response = await service.getDocuments(offset, 'undefined');
				expect(JSON.parse(response.body)).toEqual({ Items: [] });
				const params = db.query.firstCall.args[0];
				expect(params).toMatchObject({ TableName: 'documents', IndexName: 'ByOffset', Limit: 25 });
				expect(params).not.toHaveProperty('ExclusiveStartKey');
				if (offset === undefined) expect(params).not.toHaveProperty('KeyConditionExpression');
				else {
					expect(params.KeyConditionExpression).toBe('Origin = :Origin and #Offset >= :Offset');
					expect(params.ExpressionAttributeValues).toEqual({
						':Origin': 'APP', ':Offset': offset === 0 ? new Date(2024, 2, 12).getTime() / 1000 : 100,
					});
				}
			});
		});
		it('uses pagination, removes stale metadata and merges authoritative payments', async () => {
			const item = document();
			Object.assign(item.Value, {
				paymentStatus: 'UNPAID', paymentAuthCode: 'stale', paymentDate: 0, paymentRef: 'stale', paymentMethod: 'stale',
			});
			const next = { ID: item.ID, Offset: 123, Origin: 'APP' };
			resolves(db.query, { Count: 1, Items: [item], LastEvaluatedKey: next });
			payments([payment()]);
			const response = await service.getDocuments(10, next);
			const result = JSON.parse(response.body);
			expect(result.LastEvaluatedKey).toEqual(next);
			expect(result.Items[0]).not.toHaveProperty('Origin');
			expect(result.Items[0].Value).toMatchObject({
				paymentStatus: 'PAID', paymentAuthCode: 'AUTH', paymentDate: 12345, paymentRef: 'REF', paymentMethod: 'CARD',
			});
			expect(db.query.firstCall.args[0].ExclusiveStartKey).toEqual(next);
		});
		['query', 'payment'].forEach((stage) => {
			it(`returns listing errors at ${stage}`, async () => {
				resolves(db.query, { Count: 1, Items: [document()] });
				if (stage === 'query') rejects(db.query);
				else aws('invoke', undefined, new Error('payment failed'));
				expect((await service.getDocuments(1, 'undefined')).statusCode).toBe(400);
			});
		});
	});

	describe('conditional updates', () => {
		[
			{
				hashValue: undefined, origin: undefined, old: undefined, paid: true, notify: true,
			},
			{
				hashValue: 'New', origin: 'APP', old: { Origin: 'PORTAL' }, paid: true, notify: true,
			},
			{
				hashValue: '<NewHash>', origin: 'APP', old: { Origin: 'APP' }, paid: true, notify: false,
			},
			{
				hashValue: 'matchinghash', origin: 'PORTAL', old: undefined, paid: true, notify: false,
			},
			{
				hashValue: 'matchinghash', origin: 'APP', old: { Origin: 'PORTAL' }, paid: false, notify: false,
			},
			{
				hashValue: 'matchinghash', origin: 'APP', old: { Origin: 'APP' }, paid: true, notify: false,
			},
			{
				hashValue: 'New', origin: undefined, old: undefined, paid: true, notify: true,
			},
			{
				hashValue: '', origin: 'APP', old: undefined, paid: false, notify: false,
			},
		].forEach((scenario) => {
			it(`preserves hash/origin/payment rules: ${JSON.stringify(scenario)}`, async () => {
				const item = document();
				item.Hash = scenario.hashValue;
				if (scenario.origin === undefined) delete item.Origin;
				else item.Origin = scenario.origin;
				Object.assign(item.Value, {
					paymentStatus: scenario.paid ? 'PAID' : 'UNPAID',
					paymentAuthCode: 'AUTH',
					paymentDate: 12345,
					paymentRef: 'REF',
					paymentMethod: 'CARD',
				});
				let persistedValue;
				db.update.callsFake((params) => {
					persistedValue = JSON.parse(JSON.stringify(params.ExpressionAttributeValues[':Value']));
					return { promise: async () => ({ Attributes: scenario.old }) };
				});
				const publish = aws('publish', { MessageId: 'message' });
				const response = await service.updateItem(item);
				if (!scenario.hashValue || scenario.hashValue === '<NewHash>') {
					// The current validator requires an alphanumeric hash: the fallback
					// sentinel is unreachable for a missing/empty hash. Do not fake validation.
					expect(response.status).toBe(400);
					expect(response.error).toContain('Hash');
					expect(db.update.called).toBe(false);
					expect(publish.called).toBe(false);
					return;
				}
				expect(response.status).toBe(200);
				expect(response.item).toMatchObject({
					ID: item.ID, Origin: scenario.origin || 'APP', VehicleRegistration: item.Value.vehicleDetails.regNo, Offset: Date.now() / 1000,
				});
				const params = db.update.firstCall.args[0];
				expect(params).toMatchObject({ TableName: 'documents', Key: { ID: item.ID }, ReturnValues: 'UPDATED_OLD' });
				expect(params.ConditionExpression).toBe('attribute_not_exists(#ID) OR (#Origin = :PortalOrigin  and attribute_exists(#ID)) OR (#Origin = :AppOrigin and attribute_exists(#ID) AND #Hash=:clientHash) OR (#Origin = :AppOrigin and attribute_exists(#ID) AND :isNewHash = :newHashTrue AND #Enabled = :notEnabled)');
				expect(params.ExpressionAttributeValues).toMatchObject({
					':clientHash': scenario.hashValue || '<NewHash>',
					':isNewHash': !scenario.hashValue || ['New', '<NewHash>'].includes(scenario.hashValue),
					':newHashTrue': true,
					':notEnabled': false,
					':AppOrigin': 'APP',
					':PortalOrigin': 'PORTAL',
					':Enabled': true,
					':Origin': scenario.origin || 'APP',
				});
				expect(params.ExpressionAttributeNames).toEqual({
					'#ID': 'ID',
					'#Hash': 'Hash',
					'#Enabled': 'Enabled',
					'#Value': 'Value',
					'#Offset': 'Offset',
					'#Origin': 'Origin',
					'#VehicleRegistration': 'VehicleRegistration',
				});
				expect(params.UpdateExpression).toBe('set #Value = :Value, #Hash = :Hash, #Offset = :Offset, #Enabled = :Enabled, #Origin = :Origin, #VehicleRegistration = :VehicleRegistration');
				expect(persistedValue).not.toHaveProperty('paymentAuthCode');
				expect(persistedValue).not.toHaveProperty('paymentDate');
				expect(persistedValue).not.toHaveProperty('paymentRef');
				expect(persistedValue).not.toHaveProperty('paymentMethod');
				expect(params.ExpressionAttributeValues[':Hash']).toBe(hash(item.ID, persistedValue, item.Enabled));
				expect(response.item.Value.paymentStatus).toBe(scenario.paid ? 'PAID' : 'UNPAID');
				if (scenario.paid) expect(response.item.Value).toMatchObject({ paymentAuthCode: 'AUTH', paymentDate: 12345 });
				expect(publish.called).toBe(scenario.notify);
			});
		});
		it('returns a per-item error when DynamoDB rejects a stale hash', async () => {
			rejects(db.update, 'ConditionalCheckFailedException');
			const response = await service.updateItem(document());
			expect(response.status).toBe(400);
			expect(response.error.message).toBe('ConditionalCheckFailedException');
			expect(response.item.Value.paymentStatus).toBe('UNPAID');
		});
		it('does not write invalid items', async () => {
			const item = document();
			item.Value.penaltyType = 'invalid';
			const response = await service.updateItem(item);
			expect(response.status).toBe(400);
			expect(response.error).toEqual(expect.any(String));
			expect(db.update.called).toBe(false);
		});
		it('merges authoritative payments and updates all documents in order', async () => {
			const items = [document(), document()];
			items[1].ID = '920600000112_FPN';
			items[1].Value.referenceNo = '920600000112';
			payments([payment(items[0].ID)]);
			resolves(db.update, { Attributes: { Origin: 'APP' } });
			const response = await service.updateDocuments(items);
			expect(response.statusCode).toBe(200);
			expect(JSON.parse(response.body).Items.map((r) => [r.status, r.item.ID, r.item.Value.paymentStatus]))
				.toEqual([[200, items[0].ID, 'PAID'], [200, items[1].ID, 'UNPAID']]);
			expect(db.update.getCalls().map((call) => call.args[0].Key.ID)).toEqual(items.map((item) => item.ID));
		});
		it('reports failure to invoke the payment service', async () => {
			aws('invoke', undefined, new Error('payment unavailable'));
			const response = await service.updateDocuments([document()]);
			expect(response.statusCode).toBe(400);
			expect(JSON.parse(response.body).message).toBe('payment unavailable');
		});
		it('reports an unexpected item update rejection instead of dropping it', async () => {
			// A synchronous driver failure escapes updateItem's promise executor.
			db.update.throws(new Error('driver failure'));
			const response = await service.updateDocuments([document()]);
			expect(response.statusCode).toBe(400);
			expect(db.update.calledOnce).toBe(true);
		});
	});

	describe('payment updates and reversals', () => {
		it('updates paid documents and publishes correctly shaped APNS notifications', async () => {
			const item = document();
			item.Origin = 'APP';
			resolves(db.get, { Item: item });
			resolves(db.put);
			const publish = aws('publish', { MessageId: 'message' });
			const info = {
				id: item.ID, paymentStatus: 'PAID', paymentAmount: '50', penaltyType: 'FPN',
			};
			const response = await service.updateDocumentWithPayment(info);
			expect(response.statusCode).toBe(200);
			expect(db.put.firstCall.args[0]).toMatchObject({
				TableName: 'documents',
				ConditionExpression: 'attribute_exists(#ID)',
				ExpressionAttributeNames: { '#ID': 'ID' },
				Item: { Hash: hash(item.ID, item.Value, item.Enabled), Value: { paymentStatus: 'PAID' } },
			});
			const params = publish.firstCall.args[1];
			expect(params).toMatchObject({ TopicArn: 'topic', MessageStructure: 'json', Subject: 'Payment has been made!' });
			const message = JSON.parse(params.Message);
			const expected = {
				aps: { 'content-available': 1 }, site: item.Value.siteCode, offset: item.Offset, refNo: item.Value.referenceNo, regNo: item.Value.vehicleDetails.regNo, type: 'FPN', status: 'PAID', amount: 50,
			};
			expect(JSON.parse(message.APNS)).toEqual(expected);
			expect(JSON.parse(message.APNS_SANDBOX)).toEqual(expected);
		});
		it('does not send payment notifications for portal documents', async () => {
			const item = document();
			item.Origin = 'PORTAL';
			resolves(db.get, { Item: item });
			resolves(db.put);
			const publish = aws('publish', {});
			expect((await service.updateDocumentWithPayment({ id: item.ID, paymentStatus: 'PAID' })).statusCode).toBe(200);
			expect(publish.called).toBe(false);
		});
		it('handles callback notification failures without throwing', () => {
			aws('publish', undefined, new Error('notification failed'));
			expect(() => service.sendPaymentNotification({ paymentAmount: '50' }, document())).not.toThrow();
		});
		['get', 'put'].forEach((stage) => {
			it(`reports payment ${stage} errors`, async () => {
				resolves(db.get, { Item: document() });
				rejects(db[stage]);
				expect((await service.updateDocumentWithPayment({ id: 'id' })).statusCode).toBe(400);
			});
			it(`reports reversal ${stage} errors`, async () => {
				resolves(db.get, { Item: document() });
				rejects(db[stage]);
				expect((await service.updateDocumentUponPaymentDelete({ id: 'id', paymentStatus: 'UNPAID' })).statusCode).toBe(400);
			});
		});
		it('reverses document payments and conditionally persists the new hash', async () => {
			const item = document();
			resolves(db.get, { Item: item });
			resolves(db.put);
			const response = await service.updateDocumentUponPaymentDelete({ id: item.ID, paymentStatus: 'UNPAID' });
			expect(response.statusCode).toBe(200);
			expect(db.put.firstCall.args[0]).toEqual({
				TableName: 'documents',
				Item: { ...item, Hash: hash(item.ID, item.Value, item.Enabled), Offset: Date.now() / 1000 },
				ConditionExpression: 'attribute_exists(#ID)',
				ExpressionAttributeNames: { '#ID': 'ID' },
			});
		});
		it('handles an empty reversal without updating any group', async () => {
			expect((await service.updateMultipleUponPaymentDelete({ penaltyDocumentIds: [] })).statusCode).toBe(200);
			expect(db.get.called).toBe(false);
			expect(db.put.called).toBe(false);
		});
		['PAID', 'UNPAID'].forEach((status) => {
			it(`reverses children and only persists groups needing transition from ${status}`, async () => {
				const item = document();
				item.penaltyGroupId = 'group';
				item.Value.paymentStatus = 'PAID';
				const group = { ID: 'group', PaymentStatus: status };
				db.get.onFirstCall().returns({ promise: async () => ({ Item: item }) });
				db.get.onSecondCall().returns({ promise: async () => ({ Item: group }) });
				resolves(db.put);
				const response = await service.updateMultipleUponPaymentDelete({ penaltyDocumentIds: [item.ID] });
				expect(response.statusCode).toBe(200);
				expect(db.get.secondCall.args[0]).toEqual({ TableName: config.dynamodbPenaltyGroupTable(), Key: { ID: 'group' } });
				expect(db.put.callCount).toBe(status === 'PAID' ? 2 : 1);
				expect(item.Value.paymentStatus).toBe('UNPAID');
				expect(item.Hash).toBe(hash(item.ID, item.Value, item.Enabled));
				if (status === 'PAID') expect(db.put.secondCall.args[0].Item).toEqual({ ID: 'group', PaymentStatus: 'UNPAID', Offset: Date.now() / 1000 });
			});
		});
		it('propagates multi-document reversal database errors', async () => {
			rejects(db.get);
			expect((await service.updateMultipleUponPaymentDelete({ penaltyDocumentIds: ['id'] })).statusCode).toBe(400);
		});
		it('writes payment start time with an existence condition', async () => {
			resolves(db.update);
			expect((await service.updateDocumentWithPaymentStartTime('id')).statusCode).toBe(200);
			expect(db.update.firstCall.args[0]).toEqual({
				TableName: 'documents',
				Key: { ID: 'id' },
				UpdateExpression: 'set #Value.#paymentStartTime = :paymentStartTime',
				ConditionExpression: 'attribute_exists(#ID)',
				ExpressionAttributeNames: { '#ID': 'ID', '#Value': 'Value', '#paymentStartTime': 'paymentStartTime' },
				ExpressionAttributeValues: { ':paymentStartTime': Date.now() / 1000 },
			});
		});
	});

	describe('AWS sites and streams', () => {
		it('returns S3 JSON as a raw string with the correct object key', async () => {
			const getObject = aws('getObject', { Body: Buffer.from('[{"name":"site"}]') });
			expect(await service.getSites()).toMatchObject({ statusCode: 200, body: '[{"name":"site"}]' });
			expect(getObject.firstCall.args[1]).toEqual({ Bucket: 'bucket', Key: 'sites.json' });
		});
		it('returns S3 errors', async () => {
			aws('getObject', undefined, new Error('missing object'));
			expect((await service.getSites()).statusCode).toBe(400);
		});
		it('unmarshalls real DynamoDB attribute maps and publishes the minimum offset', async () => {
			const publish = aws('publish', { MessageId: 'stream-message' });
			const Records = [300, 100, 200].map((Offset) => ({
				dynamodb: {
					NewImage: DynamoDB.Converter.marshall({
						ID: 'id', Offset, Enabled: true, Value: { penaltyType: 'FPN' },
					}),
				},
			}));
			expect(await service.streamDocuments({ Records })).toBe('Successfully processed 3 records.');
			const params = publish.firstCall.args[1];
			expect(params).toMatchObject({ TopicArn: 'topic', Subject: 'New documents are available!', MessageStructure: 'json' });
			const message = JSON.parse(params.Message);
			expect(JSON.parse(message.APNS)).toEqual({ aps: { 'content-available': 1 }, offset: 100, site: 0 });
			expect(JSON.parse(message.APNS_SANDBOX)).toEqual(JSON.parse(message.APNS));
		});
		it('returns notification failures to the stream caller', async () => {
			aws('publish', undefined, new Error('SNS unavailable'));
			const Records = [{ dynamodb: { NewImage: { Offset: { N: '100' } } } }];
			expect(await service.streamDocuments({ Records })).toBe('Unable to send message. Error JSON: "SNS unavailable"');
		});
	});
});
