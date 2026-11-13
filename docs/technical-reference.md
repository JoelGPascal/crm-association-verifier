# Technical reference

Full technical detail for the [CRM Association Verifier](../README.md): request format, failure handling, safety controls, configuration and how to run it.

## What it verifies

For a request containing:

- `propertyIdentityKey`
- `expectedContactId`
- `expectedOpportunityId`

the service:

1. reads the Contact's CRM associations
2. reads the Opportunity's CRM associations
3. identifies Property records related to each
4. requires the Contact and Opportunity to resolve to the same Property
5. fetches the candidate Property record
6. compares the stored identity key exactly with the expected identity key
7. returns `VERIFIED` only when all required evidence is present and consistent

## Fail-closed behaviour

| Condition | Result |
| --- | --- |
| Exact associations + exact identity | `VERIFIED` |
| Contact relation missing | `FAILED` |
| Opportunity relation missing | `FAILED` |
| Contact and Opportunity resolve to different Properties | `FAILED` |
| Property identity mismatch | `FAILED` |
| API error or timeout | `FAILED` |
| Malformed / incomplete response | `FAILED` |
| Pagination cannot be proven complete | `FAILED` |
| Ambiguous multiple matches | `FAILED` |

An upstream error is never treated as a successful verification.

## Safety controls

The implementation includes:

- read-only upstream requests
- fixed upstream API origin
- redirects rejected
- bounded request and total verification time
- response-size limits
- bounded pagination
- duplicate/repeated-relation detection
- required total-count consistency checks
- exact object-orientation checks
- exact identity comparison
- authentication on the verifier endpoint
- credential- and identifier-free decision logging
- failure isolation so logging cannot change the verification outcome

## Endpoint

```text
POST /verify-property-associations
```

Example request:

```bash
curl -X POST "https://YOUR_WORKER_URL/verify-property-associations" \
  -H "Authorization: Bearer YOUR_VERIFIER_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "propertyIdentityKey": "EXAMPLE-PROPERTY-KEY",
    "expectedContactId": "EXAMPLE-CONTACT-ID",
    "expectedOpportunityId": "EXAMPLE-OPPORTUNITY-ID"
  }'
```

Successful verification:

```json
{
  "verifierResult": "VERIFIED",
  "verifiedPropertyId": "example-property-id",
  "reason": "EXACT_ASSOCIATIONS_CONFIRMED"
}
```

A failed verification returns `FAILED` with a reason code and no verified Property ID.

## Configuration

Runtime values are injected through environment bindings. No production values belong in source control.

Required values:

| Binding | Purpose |
| --- | --- |
| `GHL_READ_ONLY_TOKEN` | Read-only CRM API token |
| `VERIFIER_SHARED_SECRET` | Authenticates requests to the verifier |
| `GHL_LOCATION_ID` | CRM location/account identifier |

For local development, copy the example file:

```bash
cp .dev.vars.example .dev.vars
```

Then replace the placeholders locally. `.dev.vars` is git-ignored.

## Run locally

Requirements:

- Node.js 22+
- Wrangler

Install and test:

```bash
npm install
npm test
npm run check:deploy
```

Start a local Worker:

```bash
npm run dev
```

## Test evidence

The sanitized portfolio copy passes the full suite:

```text
41/41 tests independently reproduced offline on 2026-10-29
Independent Node --test run on 2026-10-29: 41 passed, 0 failed; 23 top-level test declarations
0 failed
```

Coverage includes successful verification, wrong Contact/Opportunity relationships, different Properties, identity mismatch, malformed JSON, malformed upstream responses, reversed relation orientation, upstream 401/403/500 responses, timeouts, network errors, authentication failure, multi-page association scans, pagination safety limits, repeated pages, inconsistent totals, multiple candidate Properties, credential-safe logging, and failures after an earlier partial match.

## Repository structure

```text
.
├── src/
│   └── worker.js
├── test/
│   └── worker.test.js
├── .dev.vars.example
├── .gitignore
├── package.json
├── wrangler.toml
└── README.md
```

## Validation status

The core matching and failure-handling logic was tested offline; the dated result is above. Production integration of this sanitized copy remains unverified.
