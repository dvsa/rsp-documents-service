const fs = require('node:fs');
const path = require('node:path');

const directory = path.resolve(__dirname, '../integration-reports');
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function render(report) {
	const summary = {};
	report.scenarios.forEach((s) => { summary[s.status] = (summary[s.status] || 0) + 1; });
	report.summary = summary;
	report.endpoints = report.inventory.map((endpoint) => {
		const scenarios = report.scenarios.filter((s) => s.endpoint === endpoint.id);
		const passed = scenarios.filter((s) => s.status === 'passed').length;
		let status = 'incomplete';
		if (scenarios.length > 0 && passed === scenarios.length) status = 'passed';
		else if (scenarios.some((s) => ['failed', 'dependency-unavailable'].includes(s.status))) status = 'failed';
		return {
			...endpoint,
			scenarios: scenarios.length,
			passed,
			status,
		};
	});
	const rows = report.scenarios.map((s) => `<tr><td>${escape(s.endpoint)}</td><td>${escape(s.id)}</td><td>${escape(s.validation)}<details><summary>${s.assertions?.count || 0} assertions; request/read-back evidence</summary><ul>${(s.actions || []).map((a) => `<li>${escape(a)}</li>`).join('')}</ul><ul>${(s.assertions?.checks || []).map((c) => `<li>${escape(c)}</li>`).join('')}</ul></details></td><td class="${escape(s.status)}">${escape(s.status)}</td><td>${escape(s.reason || '')}${s.difference ? `<pre>${escape(JSON.stringify(s.difference, null, 2))}</pre>` : ''}</td></tr>`).join('');
	const endpoints = report.endpoints.map((e) => `<tr><td>${escape(e.id)}</td><td>${escape(e.route || 'Lambda-only')}</td><td>${escape(e.status)}</td><td>${e.passed}/${e.scenarios}</td></tr>`).join('');
	return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Documents HTTP integration coverage</title>
<style>body{font:16px system-ui;margin:2rem;color:#17212b}table{border-collapse:collapse;width:100%;margin-bottom:2rem}th,td{border:1px solid #bbb;padding:.5rem;text-align:left;vertical-align:top}th{background:#eee}code,pre{overflow-wrap:anywhere;white-space:pre-wrap}.passed{background:#d8f3dc}.failed,.dependency-unavailable{background:#ffd6d6}.skipped,.not-run{background:#fff3bf}details{margin-top:.5rem}summary{cursor:pointer}</style>
<h1>Documents HTTP integration coverage</h1><p>${escape(report.startedAt)} — Node ${escape(report.node)} — ${escape(report.operation)}</p>
<p><strong>Endpoint/scenario coverage, NOT source-code coverage.</strong> ${escape(report.outcome)}. ${escape(JSON.stringify(summary))}</p>
<p>Setup: ${escape(report.setup)}. Cleanup: ${escape(report.cleanup)}.</p>
<p>Configuration scope: ${escape(JSON.stringify(report.scope || {}))}</p>
<p>19 exported handlers: 16 HTTP routes and 3 Lambda-only handlers (not 19 HTTP endpoints). Offline Lambda scenarios are listed separately, never counted as HTTP coverage. Notification delivery, controlled downstream failures and paid authoritative records need separate authorised evidence.</p>
<p><strong>Known defect / current-behaviour baseline:</strong> invalid dummy creation returns application 200 with dummy data while independent GET returns 404. A pass for that scenario means this exact existing behaviour was reproduced, NOT that a document was successfully created. A deliberate future bug fix must explicitly update this baseline.</p>
<h2>Handler/endpoint inventory</h2><table><tr><th>Handler</th><th>Contract</th><th>Status</th><th>Passed / inventoried scenarios</th></tr>${endpoints}</table>
<h2>Scenario checklist</h2><table><tr><th>Endpoint</th><th>Scenario</th><th>Validations</th><th>Result</th><th>Reason</th></tr>${rows}</table>
<h2>Inventory provenance</h2><p>${escape(report.provenance)}</p>
<p>Reports intentionally omit URLs, response bodies, credentials, tokens and external personal data. A dependency-unavailable result is not a pass. Skips and not-run scenarios mean incomplete coverage.</p></html>`;
}

function write(report, latestName = 'latest') {
	const html = render(report);
	fs.mkdirSync(directory, { recursive: true });
	const stem = report.startedAt.replace(/[:.]/g, '-');
	for (const name of [stem, latestName]) {
		fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
		fs.writeFileSync(path.join(directory, `${name}.html`), html);
	}
	console.log(`Integration coverage: ${report.outcome}; ${JSON.stringify(report.summary)}`);
	console.log(`Report: ${path.join(directory, `${latestName}.html`)}`);
}

function regenerate() {
	const report = JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'));
	fs.writeFileSync(path.join(directory, 'latest.html'), render(report));
	console.log(path.join(directory, 'latest.html'));
}

module.exports = {
	write, render, regenerate, directory,
};
