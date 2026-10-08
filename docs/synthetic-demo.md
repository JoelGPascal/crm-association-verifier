# Synthetic verification demonstration

All values below are **illustrative** and do not identify customers, live CRM records, or credentials. This walkthrough describes expected verifier behavior; it is **not** a captured live execution.

## Case A — consistent identity (expected VERIFIED)
Input:
```json
{"propertyIdentityKey":"DEMO-PROP-001","expectedContactId":"demo-contact-01","expectedOpportunityId":"demo-opportunity-01"}
```
Mock read-only CRM fixture: contact and opportunity both associate to `demo-property-01`; the Property identity key equals `DEMO-PROP-001`.

Expected:
```json
{"verifierResult":"VERIFIED","verifiedPropertyId":"demo-property-01","reason":"EXACT_ASSOCIATIONS_CONFIRMED"}
```

## Case B — mismatched association (expected FAILED)
Same input, but the opportunity associates to `demo-property-02`.

Expected: `verifierResult=FAILED`, `verifiedPropertyId=null`. No downstream trust or CRM write should occur.

## Case C — incomplete API evidence (expected FAILED)
If one association page is missing, or the upstream API errors/timeouts, the verifier must return `FAILED` rather than infer a match.

## Reproduce with repository tests
```bash
npm install
npm test
npm run check:deploy
```
These commands require Node.js 22+ and Wrangler. The repository README records a prior result of 41 tests passing; this documentation change does not itself rerun tests.
