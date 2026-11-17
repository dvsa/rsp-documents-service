import expect from 'expect';
import Search from './vehicleRegistrationSearch';
import { database, resolves, rejects } from '../test/helpers';

describe('vehicle registration search', () => {
	let db;
	let service;
	beforeEach(() => {
		db = database();
		service = new Search(db, 'documents', 'groups');
	});
	it('queries the registration index and returns only standalone penalties', async () => {
		const penalty = { ID: 'single', Value: {} };
		resolves(db.query, { Items: [penalty] });
		const result = await service.search('AB12 CDE');
		expect(result.statusCode).toBe(200);
		expect(JSON.parse(result.body)).toEqual({ Penalties: [penalty], PenaltyGroups: [] });
		expect(db.query.firstCall.args).toEqual([{
			TableName: 'documents',
			IndexName: 'ByVehicleRegistration',
			KeyConditionExpression: '#VehicleRegistration = :vehicleRegistration',
			ExpressionAttributeNames: { '#VehicleRegistration': 'VehicleRegistration' },
			ExpressionAttributeValues: { ':vehicleRegistration': 'AB12 CDE' },
		}]);
		expect(db.batchGet.called).toBe(false);
	});
	it('removes both top-level and nested grouped penalties and deduplicates group IDs', async () => {
		const single = { ID: 'single', Value: {} };
		resolves(db.query, {
			Items: [single,
				{
					ID: 'top', inPenaltyGroup: true, penaltyGroupId: 'group', Value: {},
				},
				{ ID: 'nested', penaltyGroupId: 'group', Value: { inPenaltyGroup: true } },
			],
		});
		resolves(db.batchGet, { Responses: { groups: [{ ID: 'group' }] } });
		expect(JSON.parse((await service.search('AB12')).body)).toEqual({ Penalties: [single], PenaltyGroups: [{ ID: 'group' }] });
		expect(db.batchGet.firstCall.args).toEqual([{ RequestItems: { groups: { Keys: [{ ID: 'group' }] } } }]);
	});
	it('returns 404 for an unknown vehicle', async () => {
		resolves(db.query, { Items: [] });
		expect(await service.search('missing')).toMatchObject({ statusCode: 404, body: '"No penalties found"' });
		expect(db.batchGet.called).toBe(false);
	});
	['query', 'batchGet'].forEach((stage) => {
		it(`returns an error when ${stage} fails`, async () => {
			resolves(db.query, { Items: [{ inPenaltyGroup: true, penaltyGroupId: 'group', Value: {} }] });
			rejects(db[stage]);
			expect((await service.search('AB12')).statusCode).toBe(400);
			expect(db[stage].calledOnce).toBe(true);
		});
	});
});
