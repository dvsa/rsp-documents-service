const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixtures, REGISTRATION } = require('./fixtures.cjs');
const store = require('./local-store.cjs');
const reports = require('./report.cjs');
const { inventory, scenarios } = require('./contracts.cjs');
const assertions = require('./assertions.cjs');
const privateConfig = require('./private-config.cjs');

class DependencyUnavailable extends Error {}
class Skipped extends Error {}

function safeError(error) {
	// Assertion messages are authored by this suite, never dump actual/expected values or bodies.
	if (error instanceof assert.AssertionError) return error.message.split('\n')[0];
	if (error instanceof DependencyUnavailable || error instanceof Skipped) return error.message;
	if (error.code === 'ECONNREFUSED' || error.code === 'NetworkingError') return 'Local service unavailable';
	if (['Set INTEGRATION_CONFIRM_LOCAL', 'Local integration tools must not run in CI', 'Only loopback HTTP',
		'Fixture ID collision', 'Cleanup ownership check failed', 'DynamoDB URL', 'Invalid offline function prefix']
		.some((prefix) => error.message?.startsWith(prefix))) return error.message;
	return 'Setup/transport/cleanup failed; inspect local service configuration (raw errors deliberately withheld)';
}

function unavailable(body) {
	const known = new Set([
		'CredentialsError', 'ExpiredTokenException', 'ExpiredToken', 'InvalidClientTokenId',
		'UnrecognizedClientException', 'AccessDeniedException', 'AccessDenied',
		'ResourceNotFoundException', 'UnknownEndpoint', 'NetworkingError',
		'NoSuchBucket', 'NoSuchKey',
	]);
	return body && typeof body === 'object' && (known.has(body.name) || known.has(body.code));
}

async function http(baseUrl, method, route, body, expected, jsonContentType = true) {
	let response;
	try {
		response = await fetch(`${baseUrl}${route}`, {
			method,
			redirect: 'error',
			signal: AbortSignal.timeout(25000),
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	} catch {
		throw new DependencyUnavailable('Local HTTP service unreachable or request timed out; no downstream result available');
	}
	const text = await response.text();
	let parsed;
	try { parsed = JSON.parse(text); } catch { parsed = undefined; }
	if (unavailable(parsed)) throw new DependencyUnavailable('AWS dependency unavailable or unauthorised; check service login/configuration');
	assertions.equal(response.status, expected, `Expected HTTP ${expected}; received HTTP ${response.status}`);
	if (parsed !== undefined && jsonContentType) {
		assert.ok(response.headers.get('content-type')?.includes('application/json'), 'JSON content type');
	}
	return { body: parsed, text, status: response.status };
}

async function poll(check) {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		try { return await check(); } catch (error) {
			if (!(error instanceof assert.AssertionError) || attempt === 11) throw error;
			await new Promise((resolve) => { setTimeout(resolve, 250); });
		}
	}
	return undefined;
}

function requirement(test, env) {
	if (test.requires === 'token' && (!env.INTEGRATION_TOKEN || !env.INTEGRATION_TOKEN_DOCUMENT_ID
		|| !env.INTEGRATION_TOKEN_REFERENCE || !env.INTEGRATION_TOKEN_AMOUNT)) {
		return 'Requires INTEGRATION_TOKEN, INTEGRATION_TOKEN_DOCUMENT_ID, INTEGRATION_TOKEN_REFERENCE and INTEGRATION_TOKEN_AMOUNT for exact valid-token assertions';
	}
	if (test.requires === 'notifications' && env.INTEGRATION_ALLOW_NOTIFICATIONS !== 'yes') {
		return 'SNS-capable scenario disabled; requires explicit INTEGRATION_ALLOW_NOTIFICATIONS=yes';
	}
	if (test.lambda && env.INTEGRATION_ALLOW_LAMBDA !== 'yes') {
		return 'Offline Lambda invocation disabled; requires INTEGRATION_ALLOW_LAMBDA=yes (port 3002, never AWS invoke)';
	}
	if (test.requires === 'sites-baseline' && !fs.existsSync(path.resolve(__dirname, '../integration-baselines/sites.json'))
		&& env.INTEGRATION_CAPTURE_SITES_BASELINE !== 'yes') {
		return 'No verified static Sites baseline; first authorised run can set INTEGRATION_CAPTURE_SITES_BASELINE=yes';
	}
	return undefined;
}

async function invoke(config, handler, event, expected, allowFunctionError = false) {
	const result = await http(
		config.lambdaUrl,
		'POST',
		`/2015-03-31/functions/${config.functionPrefix}-${handler}/invocations`,
		event,
		200,
		false,
	);
	if (allowFunctionError) return result.body;
	assert.ok(!result.body?.errorMessage && !result.body?.errorType, 'Offline Lambda must not return an unhandled function error');
	if (expected === undefined) return result.body;
	assert.ok(result.body?.statusCode === expected, `Expected Lambda application status ${expected}; received ${result.body?.statusCode}`);
	let body;
	try { body = JSON.parse(result.body.body); } catch { ({ body } = result.body); }
	if (unavailable(body)) throw new DependencyUnavailable('AWS dependency unavailable or unauthorised during offline Lambda invocation');
	return body;
}

function sitesBaseline(sites, env) {
	const file = path.resolve(__dirname, '../integration-baselines/sites.json');
	const normalized = sites.map(({ name, region, siteCode }) => ({ name, region, siteCode }))
		.sort((a, b) => a.siteCode - b.siteCode);
	if (env.INTEGRATION_CAPTURE_SITES_BASELINE === 'yes') {
		// Explicit capture only; never silently refresh an existing approved baseline.
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const candidate = file.replace(/sites\.json$/, 'sites.candidate.json');
		fs.writeFileSync(candidate, `${JSON.stringify(normalized, null, 2)}\n`);
		throw new Skipped('Sites candidate captured; review locally then npm run test:integration:approve-sites to approve explicitly. No baseline comparison was passed.');
	}
	const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
	assert.ok(JSON.stringify(normalized) === JSON.stringify(baseline), 'Full static Sites baseline must match; review changes before explicitly recapturing');
}

async function execute(options = {}) {
	const progress = options.progress || (() => {});
	progress('Starting local integration checks...');
	let env = options.env || process.env;
	const operation = options.operation || 'test';
	const tests = options.tests || scenarios();
	const report = {
		startedAt: new Date().toISOString(),
		node: process.version,
		operation,
		provenance: 'serverless/serverless.yml HTTP events and src/handler.js (19 exports); routes aligned with Terraform on this branch. No Terraform files are stored in this repository. Independent contracts are intentionally not discovered at runtime.',
		scope: {
			target: 'Loopback HTTP :3000, DynamoDB :8000, offline Lambda :3002; no direct AWS SDK invocation from contract tests',
			lambdaEnabled: env.INTEGRATION_ALLOW_LAMBDA === 'yes',
			notificationsEnabled: env.INTEGRATION_ALLOW_NOTIFICATIONS === 'yes',
			sitesCandidateCapture: env.INTEGRATION_CAPTURE_SITES_BASELINE === 'yes',
		},
		inventory,
		scenarios: tests.map(({ endpoint, id, validation }) => ({
			endpoint, id, validation, status: 'not-run', reason: 'Setup did not complete',
		})),
		setup: 'not-started',
		cleanup: 'not-required',
		outcome: 'failed',
	};
	let db;
	let originals;
	let lock;
	let interrupted = false;
	const onSignal = () => { interrupted = true; };
	if (options.handleSignals) {
		process.on('SIGINT', onSignal);
		process.on('SIGTERM', onSignal);
	}
	const createdIds = new Set();
	const lockPath = path.resolve(__dirname, '../.integration-local.lock');
	const write = options.write || reports.write;
	try {
		if (!options.env) env = privateConfig.load(env);
		const config = store.configuration(env);
		progress('Checking local configuration and snapshotting integration fixtures...');
		assert.ok(['test', 'seed', 'reset'].includes(operation), 'Valid integration operation');
		lock = fs.openSync(lockPath, 'wx');
		db = options.db || store.client(config.dynamoUrl);
		const data = fixtures();
		originals = await store.snapshot(db, data);
		progress('Local fixture snapshot complete.');
		if (operation === 'reset') {
			// A reset removes only marked synthetic seed records, not arbitrary local data.
			await store.restore(db, originals.filter((e) => store.entries(data).some((s) => s.item.ID === e.item.ID))
				.map((entry) => ({ ...entry, original: undefined })));
			originals = undefined;
			report.setup = 'Only owned seed records removed';
		} else {
			progress('Seeding 88 documents and 4 groups in local DynamoDB...');
			await store.seed(db, data);
			report.setup = '88 documents / 4 groups seeded safely in local DynamoDB';
		}
		if (operation !== 'test') {
			originals = undefined;
			report.scenarios.forEach((s) => { s.reason = 'Seed/reset operation only; HTTP scenarios not executed'; });
			report.outcome = 'setup-operation-only (no HTTP coverage)';
			return report;
		}
		const request = options.http || ((...args) => http(config.baseUrl, ...args));
		progress('Checking that the running API reads the seeded local database...');
		// Read-only check catches API/database misalignment before any HTTP mutations.
		await poll(async () => {
			const { body } = await request('GET', `/vehicle-reg/${REGISTRATION}`, undefined, 200);
			assert.ok(body?.Penalties?.some((d) => d.ID === data.documents[0].ID
				&& d.Hash === data.documents[0].Hash), 'API must read the local seeded database');
			assert.ok(data.groups.every((expected) => body?.PenaltyGroups?.some((group) => group.ID === expected.ID
				&& group.Hash === expected.Hash)), 'API must read the local seeded group table before HTTP mutations');
		});
		let steps;
		const context = {
			data,
			env,
			poll,
			http: async (method, route, body, expected) => {
				const url = route.split('?')[0];
				const template = inventory.find((entry) => entry.transport === 'HTTP'
					&& entry.route.startsWith(`${method} `)
					&& new RegExp(`^${entry.route.split(' ')[1].replace(/\{[^}]+\}/g, '[^/]+')}$`).test(url))?.route || `${method} [local route]`;
				steps.push(`${template}; expected HTTP ${expected}`);
				return request(method, route, body, expected);
			},
			invoke: (handler, event, expected, allowFunctionError) => {
				steps.push(`Offline Lambda ${handler}; expected application status ${expected === undefined ? 'handler-specific' : expected}`);
				return invoke(config, handler, event, expected, allowFunctionError);
			},
			sitesBaseline: (sites) => sitesBaseline(sites, env),
			skip: (reason) => { throw new Skipped(reason); },
			trackDocument: (id) => createdIds.add(`penaltyDocuments/${id}`),
			trackGroup: (id) => createdIds.add(`penaltyGroups/${id}`),
		};
		for (let i = 0; i < tests.length; i += 1) {
			if (interrupted) break;
			const test = tests[i];
			const result = report.scenarios[i];
			const label = `[${i + 1}/${tests.length}] ${test.endpoint} / ${test.id}`;
			const missing = test.dependsOn?.find((id) => !report.scenarios.some((s) => s.id === id && s.status === 'passed'));
			const reason = missing ? `Prerequisite scenario ${missing} did not pass; workflow not executed` : requirement(test, env);
			if (reason) {
				Object.assign(result, { status: 'skipped', reason });
				progress(`${label}: SKIPPED - ${reason}`);
				continue;
			}
			progress(`${label}: RUNNING`);
			const start = Date.now();
			steps = [];
			const evidence = assertions.begin();
			try {
				await test.run(context);
				Object.assign(result, { status: 'passed', reason: undefined });
			} catch (error) {
				let status = 'failed';
				if (error instanceof Skipped) status = 'skipped';
				else if (error instanceof DependencyUnavailable) status = 'dependency-unavailable';
				Object.assign(result, {
					status,
					reason: safeError(error),
					...(error.details ? { difference: error.details } : {}),
				});
			}
			result.actions = steps;
			result.assertions = evidence;
			result.durationMs = Date.now() - start;
			progress(`${label}: ${result.status.toUpperCase()} (${result.durationMs}ms)${result.reason ? ` - ${result.reason}` : ''}`);
		}
		report.outcome = 'passed';
		if (report.scenarios.some((s) => s.status === 'skipped')) report.outcome = 'passed-with-skips (incomplete)';
		if (report.scenarios.some((s) => ['failed', 'dependency-unavailable', 'not-run'].includes(s.status))) report.outcome = 'failed';
	} catch (error) {
		report.setup = safeError(error);
		report.outcome = 'failed';
		progress(`Setup failed: ${report.setup}`);
	} finally {
		if (originals && db) {
			try {
				progress('Restoring integration fixtures...');
				await store.restore(db, originals, createdIds);
				report.cleanup = 'Original owned records restored; newly created owned records removed';
				progress('Fixture cleanup complete.');
			} catch (error) {
				report.cleanup = safeError(error);
				report.outcome = 'failed';
				progress(`Fixture cleanup failed: ${report.cleanup}`);
			}
		}
		if (lock !== undefined) {
			fs.closeSync(lock);
			fs.unlinkSync(lockPath);
		}
		if (options.handleSignals) {
			process.off('SIGINT', onSignal);
			process.off('SIGTERM', onSignal);
		}
		if (interrupted) {
			report.outcome = 'failed';
			report.interrupted = true;
			report.scenarios.filter((s) => s.status === 'not-run').forEach((s) => { s.reason = 'Interrupted before scenario execution'; });
		}
		report.finishedAt = new Date().toISOString();
		write(report);
		const counts = report.scenarios.reduce((totals, scenario) => {
			totals[scenario.status] = (totals[scenario.status] || 0) + 1;
			return totals;
		}, {});
		progress(`Result: ${report.outcome}; ${Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(', ')}`);
		progress('HTML report: integration-reports/latest.html');
		progress('Open with: npm run test:integration:report:open');
	}
	return report;
}

if (require.main === module) {
	if (process.argv[2] === 'report') reports.regenerate();
	else {
		execute({ operation: process.argv[2] || 'test', handleSignals: true, progress: console.log })
			.then((report) => { process.exitCode = report.outcome === 'failed' ? 1 : 0; })
			.catch(() => { console.error('Unable to write integration report'); process.exitCode = 1; });
	}
}

module.exports = {
	execute, http, poll, requirement, DependencyUnavailable, safeError, invoke,
};
