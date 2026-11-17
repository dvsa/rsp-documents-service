import expect from 'expect';
import sinon from 'sinon';
import Service from './penaltyGroups';
import hash from '../utils/hash';
import payload from '../../mock-data/fake-create-penalty-group.json';
import {
	aws, database, document, resolves, rejects,
} from '../test/helpers';

describe('penalty group workflows with isolated AWS', () => {
	let db;
	let service;
	let clock;
	beforeEach(() => {
		db = database();
		service = new Service(db, 'documents', 'groups', 'topic');
		service.maxBatchSize = 25;
		clock = sinon.useFakeTimers({ now: 1700000000000, toFake: ['Date'] });
	});
	afterEach(() => clock.restore());

	function creation() {
		return JSON.parse(JSON.stringify(payload));
	}

	function groupAndChildren(status = 'UNPAID', origin = 'APP') {
		const fpn = document();
		const im = document();
		im.ID = '1575850000134_IM';
		im.Value.penaltyType = 'IM';
		im.Value.referenceNo = '157585-0-134-IM';
		fpn.Value.paymentStatus = status;
		im.Value.paymentStatus = status;
		const group = {
			ID: 'group', PenaltyDocumentIds: [fpn.ID, im.ID], PaymentStatus: status, Enabled: true, Origin: origin,
		};
		resolves(db.get, { Item: group });
		resolves(db.batchGet, { Responses: { documents: [fpn, im] } });
		return { group, fpn, im };
	}

	describe('creation validation and atomic batch shape', () => {
		[[], [{ ID: 'old', Enabled: false }]].forEach((existing) => {
			it(`creates groups when existing children are ${JSON.stringify(existing)}`, async () => {
				resolves(db.batchGet, { Responses: { documents: existing } });
				resolves(db.batchWrite);
				const input = creation();
				input.VehicleRegistration = 'ab12cd';
				const response = await service.createPenaltyGroup(input);
				expect(response.statusCode).toBe(201);
				const result = JSON.parse(response.body);
				expect(result).toMatchObject({
					ID: Service.generatePenaltyGroupId(input.Timestamp, input.SiteCode),
					VehicleRegistration: 'AB12CD',
					PaymentStatus: 'UNPAID',
					Origin: 'APP',
					Enabled: true,
					TotalAmount: input.Penalties[0].Value.penaltyAmount,
					Offset: Date.now() / 1000,
				});
				const requests = db.batchWrite.firstCall.args[0].RequestItems;
				expect(requests.documents).toHaveLength(1);
				const penalty = requests.documents[0].PutRequest.Item;
				expect(penalty).toMatchObject({
					inPenaltyGroup: true, penaltyGroupId: result.ID, Origin: 'APP', Offset: Date.now() / 1000, VehicleRegistration: input.Penalties[0].Value.vehicleDetails.regNo,
				});
				expect(penalty.Hash).toBe(hash(penalty.ID, penalty.Value, penalty.Enabled));
				const persistedGroup = requests.groups[0].PutRequest.Item;
				expect(persistedGroup).not.toHaveProperty('Penalties');
				expect(persistedGroup.PenaltyDocumentIds).toEqual([penalty.ID]);
				expect(persistedGroup.Hash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
				expect(db.batchGet.firstCall.args[0]).toEqual({ RequestItems: { documents: { Keys: [{ ID: input.Penalties[0].ID }] } } });
			});
		});
		it('preserves explicit origins when enriching a group internally', () => {
			const input = creation();
			input.Origin = 'PORTAL';
			input.Penalties[0].Origin = 'PORTAL';
			// Creation's external schema does not accept a group Origin; this helper
			// also handles internally supplied groups without overriding origins.
			// eslint-disable-next-line no-underscore-dangle
			const result = service._enrichPenaltyGroupRequest(input);
			expect(result.Origin).toBe('PORTAL');
			expect(result.Penalties[0].Origin).toBe('PORTAL');
		});
		it('rejects duplicate enabled children without writing', async () => {
			resolves(db.batchGet, { Responses: { documents: [{ ID: 'duplicate', Enabled: true }] } });
			const response = await service.createPenaltyGroup(creation());
			expect(response.statusCode).toBe(400);
			expect(JSON.parse(response.body)).toMatchObject({ errCode: 'GroupDuplicateReference', errBody: { clashingIds: ['duplicate'] } });
			expect(db.batchWrite.called).toBe(false);
		});
		it('rejects malformed schemas before reading the database', async () => {
			const response = await service.createPenaltyGroup({});
			expect(response.statusCode).toBe(400);
			expect(JSON.parse(response.body).errCode).toBe('GroupValidation');
			expect(db.batchGet.called).toBe(false);
		});
		it('returns service unavailable for a failed batch write', async () => {
			resolves(db.batchGet, { Responses: { documents: [] } });
			rejects(db.batchWrite);
			const response = await service.createPenaltyGroup(creation());
			expect(response.statusCode).toBe(503);
			expect(response.body).toContain('database unavailable');
		});
		it('propagates pre-validation read failures (existing API error boundary)', async () => {
			rejects(db.batchGet);
			await expect(service.createPenaltyGroup(creation())).rejects.toThrow('database unavailable');
			expect(db.batchWrite.called).toBe(false);
		});
		it('generates stable IDs for positive and negative site codes', () => {
			const timestamp = 1700000000.123;
			expect(Service.generatePenaltyGroupId(timestamp, 23)).toBe(parseInt('17000000001230023', 10).toString(36));
			expect(Service.generatePenaltyGroupId(timestamp, -23)).toBe(parseInt('17000000001231023', 10).toString(36));
		});
	});

	describe('reads and payment categories', () => {
		it('joins children into categories with independent paid statuses', async () => {
			const { group, fpn, im } = groupAndChildren();
			fpn.Value.paymentStatus = 'PAID';
			const unsupported = document();
			unsupported.Value.penaltyType = 'UNKNOWN';
			resolves(db.batchGet, { Responses: { documents: [fpn, im, unsupported] } });
			const response = await service.getPenaltyGroup('group');
			expect(response.statusCode).toBe(200);
			const result = JSON.parse(response.body);
			expect(result).not.toHaveProperty('PenaltyDocumentIds');
			expect(result.Payments).toEqual([
				{
					PaymentCategory: 'FPN', TotalAmount: 50, PaymentStatus: 'PAID', Penalties: [fpn],
				},
				{
					PaymentCategory: 'IM', TotalAmount: 50, PaymentStatus: 'UNPAID', Penalties: [im],
				},
			]);
			expect(db.get.firstCall.args[0]).toEqual({ TableName: 'groups', Key: { ID: group.ID } });
			expect(db.batchGet.firstCall.args[0]).toEqual({ RequestItems: { documents: { Keys: [{ ID: fpn.ID }, { ID: im.ID }] } } });
		});
		it('returns 404 without fetching children for an unknown group', async () => {
			resolves(db.get, {});
			expect(await service.getPenaltyGroup('missing')).toMatchObject({ statusCode: 404, body: '{"error":"Penalty Group missing not found"}' });
			expect(db.batchGet.called).toBe(false);
		});
		['get', 'batchGet'].forEach((stage) => {
			it(`returns service unavailable when ${stage} fails`, async () => {
				groupAndChildren();
				rejects(db[stage]);
				const response = await service.getPenaltyGroup('group');
				expect(response.statusCode).toBe(503);
				expect(response.body).toContain(stage === 'get' ? 'Problem fetching penaltyGroup' : 'Problem fetching penaltyDocuments');
			});
		});
		it('queries groups with exclusive offset and configured limit', async () => {
			const result = { Items: [{ ID: 'group' }], LastEvaluatedKey: { ID: 'group' } };
			resolves(db.query, result);
			const response = await service.listPenaltyGroups(100);
			expect(JSON.parse(response.body)).toEqual(result);
			expect(db.query.firstCall.args[0]).toEqual({
				TableName: 'groups',
				IndexName: 'ByOffset',
				Limit: 25,
				KeyConditionExpression: '#Origin = :Origin and #Offset > :Offset',
				ExpressionAttributeNames: { '#Offset': 'Offset', '#Origin': 'Origin' },
				ExpressionAttributeValues: { ':Offset': 100, ':Origin': 'APP' },
			});
		});
	});

	describe('deleting wholly unpaid and partly paid groups', () => {
		it('disables unpaid groups before all children and recalculates child hashes', async () => {
			const { fpn, im } = groupAndChildren();
			resolves(db.update);
			expect((await service.delete('group')).statusCode).toBe(204);
			expect(db.update.callCount).toBe(3);
			expect(db.update.firstCall.args[0]).toEqual({
				TableName: 'groups',
				Key: { ID: 'group' },
				UpdateExpression: 'set #e = :e, #o = :o',
				ExpressionAttributeNames: { '#e': 'Enabled', '#o': 'Offset' },
				ExpressionAttributeValues: { ':e': false, ':o': Date.now() / 1000 },
			});
			[fpn, im].forEach((item, index) => {
				expect(db.update.getCall(index + 1).args[0]).toEqual({
					TableName: 'documents',
					Key: { ID: item.ID },
					UpdateExpression: 'set #e = :e, #o = :o, #h = :h',
					ExpressionAttributeNames: { '#e': 'Enabled', '#o': 'Offset', '#h': 'Hash' },
					ExpressionAttributeValues: { ':e': false, ':o': Date.now() / 1000, ':h': hash(item.ID, item.Value, false) },
				});
			});
		});
		it('preserves paid children, recomputes totals, and removes only unpaid children', async () => {
			const { fpn, im } = groupAndChildren();
			fpn.Value.paymentStatus = 'PAID';
			resolves(db.put);
			resolves(db.delete);
			expect((await service.delete('group')).statusCode).toBe(204);
			expect(db.put.firstCall.args[0]).toMatchObject({
				TableName: 'groups',
				Item: {
					ID: 'group',
					PaymentStatus: 'PAID',
					Enabled: false,
					PenaltyDocumentIds: [fpn.ID],
					TotalAmount: fpn.Value.penaltyAmount,
					VehicleRegistration: fpn.Value.vehicleDetails.regNo,
					Offset: Date.now() / 1000,
				},
			});
			expect(db.put.firstCall.args[0].Item.Hash).toMatch(/^[a-f0-9]{64}$/);
			expect(db.delete.firstCall.args[0]).toEqual({ TableName: 'documents', Key: { ID: im.ID } });
			expect(db.delete.calledOnce).toBe(true);
			expect(db.update.called).toBe(false);
		});
		it('keeps wholly paid children rather than deleting them', async () => {
			const { fpn, im } = groupAndChildren('PAID');
			resolves(db.put);
			expect((await service.delete('group')).statusCode).toBe(204);
			expect(db.put.firstCall.args[0].Item).toMatchObject({ TotalAmount: 100, PenaltyDocumentIds: [im.ID, fpn.ID] });
			expect(db.delete.called).toBe(false);
		});
		['batchGet', 'update', 'put', 'delete'].forEach((stage) => {
			it(`returns deletion errors from ${stage}`, async () => {
				const { fpn } = groupAndChildren();
				if (stage === 'put' || stage === 'delete') fpn.Value.paymentStatus = 'PAID';
				resolves(db.put);
				resolves(db.delete);
				rejects(db[stage]);
				const response = await service.delete('group');
				expect(response.statusCode).toBe(400);
				expect(response.body).toContain('database unavailable');
			});
		});
	});

	describe('updating group payments', () => {
		[
			['PAID', 'PAID', 'APP', true],
			['PAID', 'UNPAID', 'APP', false],
			['PAID', 'PAID', 'PORTAL', true],
			['PAID', 'UNPAID', 'PORTAL', false],
			['UNPAID', 'UNPAID', 'APP', true],
			['UNPAID', 'PAID', 'PORTAL', false],
		].forEach(([newStatus, otherStatus, origin, updatesGroup]) => {
			it(`updates ${newStatus}, other penalties ${otherStatus}, origin ${origin}`, async () => {
				const { fpn, im } = groupAndChildren(newStatus === 'PAID' ? 'UNPAID' : 'PAID', origin);
				im.Value.paymentStatus = otherStatus;
				resolves(db.batchWrite);
				resolves(db.put);
				const publish = aws('publish', { MessageId: 'message' });
				const response = await service.updatePenaltyGroupWithPayment({ id: 'group', penaltyType: 'FPN', paymentStatus: newStatus });
				expect(response.statusCode).toBe(200);
				expect(db.batchWrite.firstCall.args[0]).toEqual({ RequestItems: { documents: [{ PutRequest: { Item: fpn } }] } });
				expect(fpn.Value.paymentStatus).toBe(newStatus);
				expect(fpn.Offset).toBe(Date.now() / 1000);
				expect(db.put.called).toBe(updatesGroup);
				if (updatesGroup) {
					expect(db.put.firstCall.args[0]).toMatchObject({
						TableName: 'groups',
						Item: { PaymentStatus: newStatus, Offset: Date.now() / 1000 },
						ConditionExpression: 'attribute_exists(#ID)',
						ExpressionAttributeNames: { '#ID': 'ID' },
					});
				}
				expect(publish.called).toBe(origin === 'APP');
				if (origin === 'APP') {
					const params = publish.firstCall.args[1];
					expect(params).toMatchObject({ TopicArn: 'topic', Subject: 'Payment has been made!', MessageStructure: 'json' });
					const message = JSON.parse(params.Message);
					const expected = {
						aps: { 'content-available': 1 }, site: fpn.Value.siteCode, offset: fpn.Offset, refNo: 'group', regNo: fpn.Value.vehicleDetails.regNo, type: 'FPN', status: newStatus, amount: 50,
					};
					expect(JSON.parse(message.APNS)).toEqual(expected);
					expect(JSON.parse(message.APNS_SANDBOX)).toEqual(expected);
				}
			});
		});
		['get', 'batchGet', 'batchWrite', 'put'].forEach((stage) => {
			it(`returns payment failure from ${stage}`, async () => {
				groupAndChildren('PAID');
				resolves(db.batchWrite);
				rejects(db[stage]);
				const result = await service.updatePenaltyGroupWithPayment({ id: 'group', penaltyType: 'FPN', paymentStatus: 'PAID' });
				expect(result.statusCode).toBe(500);
				expect(JSON.parse(result.body).message).toContain('database unavailable');
			});
		});
		it('logs failed SNS notifications without rejecting the completed update', async () => {
			aws('publish', undefined, new Error('SNS unavailable'));
			const log = sinon.stub(console, 'error');
			try {
				await service.sendPaymentNotification({ id: 'group', penaltyType: 'FPN', paymentAmount: 50 }, document());
				expect(JSON.parse(log.firstCall.args[0])).toMatchObject({ logName: 'PaymentNotificationError', message: { err: 'SNS unavailable' } });
			} finally { log.restore(); }
		});
		[['FPN', 'fpnPaymentStartTime'], ['IM', 'imPaymentStartTime'], ['CDN', 'cdnPaymentStartTime']].forEach(([type, attr]) => {
			it(`sets ${type} payment start time`, async () => {
				resolves(db.update);
				expect((await service.updatePenaltyGroupWithPaymentStartTime('group', type)).statusCode).toBe(200);
				expect(db.update.firstCall.args[0]).toEqual({
					TableName: 'groups',
					Key: { ID: 'group' },
					UpdateExpression: 'set #paymentStartTime = :paymentStartTime',
					ConditionExpression: 'attribute_exists(#ID)',
					ExpressionAttributeNames: { '#ID': 'ID', '#paymentStartTime': attr },
					ExpressionAttributeValues: { ':paymentStartTime': Date.now() / 1000 },
				});
			});
		});
		it('rejects unknown penalty types before writing', async () => {
			await expect(service.updatePenaltyGroupWithPaymentStartTime('group', 'UNKNOWN')).rejects.toThrow('No payment start time for penaltyType: UNKNOWN');
			expect(db.update.called).toBe(false);
		});
	});
});
