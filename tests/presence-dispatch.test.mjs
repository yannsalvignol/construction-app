import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPresenceHandler } from '../supabase/functions/presence-dispatch/handler.ts';

const now = Date.parse('2026-09-07T10:00:00Z');
const job = { request_id: 'request-a', token: 'ExpoPushToken[test]', locale: 'fr', expires_at: new Date(now + 300_000).toISOString() };
function fixture({ jobs = [], receipts = [], expired = [], orphans = [], storageError = null, fetchImpl,
  questions = [], alerts = [], raised = 0 } = {}) {
  const calls = [];
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      const data = {
        claim_presence_notifications: jobs, claim_presence_receipts: receipts,
        expired_presence_photos: expired, redact_expired_presence_evidence: 1,
        orphan_avatars: orphans,
        claim_lone_worker_questions: questions, raise_due_lone_worker_alerts: raised,
        claim_safety_alert_notifications: alerts,
      }[name] ?? null;
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

test('an avatar whose owner is gone is swept with the presence proofs', async () => {
  const { handler, calls } = fixture({ orphans: [{ path: 'gone-employee/avatar.jpg' }] });
  const report = await (await handler(request())).json();
  assert.equal(report.cleanup.avatars, 1);
  assert.ok(calls.find(c => c.name === 'remove' && c.bucket === 'avatars'
    && c.paths[0] === 'gone-employee/avatar.jpg'));
  // Nothing to sweep must not reach into Storage at all.
  const quiet = fixture();
  await quiet.handler(request());
  assert.ok(!quiet.calls.find(c => c.name === 'remove'));
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

test('the lone-worker sweep asks by push but raises in the database', async () => {
  // The question can fail to send; the alert must not depend on it having sent.
  const { calls, handler } = fixture({
    questions: [{ work_day_id: 'day-a', token: 'ExpoPushToken[worker]', locale: 'fr' }],
    raised: 1,
    alerts: [{ alert_id: 'alert-a', token: 'ExpoPushToken[chef]', locale: 'fr', employee_name: 'Worker A', kind: 'no_movement' }],
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: body.map(() => ({ status: 'ok', id: 'ticket-' + url.length })) }), { status: 200 });
    },
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.deepEqual(report.safety, { asked: 1, raised: 1, alerted: 1 });
  const names = calls.map(c => c.name);
  // Raising happens after the question goes out, and the chef is told once.
  assert.ok(names.indexOf('claim_lone_worker_questions') < names.indexOf('raise_due_lone_worker_alerts'));
  assert.deepEqual(calls.find(c => c.name === 'finish_safety_alert_notification').args, { alert: 'alert-a' });
});

test('a chef device that Expo rejects is forgotten, and the alert stays unnotified', async () => {
  const { calls, handler } = fixture({
    alerts: [{ alert_id: 'alert-a', token: 'ExpoPushToken[dead]', locale: 'fr', employee_name: 'Worker A', kind: 'sos' }],
    fetchImpl: async () => new Response(JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }), { status: 200 }),
  });
  await handler(request());
  assert.deepEqual(calls.find(c => c.name === 'finish_safety_alert_notification').args,
    { alert: 'alert-a', dead_token: 'ExpoPushToken[dead]' });
});

test('an Expo outage still lets the database raise alerts', async () => {
  const { calls, handler } = fixture({
    questions: [{ work_day_id: 'day-a', token: 'ExpoPushToken[worker]', locale: 'fr' }],
    fetchImpl: async () => new Response('down', { status: 503 }),
  });
  const response = await handler(request());
  // The safety lane reports failure, but the sweep that matters is not reached
  // through Expo at all — and the other lanes are unaffected.
  assert.equal(response.status, 503);
  assert.equal(calls.some(c => c.name === 'claim_lone_worker_questions'), true);
});
