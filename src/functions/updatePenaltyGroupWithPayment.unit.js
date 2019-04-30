import sinon from 'sinon';

import updatePenaltyGroupWithPayment from './updatePenaltyGroupWithPayment';
import PenaltyGroupSvc from '../services/penaltyGroups';

const TEST_ID = 'abc123';
const PAYMENT_STATUS = 'PAID';
const PENALTY_TYPE = 'test';


describe('updatePenaltyGroupsWithPayment', () => {
	let penaltyGroupSvc;
	const event = { body: { id: TEST_ID, paymentStatus: PAYMENT_STATUS, penaltyType: PENALTY_TYPE } };

	beforeEach(() => {
		penaltyGroupSvc = sinon.stub(PenaltyGroupSvc.prototype, 'updatePenaltyGroupWithPayment');
		penaltyGroupSvc.withArgs(event).resolves();
	});
	afterEach(() => {
		// Restore the function mocked by sinon.
		PenaltyGroupSvc.prototype.updatePenaltyGroupWithPayment.restore();
	});
	it('should update the penalty groups with payment', async () => {
		await updatePenaltyGroupWithPayment(event);
		sinon.assert.calledWith(penaltyGroupSvc, sinon.match({
			id: TEST_ID, paymentStatus: PAYMENT_STATUS, penaltyType: PENALTY_TYPE,
		}));
	});
});
