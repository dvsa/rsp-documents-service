# aws-serverless-starter-template

### Node.js 24

Use [Node Version Manager](https://npm.github.io/installation-setup-docs/installing/using-a-node-version-manager.html) (nvm) to use right Node Version. Specified in `.nvmrc`.
- `nvm use`

#### Run AWS Lambda node functions locally with a mock API Gateway and DynamoDB to test against
- `npm install`
- `./dbsetup.sh`
- Set `AWS_PROFILE` in `.env` to your development profile (for example `rsp-dev`).
- Authenticate that profile using your usual AWS login process.
- `npm start` to spin up AWS Lambda and API Gateway

`npm start` copies local configuration, compiles the service and runs the watcher
and Offline. Offline loads `.env` using Node's `--env-file`; SDK v3 resolves
`AWS_PROFILE` directly using its standard credential provider chain. Exported
shell values take precedence over `.env`. No launcher exports AWS credentials.

#### Troubleshooting
The CLI is the open-source Serverless fork **OSLS**, not licensed Serverless v4.
The `serverless` dependency is an npm alias to OSLS so plugin peer dependencies
cannot install a second, legacy framework. The local plugins are
`serverless-dynamodb`, Serverless Offline 14 and `serverless-openapi-documenter`,
following `rsp-gov-notify`'s `feat/node24-upgrade` baseline. The Node 20
`--no-experimental-require-module` workaround is no longer needed.
Use Java 21 for the current DynamoDB Local distribution. Select it before
starting the service; Java is no longer selected by a launcher. On macOS:

```sh
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

Elsewhere, put an installed Java 21 JDK on `PATH` and set `JAVA_HOME`.

The local API listens on `http://localhost:3000`, with DynamoDB on port 8000.
Set the `.env` table names to `penaltyDocuments` and `penaltyGroups`.
The local startup command disables API authorization; calls to Lambda, S3 and
SNS still require valid AWS credentials and use the configured AWS resources.

If getting errors downloading DynamoDB, download directly from:

https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html

#### Pre-requisites
Use Node.js 24 and npm 11 (as specified in `.nvmrc` and `package.json`), an authenticated development AWS
profile, and Java 21. Serverless is installed locally through `npm install`;
a global installation and a `[default]` profile are not required when
`AWS_PROFILE` selects a named profile.

### Manual integration tests and HTML results

See [the local black-box integration guide](integration/README.md) for all **19
handlers (16 HTTP routes + three local Lambda-only invocations)**, detailed
write/read-back checks, static Sites baseline approval, seed safety, optional
notification tests and the self-contained HTML coverage report.

#### Running the full suite from scratch

1. In the service repository, select Node 24 and install dependencies:

   ```sh
   nvm use
   npm ci
   ```

2. Authenticate your development AWS profile using your usual login process.
   Java 21 must be installed. Configure your ignored `.env`:

   ```dotenv
   AWS_PROFILE=rsp-dev
   INTEGRATION_CONFIRM_LOCAL=yes
   INTEGRATION_ALLOW_LAMBDA=yes
   INTEGRATION_ALLOW_NOTIFICATIONS=yes
   ```

   The notification flag permits real SNS publishing. Enable it only for an
   authorised non-production topic. Check the configured AWS resources and use
   local table names `penaltyDocuments` and `penaltyGroups`.

3. Start the service in the first terminal and wait for the API-ready message:

   ```sh
   npm start
   ```

   Startup generates the additional synthetic seed data. Keep this terminal
   running. `npm run start:local` is a compatibility alias for `npm start`.

4. In a second terminal in the same repository, run:

   ```sh
   nvm use
   npm run test:integration:local
   ```

   The command loads `.env` automatically and prints setup, scenario results,
   cleanup and final totals. It restores its owned fixtures after the run;
   no separate seed/reset command is normally necessary.

5. Open the HTML results:

   ```sh
   npm run test:integration:report:open
   ```

   Results are saved in `integration-reports/latest.html`, including failures
   and skipped scenarios. This is endpoint/scenario coverage, not source coverage.

6. Stop the service with Ctrl+C in the first terminal. If AWS credentials expire,
   authenticate again and restart `npm start` before rerunning tests. SDK v3
   handles credential resolution and refresh; there is no exported snapshot.

Keep the approved `integration-baselines/sites.json` and ignored
`integration/private-token.json` when comparing runs across runtime upgrades.
The approved Sites baseline is committed, so fresh checkouts compare against the
same dataset without local capture or approval. Supply a valid non-production
token with independently known expected values as described in the linked guide.
Missing prerequisites are reported as skipped, not covered.

This suite is manual-only, excluded from `npm test`/source coverage/CI.

### Unit tests and coverage

Run on Node.js 24 after `npm ci`:

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
builds are unchanged. The test runner disables automatic ESM
detection so every `.js` test, including ones importing only packages,
uses the Babel require hook consistently. `src/handler.js` only re-exports
handlers: Istanbul reports zero executable statements/functions/branches there
(0/0, displayed as 0%), while its 19 exports are tested.

The shared unit setup installs synthetic SDK credentials and intercepts SDK v3
client `send` calls before module-scoped clients are created. Unstubbed requests fail;
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

The Node 24 migration also resolves the nine baseline type diagnostics: Lambda
responses are explicitly decoded from SDK v3 bytes, the obsolete launcher is
removed, and hashing uses the library's named export. TypeScript
5 supports the Node 24 declarations; `npm run check-js-types` requires no blanket
suppression.

### Node 24 build and AWS SDK migration

`npm run package` builds all 19 entries in `lambdas.json` directly with webpack,
then waits for all 19 ZIP archives in `dist/`. Every bundle is self-contained at
`.webpack/<lambda>/app.js` (export `handler`). SDK v3 dynamic imports are bundled
inline (`asyncChunks: false`); no SAM webpack plugin or shared numbered chunks
are required. The `streamDocuments` entry maps to `src/functions/stream.js`.
The optional SAM template points to these generated per-function directories;
run the package command before using SAM locally.
`npm run build-openapi` uses the replacement OpenAPI documenter.
Its stricter configuration schema requires function-level timeouts (retaining
the configured 12/18-second values), explicit documented responses and path
parameters. Obsolete GET body-model references are removed; routes, CORS,
authorizers and integration expectations are unchanged.

Production clients now use SDK v3 for DynamoDB, Lambda, S3, SNS and Secrets
Manager. The injected DynamoDB interface retains `.promise()` for compatibility
with existing behavioural tests, but sends only v3 commands and preserves
`removeUndefinedValues: true`. Only Offline selects the loopback database.
The adapter preserves v2-style DynamoDB exception codes in batch responses and
the `ValidationException` contract for invalid numeric offsets, which v3 rejects
during marshalling rather than at the DynamoDB endpoint.
Lambda byte payloads are decoded before JSON parsing and S3 response streams
are consumed with `transformToString`. The independent integration seed/cleanup
adapter also uses v3, without importing production code or changing contracts.
SNS payment notifications remain fire-and-forget; a successful API response is
not proof of publish success or device delivery.

The SDK v2 credential-export launcher (`scripts/start-local.cjs`) is removed.
Authenticate with `aws sso login --profile rsp-dev` when that profile uses SSO.
SDK v3 reads the selected profile directly; select Java 21 on `PATH` before
`npm start`.

When existing services occupy IPv6 loopback ports 3000/3002, a separate local API
can be started with `LOCAL_API_HOST=127.0.0.1 LOCAL_STAGE=upgrade npm start`.
The non-`dev` stage skips DynamoDB startup/migration/seeding and requires an
already-running local database on port 8000. Defaults remain `localhost` and
`dev`. Point integration tools explicitly at this API and Lambda prefix:

```sh
INTEGRATION_BASE_URL=http://127.0.0.1:3000/upgrade \
INTEGRATION_LAMBDA_URL=http://127.0.0.1:3002 \
INTEGRATION_FUNCTION_PREFIX=RSP-BackendApi-upgrade npm run test:integration:local
```

Runtime declarations and CI select Node 24, but this does not change any live
Lambda or external Terraform configuration. No deployment is part of this test
upgrade. Existing branch/main artifact-upload and deployment guards are unchanged.

#### Upgrade verification — 4 November 2026

On Node 24.20.0 / npm 11.19.0 with OSLS 4.5.0:

- `npm test` and `npm run test:coverage`: **224 passing**; aggregate
  statements **99.76%**, branches **98.24%**, functions **100%**, lines **99.75%**.
  Every production file passes the unchanged 95.01% gate in all four metrics
  (the export-only handler module has no executable counters).
- `npm run lint`, `npm run lint:integration`, `npm run check-js-types`,
  `npm run test:integration:tooling` (**16 passing**), `npm run package` and
  `npm run build-openapi` pass. All 19 independent bundle exports and archives
  are checked.
- Full local integration: **53 passing, zero failures/skips**, all 19 handlers.
  Contracts, fixture assertions and the approved 111-site dataset are unchanged.
  The first migration run exposed two genuine v3 error-shape regressions; the
  database adapter fixes these, with new unit tests, rather than weakening the
  integration assertions. Known invalid dummy creation remains 200 then GET 404.
  Fixture restoration completed successfully.
- Existing user services occupied IPv6 loopback ports 3000/3002 and DynamoDB
  port 8000. After removing the credential-export launcher, actual `npm start`
  was verified with `LOCAL_API_HOST=127.0.0.1 LOCAL_STAGE=upgrade` and Java 21
  selected on `PATH`. No AWS access/session credentials were exported into
  the startup environment; SDK v3 resolved the `.env` profile directly.
  Verification used the new Node 24 process on IPv4
  `127.0.0.1:3000/upgrade`, Lambda port 3002 and stage `upgrade` (which skips
  database startup/migration/seeding), sharing the existing local database
  under the integration suite's ownership/snapshot/restore safeguards. The
  unchanged full suite passed again against that process, including real
  Payments/Token/S3 reads and authorised non-production SNS operations (not
  notification delivery). Default `dev` startup with a newly launched database
  was not tested because the existing database port was occupied.
  Only the task-owned API was stopped; existing services were left running.
- Snyk without policy ignores: production **53 dependencies, zero vulnerable
  paths**. Including development dependencies still reports **13 unique issues
  over 43 paths**, in legacy/build/documentation tooling. Compatible dependency
  updates substantially reduce findings, but this is **not** a clean full-tree
  security result. No new ignores are added; the original Node 20 `.snyk`
  deferrals are unchanged. Further toolchain remediation is needed before
  deployment. Generated scan details are in ignored
  `integration-reports/node24-snyk.json` for this checkout.

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

This uses Webpack entries from `lambdas.json` to bundle each Lambda into
`.webpack/<name>/app.js` and create its deployment ZIP in `dist/`. AWS SAM is not
required.
