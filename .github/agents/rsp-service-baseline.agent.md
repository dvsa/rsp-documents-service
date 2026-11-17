---
name: RSP service baseline builder
description: Establish local RSP service execution, isolated unit tests and enforced coverage before runtime upgrades and Serverless Starter rewrites.
---

# RSP service modernisation baseline

Use this guide to establish a repeatable, tested baseline for an existing RSP
service before upgrading or rewriting it. It is intended to be copied into other
service repositories. Inspect each repository first: package versions, commands,
routes and AWS services below are reference patterns, not universal requirements.

## Keep the three stages separate

1. **Local baseline:** run the existing service on its current runtime, support
   Bruno collection development, and establish meaningful automated regression
   tests.
2. **Supported runtime:** upgrade to Node.js 24, the open-source Serverless
   replacement used by the DVSA Starter, and AWS SDK for JavaScript v3. Preserve
   the API contracts and business behaviour established in stage 1.
3. **Starter rewrite:** rebuild using the DVSA Serverless Starter, carrying forward
   the same behavioural tests and Bruno requests.

The cross-service milestone is stage 2 before July 2027. Node.js 20 is an interim
compatibility baseline, not the supported-runtime destination. Completing stage 1
does not authorise starting stage 2 or deploying the service.

## Working safely

- Confirm the repository, current branch, runtime and working-tree status before
  editing. Read existing instructions, scripts, workflows and configuration.
- Work on the user's selected branch. Do not modify `main`, create/switch branches,
  discard changes, commit or push without the user's authorisation.
- Preserve existing local configuration and unrelated changes. Do not commit
  `.env`, credentials, generated builds, coverage reports or downloaded databases.
- Keep changes surgical. Do not bundle runtime upgrades, architectural rewrites
  or dependency remediation into baseline work without approval.
- Report behaviour defects discovered by tests. Fix tightly related defects only
  with regression tests and make those production changes explicit.

## Establish local execution

1. Inventory handlers, routes, validation, configuration sources and downstream
   dependencies. Separate local infrastructure from real AWS calls.
2. Check the actual Node version and align `.nvmrc`, package engines, local
   emulator runtime and CI with the baseline runtime.
3. Select compatible local tooling. Do not install licensed Serverless Framework
   v4 accidentally. For the later Node 24 stage, inspect the current DVSA Starter
   and an already-upgraded service rather than guessing package versions.
4. Make the documented `npm start` command sufficient after prerequisites and
   normal AWS authentication. Do not rely on an agent's private shell setup.
5. Document Java/database requirements, profile selection, ports, seeded data,
   startup, shutdown and credential expiry.
6. Verify readiness with an actual endpoint and inspect its response body, not
   just its HTTP status. Check a database-only endpoint and an authorised
   read-only AWS endpoint where applicable.

### Documents Service reference

- The Node 20 baseline uses Serverless 3, Offline 13 and `serverless-dynamodb`.
- Current DynamoDB Local requires Java 21. Use the official HTTPS distribution.
- The Node 20 baseline used `scripts/start-local.cjs` to export credentials and
  select Java 21. The Node 24/SDK v3 upgrade removes that workaround.
  `npm start` compiles and runs Offline, which loads `.env` with Node's
  `--env-file`; SDK v3 resolves the selected profile directly. Java 21 must be
  selected on `PATH` as a prerequisite. `npm run start:local` aliases `npm start`.
- SDK v2 could not resolve the development profile directly. SDK v3 direct
  profile resolution is verified in Documents, but do not assume that alone
  proves startup/authentication works in other repositories.
- DynamoDB is local on port 8000; the API listens on port 3000. Use the routes
  printed at startup: API stage prefixes depend on the event type.
- Sites reads real S3. Other operations can invoke real Payments/Token Lambdas or
  publish SNS notifications even while the API and database run locally.

Do not silently change `http`/`httpApi`, authorisation, CORS or route prefixes.
Compare local events against Terraform and existing clients first. The current
Documents branch deliberately aligns its local HTTP events with Terraform.
Local authorisation bypasses must remain local.

## Establish behavioural tests before migrating

Run the existing suite first and record its results. Measure all production
source, including files never imported by tests; report the measurement tool and
scope. A passing suite or a high percentage alone does not establish correctness.

Cover each applicable area:

- Handler input parsing, validation, parameter forwarding and response contracts.
- Create/read/update/delete and batch workflows, pagination, missing records,
  invalid inputs and downstream failures.
- Payment status, authoritative payment merges, hash/conditional-write rules,
  origin handling, groups and vehicle-registration search.
- Configuration from environment and Secrets Manager, defaults and failures.
- DynamoDB request shapes and conditions; Lambda payload/response contracts;
  S3 content handling; SNS message contents and failure behaviour.
- Response helpers, hashing, dates, filtering and other shared utilities.

Use representative fixtures and real validation where practical. Assert the
returned data and meaningful side effects, not only status codes or that a
function exists. Handler-export tests are useful wiring checks, not endpoint
behaviour tests. Do not stub the implementation under test just to raise coverage.
Every `expect(...)` needs an assertion matcher.

### Isolate unit tests

- No AWS login, credentials, running database or external service should be needed.
- Install synthetic credentials and request interception before importing modules
  that instantiate AWS clients.
- Make unexpected database/AWS requests fail. Mock expected requests explicitly
  and assert their inputs/results, including notification callbacks/promises.
- Block HTTP/HTTPS as a backstop. Never let a unit test publish a real notification
  or write to a shared AWS resource.
- Restore test-specific stubs, timers and environment changes. Keep integration
  tests separate from the isolated unit suite.
- Use realistic DynamoDB stream attribute maps, not JSON strings masquerading as
  stream images. Assert actual notification payloads and ordering semantics.
- Document existing defects and limitations; do not weaken validation or silently
  redefine intended behaviour to make tests pass.

## Make coverage reproducible and enforceable

The Documents baseline uses NYC and Babel's Istanbul plugin:

- `npm test` runs isolated tests.
- `npm run test:coverage` runs the same suite and checks **95.01% minimum per
  production file** for statements, branches, functions and lines.
- Include all production JavaScript. Exclude only identified tests, test helpers,
  fixtures and generated files; do not exclude hard-to-test production code.
- Instrument original source before Babel transforms it. Avoid counting Babel
  interop/regenerator helpers as application behaviour or instrumenting twice.
- Restrict instrumentation to the coverage environment so builds are unchanged.
- Keep HTML/JSON reports in ignored `coverage/` and raw data in ignored
  `.nyc_output/`; exclude these generated directories from type checking.
- Export-only modules can have zero executable counters. Explain this rather
  than inventing executable coverage or hiding the module.
- Do not add coverage-ignore directives, lower thresholds or remove assertions
  merely to pass the gate.

Choose tooling appropriate to the repository; the invariant is meaningful,
source-level, per-file coverage above 95% in all four metrics. Explain any
measurement-method change before comparing percentages.

Run lint, the coverage suite and the existing type check. Distinguish newly
introduced errors from verified baseline errors; do not suppress existing
diagnostics to claim a clean result. Record unresolved defects and diagnostics
in the service documentation.

## Bruno and integration confidence

Unit coverage complements rather than replaces endpoint checks. Build Bruno
requests with valid synthetic data and documented expected responses. Record:

- Local versus non-production environment, authentication and route prefixes.
- Required body/query fields, validation errors and state prerequisites.
- Which requests access real AWS resources, mutate data or send notifications.
- Seed/reset behaviour, pagination and time-dependent fixture limitations.

Use only authorised resources. Do not perform destructive or notification-producing
integration checks without approval. Carry the collection forward unchanged where
contracts remain unchanged, and explicitly review intentional contract changes.

## Security checks and CI

- Run Snyk before every authorised commit/push. A transport/authentication failure
  is not a successful scan; report it and retry or obtain direction.
- Record scan scope. A production-only scan does not cover development dependencies.
- During stage 1 (the initial local baseline), do not attempt to resolve Snyk
  findings by upgrading dependencies or changing application code. Preserve the
  existing baseline and defer vulnerability remediation to stage 2.
- For this local-only stage, add findings from a fresh scan to `.snyk` as explicit
  advisory-specific exceptions, not blanket ignores. This workflow authorises
  deferral for the initial baseline only. Include each advisory ID, a reason
  stating that remediation is deferred to stage 2, and an expiry no later than
  the agreed stage-2 remediation deadline. If no deadline has been agreed, ask
  for one before adding exceptions. Rerun Snyk with the policy applied and report
  the deferred findings separately; exceptions do not fix vulnerabilities.
- Do not deploy the baseline with deferred findings. Outside stage 1, prefer
  compatible remediation within the agreed scope and obtain explicit approval
  for any further exceptions.
- In this Documents baseline, eight explicitly approved findings are ignored
  until 1 July 2027 because the baseline is for local testing and must not be
  deployed before remediation during stage 2. Do not copy these exceptions into
  another repository without a fresh scan and approval.
- Read failed CI logs before changing code. Distinguish installation/setup errors
  from failed tests, lint or builds.
- Check reusable workflow inputs before replacing shared workflows. The Documents
  CI passes `node-version: 20.x` and `npm-version: '10'` to the shared lint, test
  and build workflows because their default latest npm no longer supports Node 20.
- Keep repository-specific fixes in the calling workflow; do not change shared
  DVSA workflows or other repositories without authorisation.
- Preserve deployment guards. Before merging, inspect workflows triggered by
  `main`: this service can upload artifacts and update non-production Lambdas.
  Calling a branch a local baseline does not itself disable deployment on merge.

## Stage completion and handoff

Stage 1 should leave a documented, repeatable local startup; isolated behavioural
tests; enforced coverage thresholds; passing relevant CI; and a clear inventory
of remaining Bruno/integration work and known defects.

When moving to stage 2, use `rsp-gov-notify`'s Node 24 upgrade and the current DVSA
Starter as references, not blind replacements. Documents additionally needs SDK
v3 DynamoDB, Lambda, S3 and SNS migration. Preserve undefined-value marshalling,
decode Lambda byte responses, consume S3 streams, and keep each Lambda package
self-contained despite SDK dynamic imports. Verify profile resolution and plain
`npm start` before removing the temporary Node 20 launcher.

Repository runtime settings do not necessarily change live infrastructure:
verify Terraform's runtime and deployment configuration separately. Stage 3
should retain the externally observable behaviours and regression suite while
changing the service structure.

Commit/push only when requested. Summarise results, deliberate behaviour changes,
unresolved risks and deployment implications accurately. Never claim a migration,
scan, integration check or deployment succeeded based solely on a proxy check.
