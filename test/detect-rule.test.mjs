import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detect, readDetectionEvents } from '../src/detect.mjs';
import { checkDetection } from '../scripts/detect-test.mjs';

function reads(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    at: new Date(Date.UTC(2026, 9, 1) + i * 2000).toISOString(), method: 'GET',
    identity: { sub: 'learner_fixture' },
    deviceId: 'a'.repeat(16), deviceRegistered: true,
    signals: { source: 'judge_fixture', network: 'unusual' }, ...overrides,
  }));
}

test('only the composite local fixture proposes revocation; all practice cases match', async () => {
  const results = await checkDetection(detect);
  assert.equal(results.length, 19);
  assert.ok(results.every(result => result.passed));
  assert.deepEqual(detect(reads(121)), { action: 'propose_revocation',
    reasonCode: 'burst_read', subject: 'learner_fixture', deviceId: 'a'.repeat(16) });
  assert.deepEqual(detect(reads(121).reverse()), detect(reads(121)));
});

test('read burst and unfamiliar network must coincide for the same subject', () => {
  for (const events of [reads(120), reads(200, { method: 'PUT' }),
    reads(200, { signals: undefined }),
    reads(200, { signals: { source: 'client', network: 'unusual' } }),
    reads(200, { signals: { source: 'judge_fixture', network: 'usual', region: 'foreign' } }),
    [...reads(100), ...reads(100, { identity: { sub: 'other_fixture' } })],
    [...reads(120), ...reads(200, { signals: { source: 'judge_fixture', network: 'usual' } })],
    reads(121).map((event, i) => ({ ...event,
      at: new Date(Date.UTC(2026, 9, 1) + i * 600000).toISOString() }))]) {
    assert.deepEqual(detect(events), { action: 'observe' });
  }
});

test('ten-minute window includes its boundary but not a millisecond beyond it', () => {
  const events = reads(121).map(event => ({ ...event, at: '2026-10-01T00:00:00.000Z' }));
  events[120].at = '2026-10-01T00:10:00.000Z';
  assert.equal(detect(events).action, 'propose_revocation');
  events[120].at = '2026-10-01T00:10:00.001Z';
  assert.deepEqual(detect(events), { action: 'observe' });
});

test('original starter proposals use its exact result shape, without guessed device or network', () => {
  const original = reads(121).map(({ at, method, identity }) => ({ at, method, identity }));
  const before = structuredClone(original);
  assert.deepEqual(detect(original), { action: 'propose_revocation',
    reasonCode: 'burst_read', subject: 'learner_fixture' });
  assert.deepEqual(original, before);
  assert.deepEqual(detect(original.slice(0, 120)), { action: 'observe' });
  for (const extra of [{ signals: undefined }, { deviceId: undefined },
    { deviceRegistered: false }, { role: 'instructor' }]) {
    assert.deepEqual(detect(original.map(event => ({ ...event, ...extra }))), { action: 'observe' });
  }
  assert.deepEqual(detect(original.map(event => ({ ...event,
    identity: { sub: event.identity.sub, deviceId: 'a'.repeat(16) } }))), { action: 'observe' });
});

test('a proposal targets one registered device without aggregating or changing other devices', () => {
  for (const changes of [{ deviceId: undefined }, { deviceId: 'invalid' },
    { deviceRegistered: false }, { deviceRegistered: undefined }, { deviceRegistered: 'true' }]) {
    assert.deepEqual(detect(reads(200, changes)), { action: 'observe' });
  }
  assert.deepEqual(detect([...reads(100), ...reads(100, { deviceId: 'b'.repeat(16) })]),
    { action: 'observe' });
  const input = [...reads(30, { deviceId: 'b'.repeat(16) }), ...reads(121)];
  const before = structuredClone(input);
  assert.deepEqual(detect(input), { action: 'propose_revocation', reasonCode: 'burst_read',
    subject: 'learner_fixture', deviceId: 'a'.repeat(16) });
  assert.deepEqual(input, before);
  // Even two suspicious devices produce one proposal, never a user-wide list.
  const result = detect([...reads(121), ...reads(121, { deviceId: 'b'.repeat(16) })]);
  assert.equal(result.deviceId, 'a'.repeat(16));
  assert.deepEqual(Object.keys(result).sort(), ['action', 'deviceId', 'reasonCode', 'subject']);
});

test('network projection never reads region or secret fields and logs nothing', () => {
  const events = reads(121);
  const unexpected = () => { throw new Error('unexpected_field_read'); };
  for (const event of events) {
    for (const key of ['region', 'token', 'name']) {
      Object.defineProperty(event.signals, key, { enumerable: true, get: unexpected });
    }
    Object.defineProperty(event, 'body', { enumerable: true, get: unexpected });
  }
  const saved = [console.log, console.warn, console.error];
  let outputs = 0;
  try {
    console.log = console.warn = console.error = () => { outputs++; };
    assert.deepEqual(readDetectionEvents(events)[0].signals,
      { source: 'judge_fixture', network: 'unusual' });
    assert.equal(detect(events).action, 'propose_revocation');
    assert.equal(outputs, 0);
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
});
