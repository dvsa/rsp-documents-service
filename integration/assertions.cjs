const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');

let evidence;

function begin() { evidence = { count: 0, checks: [] }; return evidence; }
function safe(value, depth = 0) {
	if (depth > 5) return '[nested value]';
	if (value === undefined) return '[undefined]';
	if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
	if (typeof value === 'string') {
		if (['PAID', 'UNPAID', 'APP', 'PORTAL', 'FPN', 'IM', 'CDN', 'UNKNOWN', 'ConditionalCheckFailedException', 'GroupValidation', 'GroupDuplicateReference'].includes(value)) return value;
		return `[string length=${value.length}, contents redacted]`;
	}
	if (Array.isArray(value)) return value.slice(0, 100).map((v) => safe(v, depth + 1));
	return Object.fromEntries(Object.entries(value).map(([key, v]) => [
		key, /token|auth|officer|driver|paymentRef|hash/i.test(key) ? '[redacted]' : safe(v, depth + 1),
	]));
}

function check(condition, message, actual, expected) {
	if (evidence) {
		evidence.count += 1;
		if (!evidence.checks.includes(message)) evidence.checks.push(message);
	}
	if (!condition) {
		const error = new assert.AssertionError({
			message, actual: undefined, expected: undefined, operator: 'contract',
		});
		if (arguments.length > 2) error.details = { expected: safe(expected), actual: safe(actual) };
		throw error;
	}
}
function equal(actual, expected, message) { check(actual === expected, message, actual, expected); }
function deep(actual, expected, message) { check(isDeepStrictEqual(actual, expected), message, actual, expected); }

module.exports = {
	begin, check, equal, deep, safe,
};
