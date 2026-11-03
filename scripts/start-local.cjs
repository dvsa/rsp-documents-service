const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

function start() {
	const profile = process.env.AWS_PROFILE || 'default';
	let credentials;
	try {
		credentials = JSON.parse(execFileSync('aws', [
			'configure', 'export-credentials', '--profile', profile, '--format', 'process',
		], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
	} catch {
		throw new Error(`Cannot load AWS profile "${profile}". Check that AWS CLI v2 is installed and the profile is authenticated, then retry npm start.`);
	}
	if (!credentials.AccessKeyId || !credentials.SecretAccessKey) {
		throw new Error(`AWS CLI returned incomplete credentials for profile "${profile}".`);
	}
	if (credentials.Expiration && Date.parse(credentials.Expiration) <= Date.now()) {
		throw new Error(`AWS profile "${profile}" has expired. Authenticate the profile, then retry npm start.`);
	}

	let javaHome = process.env.JAVA_HOME;
	if (process.platform === 'darwin') {
		try {
			javaHome = execFileSync('/usr/libexec/java_home', ['-v', '21'], {
				encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
			}).trim();
		} catch {
			throw new Error('Java 21 is required for DynamoDB Local. Install a Java 21 JDK, then retry npm start.');
		}
	}
	const java = javaHome ? path.join(javaHome, 'bin', 'java') : 'java';
	const version = spawnJavaVersion(java);
	if (!/version "21(?:[."])/.test(version)) {
		throw new Error('Java 21 is required for DynamoDB Local. Set JAVA_HOME to a Java 21 JDK, then retry npm start.');
	}

	const env = {
		...process.env,
		AWS_PROFILE: profile,
		AWS_ACCESS_KEY_ID: credentials.AccessKeyId,
		AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
		NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --no-experimental-require-module`.trim(),
	};
	if (credentials.SessionToken) env.AWS_SESSION_TOKEN = credentials.SessionToken;
	else delete env.AWS_SESSION_TOKEN;
	if (javaHome) {
		env.JAVA_HOME = javaHome;
		env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${env.PATH || ''}`;
	}

	console.log(`Starting locally with AWS profile "${profile}" and Java 21. Restart after temporary credentials expire.`);
	const child = spawn('npm', ['run', 'start:local'], { stdio: 'inherit', env });
	child.on('error', (error) => {
		console.error(`Local startup failed: ${error.message}`);
		process.exitCode = 1;
	});
	child.on('exit', (code, signal) => {
		process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
	});
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => child.kill(signal));
	}
}

function spawnJavaVersion(java) {
	const { spawnSync } = require('node:child_process');
	const result = spawnSync(java, ['-version'], { encoding: 'utf8' });
	if (result.error || result.status !== 0) {
		throw new Error('Cannot run Java. Install Java 21 and configure JAVA_HOME, then retry npm start.');
	}
	return `${result.stdout}${result.stderr}`;
}

try {
	start();
} catch (error) {
	console.error(`Local startup failed: ${error.message}`);
	process.exitCode = 1;
}
