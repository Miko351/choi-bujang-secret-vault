import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { detect, readDetectionEvents } from '../src/detect.mjs';

const event = () => ({ at: '2026-10-01T00:00:00.000Z', method: 'GET',
  identity: { sub: 'learner_fixture' } });

test('original fixture sequences remain readable and follow the supplied burst contract', () => {
  for (const count of [30, 121, 200]) {
    const events = Array.from({ length: count }, (_, i) => ({ ...event(),
      at: new Date(Date.UTC(2026, 9, 1) + i * 2000).toISOString() }));
    const parsed = readDetectionEvents(events);
    assert.equal(parsed.length, count);
    assert.deepEqual(parsed, events);
    assert.deepEqual(detect(events), count > 120
      ? { action: 'propose_revocation', reasonCode: 'burst_read', subject: 'learner_fixture' }
      : { action: 'observe' });
    assert.notEqual(parsed[0], events[0]);
    assert.notEqual(parsed[0].identity, events[0].identity);
  }
  assert.deepEqual(readDetectionEvents([]), []);
});

test('uncontracted content and identity fields are never read, copied or logged', () => {
  const raw = event();
  const unexpected = () => { throw new Error('unexpected_field_read'); };
  for (const key of ['body', 'token', 'name', 'deviceId', 'decision']) {
    Object.defineProperty(raw, key, { enumerable: true, get: unexpected });
  }
  for (const key of ['name', 'token']) {
    Object.defineProperty(raw.identity, key, { enumerable: true, get: unexpected });
  }
  const saved = [console.log, console.warn, console.error];
  let outputCount = 0;
  try {
    console.log = console.warn = console.error = () => { outputCount++; };
    assert.deepEqual(readDetectionEvents([raw]), [event()]);
    assert.deepEqual(detect([raw]), { action: 'observe' });
    assert.equal(outputCount, 0);
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
});

test('invalid inputs fail with a fixed error and never receive invented identity or time', () => {
  for (const input of [null, {}, 'not_events']) {
    assert.throws(() => readDetectionEvents(input), { message: 'invalid_detection_events' });
  }
  for (const raw of [null, [], {}, { ...event(), at: '2026-02-30T00:00:00.000Z' },
    { ...event(), at: 'invalid_time' }, { ...event(), method: 'get' },
    { ...event(), method: undefined }, { ...event(), identity: null },
    { ...event(), identity: { sub: '' } }, { ...event(), identity: { sub: 1 } },
    { ...event(), identity: { sub: ' learner_fixture ' } }]) {
    assert.throws(() => detect([raw]), { message: 'invalid_detection_event' });
  }
  assert.throws(() => detect(Array(1)), { message: 'invalid_detection_event' });
});

test('contract JSON from another context and non-read methods retain their actual fields', () => {
  const crossContext = runInNewContext("[{at:'2026-10-01T00:00:00.000Z', method:'GET', identity:{sub:'learner_fixture'}}]");
  assert.deepEqual(readDetectionEvents(crossContext), [event()]);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    assert.equal(readDetectionEvents([{ ...event(), method }])[0].method, method);
  }
});
