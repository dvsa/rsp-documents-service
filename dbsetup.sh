#!/bin/sh
set -eu
npm run presetup
cd ./build
node ../node_modules/serverless/bin/serverless.js dynamodb install