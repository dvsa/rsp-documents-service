import sinon from 'sinon';

import updatePenaltyGroupWithPayment from './updatePenaltyGroupWithPayment';
import PenaltyGroupSvc from '../services/penaltyGroups';

const TEST_ID = 'abc123';
const PAYMENT_STATUS = 'PAID';
const PENALTY_TYPE = 'test';


describe('updatePenaltyGroupsWithPayment', () => {
    let penaltyGroupSvc;
    let callbackSpy;
    const event = { body: { id: TEST_ID, paymentStatus: PAYMENT_STATUS, penaltyType: PENALTY_TYPE } };

    beforeEach(() => {
        penaltyGroupSvc = sinon.stub(PenaltyGroupSvc.prototype, 'updatePenaltyGroupWithPayment')
        penaltyGroupSvc.withArgs(event).resolves();
        callbackSpy = sinon.spy();
    });
    afterEach(() => {
        // Restore the function mocked by sinon.
        PenaltyGroupSvc.prototype.updatePenaltyGroupWithPayment.restore();
        callbackSpy.resetHistory();
    });
    it('should update the penalty groups with payment', async () => {
        await updatePenaltyGroupWithPayment(event, null, callbackSpy);
        sinon.assert.calledWith(penaltyGroupSvc, sinon.match({ id: TEST_ID, paymentStatus: PAYMENT_STATUS, penaltyType: PENALTY_TYPE }));
    });
});
