# Local black-box integration baseline

These are **manual local checks, not pipeline tests**. The contract suite uses
HTTP and the local Lambda invocation interface, not production imports, Babel,
unit-test setup, in-process stubs or mock AWS responses. Carry `integration/`
forward to Node 24 and the Starter rewrite; adjust local transport configuration
and the separate seed adapter when necessary. No new dependencies are required.

## What runs, and what is covered?

There are **19 exported handlers, not 20 HTTP endpoints**: **16 HTTP routes and
3 Lambda-only handlers**. `delete` is the route/function name for the exported
`remove` handler. Its local YAML previously referenced nonexistent `handler.delete`;
this change corrects that wiring to `handler.remove` without changing the route.
The offline tooling self-test checks the inventory against all exports and
local HTTP events; no Terraform source is stored in this repository.

| Handler | Interface | Scenarios / important assertions |
| --- | --- | --- |
| list | GET /documents | >75 recent APP documents, cursor forwarding/types, no duplicates, full fixture values, PORTAL/old exclusion, empty result, default retention |
| get | GET /documents/{id} | FPN/IM/CDN full persisted values, authoritative payment overlay, missing/disabled records |
| getDocumentByToken | GET /documents/tokens/{token} | Invalid token rejection; configured real valid encrypted token and expected document identity |
| create | POST /documents | Actual validation error, no invalid persistence, create → independent GET of full domain values/hash/offset, duplicate rejection |
| updateMulti | PUT /documents | Successful update → GET, stale hash → unchanged GET, mixed valid/invalid batch order and per-item `status`/`item`/`error`; gated notification-capable origin transition |
| remove / delete | DELETE /documents/{id} | Stale hash rejection, unpaid soft-delete → GET with full unchanged values/new hash/disabled state, repeated-delete rejection |
| listGroups | GET /penaltyGroup | Offset validation, exact synthetic membership, Count/Items structure, empty result |
| getPenaltyGroup | GET /penaltyGroup/{id} | Full group properties and exact members, FPN/IM/CDN category totals, paid/unpaid/disabled groups, missing record |
| createPenaltyGroup | POST /penaltyGroup | Real validation error, duplicate references, create → independent GET of group values and every member |
| deleteGroup | DELETE /penaltyGroup/{id} | Unpaid group/member disable read-back, missing group, mixed-paid cancellation preserves paid members and removes unpaid members with exact resulting totals |
| updateWithPaymentStartTime | PUT /documents/updateWithPaymentStartTime | Timestamp persisted in correct field, all other domain data unchanged, missing record not upserted |
| updatePenaltyGroupWithPaymentStartTime | PUT /penaltyGroup/updateWithPaymentStartTime | FPN/IM/CDN field mapping and persisted timestamps, missing group not upserted |
| updateUponPaymentDelete | PUT /documents/updateUponPaymentDelete | Stored UNPAID/full value/hash/offset read back via registration search (GET overlays live Payments) |
| updateMultipleUponPaymentDelete | PUT /documents/updateMultipleUponPaymentDelete | Paid group and members become unpaid; persisted hashes/offsets; empty list no-op |
| searchByVehicleRegistration | GET /vehicle-reg/{vehicleReg} | Full fixture domain values, standalone/group partition, deduplicated exact group IDs, stored status, missing registration |
| sites | GET /sites | Verified actual `{ Items: [...] }` response; exact item field/type contract; unique codes and entire explicitly approved static dataset comparison |
| updateWithPayment | Local Lambda invoke only | PORTAL payment → stored read-back, missing-document placeholder persistence, invalid placeholder regression; APP payment/SNS gated |
| updatePenaltyGroupWithPayment | Local Lambda invoke only | Missing group, unknown category, string/object bodies; partial/full payment and reversal aggregation/read-back, SNS-capable success gated |
| streamDocuments | Local Lambda invoke only | Malformed event rejection before publishing; realistic unordered DynamoDB attribute maps and empty batch acknowledgements, both publish paths gated |

This is a detailed baseline, not proof of every possible input combination.
Reports explicitly show unexecuted scenarios and remaining limitations:
controlled downstream/SNS failures and actual notification contents/delivery need
separate authorised fixtures/observation. Stream acknowledgements prove the SNS
promise resolved, **not device delivery or message contents**. APP payment
notifications are fire-and-forget; a returned 200 does not prove SNS success.

## Before the first real run

1. Use Node 20 and existing installed dependencies (later rerun unchanged on Node
   24 and the rewrite). Authenticate your normal development AWS profile.
2. Verify `.env` uses `penaltyDocuments` / `penaltyGroups`, the local database on
   port 8000, the intended non-production Payments/Token/S3 resources, and normal
   retention/batch settings (`DAYS_TO_HOLD=3`, batch size at most 75).
3. Start the existing service with `npm start` in another terminal. Its existing
   launcher resolves credentials in memory. Restart it after credentials expire.
   This task **does not start the service or authenticate on your behalf**.
4. Confirm the printed URLs: HTTP normally has `/dev`; Lambda invokes listen on
   port 3002. The local YAML has no stream subscription; do not wire seed-table
   streams to real notification handlers while testing.
5. Only after verifying those local-only writes, run:

   ```sh
   INTEGRATION_CONFIRM_LOCAL=yes INTEGRATION_ALLOW_LAMBDA=yes npm run test:integration:local
   npm run test:integration:report:open
   ```

The npm test/seed/reset commands load `.env` using Node's `--env-file` option.
Exported shell values take precedence. To run the full suite with just
`npm run test:integration:local`, set these in your ignored local `.env`:

```dotenv
INTEGRATION_CONFIRM_LOCAL=yes
INTEGRATION_ALLOW_LAMBDA=yes
INTEGRATION_ALLOW_NOTIFICATIONS=yes
```

The notification setting explicitly permits SNS publishing on every run; enable
it only for an authorised non-production topic. These flags do not authenticate
AWS. The runner does not resolve a profile, invoke AWS directly, or export
credentials. The **running service** may read Secrets
Manager, invoke real Payments and Token Lambdas, read Sites from real S3, or
publish SNS on explicitly enabled paths. AWS authentication must be valid in
that service process.

Synthetic references are not guaranteed to have real Payments records. An empty
authoritative Payments array is valid; GET/list/update/create treat those
documents as unpaid. No fake paid records or success-shaped fallback responses
are invented. Stable domain fields are compared deeply; payment status/details
overlaid by live Payments are explicitly excluded from synthetic value equality
and checked separately for their contract. Search and group reads expose local
stored statuses, so payment-write workflows use them for independent read-back.

If Payments unexpectedly marks an unpaid-delete fixture paid, those scenarios
are skipped with an explicit reason, never reported as covered. AWS
authentication/resource errors are `dependency-unavailable` and fail the run;
ordinary contract mismatches remain failures, not dependency excuses.

### Optional paths and safety gates

- Valid-token success needs `INTEGRATION_TOKEN`,
  `INTEGRATION_TOKEN_DOCUMENT_ID`, `INTEGRATION_TOKEN_REFERENCE` and
  `INTEGRATION_TOKEN_AMOUNT` supplied privately in your shell, so actual decoded
  identity/reference/amount can be asserted exactly. Do not put
  a real token in source, command history or reports. It must be an actual
  encrypted token, not a synthetic seed paymentToken. Without it this scenario
  is explicitly skipped. The service's own existing logs can contain tokens:
  use authorised non-production tokens and do not share raw service logs.
  Alternatively store only those four string fields in the ignored local
  `integration/private-token.json`. The runner loads it without printing it;
  explicit environment values take precedence. Never commit or share this file.
  Expected values must come independently from the approved test fixture, not
  from the response being tested.
- `INTEGRATION_ALLOW_LAMBDA=yes` permits **local HTTP Lambda invocations only**.
  Lambda-only success cases which might publish remain gated separately.
- `INTEGRATION_ALLOW_NOTIFICATIONS=yes` explicitly permits real SNS publishing
  by the gated scenarios. Do not enable it unless authorised for the configured
  SNS topic/devices. Never include it in routine runs or CI.
- The invalid-dummy-amount scenario is explicitly a **known defect /
  current-behaviour baseline**, following the user's baseline decision. It
  requires exact application status 200, complete returned dummy data (including
  invalid amount 1), and independent GET 404 with `ITEM NOT FOUND`. A pass means
  this exact existing behaviour was reproduced, **not successful creation**.
  A deliberate future production fix must explicitly update this baseline.
  No production behaviour is changed.
- Group-payment reversal currently retains the top-level PAID state while another
  category remains paid; it changes to UNPAID only when all categories reverse.
  The detailed category/read-back checks preserve this existing behaviour rather
  than silently defining a different aggregation rule during a runtime migration.

### Static Sites baseline: capture is not approval

The approved complete Sites dataset is committed in
`integration-baselines/sites.json`. Fresh checkouts use this shared baseline
automatically; no initial capture or approval is required.

Only when deliberately updating the expected Sites data, run:

```sh
INTEGRATION_CONFIRM_LOCAL=yes INTEGRATION_ALLOW_LAMBDA=yes \
  INTEGRATION_CAPTURE_SITES_BASELINE=yes npm run test:integration:local
```

Schema checks run normally. Static-data comparison is marked **skipped** while
the candidate is written to ignored `integration-baselines/sites.candidate.json`.
Inspect the entire candidate locally against the intended Sites resource. Then:

```sh
INTEGRATION_APPROVE_SITES=yes npm run test:integration:approve-sites
# Rerun without CAPTURE to verify against that explicitly approved baseline:
INTEGRATION_CONFIRM_LOCAL=yes INTEGRATION_ALLOW_LAMBDA=yes npm run test:integration:local
```

Approval performs no network calls and is not itself a passed integration check.
Every site name, region and integer siteCode is compared, sorted by unique
siteCode; extra response metadata is not made part of the documented Sites
domain. A later change fails verification. Only explicitly repeating review and
approval replaces the baseline; test execution never silently refreshes it.
Keep the approved baseline unchanged when comparing Node 20/24/Starter. Commit
any intentionally approved update to `integration-baselines/sites.json` so all
developers use the same expected dataset; candidate files remain ignored.

The first authorised run on 4 November 2026 verified the real response has an
`Items` envelope containing 111 sites. The existing JSON model's top-level array
declaration disagrees with that actual S3-backed response (its example already
shows `Items`). These external tests preserve the verified response rather than
changing the service or inventing a bare-array contract.

## Seed safety and repeatability

`npm start` now adds **88 synthetic documents and four groups** to the existing
Bruno seed records. Existing JSON fixtures are unchanged. Generated JSON goes
only in ignored `build/mock-data`, with fresh offsets and deterministic reserved
IDs. Fixtures include three penalty types, APP/PORTAL origins, paid/unpaid/mixed
groups, disabled records, an old record, and enough recent APP records for
multiple pages. These are synthetic data, not real encrypted tokens or proof of
authoritative Payments records.

Each suite run separately snapshots its owned fixture IDs, refuses any collision
with foreign data, conditionally reseeds, and restores originals in `finally`.
Newly created reserved documents/groups are removed with ownership checks.
It never scans, drops, truncates or resets entire tables, and never alters
unrelated records. A local lock prevents simultaneous suite/seed/reset commands.
Do not edit the reserved `990099...` / `rspintegrationgroup...` fixture namespace
with Bruno while a suite runs. Hard process termination cannot guarantee cleanup;
inspect the local lock and records, or restart the in-memory local service.

Manual fixture operations (not normally needed; neither provides HTTP coverage):

```sh
npm run seed:integration:generate  # Generate build/mock-data only; no database/network
INTEGRATION_CONFIRM_LOCAL=yes npm run test:integration:seed
INTEGRATION_CONFIRM_LOCAL=yes npm run test:integration:reset
```

`seed` is idempotent for marked fixtures. `reset` removes **only the owned
synthetic seed records**, not the existing Bruno seed data. Tests automatically
seed even after a reset. Mutation tools require the confirmation flag and reject
CI, non-loopback hosts, HTTPS, URL credentials, and alternate ports. DynamoDB
always uses explicit fake local credentials; the runner never reads AWS secrets.
The user confirmation is necessary because a localhost API alone cannot prove
the service's internal database configuration.

Configuration (do not put credentials here):

| Variable | Default |
| --- | --- |
| INTEGRATION_BASE_URL | http://localhost:3000/dev |
| INTEGRATION_DYNAMODB_URL | http://localhost:8000 |
| INTEGRATION_LAMBDA_URL | http://localhost:3002 |
| INTEGRATION_FUNCTION_PREFIX | RSP-BackendApi-dev |

For a Starter rewrite, keep all action/data assertions and change only local
transport URLs/function prefix and the SDK-specific seed adapter if required.
`contracts.cjs` imports only fixtures/assertions, never handler/source modules.

## Reports and offline verification

Every suite/seed/reset attempt writes timestamped **self-contained HTML** and
JSON plus `integration-reports/latest.html` / `latest.json`, including setup
failures before networking. Reports include:

- all 19 handlers and their actual HTTP/Lambda interface;
- scenario inventory, pass/fail/skipped/not-run/dependency-unavailable totals;
- each scenario's validations, request/read-back sequence, assertion count;
- safe expected/actual differences, skip reasons, setup/cleanup outcome;
- timestamp, Node runtime and explicit remaining gaps/dependency caveats.

No tokens, credentials, raw bodies, payment identifiers, hashes or personal data
are put in reports. String differences are intentionally redacted; numeric,
boolean and structural differences remain visible. Inspect sensitive actual
data locally if a redacted mismatch needs investigation.

**This is endpoint/scenario coverage, not Istanbul source-code coverage.**
Skipped scenarios/handlers remain incomplete. Setup/assertion/dependency/cleanup
failures exit nonzero; passing checks with skips exit zero with an explicit
`passed-with-skips (incomplete)` outcome. A report-only re-render is:

```sh
npm run test:integration:report
npm run test:integration:report:open
```

Offline tooling validation (no AWS, running API or database):

```sh
npm run test:integration:tooling
npm run lint:integration
```

Those self-tests use an in-memory seed adapter and a tiny private loopback HTTP
server for **tooling only**, never substitutes for the real service integration
suite. `npm test` / `test:coverage` still select only `src/**/*.unit.js`.
Integration files/reports are outside production source coverage and type-check
scope. No CI workflows invoke these new commands. Legacy `test-i` remains
available but is not this maintained, report-producing contract suite.

## First authorised Node 20 run — 4 November 2026

The completed run at **10:47:00–10:47:15 UTC** used the authenticated `rsp-dev`
profile, local API/DynamoDB, real downstream reads, safe local Lambda invocation
and Sites candidate capture. **53 scenarios: 45 passed, one failed, seven skipped.**
All 19 handlers were exercised by at least one scenario; this does not mean all
their scenarios passed or that the skipped notification paths were covered.

- The genuine failure is `lambda-dummy-invalid-amount`: an invalid amount is not
  persisted (verified by independent GET), but `updateWithPayment` still returns
  application status 200. This is the existing dummy-create defect described
  above. That historical run used an error-status expectation. The user later
  explicitly chose to characterize the exact current 200 response plus 404
  read-back instead; old reports retain their original failed result.
  No production service logic was changed.
- Seven skips: five explicitly SNS-gated scenarios, one valid-token scenario
  without the private token/expected values, and the static Sites comparison
  pending human approval of the captured 111-item candidate.
- Sites schema/complete item-field checks passed against the actual `Items`
  envelope. The first attempt's bare-array expectation was corrected to the
  verified response; no exact Sites values were invented or self-approved.
- The seed adapter needed an alphanumeric fake access key because current
  DynamoDB Local rejects hyphens. No real credentials are used by that adapter.
- Owned fixture records were restored and suite-created records removed.
  Task-started API, offline Lambda and database processes were then stopped;
  ports 3000/3002/8000 no longer responded. No SNS opt-in or shared AWS writes
  were performed.

The actual persistent result is `integration-reports/latest.html` / `latest.json`.
Tooling self-tests separately write `tooling-preview.html` and do not overwrite
the latest real result. Offline verification: **14 tooling tests and 211 existing
unit tests passed**, both linters passed, source-coverage gate remained passing
(99.87% statements/lines, 98.64% branches, 100% functions). The existing nine
type-check diagnostics remain unchanged.
