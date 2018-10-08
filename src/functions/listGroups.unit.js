import sinon from 'sinon';

import PenaltyGroup from '../services/penaltyGroups';
import listGroups from '../functions/listGroups';

describe('listGroups', () => {

	let penaltyGrpSvc;
	let callbackSpy;

	beforeEach(() => {
		penaltyGrpSvc = sinon.stub(PenaltyGroup.prototype, 'listPenaltyGroups');
		callbackSpy = sinon.spy();
	});

	afterEach(() => {
		PenaltyGroup.prototype.listPenaltyGroups.restore();
	});

	const assert400ResponseWithNoPenaltySvcCall = () => {
		sinon.assert.calledWith(callbackSpy, sinon.match({
			statusCode: 400,
			body: 'No numeric Offset provided',
		}));
		sinon.assert.notCalled(penaltyGrpSvc);
	};

	describe('when there is no offset provided', () => {
		const Offset = undefined;
		it('should respond 400 without calling PenaltyGroupService', async () => {
			await listGroups({ queryStringParameters: { Offset } }, {}, callbackSpy);
			assert400ResponseWithNoPenaltySvcCall();
		});
	});

	describe('when the offset provided is not numeric', () => {
		const Offset = 'abc';
		it('should respond 400 without calling PenaltyGroupService', async () => {
			await listGroups({ queryStringParameters: { Offset } }, {}, callbackSpy);
			assert400ResponseWithNoPenaltySvcCall();
		});
	});

	describe('when a numeric offset string is provided', () => {
		const Offset = '1234567890.345';
		it('should call PenaltyGroupService with offset and callback', async () => {
			await listGroups({ queryStringParameters: { Offset } }, {}, callbackSpy);
			sinon.assert.calledWith(penaltyGrpSvc, 1234567890.345, callbackSpy);
		});
	});
});
