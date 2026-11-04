import sinon from 'sinon';
import fixtures from '../../mock-data/fake-penalty-notice.json';
import { request } from './setup.cjs';

export function document() {
	const item = JSON.parse(JSON.stringify(fixtures.find((p) => p.ID === '920600000111_FPN')));
	delete item.penaltyGroupId;
	return item;
}

export function payment(id = document().ID) {
	return {
		ID: id,
		PenaltyStatus: 'PAID',
		PaymentDetail: {
			AuthCode: 'AUTH', PaymentDate: 12345, PaymentRef: 'REF', PaymentMethod: 'CARD',
		},
	};
}

export function database() {
	return Object.fromEntries(['get', 'put', 'query', 'update', 'batchGet', 'batchWrite', 'delete'].map((method) => [
		method, sinon.stub().callsFake(() => { throw new Error(`Unexpected database ${method}`); }),
	]));
}

export function resolves(stub, value = {}) {
	stub.returns({ promise: async () => value });
}

export function rejects(stub, message = 'database unavailable') {
	stub.returns({ promise: async () => { throw new Error(message); } });
}

export function aws(operation, value, error) {
	const stub = request.withArgs(operation);
	stub.callsFake((op, params, callback) => {
		if (callback) callback(error, value);
		return { promise: async () => { if (error) throw error; return value; } };
	});
	return stub;
}

export function payments(value = []) {
	return aws('invoke', { Payload: JSON.stringify({ body: JSON.stringify({ payments: value }) }) });
}
