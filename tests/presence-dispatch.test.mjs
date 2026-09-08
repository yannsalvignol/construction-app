import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceHandler } from '../supabase/functions/presence-dispatch/handler.ts';

const now = Date.parse('2026-09-07T10:00:00Z');
const job = { request_id: 'request-a', token: 'ExpoPushToken[test]', locale: 'fr', expires_at: new Date(now + 300_000).toISOString() };
function fixture({ jobs = [], receipts = [], expired = [], storageError = null, fetchImpl } = {}) {
  const calls = [];
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      const data = { claim_presence_notifications: jobs, claim_presence_receipts: receipts, expired_presence_photos: expired, redact_expired_presence_evidence: 1 }[name] ?? null;
      return { data, error: null };
    },
    storage: { from: bucket => ({ remove: async paths => { calls.push({ name: 'remove', bucket, paths }); return { data: null, error: storageError }; } }) },
  };
  return { calls, handler: createPresenceHandler({ secret: 'test-only-secret', now: () => now, createDatabase: () => db, fetchImpl }) };
}
function request(token = 'test-only-secret', method = 'POST') {
  return new Request('https://example.test/presence-dispatch', { method, headers: { Authorization: 'Bearer ' + token } });
}

test('dispatcher rejects unauthorized and non-POST calls before accessing data', async () => {
  const { calls, handler } = fixture();
  assert.equal((await handler(request('wrong'))).status, 401);
  assert.equal((await handler(request('test-only-secret', 'GET'))).status, 405);
  assert.equal(calls.length, 0);
  const unconfigured = createPresenceHandler({ secret: undefined, createDatabase: () => { throw new Error('must not run'); } });
  assert.equal((await unconfigured(request())).status, 401);
});

test('notification TTL ends with the request, contains no future schedule, and saves the Expo ticket', async () => {
  let payload;
  const { handler, calls } = fixture({ jobs: [job], fetchImpl: async (_url, options) => {
    payload = JSON.parse(options.body);
    return Response.json({ data: [{ status: 'ok', id: 'expo-ticket' }] });
  } });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(payload[0].ttl, 300);
  assert.deepEqual(payload[0].data, { requestId: job.request_id });
  assert.ok(calls.some(c => c.name === 'finish_presence_notification' && c.args.ticket === 'expo-ticket'));
});

test('cleanup still runs during a push service outage', async () => {
  const { handler, calls } = fixture({ jobs: [job], expired: [{ path: 'old-proof' }], fetchImpl: async () => new Response('Unavailable', { status: 503 }) });
  const response = await handler(request());
  assert.equal(response.status, 503);
  const report = await response.json();
  assert.equal(report.cleanup.removed, 1);
  assert.ok(calls.find(c => c.name === 'redact_expired_presence_evidence'));
  assert.ok(!calls.find(c => c.name === 'finish_presence_notification'));
});

test('failed Storage deletion keeps the evidence path for a later retry', async () => {
  const { handler, calls } = fixture({ expired: [{ path: 'old-proof' }], storageError: { message: 'temporary failure' } });
  assert.equal((await handler(request())).status, 503);
  assert.ok(!calls.find(c => c.name === 'redact_expired_presence_evidence'));
});

test('invalid devices are removed, receipts are checked and missing receipts are retried later', async () => {
  const { handler, calls } = fixture({ jobs: [job], receipts: [{ ticket_id: 'receipt-a' }, { ticket_id: 'not-ready' }], fetchImpl: async (url) =>
    url.endsWith('getReceipts') ? Response.json({ data: { 'receipt-a': { status: 'error', details: { error: 'DeviceNotRegistered' } } } }) :
      Response.json({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) });
  assert.equal((await handler(request())).status, 200);
  assert.ok(calls.find(c => c.name === 'finish_presence_notification' && c.args.dead_token));
  assert.deepEqual(calls.filter(c => c.name === 'resolve_presence_receipt').map(c => c.args), [{ ticket: 'receipt-a', result: 'DeviceNotRegistered' }]);
});

test('expired jobs are skipped and batches never exceed 100 notifications', async () => {
  const sizes = [];
  const jobs = Array.from({ length: 201 }, (_, i) => ({ ...job, request_id: String(i) }));
  jobs.push({ ...job, expires_at: new Date(now - 1).toISOString() });
  const { handler } = fixture({ jobs, fetchImpl: async (_url, options) => {
    const payload = JSON.parse(options.body); sizes.push(payload.length);
    return Response.json({ data: payload.map((_, i) => ({ status: 'ok', id: 'ticket-' + sizes.length + '-' + i })) });
  } });
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(sizes, [100, 100, 1]);
});
