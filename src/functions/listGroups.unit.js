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
		const offset = undefined;
		it('should respond 400 without calling PenaltyGroupService', () => {
			listGroups({ queryStringParameters: { offset } }, {}, callbackSpy);
			assert400ResponseWithNoPenaltySvcCall();
		});
	});

	describe('when the offset provided is not numeric', () => {
		const offset = 'abc';
		it('should respond 400 without calling PenaltyGroupService', () => {
			listGroups({ queryStringParameters: { offset } }, {}, callbackSpy);
			assert400ResponseWithNoPenaltySvcCall();
		});
	});

	describe('when a numeric offset string is provided', () => {
		const offset = '1234567890.345';
		it('should call PenaltyGroupService with offset and callback', () => {
			listGroups({ queryStringParameters: { offset } }, {}, callbackSpy);
			sinon.assert.calledWith(penaltyGrpSvc, 1234567890.345, callbackSpy);
		});
	});
});
