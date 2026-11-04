const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const file = path.resolve(__dirname, '../integration-reports/latest.html');
fs.accessSync(file);
const commands = {
	darwin: ['open', [file]],
	win32: ['explorer.exe', [file]],
	linux: ['xdg-open', [file]],
};
const command = commands[process.platform];
console.log(file);
if (command) {
	const child = spawn(command[0], command[1], { stdio: 'ignore' });
	child.on('error', () => { console.error('Open the HTML file printed above in your browser.'); process.exitCode = 1; });
	child.on('exit', (code) => { if (code) process.exitCode = 1; });
}
