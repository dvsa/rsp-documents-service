const test = require('node:test');
const assert = require('node:assert/strict');
const httpServer = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Validation = require('@dvsa/rsp-validation').default;
const {
	fixtures, payload, clone, OWNER,
} = require('./fixtures.cjs');
const store = require('./local-store.cjs');
const {
	inventory, scenarios, documentContract, sitesContract,
} = require('./contracts.cjs');
const {
	execute, http, requirement, DependencyUnavailable,
} = require('./run.cjs');
const { render, directory, write } = require('./report.cjs');
const assertions = require('./assertions.cjs');
const privateConfig = require('./private-config.cjs');

function memoryDb(initial = []) {
	const items = new Map(initial.map((e) => [`${e.table}/${e.item.ID}`, clone(e.item)]));
	const requests = [];
	const operation = (kind) => async (params) => {
		requests.push({ kind, params });
		const key = `${params.TableName}/${params.Key?.ID || params.Item.ID}`;
		if (kind === 'get') return { Item: items.has(key) ? clone(items.get(key)) : undefined };
		if (kind === 'put') items.set(key, clone(params.Item));
		if (kind === 'delete') items.delete(key);
		return {};
	};
	return {
		get: operation('get'), put: operation('put'), delete: operation('delete'), items, requests,
	};
}

test('startup uses SDK v3 profile resolution without the credential-export launcher', () => {
	const root = path.resolve(__dirname, '..');
	const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	assert.equal(fs.existsSync(path.join(root, 'scripts/start-local.cjs')), false);
	assert.equal(scripts.start, 'npm run copy-localfiles && npm run compile && npm run parallel');
	assert.equal(scripts['start:local'], 'npm start');
	assert.match(scripts.offline, /node --env-file=\.env .*serverless\.js offline start --noAuth$/);
	assert.doesNotMatch(JSON.stringify(scripts), /export-credentials|start-local\.cjs/);
});

test('real validators accept all synthetic write payloads and mixed-type group payload', () => {
	const data = fixtures(1793780000);
	for (const item of [...data.documents, data.create, ...data.createVariants, data.dummy]) {
		assert.equal(Validation.penaltyDocumentValidation(payload(item)).valid, true, item.ID);
	}
	assert.equal(Validation.penaltyGroupValidation(data.groupPayload).valid, true);
	assert.ok(data.documents.filter((d) => d.Origin === 'APP' && d.Offset >= data.now - 2000).length > 75);
	assert.equal(new Set(store.entries(data, true).map((e) => e.item.ID)).size, 101);
	assert.deepEqual(fixtures(1793780000), data);
});

test('inventory exactly matches all 19 exports and all 16 configured HTTP routes', () => {
	const root = path.resolve(__dirname, '..');
	const handler = fs.readFileSync(path.join(root, 'src/handler.js'), 'utf8');
	const exports = handler.match(/export\s*\{([\s\S]*?)\}/)[1].split(',').map((name) => name.trim()).filter(Boolean);
	assert.deepEqual(inventory.map((e) => e.exportName || e.id).sort(), exports.sort());
	const config = fs.readFileSync(path.join(root, 'serverless/serverless.yml'), 'utf8');
	const wired = [...config.matchAll(/handler: handler\.(\w+)/g)].map((m) => m[1]);
	assert.deepEqual(wired.sort(), exports.sort(), 'Every configured local handler must resolve to an actual export');
	const routes = [...config.matchAll(/path: ([^\n]+)\n\s+method: ([^\n]+)/g)]
		.map((m) => `${m[2].toUpperCase()} /${m[1]}`).sort();
	assert.deepEqual(inventory.filter((e) => e.transport === 'HTTP').map((e) => e.route).sort(), routes);
	for (const entry of inventory) assert.ok(scenarios().some((s) => s.endpoint === entry.id));
	assert.equal(new Set(scenarios().map((s) => s.id)).size, scenarios().length);
});

test('safety rejects CI, missing confirmation, remote hosts, alternate ports and credentials', () => {
	assert.throws(() => store.configuration({}), /CONFIRM_LOCAL/);
	assert.throws(() => store.configuration({ CI: 'true', INTEGRATION_CONFIRM_LOCAL: 'yes' }), /CI/);
	for (const url of ['https://localhost:3000', 'http://example.org:3000', 'http://127.0.0.1:8000',
		'http://user:pass@localhost:3000', 'http://localhost:3000?x=1']) {
		assert.throws(() => store.localUrl(url, 3000));
	}
	assert.equal(store.configuration({ INTEGRATION_CONFIRM_LOCAL: 'yes' }).baseUrl, 'http://localhost:3000/dev');
	assert.ok(requirement({ requires: 'notifications', lambda: true }, {}).includes('ALLOW_NOTIFICATIONS'));
	assert.ok(requirement({ lambda: true }, {}).includes('ALLOW_LAMBDA'));
	assert.ok(requirement({ requires: 'token' }, {}).includes('INTEGRATION_TOKEN'));
});

test('snapshot, reseed, cleanup preserve unrelated data and restore owned originals', async () => {
	const data = fixtures();
	const original = clone(data.documents[0]);
	original.Value.penaltyAmount = 999;
	const unrelated = { table: 'penaltyDocuments', item: { ID: 'user-owned', Value: { important: true } } };
	const db = memoryDb([{ table: 'penaltyDocuments', item: original }, unrelated]);
	const before = clone([...db.items]);
	const snapshot = await store.snapshot(db, data);
	await store.seed(db, data);
	await store.seed(db, data);
	await store.restore(db, snapshot);
	assert.deepEqual([...db.items], before);
	assert.ok(db.requests.filter((r) => r.kind === 'put' || r.kind === 'delete')
		.every((r) => r.params.ConditionExpression && r.params.ExpressionAttributeValues));
});

test('collisions fail before writes; cleanup refuses foreign data', async () => {
	const data = fixtures();
	const foreign = { ...clone(data.documents[0]), IntegrationFixture: 'another-owner' };
	const db = memoryDb([{ table: 'penaltyDocuments', item: foreign }]);
	await assert.rejects(() => store.snapshot(db, data), /collision/);
	assert.ok(db.requests.every((r) => r.kind === 'get'));
	await assert.rejects(() => store.restore(db, [{ table: 'penaltyDocuments', item: foreign }]), /ownership/);
	assert.equal(db.items.size, 1);
	const probe = memoryDb([{ table: 'penaltyDocuments', item: { ID: '990099999999_FPN', Value: { important: true } } }]);
	await assert.rejects(() => store.snapshot(probe, data), /collision/);
	assert.ok(probe.requests.every((r) => r.kind === 'get'));
});

test('cleanup restores owned originals removed by a mixed-paid group cancellation', async () => {
	const data = fixtures();
	const entry = { table: 'penaltyDocuments', item: data.documents[87] };
	const db = memoryDb([entry]);
	const originals = await store.snapshot(db, data);
	db.items.delete(`penaltyDocuments/${entry.item.ID}`);
	await store.restore(db, originals);
	assert.deepEqual(db.items.get(`penaltyDocuments/${entry.item.ID}`), entry.item);
	assert.ok(db.requests.some((r) => r.kind === 'put' && r.params.ConditionExpression === 'attribute_not_exists(ID)'));
});

test('created document/group cleanup verifies token and exact reserved group membership', async () => {
	const data = fixtures();
	const db = memoryDb();
	const snapshot = await store.snapshot(db, data);
	const created = new Set([`penaltyDocuments/${data.create.ID}`, `penaltyGroups/${data.createdGroupId}`,
		...data.groupPayload.Penalties.map((p) => `penaltyDocuments/${p.ID}`)]);
	db.items.set(`penaltyDocuments/${data.create.ID}`, clone(data.create));
	data.groupPayload.Penalties.forEach((p) => db.items.set(`penaltyDocuments/${p.ID}`, clone(p)));
	db.items.set(`penaltyGroups/${data.createdGroupId}`, { ID: data.createdGroupId, PenaltyDocumentIds: data.groupPayload.Penalties.map((p) => p.ID) });
	await store.restore(db, snapshot, created);
	assert.equal(db.items.size, 0);
});

test('preflight failure always reports complete not-run inventory without AWS client creation', async () => {
	let written;
	const result = await execute({ env: {}, write: (report) => { written = report; } });
	assert.equal(result.outcome, 'failed');
	assert.equal(result, written);
	assert.equal(result.scenarios.length, scenarios().length);
	assert.ok(result.scenarios.every((s) => s.status === 'not-run'));
	const html = render(result);
	assert.match(html, /19 exported handlers: 16 HTTP routes and 3 Lambda-only/);
	assert.equal(result.endpoints.length, 19);
	assert.ok(result.endpoints.every((e) => e.status === 'incomplete'));
});

test('HTML/JSON files persist even when confirmation is absent; this preview performs no network calls', async () => {
	const result = await execute({
		env: {},
		operation: 'offline-tooling-preview',
		write: (report) => write(report, 'tooling-preview'),
	});
	assert.equal(result.outcome, 'failed');
	const json = JSON.parse(fs.readFileSync(path.join(directory, 'tooling-preview.json'), 'utf8'));
	assert.equal(json.endpoints.length, 19);
	assert.ok(json.scenarios.every((s) => s.status === 'not-run'));
	assert.ok(fs.readFileSync(path.join(directory, 'tooling-preview.html'), 'utf8').includes('offline-tooling-preview'));
});

test('runner reports pass/fail/skips/dependency-unavailable and cleans up after failed scenarios', async () => {
	const db = memoryDb();
	let written;
	const result = await execute({
		env: { INTEGRATION_CONFIRM_LOCAL: 'yes' },
		db,
		write: (r) => { written = r; },
		http: async () => ({
			body: {
				Penalties: [clone(db.items.values().next().value)],
				PenaltyGroups: [...db.items.entries()].filter(([key]) => key.startsWith('penaltyGroups/')).map(([, item]) => clone(item)),
			},
		}),
		tests: [
			{
				id: 'pass', endpoint: 'get', validation: 'read back', run: async () => {},
			},
			{
				id: 'skip', endpoint: 'get', validation: 'SNS', requires: 'notifications', run: async () => assert.fail(),
			},
			{
				id: 'failure', endpoint: 'get', validation: 'reject bad shape', run: async () => assert.ok(false, 'Expected domain data'),
			},
			{
				id: 'dependency', endpoint: 'get', validation: 'real AWS', run: async () => { throw new DependencyUnavailable('AWS dependency unavailable'); },
			},
		],
	});
	assert.equal(result, written);
	assert.equal(result.outcome, 'failed');
	assert.deepEqual(result.scenarios.map((s) => s.status), ['passed', 'skipped', 'failed', 'dependency-unavailable']);
	assert.equal(db.items.size, 0);
	assert.match(result.cleanup, /restored/);
	assert.equal(fs.existsSync(path.resolve(__dirname, '../.integration-local.lock')), false);
});

test('HTTP transport validates JSON, reports AWS dependency failure, rejects redirects and preserves text contracts', async () => {
	const server = httpServer.createServer((req, res) => {
		if (req.url === '/redirect') { res.writeHead(302, { Location: 'https://example.org' }); res.end(); return; }
		if (req.url === '/text') { res.writeHead(400); res.end('No numeric Offset provided'); return; }
		res.setHeader('content-type', 'application/json');
		if (req.url === '/dependency') { res.writeHead(400); res.end(JSON.stringify({ name: 'ExpiredTokenException', message: 'sensitive body must not enter report' })); return; }
		res.end(JSON.stringify({ Items: [] }));
	});
	await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		assert.deepEqual((await http(base, 'GET', '/', undefined, 200)).body, { Items: [] });
		assert.equal((await http(base, 'GET', '/text', undefined, 400)).text, 'No numeric Offset provided');
		await assert.rejects(() => http(base, 'GET', '/dependency', undefined, 200), DependencyUnavailable);
		await assert.rejects(() => http(base, 'GET', '/redirect', undefined, 200), DependencyUnavailable);
		await assert.rejects(() => http(base, 'GET', '/', undefined, 404), /Expected HTTP 404; received HTTP 200/);
	} finally { await new Promise((resolve) => { server.close(resolve); }); }
});

test('reports escape markup and differences redact token, hash, external strings and personal data', () => {
	const report = {
		startedAt: '2026-01-01',
		node: '20',
		operation: 'test',
		setup: '<script>',
		cleanup: 'done',
		outcome: 'failed',
		provenance: 'checked-in inventory',
		inventory,
		scenarios: [{
			id: 'x', endpoint: 'get', validation: 'fields', status: 'failed', reason: '<img>',
		}],
	};
	const html = render(report);
	assert.ok(!html.includes('<script>') && !html.includes('<img>'));
	assert.ok(html.includes('&lt;script&gt;'));
	assert.ok(!JSON.stringify(report).includes(OWNER));
	assert.deepEqual(
		assertions.safe({
			paymentToken: 'secret', Hash: 'secret', officerName: 'person', ID: 'external', penaltyAmount: 50,
		}),
		{
			paymentToken: '[redacted]', Hash: '[redacted]', officerName: '[redacted]', ID: '[string length=8, contents redacted]', penaltyAmount: 50,
		},
	);
});

test('contract assertions reject malformed response data', () => {
	assert.throws(() => documentContract({ ID: 'x', Value: { penaltyType: 'INVALID' } }));
	assert.throws(() => documentContract({ ...fixtures().documents[0], Offset: '123' }));
});

test('Sites matches the verified actual Items envelope, exact item fields and unique codes', () => {
	const items = [{ name: 'Synthetic site', region: 'Synthetic region', siteCode: 1 }];
	assert.deepEqual(sitesContract({ Items: items }), items);
	assert.throws(() => sitesContract(items));
	assert.throws(() => sitesContract({ Items: [] }));
	assert.throws(() => sitesContract({ Items: [...items, ...items] }));
	assert.throws(() => sitesContract({ Items: [{ ...items[0], siteCode: '1' }] }));
	assert.throws(() => sitesContract({ Items: [{ ...items[0], unexpected: 'field' }] }));
});

test('private token configuration accepts only expected-value fields; explicit environment wins', () => {
	fs.mkdirSync(directory, { recursive: true });
	const file = path.join(directory, 'private-config-selftest.json');
	try {
		fs.writeFileSync(file, JSON.stringify({
			INTEGRATION_TOKEN: 'synthetic',
			INTEGRATION_TOKEN_DOCUMENT_ID: 'synthetic_FPN',
			INTEGRATION_TOKEN_REFERENCE: 'synthetic',
			INTEGRATION_TOKEN_AMOUNT: '100',
		}));
		const values = privateConfig.load({ INTEGRATION_TOKEN_AMOUNT: '200' }, file);
		assert.equal(values.INTEGRATION_TOKEN, 'synthetic');
		assert.equal(values.INTEGRATION_TOKEN_AMOUNT, '200');
		fs.writeFileSync(file, JSON.stringify({ INTEGRATION_ALLOW_NOTIFICATIONS: 'yes' }));
		assert.throws(() => privateConfig.load({}, file), /Invalid private token/);
	} finally { fs.unlinkSync(file); }
	assert.deepEqual(privateConfig.load({ sentinel: 'value' }, file), { sentinel: 'value' });
});
