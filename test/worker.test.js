import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, LIMITS } from '../src/worker.js';

const env = { VERIFIER_SHARED_SECRET: 'test-shared-secret', GHL_READ_ONLY_TOKEN: 'test-read-token', GHL_LOCATION_ID: 'test-location' };
const input = { propertyIdentityKey: 'identity', expectedContactId: 'c', expectedOpportunityId: 'o' };
const envelope = relations => ({ relations, total: relations.length, traceId: 'test-trace' });
const relation = (kind, property = 'p', id = kind === 'contact' ? 'c' : 'o', reverse = false) => ({ associationKey: `${kind}_property`, firstObjectKey: reverse ? 'custom_objects.property' : kind, secondObjectKey: reverse ? kind : 'custom_objects.property', firstRecordId: reverse ? property : id, secondRecordId: reverse ? id : property });
async function run(options = {}) {
  const calls = [], logs = [];
  const worker = createWorker({ log: event => logs.push(event), limits: { ...LIMITS, ...options.limits }, fetcher: async (url, init) => {
    calls.push(url);
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Version, 'v3');
    if (options.fetcher) return options.fetcher(url, init);
    if (url.includes('/relations/c?')) return Response.json(envelope(options.contacts ?? [relation('contact')]));
    if (url.includes('/relations/o?')) return Response.json(envelope(options.opportunities ?? [relation('opportunity')]));
    return Response.json(options.record ?? { record: { properties: { property_identity_key: 'identity' } } });
  } });
  const response = await worker.fetch(new Request('https://example.test/verify-property-associations', { method: 'POST', headers: { Authorization: options.auth ?? `Bearer ${env.VERIFIER_SHARED_SECRET}` }, body: options.body ?? JSON.stringify(input) }), env);
  return { response, body: await response.json(), calls, logs };
}
test('exact associations and identity verify; all upstream calls are GET', async () => { const result = await run(); assert.deepEqual(result.body, { verifierResult: 'VERIFIED', verifiedPropertyId: 'p', reason: 'EXACT_ASSOCIATIONS_CONFIRMED' }); assert.equal(result.calls.length, 3); });
for (const [name, options, reason] of [
  ['wrong Contact', { contacts: [relation('contact', 'p', 'wrong')] }, 'CONTACT_RELATION_MISSING'],
  ['wrong Opportunity', { opportunities: [relation('opportunity', 'p', 'wrong')] }, 'OPPORTUNITY_RELATION_MISSING'],
  ['different Properties', { opportunities: [relation('opportunity', 'other')] }, 'NO_COMMON_PROPERTY'],
  ['wrong identity', { record: { record: { properties: { property_identity_key: 'Identity' } } } }, 'PROPERTY_IDENTITY_MISMATCH'],
  ['missing fields', { body: '{}' }, 'INVALID_INPUT'],
  ['invalid request JSON', { body: '{' }, 'INVALID_INPUT'],
  ['invalid upstream JSON', { fetcher: () => new Response('{') }, 'MALFORMED_GHL_RESPONSE'],
  ['invalid properties', { record: { record: { properties: [] } } }, 'MALFORMED_GHL_RESPONSE'],
  ['wrong object orientation', { contacts: [{ ...relation('contact'), firstObjectKey: 'opportunity' }] }, 'CONTACT_RELATION_MISSING'],
  ['wrong association key', { contacts: [{ ...relation('contact'), associationKey: 'other' }] }, 'CONTACT_RELATION_MISSING'],
  ['missing identity', { record: { record: { properties: {} } } }, 'MALFORMED_GHL_RESPONSE'],
  ['wrong returned record ID', { record: { record: { id: 'other', properties: { property_identity_key: 'identity' } } } }, 'MALFORMED_GHL_RESPONSE'],
]) test(name, async () => { const result = await run(options); assert.equal(result.body.reason, reason); assert.equal(result.body.verifierResult, 'FAILED'); assert.equal(result.body.verifiedPropertyId, null); });
test('reversed directions verify', async () => { assert.equal((await run({ contacts: [relation('contact', 'p', 'c', true)], opportunities: [relation('opportunity', 'p', 'o', true)] })).body.verifierResult, 'VERIFIED'); });
for (const status of [401, 403, 500]) test(`HighLevel ${status} fails`, async () => { const result = await run({ fetcher: () => new Response('secret upstream body', { status }) }); assert.equal(result.body.reason, 'GHL_API_ERROR'); assert.equal(result.logs[0].ghlHttpStatus, status); assert.ok(!JSON.stringify(result).includes('secret upstream body')); });
test('timeout fails even when fetch ignores abort', async () => { assert.equal((await run({ limits: { requestMs: 10 }, fetcher: () => new Promise(() => {}) })).body.reason, 'GHL_API_ERROR'); });
test('network exception fails', async () => { assert.equal((await run({ fetcher: () => { throw Error('sensitive'); } })).body.reason, 'GHL_API_ERROR'); });
test('unauthorized is 401 with no upstream call', async () => { const result = await run({ auth: 'Bearer wrong' }); assert.equal(result.response.status, 401); assert.equal(result.calls.length, 0); });
test('multi-page scans discover late relations', async () => {
  const result = await run({ limits: { pageSize: 1 }, fetcher: url => {
    if (url.includes('/records/')) return Response.json({ record: { properties: { property_identity_key: 'identity' } } });
    const kind = url.includes('/relations/c?') ? 'contact' : 'opportunity';
    const skip = Number(new URL(url).searchParams.get('skip'));
    return Response.json({ total: 2, relations: skip === 0 ? [{ ...relation(kind, 'unrelated'), associationKey: 'other' }] : [relation(kind)] });
  } });
  assert.equal(result.body.verifierResult, 'VERIFIED'); assert.equal(result.calls.length, 5);
});
test('page safety limit prevents partial verification', async () => { const result = await run({ limits: { pageSize: 1, maxPages: 1 }, fetcher: () => Response.json({ total: 2, relations: [relation('contact')] }) }); assert.equal(result.body.reason, 'MALFORMED_GHL_RESPONSE'); });
test('repeated pages fail', async () => { const result = await run({ limits: { pageSize: 1 }, fetcher: () => Response.json({ total: 2, relations: [relation('contact')] }) }); assert.equal(result.body.reason, 'MALFORMED_GHL_RESPONSE'); });
test('inconsistent total fails', async () => { let n = 0; const result = await run({ limits: { pageSize: 1 }, fetcher: () => Response.json({ relations: [relation('contact', `p${n++}`)], total: n === 1 ? 2 : 3 }) }); assert.equal(result.body.reason, 'MALFORMED_GHL_RESPONSE'); });
test('two matching Properties fail', async () => { assert.equal((await run({ contacts: [relation('contact'), relation('contact', 'q')], opportunities: [relation('opportunity'), relation('opportunity', 'q')] })).body.reason, 'MULTIPLE_COMMON_PROPERTIES'); });
test('one identity match among common Properties verifies', async () => { const result = await run({ contacts: [relation('contact'), relation('contact', 'q')], opportunities: [relation('opportunity'), relation('opportunity', 'q')], fetcher: url => url.includes('/relations/') ? Response.json(envelope(url.includes('/relations/c?') ? [relation('contact'), relation('contact', 'q')] : [relation('opportunity'), relation('opportunity', 'q')])) : Response.json({ record: { properties: { property_identity_key: url.endsWith('/p') ? 'identity' : 'other' } } }) }); assert.equal(result.body.verifierResult, 'VERIFIED'); });
test('logs contain no credentials or identifiers', async () => { const result = await run(); const log = JSON.stringify(result.logs); for (const value of Object.values(env)) assert.ok(!log.includes(value)); assert.ok(!log.includes('identity')); });
test('error on later Property cannot verify an earlier match', async () => {
  const result = await run({ fetcher: url => {
    if (url.includes('/relations/')) { const kind = url.includes('/relations/c?') ? 'contact' : 'opportunity'; return Response.json(envelope([relation(kind), relation(kind, 'q')])); }
    if (url.endsWith('/p')) return Response.json({ record: { properties: { property_identity_key: 'identity' } } });
    return new Response('', { status: 500 });
  } });
  assert.equal(result.body.reason, 'GHL_API_ERROR'); assert.equal(result.body.verifierResult, 'FAILED');
});
test('consistent total proves completion on full page', async () => {
  const result = await run({ limits: { pageSize: 1, maxPages: 1 }, fetcher: url => {
    if (url.includes('/relations/')) return Response.json({ total: 1, relations: [relation(url.includes('/relations/c?') ? 'contact' : 'opportunity')] });
    return Response.json({ record: { properties: { property_identity_key: 'identity' } } });
  } });
  assert.equal(result.body.verifierResult, 'VERIFIED');
});
test('unknown envelope fails closed', async () => { assert.equal((await run({ fetcher: () => Response.json({ data: [] }) })).body.reason, 'MALFORMED_GHL_RESPONSE'); });
for (const total of [undefined, null, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid required total: ${String(total)}`, async () => {
    const result = await run({ fetcher: () => Response.json({ relations: [relation('contact')], total }) });
    assert.equal(result.body.reason, 'MALFORMED_GHL_RESPONSE');
  });
}
test('non-array relations fails', async () => { assert.equal((await run({ fetcher: () => Response.json({ relations: {}, total: 0 }) })).body.reason, 'MALFORMED_GHL_RESPONSE'); });
test('empty completed scans return missing relation', async () => { assert.equal((await run({ contacts: [], opportunities: [] })).body.reason, 'CONTACT_RELATION_MISSING'); });
test('empty page before total is reached fails closed', async () => {
  const result = await run({ fetcher: url => Response.json({ total: 2, relations: new URL(url).searchParams.get('skip') === '0' ? [relation('contact')] : [] }) });
  assert.equal(result.body.reason, 'MALFORMED_GHL_RESPONSE'); assert.equal(result.calls.length, 2);
});
test('accumulated count cannot exceed total', async () => {
  const result = await run({ fetcher: url => Response.json({ total: 2, relations: new URL(url).searchParams.get('skip') === '0' ? [relation('contact')] : [relation('contact', 'q'), relation('contact', 'r')] }) });
  assert.equal(result.body.reason, 'MALFORMED_GHL_RESPONSE');
});
test('short pages advance skip by actual returned count until required total', async () => {
  const result = await run({ fetcher: url => {
    if (url.includes('/records/')) return Response.json({ record: { id: 'p', properties: { property_identity_key: 'identity' } } });
    const query = new URL(url).searchParams;
    assert.equal(query.get('limit'), '100');
    const kind = url.includes('/relations/c?') ? 'contact' : 'opportunity';
    const skip = Number(query.get('skip'));
    assert.ok([0, 2, 3].includes(skip));
    const relations = skip === 0 ? [relation(kind, 'unrelated-1'), relation(kind, 'unrelated-2')].map(row => ({ ...row, associationKey: 'other' })) : skip === 2 ? [{ ...relation(kind, 'unrelated-3'), associationKey: 'other' }] : [relation(kind, 'p', kind === 'contact' ? 'c' : 'o', kind === 'opportunity')];
    return Response.json({ relations: relations.map((row, index) => ({ ...row, id: `relation-${skip}-${index}`, associationId: 'association-uuid', primary: false, locationId: 'test-location' })), total: 4, traceId: 'test-trace' });
  } });
  assert.equal(result.body.verifierResult, 'VERIFIED');
  assert.deepEqual(result.calls.filter(url => url.includes('/relations/')).map(url => Number(new URL(url).searchParams.get('skip'))), [0, 2, 3, 0, 2, 3]);
});
