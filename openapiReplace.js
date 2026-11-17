const fs = require('node:fs');

const openapiPath = './openapi.json';
if (fs.existsSync(openapiPath)) {
	const openapi = fs.readFileSync(openapiPath, 'utf8');
	fs.writeFileSync(openapiPath, openapi.split('\"requestBody\": {},').join(''));
}
