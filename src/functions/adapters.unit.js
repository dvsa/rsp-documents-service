/* eslint-disable global-require, import/no-dynamic-require */
import expect from 'expect';
import sinon from 'sinon';
import { doc } from '../utils/dynamodb';
import config from '../config';
import Documents from '../services/penaltyDocuments';
import Groups from '../services/penaltyGroups';
import Search from '../services/vehicleRegistrationSearch';

const body = {
	id: 'id', paymentStatus: 'PAID', paymentAmount: 50, penaltyRefNo: 'ref', penaltyType: 'FPN', paymentToken: 'token',
};
const cases = [
	['create', Documents, 'createDocument', { body: JSON.stringify({ Value: { paymentStatus: 'PAID', kept: 1 } }) }, [{ Value: { kept: 1 } }]],
	['delete', Documents, 'deleteDocument', { pathParameters: { id: 'id' }, body: '{"Hash":"hash"}' }, ['id', { Hash: 'hash' }]],
	['get', Documents, 'getDocument', { pathParameters: { id: 'id' } }, ['id']],
	['getDocumentByToken', Documents, 'getDocumentByToken', { pathParameters: { token: 'token' } }, ['token']],
	['list', Documents, 'getDocuments', { queryStringParameters: null }, [0, 'undefined']],
	['sites', Documents, 'getSites', {}, []],
	['stream', Documents, 'streamDocuments', { Records: [] }, [{ Records: [] }]],
	['updateMulti', Documents, 'updateDocuments', { body: '{"Items":[{"ID":"id"}]}' }, [[{ ID: 'id' }]]],
	['updateWithPayment', Documents, 'updateDocumentWithPayment', { body }, [body]],
	['updateUponPaymentDelete', Documents, 'updateDocumentUponPaymentDelete', { body }, [{ id: 'id', paymentStatus: 'PAID' }]],
	['updateMultipleUponPaymentDelete', Documents, 'updateMultipleUponPaymentDelete', { body: { penaltyDocumentIds: ['id'] } }, [{ penaltyDocumentIds: ['id'] }]],
	['updateWithPaymentStartTime', Documents, 'updateDocumentWithPaymentStartTime', { body: JSON.stringify(body) }, ['id']],
	['createPenaltyGroup', Groups, 'createPenaltyGroup', { body: JSON.stringify(body) }, [body]],
	['getPenaltyGroup', Groups, 'getPenaltyGroup', { pathParameters: { id: 'id' } }, ['id']],
	['deleteGroup', Groups, 'delete', { pathParameters: { id: 'id' } }, ['id']],
	['listGroups', Groups, 'listPenaltyGroups', { queryStringParameters: { Offset: '123' } }, [123]],
	['updatePenaltyGroupWithPayment', Groups, 'updatePenaltyGroupWithPayment', { body }, [body]],
	['updatePenaltyGroupWithPaymentStartTime', Groups, 'updatePenaltyGroupWithPaymentStartTime', { body: JSON.stringify(body) }, ['id', 'FPN']],
	['searchByVehicleRegistration', Search, 'search', { pathParameters: { vehicleReg: 'AB%2012' } }, ['AB 12']],
];

function fresh(name) {
	const path = require.resolve(`./${name}`);
	delete require.cache[path];
	return require(path).handler;
}

describe('Lambda event adapters', () => {
	let sandbox;
	let bootstrap;
	beforeEach(() => {
		sandbox = sinon.createSandbox();
		bootstrap = sandbox.stub(config, 'bootstrap').resolves();
		Object.keys(config).filter((key) => key !== 'bootstrap').forEach((key) => {
			sandbox.stub(config, key).returns(key);
		});
	});
	afterEach(() => sandbox.restore());

	cases.forEach(([name, Service, method, event, args]) => {
		it(`${name}: initializes once, adapts arguments, returns responses and propagates errors`, async () => {
			const response = { statusCode: 202, body: 'result' };
			const operation = sandbox.stub(Service.prototype, method).callsFake(async function run(...actual) {
				expect(this.db).toBe(doc);
				expect(this.penaltyDocTableName).toBe('dynamodbPenaltyDocTable');
				expect(actual).toEqual(args);
				return response;
			});
			const handler = fresh(name);
			expect(await handler(event)).toBe(response);
			expect(await handler(event)).toBe(response);
			sinon.assert.calledOnce(bootstrap);
			sinon.assert.calledTwice(operation);
			operation.rejects(new Error('service failure'));
			await expect(handler(event)).rejects.toThrow('service failure');
		});
	});

	it('gets IDs from an object body and rejects missing IDs', async () => {
		const get = sandbox.stub(Documents.prototype, 'getDocument').resolves('found');
		const handler = fresh('get');
		expect(await handler({ pathParameters: {}, body: { id: 'body-id' } })).toBe('found');
		sinon.assert.calledWithExactly(get, 'body-id');
		await expect(handler({ pathParameters: {}, body: {} })).rejects.toThrow('ID not found');
	});
	it('adapts offset and pagination and accepts missing query strings', async () => {
		const list = sandbox.stub(Documents.prototype, 'getDocuments').resolves('listed');
		const handler = fresh('list');
		await handler({ queryStringParameters: { Offset: '12', NextID: 'id', NextOffset: '13' } });
		sinon.assert.calledWithExactly(list, '12', { ID: 'id', Offset: 13, Origin: 'APP' });
		await handler({ queryStringParameters: {} });
		sinon.assert.calledWithExactly(list, 0, 'undefined');
		await handler({});
		sinon.assert.calledThrice(list);
	});
	it('rejects nonnumeric group offsets without invoking the service', async () => {
		const list = sandbox.stub(Groups.prototype, 'listPenaltyGroups');
		expect(await fresh('listGroups')({ queryStringParameters: { Offset: 'bad' } })).toEqual({ statusCode: 400, body: 'No numeric Offset provided' });
		sinon.assert.notCalled(list);
	});
	[
		['updateUponPaymentDelete', Documents, 'updateDocumentUponPaymentDelete', body, { id: 'id', paymentStatus: 'PAID' }],
		['updateMultipleUponPaymentDelete', Documents, 'updateMultipleUponPaymentDelete', { penaltyDocumentIds: ['id'] }, { penaltyDocumentIds: ['id'] }],
		['updatePenaltyGroupWithPayment', Groups, 'updatePenaltyGroupWithPayment', body, body],
	].forEach(([name, Service, method, value, expected]) => {
		it(`${name}: accepts HTTP JSON bodies`, async () => {
			const operation = sandbox.stub(Service.prototype, method).resolves('updated');
			expect(await fresh(name)({ body: JSON.stringify(value) })).toBe('updated');
			sinon.assert.calledWithExactly(operation, expected);
		});
	});
	it('rejects malformed JSON without calling the document service', async () => {
		const create = sandbox.stub(Documents.prototype, 'createDocument');
		await expect(fresh('create')({ body: '{' })).rejects.toThrow(SyntaxError);
		sinon.assert.notCalled(create);
	});
	it('does not continue when configuration bootstrap fails', async () => {
		bootstrap.rejects(new Error('configuration failed'));
		const search = sandbox.stub(Search.prototype, 'search');
		await expect(fresh('searchByVehicleRegistration')({})).rejects.toThrow('configuration failed');
		sinon.assert.notCalled(search);
	});
});
