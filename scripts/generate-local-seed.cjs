const fs = require('node:fs');
const path = require('node:path');
const { fixtures } = require('../integration/fixtures.cjs');

const target = path.resolve(__dirname, '../build/mock-data');
fs.mkdirSync(target, { recursive: true });
const { documents, groups } = fixtures();
fs.writeFileSync(path.join(target, 'integration-documents.json'), JSON.stringify(documents, null, 2));
fs.writeFileSync(path.join(target, 'integration-groups.json'), JSON.stringify(groups, null, 2));
console.log(`Generated ${documents.length} synthetic documents and ${groups.length} groups in build/mock-data; existing Bruno fixtures are unchanged.`);
