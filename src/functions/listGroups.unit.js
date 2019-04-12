import sinon from 'sinon';
import expect from 'expect';

import PenaltyGroup from '../services/penaltyGroups';
import listGroups from '../functions/listGroups';

describe('listGroups', () => {

	let penaltyGrpSvc;

	beforeEach(() => {
		penaltyGrpSvc = sinon.stub(PenaltyGroup.prototype, 'listPenaltyGroups');
	});

	afterEach(() => {
		PenaltyGroup.prototype.listPenaltyGroups.restore();
	});

	const assert400ResponseWithNoPenaltySvcCall = (response) => {
		expect(response.statusCode).toBe(400);
		expect(response.body).toBe('No numeric Offset provided');
		sinon.assert.notCalled(penaltyGrpSvc);
	};

	describe('when there is no offset provided', () => {
		const Offset = undefined;
		it('should respond 400 without calling PenaltyGroupService', async () => {
			const response = await listGroups({ queryStringParameters: { Offset } });
			assert400ResponseWithNoPenaltySvcCall(response);
		});
	});

	describe('when the offset provided is not numeric', () => {
		const Offset = 'abc';
		it('should respond 400 without calling PenaltyGroupService', async () => {
			const response = await listGroups({ queryStringParameters: { Offset } });
			assert400ResponseWithNoPenaltySvcCall(response);
		});
	});

	describe('when a numeric offset string is provided', () => {
		const Offset = '1234567890.345';
		it('should call PenaltyGroupService with offset and callback', async () => {
			await listGroups({ queryStringParameters: { Offset } });
			sinon.assert.calledWith(penaltyGrpSvc, 1234567890.345);
		});
	});
});
