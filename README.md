# CRM Association Verifier

A small, read-only Cloudflare Worker that verifies CRM record relationships before downstream automation is trusted.

This repository is a **sanitized portfolio version of a real operating control**. It demonstrates the design and tested logic without publishing production credentials, live account identifiers, customer data, or internal business configuration.

## Why this exists

Automation can execute exactly as designed and still make the wrong decision when the underlying data is incomplete or incorrectly associated.

This verifier adds an independent control step before a workflow treats a Property ↔ Contact ↔ Opportunity relationship as trustworthy.

**Design principle: automate the predictable path, fail closed on uncertainty, and send ambiguous cases to human review.**

## Architecture

```mermaid
flowchart LR
    A[Workflow / Caller] --> B[Read-only Verifier]
    B --> C[Read Contact Associations]
    B --> D[Read Opportunity Associations]
    C --> E[Find Related Property IDs]
    D --> E
    E --> F[Find Common Property]
    F --> G[Fetch Property Record]
    G --> H{Identity + associations match?}
    H -->|Yes| I[VERIFIED]
    H -->|No / incomplete / error| J[FAILED]
    J --> K[Human Review]
```

The verifier makes **GET requests only** to the CRM API. It does not create, edit, delete, or re-associate CRM records.

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
41 tests
41 passed
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

**Built and tested**

- core verification logic
- read-only architecture
- fail-closed behaviour
- 41-test unit suite

**Not claimed**

- full live end-to-end production certification of this sanitized portfolio copy

The original operating project was intentionally documented with the same distinction: tested logic is not presented as production-certified until the complete live path is validated.

## What this project demonstrates

This is less about writing a large amount of code and more about designing a reliable control around a commercial workflow:

- API integration
- structured-data validation
- CRM relationship modelling
- exception handling
- verification boundaries
- human-in-the-loop design
- test discipline
- security-minded failure behaviour
- translating an operating problem into an auditable technical control

## Author

**Joel Gabriel Pascal**  
Enterprise GTM & Strategic Sales | AI | SaaS | APIs | Data | Revenue Systems

My broader work focuses on the commercial-technical layer between enterprise GTM, CRM/revenue systems, automation, APIs, verification controls, and practical AI-enabled workflows.
