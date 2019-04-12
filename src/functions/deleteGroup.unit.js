import sinon from 'sinon';
import expect from 'expect';

import deleteGroup from './deleteGroup';
import PenaltyGroupService from '../services/penaltyGroups';

describe('Delete group function', () => {
	let penaltyGroupSvc;
	const event = { pathParameters: { id: 'abcdefghij1' } };

	beforeEach(() => {
		penaltyGroupSvc = sinon.stub(PenaltyGroupService.prototype, 'delete');
		penaltyGroupSvc
			.withArgs('abcdefghij1')
			.resolves('mock response');
	});
	afterEach(() => {
		PenaltyGroupService.prototype.delete.restore();
	});
	it('should return the result of calling the penalty group service delete method', async () => {
		const response = await deleteGroup(event);
		expect(response).toBe('mock response');
	});
});
