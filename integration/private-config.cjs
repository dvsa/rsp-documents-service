const fs = require('node:fs');
const path = require('node:path');

function load(env, file = path.join(__dirname, 'private-token.json')) {
	if (!fs.existsSync(file)) return { ...env };
	const values = JSON.parse(fs.readFileSync(file, 'utf8'));
	const allowed = ['INTEGRATION_TOKEN', 'INTEGRATION_TOKEN_DOCUMENT_ID', 'INTEGRATION_TOKEN_REFERENCE', 'INTEGRATION_TOKEN_AMOUNT'];
	if (!values || typeof values !== 'object' || Array.isArray(values)
		|| Object.keys(values).some((key) => !allowed.includes(key))
		|| Object.values(values).some((value) => typeof value !== 'string')) {
		throw new Error('Invalid private token configuration; only string token/expected-value fields are permitted');
	}
	return { ...values, ...env };
}

module.exports = { load };
