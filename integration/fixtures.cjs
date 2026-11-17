const { createHash } = require('node:crypto');

const OWNER = 'RSPIntegrationFixtureV1';
const REGISTRATION = 'RSPTEST01';
const GROUP_ID = 'rspintegrationgroup01';
const clone = (value) => JSON.parse(JSON.stringify(value));

function document(index, now = Math.floor(Date.now() / 1000)) {
	const type = ['FPN', 'IM', 'CDN'][index % 3];
	const sequence = String(index + 1).padStart(6, '0');
	const reference = type === 'IM' ? `990099-0-${sequence}-IM` : String(990099000000 + index);
	const ID = type === 'IM' ? `9900990${sequence}_IM` : `${reference}_${type}`;
	const Value = {
		penaltyType: type,
		paymentStatus: index % 7 === 0 ? 'PAID' : 'UNPAID',
		inPenaltyGroup: false,
		paymentToken: OWNER,
		referenceNo: reference,
		vehicleDetails: { regNo: REGISTRATION, make: 'Synthetic', nationality: 'UK' },
		driverDetails: { name: 'Synthetic Driver', address: 'Synthetic test address', licenceNumber: 'SYNTHETIC123' },
		trailerDetails: { number1: 'TEST1', number2: 'TEST2' },
		nonEndorsableOffence: ['SYNTHETIC TEST OFFENCE'],
		penaltyAmount: 50 + index,
		officerName: 'Synthetic Integration Officer',
		officerID: 'INTEGRATION',
		dateTime: now - 3600,
		paymentDueDate: now + (28 * 86400),
		paymentCodeDateTime: now - 3600,
		placeWhereIssued: 'Synthetic integration site',
		siteCode: 3,
	};
	const Enabled = index !== 78;
	const Hash = createHash('sha256').update(`${ID}:${JSON.stringify(Value)}:${Enabled ? '1' : '0'}`).digest('hex');
	return {
		ID,
		Hash,
		Enabled,
		Offset: now - 1800 + index,
		Origin: 'APP',
		VehicleRegistration: REGISTRATION,
		Value,
		IntegrationFixture: OWNER,
	};
}

function fixtures(now = Math.floor(Date.now() / 1000)) {
	const documents = Array.from({ length: 88 }, (_, i) => document(i, now));
	documents[77].Origin = 'PORTAL';
	documents[77].Value.paymentStatus = 'UNPAID';
	documents[79].Origin = 'PORTAL';
	documents[78].Offset = now - (365 * 86400);
	const groups = ['UNPAID', 'PAID', 'UNPAID', 'UNPAID'].map((status, i) => {
		const ID = i === 0 ? GROUP_ID : `rspintegrationgroup0${i + 1}`;
		const members = documents.slice(80 + (i * 2), 82 + (i * 2));
		members.forEach((member) => {
			member.Value.inPenaltyGroup = true;
			member.Value.paymentStatus = status;
			member.penaltyGroupId = ID;
		});
		if (i === 3) members[0].Value.paymentStatus = 'PAID';
		return {
			ID,
			PaymentStatus: status,
			Timestamp: now - 3600,
			Offset: now - 1700 + i,
			VehicleRegistration: REGISTRATION,
			Location: 'Synthetic integration site',
			TotalAmount: members.reduce((sum, member) => sum + member.Value.penaltyAmount, 0),
			SiteCode: 3,
			Origin: 'APP',
			Enabled: i !== 2,
			Hash: 'IntegrationGroupHash',
			PenaltyDocumentIds: members.map((member) => member.ID),
			IntegrationFixture: OWNER,
		};
	});
	documents.forEach((item) => {
		item.Hash = createHash('sha256').update(`${item.ID}:${JSON.stringify(item.Value)}:${item.Enabled ? '1' : '0'}`).digest('hex');
	});
	const create = document(90, now);
	create.Value.paymentStatus = 'UNPAID';
	const groupPayload = {
		Timestamp: 1924992000.123,
		Offset: now,
		SiteCode: 9901,
		Location: 'Synthetic integration site',
		VehicleRegistration: 'RSPGROUP01',
		Penalties: [document(91, now), document(92, now)].map((item) => {
			const body = payload(item);
			body.Value.inPenaltyGroup = true;
			body.Value.paymentStatus = 'UNPAID';
			return body;
		}),
	};
	// Reserve the group's timestamp/site-derived ID before making a create request.
	const createdGroupId = Number(`${Number(groupPayload.Timestamp.toFixed(3)) * 1000}9901`).toString(36);
	return {
		now,
		documents,
		groups,
		create,
		createVariants: [document(95, now), document(97, now)],
		dummy: document(93, now),
		groupPayload,
		createdGroupId,
	};
}

function payload(item) {
	const {
		ID, Hash, Enabled, Value, Origin,
	} = clone(item);
	return {
		ID, Hash, Enabled, Value, ...(Origin ? { Origin } : {}),
	};
}

module.exports = {
	OWNER, REGISTRATION, GROUP_ID, fixtures, document, payload, clone,
};
