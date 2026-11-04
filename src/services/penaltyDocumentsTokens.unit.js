import expect from 'expect';
import sinon from 'sinon';
import Service from './penaltyDocuments';
import {
	aws, database, document, payment, payments, resolves, rejects,
} from '../test/helpers';

describe('token lookups and missing paid documents', () => {
	let db;
	let service;
	let token;
	beforeEach(() => {
		db = database();
		service = new Service(db, 'documents', 'bucket', 'topic', 'sites', 'payment-url', 'token-arn', 3, 'payments-arn');
		token = {
			DocumentType: 0, Reference: '920600000111', FormattedReference: '920600000111', PaymentAmount: 50,
		};
	});

	function invocations(paymentList = []) {
		const invoke = aws('invoke', {});
		invoke.callsFake(async (op, params) => ({
			Payload: Buffer.from(JSON.stringify({
				statusCode: 200,
				body: JSON.stringify(params.FunctionName === 'token-arn' ? token : { payments: paymentList }),
			})),
		}));
		return invoke;
	}

	it('decodes tokens and returns persisted documents with current payments', async () => {
		const invoke = invocations([payment()]);
		resolves(db.get, { Item: document() });
		const response = await service.getDocumentByToken('token');
		expect(response.statusCode).toBe(200);
		expect(JSON.parse(response.body)).toMatchObject({ ID: document().ID, Value: { paymentStatus: 'PAID', paymentAuthCode: 'AUTH' } });
		expect(invoke.firstCall.args[1]).toEqual({ FunctionName: 'token-arn', Payload: '{"body": { "Token": "token" } }' });
		expect(db.get.firstCall.args[0].Key).toEqual({ ID: '920600000111_FPN' });
	});
	[null, undefined, [], [payment()]].forEach((value) => {
		it(`builds minimal missing documents using payments ${JSON.stringify(value)}`, async () => {
			invocations(value);
			resolves(db.get, {});
			const response = await service.getDocumentByToken('token');
			expect(response.statusCode).toBe(200);
			const result = JSON.parse(response.body);
			expect(result).toMatchObject({
				ID: document().ID,
				Value: {
					paymentToken: 'token', referenceNo: token.FormattedReference, penaltyAmount: 50, penaltyType: 'FPN', paymentStatus: value && value.length ? 'PAID' : 'UNPAID',
				},
			});
			if (value && value.length) expect(result.Value).toMatchObject({ paymentAuthCode: 'AUTH', paymentDate: 12345 });
			else expect(result.Value).not.toHaveProperty('paymentAuthCode');
		});
	});
	it('returns a clear error for a token service 400 response', async () => {
		aws('invoke', { Payload: JSON.stringify({ statusCode: 400, body: '{"message":"invalid token"}' }) });
		expect(await service.getDocumentByToken('bad')).toMatchObject({
			statusCode: 400, body: '{"name":"Token Error","message":"invalid token"}',
		});
		expect(db.get.called).toBe(false);
	});
	['invocation', 'no payload', 'malformed payload', 'malformed body'].forEach((failure) => {
		it(`handles token ${failure}`, async () => {
			if (failure === 'invocation') aws('invoke', undefined, new Error('token unavailable'));
			else if (failure === 'no payload') aws('invoke', {});
			else if (failure === 'malformed payload') aws('invoke', { Payload: '{' });
			else aws('invoke', { Payload: '{"body":"{"}' });
			expect((await service.getDocumentByToken('bad')).statusCode).toBe(400);
			expect(db.get.called).toBe(false);
		});
	});
	it('reports failure fetching payment information for a missing token document', async () => {
		const invoke = invocations();
		invoke.onSecondCall().rejects(new Error('payments unavailable'));
		resolves(db.get, {});
		const response = await service.getDocumentByToken('token');
		expect(response.statusCode).toBe(400);
		expect(JSON.parse(response.body).message).toBe('payments unavailable');
	});
	it('reports non-OK/non-not-found document responses rather than returning them as success', async () => {
		invocations();
		rejects(db.get);
		const result = await service.getDocumentByToken('token');
		expect(result.statusCode).toBe(400);
		expect(JSON.parse(result.body).name).toBe('Error from GetDocument');
	});
	['FPN', 'IM'].forEach((penaltyType) => {
		it(`creates a portal placeholder for an unknown ${penaltyType} payment`, async () => {
			payments([]);
			resolves(db.get, {});
			resolves(db.put);
			const ref = penaltyType === 'IM' ? '1575850000134' : '920600000111';
			const info = {
				id: `${ref}_${penaltyType}`,
				penaltyType,
				penaltyRefNo: ref,
				paymentStatus: 'PAID',
				paymentAmount: '50',
				paymentToken: 'token',
			};
			const response = await service.updateDocumentWithPayment(info);
			expect(response.statusCode).toBe(200);
			expect(JSON.parse(response.body)).toMatchObject({
				ID: info.id,
				Origin: 'PORTAL',
				Enabled: true,
				Value: {
					penaltyType,
					penaltyAmount: 50,
					vehicleDetails: { regNo: 'UNKNOWN' },
					inPenaltyGroup: false,
					officerID: 'UNKNOWN',
					officerName: 'UNKNOWN',
					paymentToken: 'token',
					referenceNo: penaltyType === 'IM' ? '157585-0-00134-IM' : info.penaltyRefNo,
				},
			});
			expect(db.put.calledOnce).toBe(true);
		});
	});
	it('logs a failed dummy persistence (known behaviour: still returns HTTP 200)', async () => {
		payments();
		rejects(db.put);
		const log = sinon.stub(console, 'error');
		try {
			// This is an existing failure-reporting defect, not a successful write.
			await service.createDummyDocumentForPayment({
				id: document().ID, penaltyType: 'FPN', penaltyRefNo: '920600000111', paymentAmount: 50, paymentToken: 'token',
			});
			expect(log.getCalls().some((call) => JSON.parse(call.args[0]).logName === 'DummmyPenaltyDocumentCreateError')).toBe(true);
			expect(db.put.calledOnce).toBe(true);
		} finally { log.restore(); }
	});
	it('logs unexpected dummy creation exceptions', async () => {
		const create = sinon.stub(service, 'createDocument').rejects(new Error('unexpected creation failure'));
		const log = sinon.stub(console, 'error');
		try {
			await service.createDummyDocumentForPayment({ penaltyType: 'FPN', penaltyRefNo: '920600000111' });
			expect(JSON.parse(log.firstCall.args[0]).message.error).toBe('unexpected creation failure');
			sinon.assert.calledOnce(create);
		} finally { create.restore(); log.restore(); }
	});
});
