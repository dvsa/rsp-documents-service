const { check, equal, deep } = require('./assertions.cjs');
const {
	GROUP_ID, REGISTRATION, payload, clone,
} = require('./fixtures.cjs');

const inventory = [
	['list', 'GET /documents'],
	['get', 'GET /documents/{id}'],
	['getDocumentByToken', 'GET /documents/tokens/{token}'],
	['create', 'POST /documents'],
	['updateMulti', 'PUT /documents'],
	['delete', 'DELETE /documents/{id}'],
	['listGroups', 'GET /penaltyGroup'],
	['getPenaltyGroup', 'GET /penaltyGroup/{id}'],
	['createPenaltyGroup', 'POST /penaltyGroup'],
	['deleteGroup', 'DELETE /penaltyGroup/{id}'],
	['updateWithPaymentStartTime', 'PUT /documents/updateWithPaymentStartTime'],
	['updatePenaltyGroupWithPaymentStartTime', 'PUT /penaltyGroup/updateWithPaymentStartTime'],
	['updateUponPaymentDelete', 'PUT /documents/updateUponPaymentDelete'],
	['updateMultipleUponPaymentDelete', 'PUT /documents/updateMultipleUponPaymentDelete'],
	['searchByVehicleRegistration', 'GET /vehicle-reg/{vehicleReg}'],
	['sites', 'GET /sites'],
].map(([id, route]) => ({
	id, route, transport: 'HTTP', exportName: id === 'delete' ? 'remove' : id,
})).concat(
	['updateWithPayment', 'updatePenaltyGroupWithPayment', 'streamDocuments']
		.map((id) => ({ id, transport: 'Lambda-only' })),
);

function domainValue(value, authoritative) {
	const result = clone(value);
	if (authoritative) {
		['paymentStatus', 'paymentAuthCode', 'paymentDate', 'paymentRef', 'paymentMethod']
			.forEach((field) => { delete result[field]; });
	}
	return result;
}
function persistedDocument(actual, expected, authoritative = true) {
	documentContract(actual);
	equal(actual.ID, expected.ID, 'Read-back exact ID');
	equal(actual.Enabled, expected.Enabled, 'Read-back exact Enabled');
	equal(actual.Hash, expected.Hash, 'Read-back exact persisted hash');
	equal(actual.Offset, expected.Offset, 'Read-back exact persisted offset');
	deep(domainValue(actual.Value, authoritative), domainValue(expected.Value, authoritative), 'Read-back full domain Value (payment overlays explicitly separated)');
}
function groupData(actual, expected, members) {
	groupContract(actual);
	for (const field of ['ID', 'Enabled', 'PaymentStatus', 'VehicleRegistration', 'Location', 'TotalAmount', 'SiteCode', 'Timestamp']) {
		deep(actual[field], expected[field], `Read-back group ${field}`);
	}
	const returned = actual.Payments.flatMap((p) => p.Penalties);
	deep(returned.map((p) => p.ID).sort(), members.map((p) => p.ID).sort(), 'Read-back exact group membership');
	returned.forEach((p) => {
		const member = members.find((m) => m.ID === p.ID);
		persistedDocument(p, member, false);
		equal(p.penaltyGroupId, actual.ID, 'Read-back member parent group');
	});
}
function documentContract(item, full = true) {
	check(item && typeof item === 'object' && !Array.isArray(item), 'Document object');
	check(typeof item.ID === 'string', 'Document ID string');
	check(item.Value && typeof item.Value === 'object', 'Document Value object');
	check(['FPN', 'IM', 'CDN'].includes(item.Value.penaltyType), 'Known penalty type');
	check(['PAID', 'UNPAID'].includes(item.Value.paymentStatus), 'Known authoritative payment status');
	check(typeof item.Value.referenceNo === 'string', 'Reference string');
	check(Number.isInteger(item.Value.penaltyAmount), 'Amount integer');
	if (full) {
		check(typeof item.Hash === 'string' && item.Hash.length > 0, 'Nonempty Hash string');
		check(typeof item.Enabled === 'boolean', 'Enabled boolean');
		check(Number.isFinite(item.Offset), 'Offset finite number');
		check(typeof item.Value.vehicleDetails?.regNo === 'string', 'Registration string');
		check(Number.isInteger(item.Value.dateTime), 'Issue time integer');
		check(Number.isInteger(item.Value.siteCode), 'Document site code integer');
		check(typeof item.Value.officerName === 'string' && typeof item.Value.officerID === 'string', 'Officer field types');
		check(typeof item.Value.inPenaltyGroup === 'boolean', 'Grouping flag boolean');
		check(typeof item.Value.paymentToken === 'string', 'Payment token string');
		if (item.Value.paymentDueDate !== undefined) check(Number.isInteger(item.Value.paymentDueDate), 'Due date integer');
		if (item.Value.paymentCodeDateTime !== undefined) check(Number.isInteger(item.Value.paymentCodeDateTime), 'Payment code issue time integer');
		if (item.Value.nonEndorsableOffence !== undefined) check(Array.isArray(item.Value.nonEndorsableOffence) && item.Value.nonEndorsableOffence.every((o) => typeof o === 'string'), 'Offence string array');
	}
	if (item.Value.paymentStatus === 'PAID' && !full) {
		check(typeof item.Value.paymentAuthCode === 'string', 'Paid auth code string');
		check(Number.isFinite(item.Value.paymentDate), 'Paid payment date number');
	}
}

function groupContract(item) {
	check(typeof item.ID === 'string', 'Group ID string');
	check(typeof item.Enabled === 'boolean', 'Group Enabled boolean');
	check(Number.isFinite(item.Offset), 'Group Offset number');
	check(Number.isInteger(item.TotalAmount), 'Group total integer');
	check(['PAID', 'UNPAID'].includes(item.PaymentStatus), 'Group payment status');
	check(Array.isArray(item.Payments), 'Group Payments array');
	check(Number.isFinite(item.Timestamp) && Number.isInteger(item.SiteCode), 'Group timestamp and site types');
	check(typeof item.Location === 'string' && typeof item.VehicleRegistration === 'string', 'Group location and registration types');
	equal(new Set(item.Payments.map((p) => p.PaymentCategory)).size, item.Payments.length, 'Payment categories unique');
	item.Payments.forEach((payment) => {
		check(['FPN', 'IM', 'CDN'].includes(payment.PaymentCategory), 'Payment category');
		check(['PAID', 'UNPAID'].includes(payment.PaymentStatus), 'Category status');
		check(Array.isArray(payment.Penalties) && payment.Penalties.length > 0, 'Nonempty penalties');
		payment.Penalties.forEach((doc) => documentContract(doc));
		payment.Penalties.forEach((doc) => equal(doc.Value.penaltyType, payment.PaymentCategory, 'Member matches payment category'));
		equal(payment.PaymentStatus, payment.Penalties.every((doc) => doc.Value.paymentStatus === 'PAID') ? 'PAID' : 'UNPAID', 'Category status matches member statuses');
		equal(payment.TotalAmount, payment.Penalties.reduce((sum, doc) => sum + doc.Value.penaltyAmount, 0), 'Category total matches penalties');
	});
	equal(item.TotalAmount, item.Payments.reduce((sum, payment) => sum + payment.TotalAmount, 0), 'Group total matches categories');
}

function sitesContract(body) {
	check(body && typeof body === 'object' && !Array.isArray(body), 'Sites response object');
	deep(Object.keys(body).sort(), ['Items'], 'Actual Sites envelope has exactly Items');
	check(Array.isArray(body.Items) && body.Items.length > 0, 'Nonempty Sites Items array');
	body.Items.forEach((site) => {
		deep(Object.keys(site).sort(), ['name', 'region', 'siteCode'], 'Exact static site fields');
		check(typeof site.name === 'string' && site.name.length > 0, 'Site name');
		check(typeof site.region === 'string' && site.region.length > 0, 'Site region');
		check(Number.isInteger(site.siteCode), 'Site code integer');
	});
	equal(new Set(body.Items.map((s) => s.siteCode)).size, body.Items.length, 'Unique site codes');
	return body.Items;
}

function scenarios() {
	const cases = [];
	const add = (endpoint, id, validation, run, options = {}) => cases.push({
		endpoint, id, validation, run, ...options,
	});
	const getDoc = async (c, id) => {
		const { body } = await c.http('GET', `/documents/${id}`, undefined, 200);
		if (body.Value?.paymentStatus === 'PAID') {
			check(typeof body.Value.paymentAuthCode === 'string' && body.Value.paymentAuthCode.length > 0, 'Authoritative paid auth code');
			check(Number.isFinite(body.Value.paymentDate), 'Authoritative GET payment date number');
			check(typeof body.Value.paymentRef === 'string', 'Authoritative paid payment reference');
			check(typeof body.Value.paymentMethod === 'string', 'Authoritative paid payment method');
		}
		return body;
	};
	const getGroup = async (c, id = GROUP_ID) => (await c.http('GET', `/penaltyGroup/${id}`, undefined, 200)).body;

	add('list', 'list-pagination', 'All recent APP fixtures across >75 records; cursor types, no duplicates, origins, field types and authoritative status', async (c) => {
		const seen = new Set();
		let cursor = '';
		let pages = 0;
		do {
			const { body } = await c.http('GET', `/documents?Offset=${c.data.now - 2000}${cursor}`, undefined, 200);
			check(Array.isArray(body.Items), 'Items array');
			body.Items.forEach((item) => {
				documentContract(item);
				check(!('Origin' in item), 'Origin omitted in document list');
				check(!seen.has(item.ID), 'No repeated ID across pages');
				seen.add(item.ID);
				const fixture = c.data.documents.find((d) => d.ID === item.ID);
				if (fixture) persistedDocument(item, fixture);
			});
			const key = body.LastEvaluatedKey;
			if (key) {
				check(typeof key.ID === 'string' && Number.isFinite(key.Offset) && key.Origin === 'APP', 'Cursor shape');
				cursor = `&NextID=${encodeURIComponent(key.ID)}&NextOffset=${key.Offset}`;
			} else cursor = '';
			pages += 1;
			check(pages < 30, 'Pagination terminates');
		} while (cursor);
		check(pages >= 2, 'Fixture set exercises pagination (configure batch size <=75)');
		c.data.documents.filter((d) => d.Origin === 'APP' && d.Offset >= c.data.now - 2000)
			.forEach((d) => check(seen.has(d.ID), 'All recent APP fixtures listed'));
		check(!seen.has(c.data.documents[79].ID), 'PORTAL fixture excluded');
		check(!seen.has(c.data.documents[78].ID), 'Old fixture excluded by explicit offset');
	});
	add('list', 'list-empty', 'Future offset returns exactly empty Items and no cursor', async (c) => {
		const { body } = await c.http('GET', '/documents?Offset=9999999999', undefined, 200);
		check(Array.isArray(body.Items) && body.Items.length === 0 && !body.LastEvaluatedKey, 'Empty list contract');
	});
	add('list', 'list-invalid-offset', 'Non-numeric offset rejected by DynamoDB with structured validation error, not empty success', async (c) => {
		const { body } = await c.http('GET', '/documents?Offset=invalid', undefined, 400);
		equal(body.name, 'ValidationException', 'Document offset validation error');
		check(typeof body.message === 'string' && body.message.length > 0, 'Document offset validation message');
	});
	add('list', 'list-default-days', 'Default retention includes recent APP fixtures and excludes year-old fixture', async (c) => {
		const seen = new Set();
		let cursor = '';
		let pages = 0;
		do {
			const { body } = await c.http('GET', `/documents${cursor}`, undefined, 200);
			check(Array.isArray(body.Items), 'Default Items array');
			body.Items.forEach((item) => seen.add(item.ID));
			const key = body.LastEvaluatedKey;
			cursor = key ? `?NextID=${encodeURIComponent(key.ID)}&NextOffset=${key.Offset}` : '';
			pages += 1;
			check(pages < 30, 'Default-retention pagination terminates');
		} while (cursor);
		c.data.documents.filter((d) => d.Origin === 'APP' && d.ID !== c.data.documents[78].ID)
			.forEach((d) => check(seen.has(d.ID), 'Recent fixture included with default retention'));
		check(!seen.has(c.data.documents[78].ID), 'Old fixture excluded by DAYS_TO_HOLD (must be <365)');
	});
	add('get', 'get-types', 'FPN/IM/CDN identity, amounts, enabled/hash/offset types; Payments status may override seed status', async (c) => {
		for (const expected of c.data.documents.slice(0, 3)) {
			const doc = await getDoc(c, expected.ID);
			persistedDocument(doc, expected);
			equal(doc.ID, expected.ID, 'Requested ID');
			equal(doc.Value.referenceNo, expected.Value.referenceNo, 'Requested reference');
			equal(doc.Value.penaltyAmount, expected.Value.penaltyAmount, 'Seeded amount');
			equal(doc.Value.penaltyType, expected.Value.penaltyType, 'Requested type');
			check(!('Origin' in doc), 'Origin omitted by get');
		}
	});
	add('get', 'get-missing', 'Missing document returns 404 with exact error', async (c) => {
		const { body } = await c.http('GET', '/documents/990099999999_FPN', undefined, 404);
		equal(body.error, 'ITEM NOT FOUND', 'Missing document error');
	});
	add('get', 'get-disabled', 'Disabled records remain retrievable with Enabled false', async (c) => {
		equal((await getDoc(c, c.data.documents[78].ID)).Enabled, false, 'Disabled flag preserved');
	});
	add('sites', 'sites-schema', 'Actual real S3 Items envelope; exact item fields, nonempty name/region, integer unique siteCode', async (c) => {
		const { body } = await c.http('GET', '/sites', undefined, 200);
		sitesContract(body);
	});
	add('sites', 'sites-static-baseline', 'Full sorted name/region/siteCode equality against explicitly captured static S3 baseline; unique codes', async (c) => {
		const { body } = await c.http('GET', '/sites', undefined, 200);
		c.sitesBaseline(sitesContract(body));
	}, { requires: 'sites-baseline' });
	add('getDocumentByToken', 'valid-external-token', 'Valid configured encrypted token resolves exact externally specified ID/reference/amount, type and status; never logged', async (c) => {
		const { body } = await c.http('GET', `/documents/tokens/${encodeURIComponent(c.env.INTEGRATION_TOKEN)}`, undefined, 200);
		documentContract(body, false);
		equal(body.ID, c.env.INTEGRATION_TOKEN_DOCUMENT_ID, 'Token resolves configured expected ID');
		equal(body.Value.referenceNo, c.env.INTEGRATION_TOKEN_REFERENCE, 'Token exact expected reference');
		equal(body.Value.penaltyAmount, Number(c.env.INTEGRATION_TOKEN_AMOUNT), 'Token exact expected amount');
		check(body.ID.endsWith(`_${body.Value.penaltyType}`), 'Token ID/type consistency');
	}, { requires: 'token' });
	add('getDocumentByToken', 'invalid-token', 'Token service rejects invalid encrypted token with Token Error and message', async (c) => {
		const { body } = await c.http('GET', '/documents/tokens/NotAValidEncryptedToken', undefined, 400);
		equal(body.name, 'Token Error', 'Token rejection name');
		check(typeof body.message === 'string' && body.message.length > 0, 'Token rejection message');
	});
	add('searchByVehicleRegistration', 'search-grouping', 'Standalone/group partition, no grouped duplicates, stored PAID/UNPAID statuses and all synthetic IDs', async (c) => {
		const { body } = await c.http('GET', `/vehicle-reg/${REGISTRATION}`, undefined, 200);
		check(Array.isArray(body.Penalties) && Array.isArray(body.PenaltyGroups), 'Search arrays');
		const expectedStandalone = c.data.documents.filter((d) => !d.Value.inPenaltyGroup);
		equal(body.Penalties.length, expectedStandalone.length, 'All standalone fixtures');
		body.Penalties.forEach((doc) => {
			documentContract(doc);
			check(!doc.inPenaltyGroup && !doc.Value.inPenaltyGroup, 'Grouped docs not standalone');
			const expected = expectedStandalone.find((d) => d.ID === doc.ID);
			check(expected, 'Synthetic search ID');
			persistedDocument(doc, expected, false);
			equal(doc.Value.paymentStatus, expected.Value.paymentStatus, 'Search preserves locally stored status');
		});
		equal(body.PenaltyGroups.length, c.data.groups.length, 'Group IDs deduplicated');
		c.data.groups.forEach((group) => check(body.PenaltyGroups.some((g) => g.ID === group.ID), 'Expected group in search'));
	});
	add('searchByVehicleRegistration', 'search-missing', 'Missing registration returns 404 and exact JSON string', async (c) => {
		equal((await c.http('GET', '/vehicle-reg/RSPNORESULT999', undefined, 404)).body, 'No penalties found', 'Missing registration response');
	});
	add('listGroups', 'groups-list', 'Numeric offset, Items/Count types, all recent synthetic groups', async (c) => {
		const { body } = await c.http('GET', `/penaltyGroup?Offset=${c.data.now - 2000}`, undefined, 200);
		check(Array.isArray(body.Items) && Number.isInteger(body.Count), 'Dynamo list response');
		equal(body.Count, body.Items.length, 'Count matches Items');
		c.data.groups.forEach((g) => check(body.Items.some((item) => item.ID === g.ID), 'Synthetic group listed'));
	});
	add('listGroups', 'groups-invalid-offset', 'Non-numeric offset rejected with exact text', async (c) => {
		equal((await c.http('GET', '/penaltyGroup?Offset=invalid', undefined, 400)).text, 'No numeric Offset provided', 'Offset validation');
	});
	add('listGroups', 'groups-empty', 'Future offset gives empty groups and zero Count', async (c) => {
		const { body } = await c.http('GET', '/penaltyGroup?Offset=9999999999', undefined, 200);
		check(Array.isArray(body.Items) && body.Items.length === 0, 'Empty group list');
		equal(body.Count, 0, 'Empty group count');
	});
	add('getPenaltyGroup', 'group-categories', 'Paid/unpaid/disabled groups; category grouping and amount arithmetic; IDs moved to Payments', async (c) => {
		for (const expected of c.data.groups) {
			const group = await getGroup(c, expected.ID);
			groupData(group, expected, c.data.documents.filter((d) => expected.PenaltyDocumentIds.includes(d.ID)));
			equal(group.ID, expected.ID, 'Requested group ID');
			equal(group.PaymentStatus, expected.PaymentStatus, 'Stored group payment status');
			equal(group.Enabled, expected.Enabled, 'Stored group enabled state');
			check(!('PenaltyDocumentIds' in group), 'Internal ID list omitted');
			equal(group.Payments.flatMap((p) => p.Penalties).length, expected.PenaltyDocumentIds.length, 'All group members');
		}
	});
	add('getPenaltyGroup', 'group-missing', '404 with exact group-not-found error', async (c) => {
		equal((await c.http('GET', '/penaltyGroup/rspintegrationmissing', undefined, 404)).body.error, 'Penalty Group rspintegrationmissing not found', 'Missing group response');
	});
	add('create', 'create-invalid', 'Real validation rejects amount below minimum, before writing', async (c) => {
		const item = payload(c.data.create);
		item.Value.penaltyAmount = 1;
		const { body } = await c.http('POST', '/documents', item, 400);
		equal(body.err, 'Invalid Input: Value.penaltyAmount must be greater than or equal to 10', 'Amount validation message');
		await c.http('GET', `/documents/${item.ID}`, undefined, 404);
	});
	add('create', 'create-read-duplicate', 'Create valid synthetic document, generated hash/offset, read persistence; duplicate conditional write rejected', async (c) => {
		for (const item of [c.data.create, ...c.data.createVariants]) {
			c.trackDocument(item.ID);
			const { body } = await c.http('POST', '/documents', payload(item), 200);
			documentContract(body);
			equal(body.ID, item.ID, 'Created ID');
			equal(body.Value.penaltyAmount, item.Value.penaltyAmount, 'Created amount');
			check(body.Offset >= c.data.now && /^[a-f0-9]{64}$/.test(body.Hash), 'Fresh create offset and SHA-256 hash format');
			persistedDocument(await getDoc(c, body.ID), { ...item, Hash: body.Hash, Offset: body.Offset });
		}
		const duplicate = await c.http('POST', '/documents', payload(c.data.create), 400);
		equal(duplicate.body.name, 'ConditionalCheckFailedException', 'Duplicate condition error');
	});
	add('updateMulti', 'batch-update-all-types', 'FPN/IM/CDN full-value updates, ordered per-item results, independent complete read-back and fresh hashes/offsets', async (c) => {
		const originals = c.data.documents.slice(15, 18);
		const items = originals.map((item) => {
			const body = payload(item);
			body.Value.penaltyAmount += 5;
			body.Value.driverDetails.address = 'Updated synthetic test address';
			return body;
		});
		const { body } = await c.http('PUT', '/documents', { Items: items }, 200);
		equal(body.Items.length, 3, 'Three typed update results');
		for (let i = 0; i < items.length; i += 1) {
			const result = body.Items[i];
			equal(result.status, 200, 'Typed update per-item success');
			equal(result.item.ID, items[i].ID, 'Typed update order');
			check(result.item.Hash !== originals[i].Hash && result.item.Offset >= c.data.now, 'Typed update fresh hash/offset');
			persistedDocument(await getDoc(c, items[i].ID), { ...items[i], Hash: result.item.Hash, Offset: result.item.Offset });
		}
	});
	add('updateMulti', 'update-and-stale-hash', 'Matching hash updates amount; stale hash fails per-item without overwriting; batch HTTP 200 is not per-item success', async (c) => {
		const original = await getDoc(c, c.data.documents[3].ID);
		const item = payload(original);
		item.Value.penaltyAmount += 10;
		const { body } = await c.http('PUT', '/documents', { Items: [item] }, 200);
		check(Array.isArray(body.Items) && body.Items.length === 1, 'Batch result array');
		equal(body.Items[0].status, 200, 'Successful per-item status');
		documentContract(body.Items[0].item);
		check(body.Items[0].item.Hash !== original.Hash, 'Hash changed');
		const changed = await getDoc(c, original.ID);
		persistedDocument(changed, { ...item, Hash: body.Items[0].item.Hash, Offset: body.Items[0].item.Offset });
		equal(changed.Value.penaltyAmount, item.Value.penaltyAmount, 'Updated amount persisted');
		equal(changed.Hash, body.Items[0].item.Hash, 'Updated hash persisted');
		const stale = payload(original);
		stale.Value.penaltyAmount += 20;
		const rejected = await c.http('PUT', '/documents', { Items: [stale] }, 200);
		equal(rejected.body.Items[0].status, 400, 'Stale hash per-item rejected');
		equal(rejected.body.Items[0].error.code, 'ConditionalCheckFailedException', 'Conditional rejection code');
		persistedDocument(await getDoc(c, original.ID), changed);
	});
	add('updateMulti', 'batch-mixed-validation', 'Mixed valid/invalid batch preserves order and validates each result and persistence', async (c) => {
		const good = payload(await getDoc(c, c.data.documents[4].ID));
		const bad = payload(await getDoc(c, c.data.documents[5].ID));
		good.Value.penaltyAmount += 1;
		bad.Value.penaltyAmount = 1;
		const { body } = await c.http('PUT', '/documents', { Items: [good, bad] }, 200);
		equal(body.Items.length, 2, 'Two batch results');
		equal(body.Items[0].status, 200, 'First item succeeds');
		equal(body.Items[0].item.ID, good.ID, 'First result order');
		equal(body.Items[1].status, 400, 'Second item fails');
		equal(body.Items[1].item.ID, bad.ID, 'Second result order');
		equal(body.Items[1].error, 'Invalid Input: Value.penaltyAmount must be greater than or equal to 10', 'Exact validation error');
		equal((await getDoc(c, good.ID)).Value.penaltyAmount, good.Value.penaltyAmount, 'Valid item persisted');
		persistedDocument(await getDoc(c, good.ID), { ...good, Hash: body.Items[0].item.Hash, Offset: body.Items[0].item.Offset });
		persistedDocument(await getDoc(c, bad.ID), c.data.documents[5]);
	});
	add('delete', 'delete-stale-hash', 'Stale delete rejected conditionally and document stays enabled', async (c) => {
		const item = payload(await getDoc(c, c.data.documents[6].ID));
		if (item.Value.paymentStatus === 'PAID') c.skip('Authoritative Payments marks fixture paid; cannot exercise unpaid delete condition');
		item.Hash = 'StaleHash';
		const { body } = await c.http('DELETE', `/documents/${item.ID}`, item, 400);
		equal(body.name, 'ConditionalCheckFailedException', 'Stale delete error');
		equal((await getDoc(c, item.ID)).Enabled, true, 'Stale delete preserves enabled flag');
	});
	add('delete', 'delete-invalid-document', 'Real document validation rejects invalid deletion value and leaves complete record unchanged', async (c) => {
		const original = await getDoc(c, c.data.documents[6].ID);
		if (original.Value.paymentStatus === 'PAID') c.skip('Authoritative Payments marks fixture paid; document validation delete path unavailable');
		const item = payload(original);
		item.Value.penaltyAmount = 1;
		const { body } = await c.http('DELETE', `/documents/${item.ID}`, item, 400);
		equal(body.err, 'Invalid Input: Value.penaltyAmount must be greater than or equal to 10', 'Invalid delete exact validation error');
		persistedDocument(await getDoc(c, item.ID), original);
	});
	add('delete', 'delete-disable-read', 'Current hash soft-deletes unpaid document; disabled state, changed hash and repeated-delete rejection', async (c) => {
		const original = await getDoc(c, c.data.documents[6].ID);
		if (original.Value.paymentStatus === 'PAID') c.skip('Authoritative Payments marks fixture paid; unpaid delete unavailable');
		const { body } = await c.http('DELETE', `/documents/${original.ID}`, payload(original), 200);
		equal(body.Enabled, false, 'Delete disables');
		check(body.Hash !== original.Hash, 'Delete changes hash');
		const read = await getDoc(c, original.ID);
		persistedDocument(read, {
			...original, Enabled: false, Hash: body.Hash, Offset: body.Offset,
		});
		equal(read.Enabled, false, 'Disabled state persisted');
		equal(read.Hash, body.Hash, 'Delete hash persisted');
		equal((await c.http('DELETE', `/documents/${read.ID}`, payload(read), 400)).body.name, 'ConditionalCheckFailedException', 'Repeated deletion rejected');
	});
	add('delete', 'delete-all-types', 'FPN/IM/CDN unpaid soft-deletes preserve all Value fields and expose exact disabled state/hash/offset through independent GET', async (c) => {
		for (const fixture of c.data.documents.slice(18, 21)) {
			const original = await getDoc(c, fixture.ID);
			if (original.Value.paymentStatus === 'PAID') c.skip('Authoritative Payments marks a typed delete fixture paid; cannot delete it');
			const { body } = await c.http('DELETE', `/documents/${original.ID}`, payload(original), 200);
			check(body.Hash !== original.Hash && body.Offset >= c.data.now, 'Typed deletion fresh hash/offset');
			persistedDocument(await getDoc(c, original.ID), {
				...original, Enabled: false, Hash: body.Hash, Offset: body.Offset,
			});
		}
	});
	add('updateWithPaymentStartTime', 'document-payment-start', 'Payment start time persisted as recent epoch seconds', async (c) => {
		const id = c.data.documents[9].ID;
		await c.http('PUT', '/documents/updateWithPaymentStartTime', { id }, 200);
		const value = (await getDoc(c, id)).Value.paymentStartTime;
		check(Number.isFinite(value) && value >= c.data.now && value <= Date.now() / 1000 + 1, 'Recent paymentStartTime');
		const expected = clone(c.data.documents[9]);
		expected.Value.paymentStartTime = value;
		persistedDocument(await getDoc(c, id), expected);
	});
	add('updateWithPaymentStartTime', 'document-payment-start-missing', 'Missing document update rejected; no record created', async (c) => {
		await c.http('PUT', '/documents/updateWithPaymentStartTime', { id: '990099999999_FPN' }, 400);
		equal((await c.http('GET', '/documents/990099999999_FPN', undefined, 404)).body.error, 'ITEM NOT FOUND', 'Conditional update did not upsert');
	});
	add('updatePenaltyGroupWithPaymentStartTime', 'group-payment-start-types', 'FPN/IM/CDN each persist to correct payment-start field with recent epoch seconds', async (c) => {
		const before = await getGroup(c);
		const observed = {};
		for (const [penaltyType, field] of [['FPN', 'fpnPaymentStartTime'], ['IM', 'imPaymentStartTime'], ['CDN', 'cdnPaymentStartTime']]) {
			await c.http('PUT', '/penaltyGroup/updateWithPaymentStartTime', { id: GROUP_ID, penaltyType }, 200);
			const value = (await getGroup(c))[field];
			check(Number.isFinite(value) && value >= c.data.now, 'Group payment start time');
			observed[field] = value;
			deep(await getGroup(c), { ...before, ...observed }, 'Only expected group payment start fields changed');
		}
	});
	add('updatePenaltyGroupWithPaymentStartTime', 'group-payment-start-missing', 'Missing group rejected and not upserted', async (c) => {
		await c.http('PUT', '/penaltyGroup/updateWithPaymentStartTime', { id: 'rspintegrationmissing', penaltyType: 'FPN' }, 400);
		await c.http('GET', '/penaltyGroup/rspintegrationmissing', undefined, 404);
	});
	add('updateUponPaymentDelete', 'single-payment-reversal', 'Stored status, hash and offset change; verify through registration search (GET overlays live Payments)', async (c) => {
		const original = c.data.documents[7];
		const { body } = await c.http('PUT', '/documents/updateUponPaymentDelete', { id: original.ID, paymentStatus: 'UNPAID' }, 200);
		documentContract(body);
		equal(body.Value.paymentStatus, 'UNPAID', 'Reversal status');
		check(body.Hash !== original.Hash && body.Offset >= c.data.now, 'Reversal updates hash and offset');
		await c.poll(async () => {
			const search = (await c.http('GET', `/vehicle-reg/${REGISTRATION}`, undefined, 200)).body;
			const stored = search.Penalties.find((d) => d.ID === original.ID);
			persistedDocument(stored, body, false);
			equal(stored?.Value.paymentStatus, 'UNPAID', 'Stored reversal status visible in search');
			equal(stored?.Hash, body.Hash, 'Reversal hash persisted');
		});
	});
	add('updateUponPaymentDelete', 'single-reversal-missing', 'Missing penalty reversal rejected and never upserted; existing group unchanged', async (c) => {
		const before = await getGroup(c);
		const { body } = await c.http('PUT', '/documents/updateUponPaymentDelete', { id: '990099999999_FPN', paymentStatus: 'UNPAID' }, 400);
		check(body && typeof body === 'object' && 'message' in body, 'Existing reversal error envelope');
		await c.http('GET', '/documents/990099999999_FPN', undefined, 404);
		deep(await getGroup(c), before, 'Missing reversal leaves group unchanged');
	});
	add('updateMultipleUponPaymentDelete', 'group-payment-reversal', 'Paid group and both members become UNPAID with changed document hashes and fresh offsets', async (c) => {
		const original = c.data.groups[1];
		await c.http('PUT', '/documents/updateMultipleUponPaymentDelete', { penaltyDocumentIds: original.PenaltyDocumentIds }, 200);
		const group = await getGroup(c, original.ID);
		equal(group.PaymentStatus, 'UNPAID', 'Group reversal persisted');
		check(group.Offset >= c.data.now, 'Group reversal offset');
		group.Payments.flatMap((p) => p.Penalties).forEach((doc) => {
			equal(doc.Value.paymentStatus, 'UNPAID', 'Member reversed');
			check(doc.Offset >= c.data.now, 'Member offset updated');
			check(doc.Hash !== c.data.documents.find((d) => d.ID === doc.ID).Hash, 'Member hash updated');
			persistedDocument(doc, {
				...c.data.documents.find((d) => d.ID === doc.ID),
				Value: { ...c.data.documents.find((d) => d.ID === doc.ID).Value, paymentStatus: 'UNPAID' },
				Hash: doc.Hash,
				Offset: doc.Offset,
			}, false);
		});
		const unchanged = { ...original, PaymentStatus: 'UNPAID', Offset: group.Offset };
		const actual = clone(group);
		delete actual.Payments;
		delete unchanged.PenaltyDocumentIds;
		deep(actual, unchanged, 'Group reversal changes only stored status and offset');
	});
	add('updateMultipleUponPaymentDelete', 'empty-payment-reversal', 'Empty list accepted without changing group hash/status', async (c) => {
		const before = await getGroup(c);
		await c.http('PUT', '/documents/updateMultipleUponPaymentDelete', { penaltyDocumentIds: [] }, 200);
		const after = await getGroup(c);
		equal(after.Hash, before.Hash, 'Empty reversal hash unchanged');
		equal(after.PaymentStatus, before.PaymentStatus, 'Empty reversal status unchanged');
	});
	add('updateMultipleUponPaymentDelete', 'multiple-reversal-missing', 'Missing member gives structured failure rather than upsert/false success; complete existing group unchanged', async (c) => {
		const before = await getGroup(c);
		const { body } = await c.http('PUT', '/documents/updateMultipleUponPaymentDelete', { penaltyDocumentIds: ['990099999999_FPN'] }, 400);
		equal(body.name, 'TypeError', 'Missing member currently raises TypeError');
		check(typeof body.message === 'string' && body.message.length > 0, 'Missing member error detail');
		await c.http('GET', '/documents/990099999999_FPN', undefined, 404);
		deep(await getGroup(c), before, 'Missing multi-reversal preserves group');
	});
	add('createPenaltyGroup', 'group-validation', 'Real schema rejects invalid registration with structured GroupValidation error', async (c) => {
		const item = clone(c.data.groupPayload);
		item.VehicleRegistration = 'INVALID REG';
		const { body } = await c.http('POST', '/penaltyGroup', item, 400);
		equal(body.errCode, 'GroupValidation', 'Group validation code');
		equal(body.errMessage, 'Schema validation failed', 'Group validation message');
		check(body.errBody.validationError.startsWith('Invalid Input: VehicleRegistration'), 'Validation field identified');
	});
	add('createPenaltyGroup', 'group-duplicate-references', 'Existing enabled penalties rejected with GroupDuplicateReference and clashing IDs', async (c) => {
		const item = clone(c.data.groupPayload);
		item.Penalties = [payload(c.data.documents[0])];
		const { body } = await c.http('POST', '/penaltyGroup', item, 400);
		equal(body.errCode, 'GroupDuplicateReference', 'Duplicate group code');
		check(body.errBody.clashingIds.includes(c.data.documents[0].ID), 'Clashing ID identified');
	});
	add('createPenaltyGroup', 'group-create-read', '201 group creation, normalized registration, exact total and member links; HTTP GET category structure', async (c) => {
		c.trackGroup(c.data.createdGroupId);
		c.data.groupPayload.Penalties.forEach((doc) => c.trackDocument(doc.ID));
		const { body } = await c.http('POST', '/penaltyGroup', c.data.groupPayload, 201);
		equal(body.ID, c.data.createdGroupId, 'Reserved derived group ID');
		equal(body.VehicleRegistration, 'RSPGROUP01', 'Group registration');
		equal(body.PaymentStatus, 'UNPAID', 'Created group status');
		equal(body.TotalAmount, c.data.groupPayload.Penalties.reduce((sum, p) => sum + p.Value.penaltyAmount, 0), 'Create total');
		check(Array.isArray(body.Penalties) && body.Penalties.length === 2, 'Created member count');
		body.Penalties.forEach((doc) => {
			equal(doc.penaltyGroupId, body.ID, 'Member group link');
			equal(doc.inPenaltyGroup, true, 'Member grouping flag');
		});
		const read = await getGroup(c, body.ID);
		groupData(read, body, body.Penalties);
		equal(read.TotalAmount, body.TotalAmount, 'Persisted group total');
	});
	add('deleteGroup', 'group-delete-disable', 'Unpaid group deletion returns empty 204, group and all members disabled', async (c) => {
		const before = await getGroup(c);
		const { text } = await c.http('DELETE', `/penaltyGroup/${GROUP_ID}`, undefined, 204);
		equal(text, '', '204 has no response body');
		const group = await getGroup(c);
		equal(group.Enabled, false, 'Group disabled');
		const metadata = clone(group);
		delete metadata.Payments;
		const expectedMetadata = { ...before, Enabled: false, Offset: group.Offset };
		delete expectedMetadata.Payments;
		deep(metadata, expectedMetadata, 'Cancellation preserves all other group fields');
		check(group.Offset >= c.data.now, 'Cancelled group fresh offset');
		group.Payments.flatMap((p) => p.Penalties).forEach((doc) => {
			const original = c.data.documents.find((d) => d.ID === doc.ID);
			equal(doc.Enabled, false, 'Member disabled');
			check(doc.Hash !== original.Hash && doc.Offset >= c.data.now, 'Cancelled member new hash/offset');
			persistedDocument(doc, {
				...original, Enabled: false, Hash: doc.Hash, Offset: doc.Offset,
			}, false);
		});
	});
	add('deleteGroup', 'group-delete-missing', 'Missing group deletion returns 400 with nonempty error string', async (c) => {
		const { body } = await c.http('DELETE', '/penaltyGroup/rspintegrationmissing', undefined, 400);
		check(typeof body === 'string' && body.length > 0, 'Missing group error string');
	});
	add('deleteGroup', 'group-delete-partially-paid', 'Mixed group cancellation preserves paid document, destroys unpaid document, updates full group totals/status/membership and hash', async (c) => {
		const original = c.data.groups[3];
		const members = c.data.documents.filter((d) => original.PenaltyDocumentIds.includes(d.ID));
		const paid = members.find((d) => d.Value.paymentStatus === 'PAID');
		const unpaid = members.find((d) => d.Value.paymentStatus === 'UNPAID');
		await c.http('DELETE', `/penaltyGroup/${original.ID}`, undefined, 204);
		const read = await getGroup(c, original.ID);
		groupData(read, {
			...original,
			Enabled: false,
			PaymentStatus: 'PAID',
			TotalAmount: paid.Value.penaltyAmount,
			VehicleRegistration: paid.Value.vehicleDetails.regNo,
		}, [paid]);
		check(read.Hash !== original.Hash && read.Offset >= c.data.now, 'Mixed cancellation fresh hash/offset');
		persistedDocument(await getDoc(c, paid.ID), paid);
		equal((await c.http('GET', `/documents/${unpaid.ID}`, undefined, 404)).body.error, 'ITEM NOT FOUND', 'Unpaid member removed');
	});
	add('updateWithPayment', 'lambda-portal-payment', 'Offline object-body payment update on PORTAL document: status/hash/offset persistence without SNS; real GET still overlays Payments', async (c) => {
		const item = c.data.documents[77];
		const body = await c.invoke('updateWithPayment', {
			body: {
				id: item.ID,
				paymentStatus: 'PAID',
				paymentAmount: item.Value.penaltyAmount,
				penaltyRefNo: item.Value.referenceNo,
				penaltyType: item.Value.penaltyType,
				paymentToken: item.Value.paymentToken,
			},
		}, 200);
		documentContract(body);
		equal(body.Value.paymentStatus, 'PAID', 'Lambda payment status');
		check(body.Hash !== item.Hash && body.Offset >= c.data.now, 'Lambda payment hash and offset');
		await c.poll(async () => {
			const search = (await c.http('GET', `/vehicle-reg/${REGISTRATION}`, undefined, 200)).body;
			const stored = search.Penalties.find((p) => p.ID === item.ID);
			equal(stored?.Value.paymentStatus, 'PAID', 'Lambda payment stored status');
			equal(stored?.Hash, body.Hash, 'Lambda payment stored hash');
			persistedDocument(stored, body, false);
		});
	}, { lambda: true });
	add('updateWithPayment', 'lambda-dummy-invalid-amount', 'KNOWN DEFECT / current-behaviour baseline: exact application 200 with returned dummy fields, independent GET 404; not successful creation', async (c) => {
		const item = c.data.dummy;
		c.trackDocument(item.ID);
		const body = await c.invoke('updateWithPayment', {
			body: {
				id: item.ID,
				paymentStatus: 'PAID',
				paymentAmount: 1,
				penaltyRefNo: item.Value.referenceNo,
				penaltyType: item.Value.penaltyType,
				paymentToken: item.Value.paymentToken,
			},
		}, 200);
		check(Number.isInteger(body.Offset) && body.Offset >= c.data.now, 'Current-behaviour dummy response has fresh epoch offset');
		deep(body, {
			ID: item.ID,
			Value: {
				dateTime: body.Offset,
				siteCode: 5,
				vehicleDetails: { regNo: 'UNKNOWN' },
				referenceNo: item.Value.referenceNo,
				penaltyType: item.Value.penaltyType,
				paymentToken: item.Value.paymentToken,
				officerName: 'UNKNOWN',
				penaltyAmount: 1,
				officerID: 'UNKNOWN',
				inPenaltyGroup: false,
				paymentStatus: 'PAID',
			},
			Enabled: true,
			Origin: 'PORTAL',
			Hash: 'New',
			Offset: body.Offset,
		}, 'Known defect baseline: exact returned dummy data despite invalid amount');
		const missing = await c.http('GET', `/documents/${item.ID}`, undefined, 404);
		equal(missing.body.error, 'ITEM NOT FOUND', 'Known defect baseline: dummy was NOT persisted despite application 200');
	}, { lambda: true });
	add('updateWithPayment', 'lambda-dummy-create', 'Missing penalty creates valid PORTAL placeholder, persists identity/UNKNOWN registration, uses authoritative Payments status', async (c) => {
		const item = c.data.dummy;
		c.trackDocument(item.ID);
		const body = await c.invoke('updateWithPayment', {
			body: {
				id: item.ID,
				paymentStatus: 'UNPAID',
				paymentAmount: item.Value.penaltyAmount,
				penaltyRefNo: item.Value.referenceNo,
				penaltyType: item.Value.penaltyType,
				paymentToken: item.Value.paymentToken,
			},
		}, 200);
		equal(body.ID, item.ID, 'Placeholder returned ID');
		const read = await getDoc(c, item.ID);
		documentContract(read);
		equal(read.Value.vehicleDetails.regNo, 'UNKNOWN', 'Placeholder registration');
		equal(read.Value.officerID, 'UNKNOWN', 'Placeholder officer ID');
		equal(read.Value.penaltyAmount, item.Value.penaltyAmount, 'Placeholder persisted amount');
		const expected = {
			dateTime: read.Value.dateTime,
			siteCode: 5,
			vehicleDetails: { regNo: 'UNKNOWN' },
			referenceNo: item.Value.referenceNo,
			penaltyType: item.Value.penaltyType,
			paymentToken: item.Value.paymentToken,
			officerName: 'UNKNOWN',
			penaltyAmount: item.Value.penaltyAmount,
			officerID: 'UNKNOWN',
			inPenaltyGroup: false,
		};
		deep(domainValue(read.Value, true), expected, 'Full placeholder domain values persisted');
		check(Number.isFinite(read.Value.dateTime) && read.Value.dateTime >= c.data.now, 'Placeholder issue time');
		check(read.Hash.length === 64 && read.Offset >= c.data.now && read.Enabled, 'Placeholder fresh persisted hash/offset/enabled');
		await c.poll(async () => {
			const search = (await c.http('GET', '/vehicle-reg/UNKNOWN', undefined, 200)).body;
			const stored = search.Penalties.find((p) => p.ID === item.ID);
			equal(stored?.Origin, 'PORTAL', 'Placeholder persisted PORTAL origin');
			persistedDocument(stored, read);
		});
	}, { lambda: true });
	add('updateWithPayment', 'lambda-app-payment-notification', 'APP payment update persists status/hash and can send real SNS; no assertion of delivery from fire-and-forget return', async (c) => {
		const item = c.data.documents[12];
		const body = await c.invoke('updateWithPayment', {
			body: {
				id: item.ID,
				paymentStatus: 'PAID',
				paymentAmount: item.Value.penaltyAmount,
				penaltyRefNo: item.Value.referenceNo,
				penaltyType: item.Value.penaltyType,
				paymentToken: item.Value.paymentToken,
			},
		}, 200);
		equal(body.Value.paymentStatus, 'PAID', 'APP payment updated');
		check(body.Hash !== item.Hash, 'APP payment hash changed');
		await c.poll(async () => {
			const search = (await c.http('GET', `/vehicle-reg/${REGISTRATION}`, undefined, 200)).body;
			equal(search.Penalties.find((p) => p.ID === item.ID)?.Value.paymentStatus, 'PAID', 'APP payment stored');
		});
	}, { lambda: true, requires: 'notifications' });
	add('updatePenaltyGroupWithPayment', 'lambda-group-missing', 'Missing group returns structured 500 application error, does not create group or publish', async (c) => {
		const body = await c.invoke('updatePenaltyGroupWithPayment', {
			body: {
				id: 'rspintegrationmissing', paymentStatus: 'PAID', penaltyType: 'FPN',
			},
		}, 500);
		check(typeof body.name === 'string' && typeof body.message === 'string', 'Structured missing group error');
		await c.http('GET', '/penaltyGroup/rspintegrationmissing', undefined, 404);
	}, { lambda: true });
	add('updatePenaltyGroupWithPayment', 'lambda-group-unknown-type', 'Unknown payment type gives application error, group remains unchanged', async (c) => {
		const before = await getGroup(c, c.data.createdGroupId);
		const body = await c.invoke('updatePenaltyGroupWithPayment', {
			body: JSON.stringify({
				id: before.ID, paymentStatus: 'PAID', penaltyType: 'UNKNOWN',
			}),
		}, 500);
		check(typeof body.message === 'string', 'Unknown type error message');
		equal((await getGroup(c, before.ID)).PaymentStatus, before.PaymentStatus, 'Rejected type does not change group');
	}, { lambda: true });
	add('updatePenaltyGroupWithPayment', 'lambda-group-partial-full-reverse', 'String/object body, per-category paid state, full group paid aggregation, reverse one category; persists all transitions; can publish SNS', async (c) => {
		const id = c.data.createdGroupId;
		const start = await getGroup(c, id);
		const categories = start.Payments.map((p) => p.PaymentCategory);
		check(categories.length >= 2, 'Multiple payment categories');
		for (let i = 0; i < categories.length; i += 1) {
			const payment = { id, paymentStatus: 'PAID', penaltyType: categories[i] };
			const body = await c.invoke('updatePenaltyGroupWithPayment', { body: i === 0 ? JSON.stringify(payment) : payment }, 200);
			equal(body.PaymentStatus, i === categories.length - 1 ? 'PAID' : 'UNPAID', 'Aggregate group status after category payment');
			const read = await getGroup(c, id);
			equal(read.Payments.find((p) => p.PaymentCategory === categories[i]).PaymentStatus, 'PAID', 'Paid category persisted');
			equal(read.PaymentStatus, body.PaymentStatus, 'Aggregate status persisted');
		}
		const paid = await getGroup(c, id);
		check(paid.Hash !== start.Hash, 'Whole-group payment changes hash');
		await c.invoke('updatePenaltyGroupWithPayment', { body: { id, paymentStatus: 'UNPAID', penaltyType: categories[0] } }, 200);
		const reversed = await getGroup(c, id);
		equal(reversed.PaymentStatus, 'PAID', 'Existing group status remains paid until all categories reverse');
		equal(reversed.Payments.find((p) => p.PaymentCategory === categories[0]).PaymentStatus, 'UNPAID', 'Reversed category');
		equal(reversed.Payments.find((p) => p.PaymentCategory === categories[1]).PaymentStatus, 'PAID', 'Other category preserved');
		await c.invoke('updatePenaltyGroupWithPayment', { body: { id, paymentStatus: 'UNPAID', penaltyType: categories[1] } }, 200);
		const fullyReversed = await getGroup(c, id);
		equal(fullyReversed.PaymentStatus, 'UNPAID', 'Group status reverses once all categories are unpaid');
		fullyReversed.Payments.forEach((p) => equal(p.PaymentStatus, 'UNPAID', 'Every category reversed'));
	}, { lambda: true, requires: 'notifications' });
	add('streamDocuments', 'lambda-stream-malformed', 'Invalid DynamoDB image fails invocation explicitly; no SNS attempted before unmarshalling', async (c) => {
		const result = await c.invoke('streamDocuments', { Records: [{}] }, undefined, true);
		check(typeof result.errorMessage === 'string', 'Malformed stream invocation error');
	}, { lambda: true });
	add('streamDocuments', 'lambda-stream-batch-notification', 'Realistic DynamoDB attribute maps, multiple unordered offsets, exact processed-record acknowledgement; real SNS publish opt-in', async (c) => {
		const result = await c.invoke('streamDocuments', {
			Records: [200, 100, 300].map((delta) => ({
				eventName: 'MODIFY',
				dynamodb: {
					NewImage: {
						ID: { S: c.data.documents[0].ID }, Offset: { N: String(c.data.now + delta) },
					},
				},
			})),
		});
		equal(result, 'Successfully processed 3 records.', 'Stream acknowledgement only after SNS promise succeeds');
	}, { lambda: true, requires: 'notifications' });
	add('streamDocuments', 'lambda-stream-empty-notification', 'Empty stream exact acknowledgement (existing handler still publishes; explicit notification opt-in)', async (c) => {
		equal(await c.invoke('streamDocuments', { Records: [] }), 'Successfully processed 0 records.', 'Empty stream acknowledgement');
	}, { lambda: true, requires: 'notifications' });
	add('updateMulti', 'notification-capable-upsert', 'Paid APP upsert / PORTAL-to-APP update can publish SNS; deliberately not executed by default', async (c) => {
		const item = payload(c.data.documents[79]);
		item.Origin = 'APP';
		const { body } = await c.http('PUT', '/documents', { Items: [item] }, 200);
		equal(body.Items[0].status, 200, 'Origin transition status');
		equal((await getDoc(c, item.ID)).ID, item.ID, 'Origin transition document persisted');
	}, { requires: 'notifications' });
	cases.filter((s) => ['lambda-group-unknown-type', 'lambda-group-partial-full-reverse'].includes(s.id))
		.forEach((s) => { s.dependsOn = ['group-create-read']; });
	return cases;
}

module.exports = {
	inventory, scenarios, documentContract, groupContract, sitesContract,
};
