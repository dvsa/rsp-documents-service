# aws-serverless-starter-template

### Node JS 20

Use [Node Version Manager](https://npm.github.io/installation-setup-docs/installing/using-a-node-version-manager.html) (nvm) to use right Node Version. Specified in `.nvmrc`.
- `nvm use`

#### Run AWS Lambda node functions locally with a mock API Gateway and DynamoDB to test against
- `npm install`
- `./dbsetup.sh`
- Set `AWS_PROFILE` in `.env` to your development profile (for example `rsp-dev`).
- Authenticate that profile using your usual AWS login process.
- `npm start` to spin up AWS Lambda and API Gateway

`npm start` loads `.env`, resolves the selected profile through AWS CLI v2,
and passes credentials to the local processes in memory only. An exported
shell `AWS_PROFILE` takes precedence over `.env`; if neither is set, the
`default` profile is used. Credentials are not written to files or printed.
Restart `npm start` after temporary credentials expire.

#### Troubleshooting
The launcher adds `--no-experimental-require-module` automatically to avoid
Serverless 3's CommonJS/ES module loading error on recent Node.js 20 releases.
The local plugins are `serverless-dynamodb`
and Serverless Offline 13, which support Serverless 3 and the Node.js 20 runtime.
Use Java 21 for the current DynamoDB Local distribution. On macOS, the launcher
selects an installed Java 21 JDK automatically; elsewhere, configure `JAVA_HOME`
or put Java 21 on `PATH`. Startup fails clearly if Java or AWS credentials
cannot be resolved.

The local API listens on `http://localhost:3000`, with DynamoDB on port 8000.
Set the `.env` table names to `penaltyDocuments` and `penaltyGroups`.
The local startup command disables API authorization; calls to Lambda, S3 and
SNS still require valid AWS credentials and use the configured AWS resources.

If getting errors downloading DynamoDB, download directly from:

https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html

#### Pre-requisites
Use Node.js 20 (as specified in `.nvmrc`), AWS CLI v2 with
`aws configure export-credentials` support, an authenticated development AWS
profile, and Java 21. Serverless is installed locally through `npm install`;
a global installation and a `[default]` profile are not required when
`AWS_PROFILE` selects a named profile.

### Unit tests and coverage

Run on Node.js 20 after `npm ci`:

- `npm test` — isolated unit/behaviour tests (no local services or AWS login needed).
- `npm run test:coverage` — the same tests with **95.01% minimum statements,
  branches, functions and lines for each production file**, including files never
  imported by tests. A failing test or threshold fails the command.
- `npm run lint` and `npm run check-js-types` — existing validation commands.

Reports are generated in ignored `coverage/` (`index.html`,
`coverage-final.json`, `coverage-summary.json`); raw data is in ignored
`.nyc_output/`. Generated report JavaScript is excluded from type checking.
Only unit/integration tests, fixtures/helpers under `src/test/`, and the
test-only `src/services/penaltyDocumentsTests/` directory (including its empty
`getDocumentByToken.js`) are excluded from coverage. No production files or
branches are ignored.

Coverage uses NYC with Babel's Istanbul plugin **before** Babel transforms the
source. NYC's second instrumentation/remapping pass is disabled so generated
regenerator/interop helpers do not appear as untested application code.
`BABEL_ENV=coverage` limits instrumentation to the coverage command; normal
builds are unchanged. The test runner disables Node 20's automatic ESM
detection/require so every `.js` test, including ones importing only packages,
uses the Babel require hook consistently. `src/handler.js` only re-exports
handlers: Istanbul reports zero executable statements/functions/branches there
(0/0, displayed as 0%), while its 19 exports are tested.

The shared unit setup installs synthetic SDK credentials and intercepts AWS
requests before module-scoped clients are created. Unstubbed requests fail;
legacy fire-and-forget SNS notifications receive an in-memory response.
Individual behavioural tests explicitly configure and assert DynamoDB, Lambda,
S3, SNS and Secrets Manager requests/results. HTTP/HTTPS are also blocked as a
backstop; no profiles, real credentials, databases, buckets or notifications
are used. Integration tests (`npm run test-i`) are separate and **not** covered
by this isolation setup.

#### Behavioural findings

Two tightly scoped fixes accompany regression tests: unmatched payment IDs are
ignored rather than indexing `-1` and throwing; vehicle searches no longer
include top-level grouped penalties among standalone penalties.

Existing issues are explicitly identified rather than counted as successful
behaviour or bypassed with fake validation:

- Missing/empty/`<NewHash>` hashes are rejected by the real validation package,
  so the intended missing-hash fallback in `updateItem` cannot reach DynamoDB.
  The supported alphanumeric `New` sentinel and conditional expression are tested.
- Dummy document creation still returns HTTP 200 after validation/write failure;
  its success log checks for 201 although `createDocument` returns 200. Tests
  assert error logging and failed persistence, not a successful write.
- Group creation's pre-validation read failures escape its response boundary;
  unknown payment-start penalty types reject before its `try` block.
- Group creation validation rejects spaces and a top-level `Origin`, even though
  the internal enrichment helper can normalize/preserve them.
- Repeated environment bootstraps retain existing configuration values because
  the existing reducer gives the previous configuration precedence.

`check-js-types` already fails on this branch: six diagnostics in the local
startup launcher, two Lambda `_Blob`/`JSON.parse` diagnostics in
`penaltyDocuments.js`, and the `js-sha256` default-import diagnostic. These
pre-existing errors are not suppressed or changed by the coverage work.

### Environmental variables

The ENV environmental variable should be one of DEV or PROD.

USE_SECRETS_MANAGER=false
TOKEN_SERVICE_ARN=rsp-token-decrypt-arn
SNSTOPICARN=snsTopicArn
SITERESOURCE=siteResource
PAYMENTURL=paymenturl
PAYMENTS_BATCH_FETCH_ARN=rsp-payments-dev-arn
ENV=development
DYNAMODB_PENALTY_GROUP_TABLE=penaltyGroups
DYNAMODB_PENALTY_DOC_TABLE=penaltyDocuments
BUCKETNAME=bucketName
TOKEN_SERVICE_URL=tokenservice
AWS_ACCESS_KEY_ID=access_key_id
AWS_SECRET_ACCESS_KEY=secret_access_key
AWS_DEFAULT_REGION=eu-west-1

### Authorisation

The API is protected by a really basic mechanism in DEV mode.
When you are sending an API request, send the header

```
"Authorization": "allow"
```
### Git Hooks

Please set up the following prepush git hook in .git/hooks/pre-push

```
#!/bin/sh
npm run prepush && git log -p | scanrepo
```

#### Security

Please install and run the following securiy programs as part of your testing process:

https://github.com/awslabs/git-secrets

- After installing, do a one-time set up with `git secrets --register-aws`. Run with `git secrets --scan`.

https://github.com/UKHomeOffice/repo-security-scanner

- After installing, run with `git log -p | scanrepo`.

These will be run as part of prepush so please make sure you set up the git hook above so you don't accidentally introduce any new security vulnerabilities.

### Building

To build for deployment to AWS.

- `npm run package`

This uses aws-sam-plugin and webpack to build each Lambda into it's own archive zip ready to upload to s3 or Lambda.
