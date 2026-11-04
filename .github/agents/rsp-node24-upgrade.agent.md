---
name: RSP Node 24 upgrade
description: Upgrade an established RSP service to Node 24, OSLS and AWS SDK v3 while preserving tested contracts and verifying local startup, coverage, integrations and deployment artifacts.
---

# Role and outcome

Execute stage 2 of RSP service modernisation: Node.js 24, the open-source
Serverless fork (OSLS), and AWS SDK for JavaScript v3. Preserve the behavioural
baseline established by the companion service-baseline and integration-baseline
agents. This is not a Serverless Starter rewrite or permission to deploy.

This guide is portable. Inspect the selected repository first; names, versions,
commands, handler counts and ports below are Documents reference examples, not
universal requirements. Do not copy private configuration between repositories.

## 1. Confirm scope and capture the baseline

- Confirm the target repository, directory, branch, runtime and working-tree
  status. Read applicable repository instructions and both baseline agents.
  Do not assume the conversation's initial directory is the service checkout.
- Preserve user changes and local configuration. Create/switch an upgrade branch
  only with permission, from the agreed baseline. Do not change another checkout
  or use a worktree when the user selected their existing checkout.
- Do not commit, push, create a PR or deploy unless explicitly requested.
  Keep changes focused on the runtime migration, necessary compatibility fixes
  and directly related documentation.
- Run and record the full existing unit suite, per-file coverage gates, lint,
  type checking, builds and authorised black-box integrations before migration.
  Record existing failures separately. If a credible baseline is absent, surface
  that gap rather than silently inventing or weakening expected behaviour.
- Inventory all exported handlers, routes, event transports, AWS dependencies,
  artifact names and deployment entry points. Preserve route types/prefixes,
  request/response semantics, CORS, authorization and Lambda-only interfaces.
- Preserve approved fixtures, independent integration assertions and known-defect
  expectations. Documents' invalid dummy creation deliberately remains HTTP 200
  followed by GET 404; an upgrade is not authorization to fix that behaviour.

## 2. Inspect proven references and select compatible dependencies

Inspect `rsp-gov-notify` branch `feat/node24-upgrade` and the current DVSA Starter
where available. Use `git show <ref>:<path>` or authenticated remote reads;
do not switch or modify a reference checkout. Do not require a fixed sibling
path, assume the branch exists everywhere, or clone without permission.

Read actual manifests, bundler configuration, local Serverless configuration and
SDK usage. Do not copy the whole service or guess that every scoped SDK package
has the same release number.

The proven Documents/Notify approach uses:

- Node 24, npm 11, OSLS, Serverless Offline 14 and
  `serverless-openapi-documenter` instead of `serverless-openapi-documentation`.
- Scoped `@aws-sdk/client-*` dependencies plus `@aws-sdk/lib-dynamodb` and
  `@aws-sdk/util-dynamodb` where needed.
- Direct webpack entries rather than `aws-sam-webpack-plugin`.

Verify published versions, engines and peer requirements before installation.
Refresh the lockfile with the chosen package manager. Inspect the resolved tree,
not only the top-level manifest. Documents verified OSLS 4.5.0 and Offline 14.8.4;
these are reference results, not permanent version pins.

Some plugins declare a `serverless` peer. A top-level `osls` dependency alone can
leave legacy Serverless and SDK v2 installed. Documents explicitly aliases
`serverless` to OSLS and uses an override referencing that alias. Adapt to the
package manager, verify the `sls` binary resolves to OSLS, and ensure the graph
does not accidentally install licensed Serverless v4 or the old framework.

## 3. Align runtime, local configuration and CI

Update all applicable surfaces together:

- `.nvmrc`, `package.json` engines and the actual execution shell.
- Local Serverless provider runtime (`nodejs24.x`).
- SAM runtime, handler and generated `CodeUri` mappings.
- CI Node/npm inputs, build scripts, packaging paths and runtime declarations.
- Deployment configuration maintained in this repository. Identify external
  Terraform/live runtime work separately; do not modify/deploy it without scope.

Select Node 24 per shell where possible; do not change the user's global runtime
unnecessarily. Verify `node --version` and `npm --version`.

OSLS and the replacement OpenAPI plugin validate configuration more strictly:

- Move misplaced HTTP-event `timeout` properties to the function level,
  retaining each configured value (Documents uses 12/18 seconds).
- Supply missing documented response definitions and path parameters.
- Remove obsolete GET-body references to nonexistent models and complete
  incomplete response-model mappings.
- Run the real OpenAPI generation command and validate its generated output.
  Do not disable validation or hide generation errors to obtain a green build.
- Ensure postprocessing runs in the generated file's directory. An npm script
  invoked from `build/` may still execute from the package root.

Documentation/schema corrections must not silently change actual endpoint
contracts, authorizers, CORS, routing or integration baselines.

## 4. Migrate AWS operations and preserve observable semantics

Inventory every SDK v2 import, including runtime modules, local seed/cleanup
adapters, old integration helpers, tests and framework transitive dependencies.
Remove `aws-sdk` and legacy database-client wrappers when no longer needed.

Use reusable module-scoped v3 clients with appropriate region/endpoint
configuration and `client.send(new OperationCommand(input))`. Do not instantiate
a client per record or hardcode cloud credentials. Use the normal credential
provider chain for AWS; local-only adapters use explicit fake credentials and
verified loopback endpoints.

For Documents, migrate DynamoDB, Lambda, S3, SNS and Secrets Manager:

- **DynamoDB:** use the v3 document client and
  `marshallOptions: { removeUndefinedValues: true }` to preserve v2 behaviour.
  Keep local endpoints conditional on Offline, never an unconditional production
  loopback endpoint. Preserve conditions, return values, pagination, batching,
  ownership guards and marshalling semantics.
- A narrow injected database adapter may retain the existing `.promise()` shape
  while sending only v3 commands underneath. Alternatively migrate all callers
  and mocks together; do not leave a half-converted interface.
- Preserve public error contracts. V3 service exceptions use `name`; v2-style
  batch responses may require `error.code`. Normalize only the relevant
  compatibility boundary and preserve existing codes.
- V3 rejects non-finite numbers during marshalling, before DynamoDB receives the
  request. Documents maps that specific failure back to `ValidationException`
  for invalid offsets. Do not translate every error into a validation error.
  Add regression tests for conditional failures, invalid numbers and ordinary
  failures; keep the original assertions intact.
- **Lambda:** preserve the exact invocation input and nested JSON envelopes.
  Decode returned byte payloads with `Buffer.from(payload).toString('utf8')`
  before JSON parsing. Test malformed/missing payloads and downstream errors.
- **S3:** consume the response stream, for example with
  `await response.Body.transformToString('utf-8')`; `Body.toString()` is no longer
  the object-content contract. Test both successful reads and failures.
- **SNS:** replace callback/promise APIs deliberately. Preserve whether each
  caller awaits publishing or is fire-and-forget, and handle rejections without
  unhandled promises. Assert message content and ordering where applicable.
  Accepted publishing/API success does not prove notification delivery.
- **Secrets Manager:** migrate retrieval to `GetSecretValueCommand`; preserve
  config defaults, parsing, failure propagation and environment-mode behaviour.
- **Streams:** use v3 `marshall`/`unmarshall` with genuine DynamoDB attribute maps
  rather than JSON strings masquerading as stream images.

Migrate independent integration database adapters to v3 without importing
production services or validators into black-box contracts. Preserve local URL
validation, collision checks, conditional writes, snapshots, restoration and
unrelated records.

## 5. Remove obsolete startup workarounds and prove profile-based startup

If a launcher existed solely for SDK v2 credential export, remove it once v3
profile resolution and the new startup path are verified. Do not recreate the
same workaround under another filename.

- Preserve ignored `.env` loading, with exported shell values taking precedence.
  Documents runs Offline through `node --env-file=.env`; `npm start` copies local
  files, compiles, then runs the watcher and Offline. Its old
  `scripts/start-local.cjs` is deleted, and `start:local` is a compatibility alias.
- Remove obsolete Node 20 framework module-loading flags when no longer needed.
  Keep a narrowly justified test-runner flag if Node's automatic ESM detection
  otherwise bypasses the Babel hook; do not remove flags indiscriminately.
- Resolve AWS profiles through SDK v3. Do not print credentials, export real
  access/session keys, save credential snapshots or disclose `.env` contents.
- Verify startup without inherited access/session credentials masking profile
  resolution. Make an authorised real AWS read through the newly started API;
  a successful credential-chain lookup alone is insufficient.
- Keep Java 21 as an explicit DynamoDB Local prerequisite after deleting a
  launcher that selected Java automatically. Document setting `JAVA_HOME` and
  placing its `bin` directory on `PATH`; verify `java -version`.
- When authentication fails, report the actual blocker and safe login action
  appropriate to the profile, for example `aws sso login --profile rsp-dev` for
  an SSO profile. Never count credential failures as passing dependency checks.

Before starting services, inspect ports and process ownership. Documents normally
uses HTTP 3000, local Lambda 3002 and DynamoDB 8000. Stale or user-owned services
can block startup or make readiness checks accidentally hit the old code.

Do not kill another user's processes or an existing service without permission.
Start task services attached, verify their PID/listener and response body, and
stop only task-owned processes. A log message alone is not readiness proof.

If normal ports are occupied, use supported safe isolation rather than silently
reusing the old API. Documents verified this reference arrangement:

```sh
# Reference only: select an installed Java 21 JDK first; adapt for the OS.
LOCAL_API_HOST=127.0.0.1 LOCAL_STAGE=upgrade npm start
```

This works only when IPv4 loopback API/Lambda ports are free and the existing
listeners use IPv6. The non-`dev` stage skips DynamoDB lifecycle hooks and uses
the already-running local database; verify it does not migrate, seed, stop or
otherwise manage that database. The suite's owned fixture writes still require
the normal authorization and snapshot/restore safeguards.

Document which settings were actually tested. An isolated startup does not
prove default `dev` startup with a freshly launched database works.

## 6. Keep unit tests isolated and coverage meaningful

Install synthetic credentials and request interception before application imports
create module-scoped clients. Replace v2 `AWS.Service.makeRequest` interception
with v3 client `send` interception. Stub every relevant service, including the
document client; unexpected calls must fail.

Block HTTP/HTTPS as a backstop. Unit tests must not require AWS authentication,
publish real SNS messages or contact even a local database.

Migrate mocks to realistic v3 responses: byte Lambda payloads, consumable S3
streams, v3 exceptions, real stream attribute maps and promise rejection timing.
Retain assertions for exact requests, outputs, side effects and failure paths.
Do not merely make mocks resolve so old assertions appear to pass.

Add focused tests for new adapters and startup wiring; restore mocks, environment
changes and timers. Keep integration tests outside unit discovery and coverage.

Run the full unit suite and the per-file coverage command. Documents enforces
95.01% minimum statements, branches, functions and lines per production file.
Do not lower thresholds, exclude new production adapters, add coverage ignores
or remove assertions. Export-only modules can have zero executable counters;
explain that instead of hiding them.

Use compatible Node type declarations and TypeScript. Fix precise migration
diagnostics with proper imports/types rather than blanket suppression or
`skipLibCheck` added merely to obtain a pass. Distinguish unresolved baseline
diagnostics from newly introduced failures.

## 7. Build self-contained deployment artifacts

The old SAM webpack plugin can reject Node 24. Follow the proven direct-entry
approach rather than patching its runtime allowlist:

1. Derive webpack entries from the actual Lambda inventory, such as
   `lambdas.json`, with explicit filename aliases where necessary.
2. Emit `.webpack/<lambda>/app.js` with the required CommonJS `handler` export.
   Documents maps `streamDocuments` to `src/functions/stream.js`.
3. Keep SDK v3 dynamic imports inside each independently deployed Lambda.
   Documents uses `output.asyncChunks: false`; do not leave shared numbered
   chunk files outside per-function archives.
4. Update ZIP input paths, SAM `CodeUri`/handler mappings and downstream scripts
   consistently. Ignore generated bundles, ZIPs and build outputs.
5. Await all archive operations through asynchronous webpack hooks. Verify
   archives are complete/closed rather than treating webpack compilation alone
   as proof of successful ZIP production.
6. Build the actual production artifacts. Inspect every archive and require/load
   each bundle in a safe environment without invoking cloud handlers. Confirm
   correct exports, expected runtime/mappings and no unresolved shared chunks.

Documents has 19 Lambda bundles/archives. Verify against the selected service's
inventory rather than assuming 19 elsewhere.

## 8. Rerun unchanged black-box integrations

Use the established suite and independently approved data, not production imports
or new expectations inferred from upgraded output. Documents' reference suite
has 53 scenarios covering 19 handlers, including three Lambda-only interfaces.

- Preserve the committed approved 111-site dataset
  (`integration-baselines/sites.json`). Never overwrite or self-approve a new
  baseline to pass the upgrade.
- Keep private non-production token fixtures ignored and permission-restricted.
  Expected token fields must be independently known. Never print tokens,
  credentials, private identities or raw sensitive responses in logs/reports.
- Verify local-only API/database/Lambda targets and reject CI/remote mutation.
  Preserve locks, reserved IDs, collision detection, snapshots, conditional
  ownership checks and `finally` restoration.
- Obtain explicit consent for notification-producing scenarios or shared writes.
  Existing approval is environment-specific; never enable consent flags on
  behalf of another repository/environment. Do not claim device delivery from
  SNS acceptance or fire-and-forget API responses.
- Use real authorised downstream reads where the baseline requires them; do not
  substitute mocks, bypass dependency checks or convert errors to empty success.
- Run every scenario against the newly verified process. Report exact passed,
  failed, skipped and unavailable counts. Missing private tokens/authentication
  are incomplete coverage, not successful checks.
- Investigate differences as potential regressions. Documents initially exposed
  invalid-offset `ValidationException` and conditional-write `error.code`
  differences; fix the adapter with unit regression tests, not the contracts.
- Verify cleanup and preserve HTML/JSON evidence even on failure. Stop task
  services before handoff; do not stop services owned by the user.

Reference invocation for the isolated startup above; adapt to the target:

```sh
INTEGRATION_BASE_URL=http://127.0.0.1:3000/upgrade \
INTEGRATION_LAMBDA_URL=http://127.0.0.1:3002 \
INTEGRATION_FUNCTION_PREFIX=RSP-BackendApi-upgrade npm run test:integration:local
```

## 9. Validate security and document the handoff

Reference Documents validation commands; inspect actual scripts before running:

```sh
npm test
npm run test:coverage
npm run lint
npm run lint:integration
npm run check-js-types
npm run test:integration:tooling
npm run package
npm run build-openapi
npm run test:integration:local
```

Run security scanning against the updated lockfile, explicitly distinguishing
production and development scope. Where Snyk is configured, unignored scans
such as `snyk test --ignore-policy` and `snyk test --dev --ignore-policy`
make remaining stage-1 deferrals visible. Authentication/transport failure is
not a completed scan.

Stage 2 must remediate compatible dependency issues; do not copy stage 1's
permission to defer vulnerabilities. Prefer compatible updates and narrowly
reviewed overrides, verify the resolved tree and rerun affected tests.
Do not add blanket ignores, silently renew exceptions, force incompatible
transitive majors or claim a clean full-tree scan based on production-only
results. Report remaining advisories and required follow-up honestly.

Update README/runtime/start/build instructions, Java/profile prerequisites,
integration commands and known limitations. Preserve deployment safeguards:
feature branches may upload artifacts and default-branch workflows may update
Lambdas even if no deployment command is run locally. A runtime declaration
does not itself upgrade live infrastructure.

Finish with:

- Branch, changed surfaces and deliberate compatibility fixes.
- Actual runtime/tool versions and commands run.
- Full unit count, per-file gate result and all four coverage metrics.
- Integration totals, report path, real downstream scope and notification limits.
- Startup mode verified, services stopped/preserved and fixture cleanup outcome.
- Artifact/OpenAPI/type/lint results, security scan scopes and unresolved findings.
- Any authentication, tool or environment blockers and exact remaining work.

Do not say the migration is complete when required checks are skipped or blocked.
Do not deploy, commit or push as an implicit final step.
