import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { decide, RULE_IDS, inspectConnectionInput } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { checkDecider } from '../scripts/decider-test.mjs';
import { RESOURCE_IDS, resourceIdForService, resourceIdForApiPath, resourceRouteForRequest } from '../src/decider.mjs';

test('engine collection paths cannot grant the entire notes zone to registered users', async () => {
  const saved = process.env.VAULT_ZONE_POLICY;
  const { normal } = fixtureRequests();
  const id = randomUUID();
  try {
    process.env.VAULT_ZONE_POLICY = JSON.stringify({ version: 1,
      noteOwners: [{ classId: normal.classId, projectId: normal.projectId, subjectId: normal.subjectId, id }],
      noticeEditors: [], apiNoticeEditors: [] });
    for (const base of ['/notes', '/api/notes']) {
      for (const subjectId of [normal.subjectId, 'other_fixture']) {
        for (const path of [base, `${base}/`, `${base}/all`, `${base}/export`]) {
          const request = { ...normal, subjectId, path, route: `GET ${base}` };
          assert.equal(resourceRouteForRequest(request), null);
          assert.equal((await decide(request)).decision, 'deny');
          assert.equal((await decide({ ...request, stepUp: { verified: true, authAgeSeconds: 0 } })).decision, 'deny');
        }
      }
      // Removing collection access must retain proven ownership of a single row.
      const own = { ...normal, path: `${base}/${id}`, route: `GET ${base}/:id` };
      assert.equal((await decide(own)).decision, 'allow');
      assert.equal((await decide({ ...own, subjectId: 'other_fixture' })).decision, 'deny');
    }
  } finally {
    if (saved === undefined) delete process.env.VAULT_ZONE_POLICY;
    else process.env.VAULT_ZONE_POLICY = saved;
  }
});

test('legacy demo ownership does not bypass subject, class or project zones', async () => {
  const { normal, suspicious } = fixtureRequests();
  assert.equal((await decide(normal)).decision, 'allow');
  assert.equal((await decide(suspicious)).decision, 'step_up');
  for (const base of ['/notes', '/api/notes']) {
    const own = { ...normal, path: `${base}/demo`, route: `GET ${base}/:id` };
    assert.equal((await decide(own)).decision, 'allow');
    for (const altered of [{ subjectId: 'other_fixture' }, { classId: 'other_class' },
      { projectId: 'other_project' }]) {
      for (const stepUp of [normal.stepUp, { verified: true, authAgeSeconds: 60 }]) {
        const denied = await decide({ ...own, ...altered, stepUp });
        assert.equal(denied.decision, 'deny');
        assert.ok(denied.ruleIds.includes('resource_zone'));
        assert.deepEqual(Object.keys(denied).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
      }
    }
    assert.equal((await decide({ ...own, deviceRegistered: false })).reasonCode, 'device_not_registered');
    assert.equal((await decide({ ...own, subjectId: 'other_fixture', role: 'instructor' })).decision, 'deny');
    assert.equal((await decide({ ...own, service: 'notices', method: 'PUT',
      path: '/notices/demo', route: 'PUT /notices/:id' })).decision, 'deny');
  }
});

test('server policy separates A/B ownership and notice editing without new request claims', async () => {
  const saved = process.env.VAULT_ZONE_POLICY;
  const { normal, suspicious } = fixtureRequests();
  const noteA = randomUUID(), noteB = randomUUID(), notice = randomUUID();
  const scope = { classId: normal.classId, projectId: normal.projectId };
  const policy = { version: 1,
    noteOwners: [{ ...scope, subjectId: normal.subjectId, id: noteA },
      { ...scope, subjectId: 'other_fixture', id: noteB }],
    noticeEditors: [{ ...scope, subjectId: 'editor_fixture', id: notice }], apiNoticeEditors: [] };
  const request = (subjectId, service, method, id) => ({ ...normal, subjectId, service,
    method, path: `/${service}/${id}`, route: `${method} /${service}/:id` });
  try {
    process.env.VAULT_ZONE_POLICY = JSON.stringify(policy);
    for (const [actor, own, other] of [[normal.subjectId, noteA, noteB], ['other_fixture', noteB, noteA]]) {
      for (const method of ['GET', 'PUT']) {
        assert.equal((await decide(request(actor, 'notes', method, own))).decision, 'allow');
        const denied = await decide(request(actor, 'notes', method, other));
        assert.equal(denied.decision, 'deny');
        assert.ok(denied.ruleIds.includes('resource_zone'));
      }
    }
    assert.equal((await decide(request(normal.subjectId, 'notices', 'PUT', notice))).decision, 'deny');
    const editor = request('editor_fixture', 'notices', 'PUT', notice);
    assert.equal((await decide(editor)).decision, 'allow');
    assert.equal((await decide({ ...editor, classId: 'other_class' })).decision, 'deny');
    assert.equal((await decide({ ...editor, projectId: 'other_project' })).decision, 'deny');
    assert.equal((await decide({ ...editor, deviceRegistered: false })).reasonCode, 'device_not_registered');
    assert.equal((await decide({ ...editor, role: 'instructor' })).decision, 'deny');
    assert.equal((await decide(request('editor_fixture', 'notices', 'PUT', randomUUID()))).decision, 'deny');
    assert.equal((await decide({ ...suspicious, path: `/notes/${noteA}` })).decision, 'step_up');
    assert.equal((await decide({ ...suspicious, subjectId: 'other_fixture', path: `/notes/${noteA}` })).decision, 'deny');
    assert.equal((await decide({ ...request(normal.subjectId, 'notes', 'PUT', noteA), queryLength: 4 })).decision, 'deny');
    delete process.env.VAULT_ZONE_POLICY;
    assert.equal((await decide(request(normal.subjectId, 'notes', 'GET', noteA))).decision, 'deny');
    assert.equal((await decide(editor)).decision, 'deny');
    const malformed = [null, {}, { ...policy, role: 'instructor' },
      { ...policy, noteOwners: [...policy.noteOwners, { ...scope, subjectId: 'other_fixture', id: noteA }] },
      { ...policy, apiNoticeEditors: [{ userId: 'not_verified', id: notice }] }];
    for (const value of malformed) {
      process.env.VAULT_ZONE_POLICY = JSON.stringify(value);
      assert.equal((await decide(request(normal.subjectId, 'notes', 'PUT', noteA))).decision, 'deny');
    }
  } finally {
    if (saved === undefined) delete process.env.VAULT_ZONE_POLICY;
    else process.env.VAULT_ZONE_POLICY = saved;
  }
});

test('resource routes match exact method, service, path and engine route without function/query selection', async () => {
  const { normal } = fixtureRequests();
  for (const base of ['/notes', '/api/notes']) {
    const id = randomUUID();
    for (const [path, route] of [[`${base}/${id}`, `GET ${base}/:id`]]) {
      const request = { ...normal, path, route };
      assert.equal(resourceRouteForRequest(request).resourceId, 'notes');
      // A known route alone is not proof that the UUID belongs to this subject.
      assert.equal((await decide(request)).decision, 'deny');
    }
  }
  const invalid = [
    ...['/notes/export', '/notes/demo/export', '/notes/demo/', '/notes/%64emo',
      '/notes/../demo', '/notices/demo', '/api/notes/export', '/notes/demo?op=export',
      '/notes/demo#export', '/notes//demo', '/notes/admin'].map(path => ({ ...normal, path })),
    { ...normal, route: 'GET /notes/export' },
    { ...normal, queryLength: 9 },
    { ...normal, subjectId: '' },
    { ...normal, deviceId: 'unverified' },
  ];
  for (const request of invalid) {
    assert.equal(resourceRouteForRequest(request), null);
    assert.equal((await decide(request)).decision, 'deny');
  }
});

test('recognized update zones fail closed without engine ownership and instructor evidence', async () => {
  const { normal } = fixtureRequests();
  const id = randomUUID();
  for (const service of ['notes', 'notices']) {
    const request = { ...normal, service, method: 'PUT', path: `/${service}/${id}`, route: `PUT /${service}/:id` };
    assert.deepEqual(resourceRouteForRequest(request), { resourceId: service, operation: 'update', id });
    assert.equal((await decide(request)).decision, 'deny');
    const forged = { ...request, role: 'instructor', owner_id: normal.subjectId };
    assert.equal((await decide(forged)).decision, 'deny');
  }
});

test('engine service identifies notes and instructor notices separately without granting notice access', async () => {
  const { normal } = fixtureRequests();
  assert.notEqual(RESOURCE_IDS.NOTES, RESOURCE_IDS.INSTRUCTOR_NOTICES);
  assert.equal(resourceIdForService(normal.service), 'notes');
  const notice = { ...normal, service: 'notices', path: '/notices/demo', route: 'GET /notices/:id' };
  assert.equal(resourceIdForService(notice.service), 'notices');
  assert.equal((await decide(normal)).decision, 'allow');
  assert.equal((await decide(notice)).decision, 'deny');
  assert.equal((await decide({ ...notice, deviceRegistered: false })).reasonCode, 'device_not_registered');
  for (const service of [undefined, null, {}, 'other', 'NOTES', '__proto__']) {
    assert.equal(resourceIdForService(service), null);
  }
  for (const path of ['/api/notes', '/api/notes/', '/api/notes/demo']) {
    assert.equal(resourceIdForApiPath(path), 'notes');
  }
  for (const path of ['/api/auth/session', '/api/notices', '/api/notes-demo', '/api/notes/a/b', undefined]) {
    assert.equal(resourceIdForApiPath(path), null);
  }
  const browserClaim = { ...notice, resourceId: 'notes' };
  assert.equal((await decide(browserClaim)).decision, 'deny');
});

test('the original starter checker selects all four stage seven cases with the declared rule ID', async () => {
  const checks = await checkDecider({ decide, ruleIds: RULE_IDS });
  assert.equal(checks.length, 4);
  assert.ok(checks.every(check => check.passed));
});

test('JSON requests from another execution context retain distinct normal and composite decisions', async () => {
  const { normal, suspicious } = fixtureRequests();
  const remoteJson = request => runInNewContext('JSON.parse(payload)', { payload: JSON.stringify(request) });
  for (const [request, expected] of [[normal, 'allow'], [suspicious, 'step_up']]) {
    const remote = remoteJson(request);
    assert.notEqual(Object.getPrototypeOf(remote), Object.prototype);
    assert.equal((await decide(remote)).decision, expected);
    // Also cover a same-context envelope with nested JSON created by the engine.
    assert.equal((await decide({ ...request, signals: remote.signals,
      recentEvents: remote.recentEvents, stepUp: remote.stepUp })).decision, expected);
  }
  const confirmed = remoteJson({ ...suspicious, requestId: randomUUID(),
    stepUp: { verified: true, authAgeSeconds: 60 } });
  assert.equal((await decide(confirmed)).decision, 'allow');
  assert.equal((await decide({ ...confirmed, deviceRegistered: false })).reasonCode, 'device_not_registered');
  const forged = remoteJson({ ...suspicious, headers: { 'x-signals-source': 'judge_fixture' } });
  assert.equal((await decide(forged)).decision, 'deny');
  assert.equal((await decide(remoteJson({ ...suspicious,
    signals: { ...suspicious.signals, source: 'client' } }))).decision, 'deny');
});

test('registered device can read the notes service using the unchanged response contract', async () => {
  const { normal } = fixtureRequests();
  const result = await decide(normal);
  assert.equal(result.decision, 'allow');
  assert.equal(result.reasonCode, 'approved');
  assert.deepEqual(result.ruleIds, ['device_registered']);
  assert.equal(result.requestId, normal.requestId);
  assert.equal(result.schema, 'aleph.decision.v1');
  assert.deepEqual(Object.keys(result).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.deepEqual(RULE_IDS, ['starter.deny', 'device_registered', 'step_up_required', 'resource_zone']);
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
    assert.deepEqual(result.ruleIds, method === 'PUT'
      ? ['device_registered', 'resource_zone'] : ['starter.deny']);
  }
  const other = await decide({ ...normal, service: 'other', path: '/other', route: 'GET /other' });
  assert.equal(other.decision, 'deny');
  assert.equal(other.reasonCode, 'starter_not_ready');
  assert.deepEqual(other.ruleIds, ['starter.deny']);
});

test('fixture provenance is virtual and live unavailable location remains unknown', async () => {
  const { normal } = fixtureRequests();
  const before = structuredClone(normal);
  const fixture = inspectConnectionInput(normal);
  assert.equal(fixture.valid, true);
  assert.equal(fixture.source, 'judge_fixture');
  assert.equal(fixture.kind, 'virtual');
  assert.equal(fixture.region, 'local');
  assert.equal(fixture.network, 'usual');
  assert.equal(fixture.hour, 14);
  assert.deepEqual(fixture.recentEvents, []);
  assert.deepEqual(normal, before);
  const live = { ...normal, signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 0 } };
  const inspected = inspectConnectionInput(live);
  assert.equal(inspected.valid, true);
  assert.equal(inspected.kind, 'unavailable');
  assert.equal(inspected.region, null);
  assert.equal(inspected.network, null);
  assert.equal(inspected.hour, 0);
  assert.equal((await decide(live)).decision, 'allow');
});

test('missing context and unknown provenance never receive normal defaults', async () => {
  const { normal } = fixtureRequests();
  const requests = [];
  for (const field of ['signals', 'at', 'recentEvents']) {
    const request = structuredClone(normal);
    delete request[field];
    requests.push(request);
  }
  for (const field of ['source', 'region', 'network', 'hour']) {
    const request = structuredClone(normal);
    delete request.signals[field];
    requests.push(request);
  }
  requests.push({ ...normal, signals: { ...normal.signals, source: 'client' } },
    { ...normal, signals: { ...normal.signals, source: 'none' } },
    { ...normal, signals: { ...normal.signals, hour: '14' } },
    { ...normal, signals: { ...normal.signals, hour: 24 } },
    { ...normal, at: '2026-02-31T14:00:00Z' },
    { ...normal, recentEvents: null },
    { ...normal, recentEvents: [{ kind: 'risk_signal', ageSeconds: 60 }] },
    { ...normal, recentEvents: [{ kind: 'risk_signal', ageSeconds: -1, count: 1 }] },
    { ...normal, recentEvents: Array.from({ length: 13 }, () => ({ kind: 'risk_signal', ageSeconds: 1, count: 1 })) });
  for (const request of requests) {
    const inspected = inspectConnectionInput(request);
    assert.equal(inspected.valid, false);
    assert.equal(inspected.source, null);
    for (const field of ['at', 'region', 'network', 'hour', 'recentEvents']) assert.equal(inspected[field], null);
    const result = await decide(request);
    assert.equal(result.decision, 'deny');
    assert.equal(result.reasonCode, 'starter_not_ready');
    assert.deepEqual(result.ruleIds, ['starter.deny']);
  }
});

test('forged client headers cannot replace or promote engine connection information', async () => {
  const { normal } = fixtureRequests();
  const forged = { ...normal, signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 0 },
    headers: { 'x-region': 'local', 'x-network': 'usual', 'x-hour': '14', 'x-signals-source': 'judge_fixture' } };
  assert.equal(inspectConnectionInput(forged).valid, false);
  assert.equal(inspectConnectionInput(forged).source, null);
  assert.equal(inspectConnectionInput(forged).region, null);
  assert.equal((await decide(forged)).decision, 'deny');
  const withNestedHeaders = { ...normal, signals: { ...normal.signals, headers: forged.headers } };
  assert.equal(inspectConnectionInput(withNestedHeaders).valid, false);
  assert.equal((await decide(withNestedHeaders)).decision, 'deny');
  assert.deepEqual(RULE_IDS, ['starter.deny', 'device_registered', 'step_up_required', 'resource_zone']);
});

test('combined virtual night, unfamiliar network and recent burst requests step up with a reason', async () => {
  const { suspicious } = fixtureRequests();
  const before = structuredClone(suspicious);
  const result = await decide(suspicious);
  assert.equal(result.decision, 'step_up');
  assert.equal(result.reasonCode, 'step_up_required');
  assert.deepEqual(result.ruleIds, ['device_registered', 'step_up_required']);
  assert.equal(result.requestId, suspicious.requestId);
  assert.equal(result.schema, 'aleph.decision.v1');
  assert.deepEqual(Object.keys(result).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.deepEqual(suspicious, before);
  assert.equal((await decide({ ...suspicious, signals: { ...suspicious.signals, region: 'local' } })).decision, 'step_up');
  const unregistered = await decide({ ...suspicious, deviceRegistered: false });
  assert.equal(unregistered.decision, 'deny');
  assert.equal(unregistered.reasonCode, 'device_not_registered');
  assert.deepEqual(unregistered.ruleIds, ['device_registered']);
  const missingAge = await decide({ ...suspicious, stepUp: { verified: true } });
  assert.equal(missingAge.decision, 'step_up');
});

test('only a complete fresh engine-verified fixture confirmation permits the new request', async () => {
  const { suspicious } = fixtureRequests();
  const pending = await decide(suspicious);
  assert.equal(pending.decision, 'step_up');
  for (const authAgeSeconds of [0, 60, 900]) {
    const confirmed = { ...suspicious, requestId: randomUUID(),
      stepUp: { verified: true, authAgeSeconds } };
    const result = await decide(confirmed);
    assert.equal(result.decision, 'allow');
    assert.equal(result.reasonCode, 'approved');
    assert.equal(result.requestId, confirmed.requestId);
    assert.deepEqual(result.ruleIds, ['device_registered', 'step_up_required']);
    const unregistered = await decide({ ...confirmed, deviceRegistered: false });
    assert.equal(unregistered.decision, 'deny');
    assert.equal(unregistered.reasonCode, 'device_not_registered');
  }
  for (const stepUp of [undefined, null, {},
    { verified: false, authAgeSeconds: 60 },
    { verified: 'true', authAgeSeconds: 60 },
    { verified: true, authAgeSeconds: null },
    { verified: true, authAgeSeconds: '60' },
    { verified: true, authAgeSeconds: -1 },
    { verified: true, authAgeSeconds: 901 },
    { verified: true, authAgeSeconds: Infinity },
    { verified: true, authAgeSeconds: 60, clientClaim: true },
  ]) {
    assert.equal((await decide({ ...suspicious, stepUp })).decision, 'step_up');
  }
  const forged = { ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 },
    headers: { 'x-step-up-verified': 'true' } };
  assert.equal((await decide(forged)).decision, 'deny');
});

test('region alone and incomplete combinations never cause a permanent block or step up', async () => {
  const { normal, suspicious } = fixtureRequests();
  const requests = [
    { ...normal, signals: { ...normal.signals, region: 'foreign' } },
    { ...suspicious, signals: { ...suspicious.signals, hour: 14 } },
    { ...suspicious, signals: { ...suspicious.signals, network: 'usual' } },
    { ...suspicious, recentEvents: [] },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: 60, count: 19 }] },
    { ...suspicious, recentEvents: [{ kind: 'risk_signal', ageSeconds: 61, count: 20 }] },
    { ...suspicious, recentEvents: [{ kind: 'other', ageSeconds: 60, count: 20 }] },
    { ...suspicious, signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 3 } },
  ];
  for (const request of requests) {
    const result = await decide(request);
    assert.equal(result.decision, 'allow');
    assert.equal(result.reasonCode, 'approved');
  }
  for (const method of ['POST', 'PUT', 'DELETE']) {
    assert.equal((await decide({ ...suspicious, method })).decision, 'deny');
  }
});

test('combined rule respects time and read boundaries without accepting forged provenance', async () => {
  const { suspicious } = fixtureRequests();
  for (const hour of [0, 5, 22, 23]) {
    assert.equal((await decide({ ...suspicious, signals: { ...suspicious.signals, hour } })).decision, 'step_up');
  }
  for (const hour of [6, 21]) {
    assert.equal((await decide({ ...suspicious, signals: { ...suspicious.signals, hour } })).decision, 'allow');
  }
  const splitReads = { ...suspicious, recentEvents: [
    { kind: 'risk_signal', ageSeconds: 0, count: 10 },
    { kind: 'risk_signal', ageSeconds: 60, count: 10 },
  ] };
  assert.equal((await decide(splitReads)).decision, 'step_up');
  for (const source of ['client', 'none']) {
    const result = await decide({ ...suspicious, signals: { ...suspicious.signals, source } });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reasonCode, 'starter_not_ready');
  }
});
