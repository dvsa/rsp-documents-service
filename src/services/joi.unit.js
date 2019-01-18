// @ts-check
import expect from 'expect';
import Validation from 'rsp-validation';

const currentDocumentFormat = {
	Enabled: true,
	ID: '2514563246555_FPN',
	Offset: 1519310362.891,
	Value: {
		dateTime: 1519257600,
		paymentCodeDateTime: 1519257660,
		siteCode: 5,
		vehicleDetails: {
			regNo: '12212121X',
		},
		referenceNo: '2514563246555',
		nonEndorsableOffence: [],
		penaltyType: 'FPN',
		paymentAuthCode: '1234TBD',
		paymentToken: '750e811603fe2aaf',
		placeWhereIssued: 'Badbury (M4 J15 - Swindon)',
		officerName: 'dvsa.officerfpns@bjss.com',
		penaltyAmount: 2138,
		paymentDate: 1518480000,
		officerID: 'Z7F6yxnw--6DJf4sLsxjg_S-3Gvrl5MxV-1iY7RRNiA',
		paymentStatus: 'PAID',
		inPenaltyGroup: false,
	},
	Hash: 'c3c7581adeec5585e953e2a613c26986ce35a733f17947921cb828749c1aaf22',
};

describe('rsp-validation', () => {
	it('should validate a model', () => {
		const res = Validation.penaltyDocumentValidation(currentDocumentFormat);
		expect(res.valid).toBe(true);
	});
});
