import sinon from 'sinon';

import DeleteGroup from './deleteGroup';
import PenaltyGroupService from '../services/penaltyGroups';

describe('Delete group function', () => {
	let penaltyGroupSvc;
	let callbackSpy;
	const event = { pathParameters: { id: 'abcdefghij1' } };

	beforeEach(() => {
		penaltyGroupSvc = sinon.stub(PenaltyGroupService.prototype, 'delete');
		penaltyGroupSvc
			.withArgs('abcdefghij1')
			.resolves();
		callbackSpy = sinon.spy();
	});
	afterEach(() => {
		PenaltyGroupService.prototype.delete.restore();
		callbackSpy.resetHistory();
	});
	it('should return the result of calling the penalty group service delete method', async () => {
		await DeleteGroup(event, null, callbackSpy);
		sinon.assert.calledWith(penaltyGroupSvc, 'abcdefghij1', callbackSpy);
	});
});
