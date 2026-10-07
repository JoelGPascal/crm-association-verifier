const BASE = 'https://services.leadconnectorhq.com';
const PROPERTY = 'custom_objects.property';
export const LIMITS = Object.freeze({ pageSize: 100, maxPages: 10, maxProperties: 20, requestMs: 5000, totalMs: 25000, bodyBytes: 4096, responseBytes: 1048576 });
class Failure extends Error {
  constructor(reason, status) { super(reason); this.reason = reason; this.status = status; }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim().length > 0;
const failed = reason => ({ verifierResult: 'FAILED', verifiedPropertyId: null, reason });

async function readJson(response, maxBytes) {
  if (!response.body) throw new Failure('MALFORMED_GHL_RESPONSE');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Failure('MALFORMED_GHL_RESPONSE');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof Failure) throw error;
    throw new Failure('MALFORMED_GHL_RESPONSE');
  } finally { reader.releaseLock(); }
}

// Hash both values so comparison always examines the same number of bytes.
async function authorized(header, secret) {
  if (!identifier(secret) || typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 4096) return false;
  const digest = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(header.slice(7)), digest(secret)]);
  const x = new Uint8Array(a), y = new Uint8Array(b); let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}

export function createWorker({ fetcher = (...args) => fetch(...args), log = event => console.log(JSON.stringify(event)), limits = LIMITS } = {}) {
  return {
    async fetch(request, env) {
      const started = Date.now(); let httpStatus = 200; let upstreamStatus;
      const finish = result => {
        try { log({ event: 'association_verification', outcome: result.verifierResult, reason: result.reason, httpStatus, ...(upstreamStatus === undefined ? {} : { ghlHttpStatus: upstreamStatus }), elapsedMs: Date.now() - started }); } catch { /* Logging cannot change the decision. */ }
        return Response.json(result, { status: httpStatus, headers: { 'Cache-Control': 'no-store' } });
      };
      try {
        if (!await authorized(request.headers.get('Authorization'), env.VERIFIER_SHARED_SECRET)) { httpStatus = 401; return finish(failed('INVALID_INPUT')); }
        if (new URL(request.url).pathname !== '/verify-property-associations') { httpStatus = 404; return finish(failed('INVALID_INPUT')); }
        if (request.method !== 'POST') { httpStatus = 405; return finish(failed('INVALID_INPUT')); }
        let input; let inputTimer;
        try { input = await Promise.race([readJson(request, limits.bodyBytes), new Promise((_, reject) => { inputTimer = setTimeout(() => reject(new Failure('INVALID_INPUT')), limits.requestMs); })]); } catch { httpStatus = 400; return finish(failed('INVALID_INPUT')); } finally { clearTimeout(inputTimer); }
        if (!object(input) || !['propertyIdentityKey', 'expectedContactId', 'expectedOpportunityId'].every(key => identifier(input[key]))) { httpStatus = 400; return finish(failed('INVALID_INPUT')); }
        if (!identifier(env.GHL_READ_ONLY_TOKEN) || !identifier(env.GHL_LOCATION_ID)) throw new Failure('INTERNAL_ERROR');
        const location = env.GHL_LOCATION_ID;
        const get = async path => {
          const remaining = limits.totalMs - (Date.now() - started);
          if (remaining <= 0) throw new Failure('GHL_API_ERROR');
          const controller = new AbortController(); let timer;
          try {
            return await Promise.race([
              (async () => {
                const response = await fetcher(BASE + path, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { Authorization: `Bearer ${env.GHL_READ_ONLY_TOKEN}`, Version: 'v3', Accept: 'application/json' } });
                upstreamStatus = response.status;
                if (!response.ok) { await response.body?.cancel(); throw new Failure('GHL_API_ERROR', response.status); }
                return await readJson(response, limits.responseBytes);
              })(),
              new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Failure('GHL_API_ERROR')); }, Math.min(limits.requestMs, remaining)); })
            ]);
          } catch (error) { if (error instanceof Failure) throw error; throw new Failure('GHL_API_ERROR'); }
          finally { clearTimeout(timer); }
        };
        const scan = async (recordId, kind) => {
          const found = new Set(), seen = new Set(); let expectedTotal; let skip = 0;
          for (let page = 0; page < limits.maxPages; page++) {
            const data = await get(`/associations/relations/${encodeURIComponent(recordId)}?locationId=${encodeURIComponent(location)}&skip=${skip}&limit=${limits.pageSize}`);
            if (!object(data) || !Array.isArray(data.relations) || data.relations.length > limits.pageSize) throw new Failure('MALFORMED_GHL_RESPONSE');
            const total = data.total;
            if (!Number.isSafeInteger(total) || total < 0) throw new Failure('MALFORMED_GHL_RESPONSE');
            if (page === 0) expectedTotal = total;
            if (total !== expectedTotal || skip + data.relations.length > total || (data.relations.length === 0 && skip < total)) throw new Failure('MALFORMED_GHL_RESPONSE');
            for (const relation of data.relations) {
              if (!object(relation) || !['associationKey', 'firstObjectKey', 'secondObjectKey', 'firstRecordId', 'secondRecordId'].every(key => identifier(relation[key]))) throw new Failure('MALFORMED_GHL_RESPONSE');
              if (relation.locationId !== undefined && relation.locationId !== location) throw new Failure('MALFORMED_GHL_RESPONSE');
              const signature = JSON.stringify([relation.associationKey, relation.firstObjectKey, relation.firstRecordId, relation.secondObjectKey, relation.secondRecordId]);
              if (seen.has(signature)) throw new Failure('MALFORMED_GHL_RESPONSE');
              seen.add(signature);
              if (relation.associationKey !== `${kind}_property`) continue;
              if (relation.firstObjectKey === kind && relation.firstRecordId === recordId && relation.secondObjectKey === PROPERTY) found.add(relation.secondRecordId);
              else if (relation.secondObjectKey === kind && relation.secondRecordId === recordId && relation.firstObjectKey === PROPERTY) found.add(relation.firstRecordId);
            }
            skip += data.relations.length;
            if (skip === total) return found;
          }
          throw new Failure('MALFORMED_GHL_RESPONSE');
        };
        const contacts = await scan(input.expectedContactId, 'contact');
        const opportunities = await scan(input.expectedOpportunityId, 'opportunity');
        if (!contacts.size) return finish(failed('CONTACT_RELATION_MISSING'));
        if (!opportunities.size) return finish(failed('OPPORTUNITY_RELATION_MISSING'));
        const common = [...contacts].filter(id => opportunities.has(id));
        if (!common.length) return finish(failed('NO_COMMON_PROPERTY'));
        if (common.length > limits.maxProperties) return finish(failed('MULTIPLE_COMMON_PROPERTIES'));
        const matches = [];
        for (const id of common) {
          const data = await get(`/objects/${PROPERTY}/records/${encodeURIComponent(id)}`);
          if (!object(data) || !object(data.record) || !object(data.record.properties)) throw new Failure('MALFORMED_GHL_RESPONSE');
          if (data.record.id !== undefined && data.record.id !== id || data.record.locationId !== undefined && data.record.locationId !== location) throw new Failure('MALFORMED_GHL_RESPONSE');
          if (typeof data.record.properties.property_identity_key !== 'string') throw new Failure('MALFORMED_GHL_RESPONSE');
          if (data.record.properties.property_identity_key === input.propertyIdentityKey) matches.push(id);
        }
        if (matches.length > 1) return finish(failed('MULTIPLE_COMMON_PROPERTIES'));
        if (!matches.length) return finish(failed('PROPERTY_IDENTITY_MISMATCH'));
        return finish({ verifierResult: 'VERIFIED', verifiedPropertyId: matches[0], reason: 'EXACT_ASSOCIATIONS_CONFIRMED' });
      } catch (error) { return finish(failed(error instanceof Failure ? error.reason : 'INTERNAL_ERROR')); }
    }
  };
}
export default createWorker();
