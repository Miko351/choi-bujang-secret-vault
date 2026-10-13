import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

test('registered device can read the notes service using the unchanged response contract', async () => {
  const { normal } = fixtureRequests();
  const result = await decide(normal);
  assert.equal(result.decision, 'allow');
  assert.equal(result.reasonCode, 'approved');
  assert.deepEqual(result.ruleIds, ['device_registered']);
  assert.equal(result.requestId, normal.requestId);
  assert.equal(result.schema, 'aleph.decision.v1');
  assert.deepEqual(Object.keys(result).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.deepEqual(RULE_IDS, ['starter.deny', 'device_registered']);
});

test('unregistered, missing and non-boolean device states cannot grant read access', async () => {
  const { normal } = fixtureRequests();
  const missing = { ...normal };
  delete missing.deviceRegistered;
  for (const request of [missing, ...[false, null, undefined, 'true', 'false', 1, {}, []]
    .map(deviceRegistered => ({ ...normal, deviceRegistered }))]) {
    const result = await decide(request);
    assert.equal(result.decision, 'deny');
    assert.equal(result.reasonCode, 'device_not_registered');
    assert.deepEqual(result.ruleIds, ['device_registered']);
    assert.equal(result.requestId, request.requestId);
  }
});

test('device registration does not expand access to writes or other services', async () => {
  const { normal } = fixtureRequests();
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const result = await decide({ ...normal, method, route: `${method} /notes/:id` });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reasonCode, 'starter_not_ready');
    assert.deepEqual(result.ruleIds, ['starter.deny']);
  }
  const other = await decide({ ...normal, service: 'other', path: '/other', route: 'GET /other' });
  assert.equal(other.decision, 'deny');
  assert.equal(other.reasonCode, 'starter_not_ready');
  assert.deepEqual(other.ruleIds, ['starter.deny']);
});
