const penalty1 = {
	ID: '987654321012_FPN',
	Hash: 'somehash',
	Enabled: true,
	Value: {
		penaltyType: 'FPN',
		inPenaltyGroup: true,
		penaltyAmount: 150,
		paymentToken: '1234abcdef',
		referenceNo: '12345678',
		vehicleDetails: {
			regNo: 'AA123',
		},
		officerName: 'Joe Bloggs',
		officerID: 'XYZ',
		dateTime: 1532000305,
		siteCode: 3,
	},
};

const penalty2 = {
	ID: '987654321555_FPN',
	Hash: 'somehash',
	Enabled: true,
	Value: {
		penaltyType: 'IM',
		inPenaltyGroup: true,
		penaltyAmount: 80,
		paymentToken: '1234abcdef',
		referenceNo: '87654321',
		vehicleDetails: {
			regNo: 'BB123',
		},
		officerName: 'Joe Bloggs',
		officerID: 'XYZ',
		dateTime: 1532000305,
		siteCode: 3,
	},
};

export default {
	penalty1,
	penalty2,
	penaltyGroupPayload: {
		Timestamp: 1532945465.234729,
		SiteCode: -72,
		Location: 'Trowell Services',
		VehicleRegistration: '11 abc',
		Offset: 123,
		Penalties: [penalty1, penalty2],
	},
};
