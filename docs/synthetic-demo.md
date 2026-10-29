# Reproducible synthetic association walkthrough

All identifiers are fabricated. This is an **expected-behavior illustration**, not a captured live CRM run.

## Contract example

```http
POST /verify-property-associations HTTP/1.1
Authorization: Bearer <local-placeholder-secret>
Content-Type: application/json

{"propertyIdentityKey":"DEMO-PROP-001","expectedContactId":"demo-contact-01","expectedOpportunityId":"demo-opportunity-01"}
```

**Fixture A:** Contact and Opportunity each relate to `demo-property-01`; that Property has `property_identity_key = DEMO-PROP-001`.

Expected JSON:

```json
{"verifierResult":"VERIFIED","verifiedPropertyId":"demo-property-01","reason":"EXACT_ASSOCIATIONS_CONFIRMED"}
```

**Fixture B:** Opportunity relates to `demo-property-02` instead; there is no common Property.

```json
{"verifierResult":"FAILED","verifiedPropertyId":null,"reason":"NO_COMMON_PROPERTY"}
```

**Fixture C:** Contact and Opportunity agree on the Property, but the stored key differs.

```json
{"verifierResult":"FAILED","verifiedPropertyId":null,"reason":"PROPERTY_IDENTITY_MISMATCH"}
```

**Fixture D:** Missing page, inconsistent total, upstream error or timeout → `FAILED`, never inferred `VERIFIED`.

## Local verification commands

Requires Node.js >=22:

```bash
npm install
npm test
npm run check:deploy
```

The unit tests use mocked upstream responses. Do not paste real secrets or customer identifiers into a demo, and do not deploy to run these tests. The source currently defines **23 top-level test cases**; the historical claim of 41 passing tests remains pending source-to-run reconciliation. Commands above have **not** been executed during this documentation change.
