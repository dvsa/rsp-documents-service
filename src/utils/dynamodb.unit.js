import expect from 'expect';
import { doc, databaseOptions, databaseError } from './dynamodb';
import { request } from '../test/setup.cjs';

describe('SDK v3 database adapter', () => {
	it('preserves DynamoDB service exception codes in batch error responses', async () => {
		const error = Object.assign(new Error('The conditional request failed'), {
			name: 'ConditionalCheckFailedException',
		});
		request.withArgs('update').rejects(error);
		await expect(doc.update({ TableName: 'unit', Key: { ID: 'unit' } }).promise()).rejects.toBe(error);
		expect(error.code).toBe('ConditionalCheckFailedException');
	});
	it('preserves existing error codes and ordinary errors', () => {
		const coded = Object.assign(new Error('unavailable'), { code: 'ExistingCode' });
		expect(() => databaseError(coded)).toThrow('unavailable');
		expect(coded.code).toBe('ExistingCode');
		const ordinary = new Error('ordinary');
		expect(() => databaseError(ordinary)).toThrow('ordinary');
		expect(ordinary).not.toHaveProperty('code');
	});
	['NaN', 'Infinity', '-Infinity'].forEach((value) => {
		it(`preserves the ValidationException contract for v3 marshalling of ${value}`, () => {
			const error = new Error(`Special numeric value ${value} is not allowed`);
			expect(() => databaseError(error)).toThrow(error.message);
			expect(error.name).toBe('ValidationException');
			expect(error.code).toBe('ValidationException');
		});
	});
	it('uses AWS normally and only selects loopback DynamoDB for Offline', () => {
		expect(databaseOptions({})).toEqual({ region: 'eu-west-1' });
		expect(databaseOptions({ REGION: 'eu-west-2', IS_OFFLINE: 'true' })).toEqual({
			region: 'eu-west-2', endpoint: 'http://localhost:8000',
		});
	});
	Object.keys(doc).forEach((operation) => {
		it(`forwards ${operation} inputs and results without changing the database contract`, async () => {
			const input = { TableName: 'unit', Key: { ID: 'unit' } };
			const output = { Item: { ID: 'unit' } };
			request.withArgs(operation).resolves(output);
			expect(await doc[operation](input).promise()).toBe(output);
			expect(request.firstCall.args).toEqual([operation, input]);
		});
	});
});
