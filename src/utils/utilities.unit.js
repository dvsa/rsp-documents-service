import expect from 'expect';
import sinon from 'sinon';
import sha256 from 'js-sha256';
import createResponse from './createResponse';
import createSimpleResponse from './createSimpleResponse';
import createStringResponse from './createStringResponse';
import createErrorResponse from './createErrorResponse';
import createErrorCodedResponse from './createErrorCodedResponse';
import formatMinimalDocument from './formatMinimalDocument';
import hash from './hash';
import mergeDocuments from './mergeDocumentsWithPayments';
import mergeSingle from './mergeSingleDocumentWithPayment';
import onlyUnique from './onlyUnique';
import subtractDays from './subtractDays';
import time from './time';
import { logInfo, logError } from './logger';
import { payment } from '../test/helpers';

describe('response utilities', () => {
	const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
	it('preserves JSON, raw and simple response contracts with explicit and default arguments', () => {
		expect(createResponse({})).toEqual({ statusCode: 200, headers, body: '{}' });
		expect(createResponse({ statusCode: 201, body: ['item'] })).toEqual({ statusCode: 201, headers, body: '["item"]' });
		expect(createStringResponse({})).toEqual({ statusCode: 200, headers, body: {} });
		expect(createStringResponse({ statusCode: 202, body: 'raw' })).toEqual({ statusCode: 202, headers, body: 'raw' });
		expect(createSimpleResponse({})).toEqual({ status: 200, item: {}, error: undefined });
		expect(createSimpleResponse({ statusCode: 400, body: { ID: 'id' }, error: 'bad' })).toEqual({ status: 400, item: { ID: 'id' }, error: 'bad' });
		expect(createErrorResponse({ statusCode: 400, err: new TypeError('bad') })).toEqual({ statusCode: 400, headers, body: '{"name":"TypeError","message":"bad"}' });
		expect(JSON.parse(createErrorCodedResponse(400, 'code', 'bad').body)).toEqual({ errCode: 'code', errMessage: 'bad', errBody: {} });
		expect(JSON.parse(createErrorCodedResponse(400, 'code', 'bad', { id: 1 }).body).errBody).toEqual({ id: 1 });
	});
	it('formats both unpaid and authenticated minimal documents', () => {
		const token = { FormattedReference: 'ref', PaymentAmount: 50 };
		const unpaid = { paymentStatus: 'UNPAID' };
		expect(formatMinimalDocument(token, 'id', 'token', 'FPN', unpaid)).toEqual({
			ID: 'id',
			Value: {
				penaltyType: 'FPN', paymentStatus: 'UNPAID', paymentToken: 'token', referenceNo: 'ref', penaltyAmount: 50,
			},
		});
		expect(formatMinimalDocument(token, 'id', 'token', 'FPN', { paymentStatus: 'PAID', paymentAuthCode: 'auth', paymentDate: 123 }).Value)
			.toEqual({
				penaltyType: 'FPN', paymentStatus: 'PAID', paymentToken: 'token', referenceNo: 'ref', penaltyAmount: 50, paymentAuthCode: 'auth', paymentDate: 123,
			});
	});
});

describe('payment merging', () => {
	it('handles defaults, unmatched payments and first/later matched documents', () => {
		expect(mergeDocuments({})).toEqual([]);
		const items = [{ ID: 'first', Value: {} }, { ID: 'second', Value: {} }, { ID: 'unpaid', Value: {} }];
		const result = mergeDocuments({ items, payments: [payment('first'), payment('second'), payment('missing')] });
		expect(result).not.toBe(items);
		expect(result).toHaveLength(3);
		['first', 'second'].forEach((id, i) => {
			expect(result[i]).toEqual({
				ID: id,
				Value: {
					paymentStatus: 'PAID', paymentAuthCode: 'AUTH', paymentDate: 12345, paymentRef: 'REF', paymentMethod: 'CARD',
				},
			});
		});
		expect(result[2]).toEqual({ ID: 'unpaid', Value: { paymentStatus: 'UNPAID' } });
	});
	it('merges a single payment into the original item', () => {
		const item = { ID: 'id', Value: { retained: true } };
		expect(mergeSingle({ item, payment: payment('id') })).toBe(item);
		expect(item.Value).toEqual({
			retained: true, paymentStatus: 'PAID', paymentAuthCode: 'AUTH', paymentDate: 12345,
		});
	});
});

describe('hash, dates, uniqueness and structured logging', () => {
	it('hashes strings/objects and enabled/disabled states deterministically', () => {
		expect(hash('id', 'value', true)).toBe(sha256('id:value:1'));
		expect(hash('id', { a: 1 }, false)).toBe(sha256('id:{"a":1}:0'));
	});
	it('subtracts calendar days at local midnight and rounds Unix seconds', () => {
		expect(subtractDays(new Date(2024, 2, 1, 15), 1)).toBe(new Date(2024, 1, 29).getTime() / 1000);
		const clock = sinon.useFakeTimers(1234567);
		try { expect(time()).toBe(1235); } finally { clock.restore(); }
		expect(['a', 'b', 'a'].filter(onlyUnique)).toEqual(['a', 'b']);
	});
	it('logs JSON with the correct level, name and structured message', () => {
		const info = sinon.stub(console, 'log');
		const error = sinon.stub(console, 'error');
		try {
			logInfo('info', { id: 1 });
			logError('failure', 'bad');
			expect(JSON.parse(info.firstCall.args[0])).toEqual({ logName: 'info', logLevel: 'INFO', message: { id: 1 } });
			expect(JSON.parse(error.firstCall.args[0])).toEqual({ logName: 'failure', logLevel: 'ERROR', message: 'bad' });
		} finally { info.restore(); error.restore(); }
	});
});
