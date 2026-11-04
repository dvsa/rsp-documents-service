const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (process.env.INTEGRATION_APPROVE_SITES !== 'yes') {
	throw new Error('Review integration-baselines/sites.candidate.json, then set INTEGRATION_APPROVE_SITES=yes to explicitly approve it');
}
const folder = path.resolve(__dirname, '../integration-baselines');
const candidate = fs.readFileSync(path.join(folder, 'sites.candidate.json'), 'utf8');
const sites = JSON.parse(candidate);
assert.ok(Array.isArray(sites) && sites.length > 0, 'Nonempty Sites candidate');
assert.ok(sites.every((s) => typeof s.name === 'string' && typeof s.region === 'string' && Number.isInteger(s.siteCode)), 'Valid Sites schema');
assert.ok(new Set(sites.map((s) => s.siteCode)).size === sites.length, 'Unique site codes');
fs.writeFileSync(path.join(folder, 'sites.json'), candidate);
console.log('Sites baseline explicitly approved locally. Run the integration suite again to verify it; approval itself is not a test pass.');
