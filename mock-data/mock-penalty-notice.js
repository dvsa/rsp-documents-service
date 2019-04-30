import mockPenaltyNotice from './fake-penalty-notice.json';

function getMockPenalties() {
	return JSON.parse(JSON.stringify(mockPenaltyNotice));
}

export default getMockPenalties;
