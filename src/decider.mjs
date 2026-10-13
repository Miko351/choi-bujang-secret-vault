// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 등록 기기의 자료실 읽기에 복합 가상 이상 신호가 있으면 추가 확인을 요청합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered', 'step_up_required', 'resource_scope']);

// Server-owned IDs are carried in the existing engine contract's service field.
// A resource ID is a routing label, never a permission supplied by a browser.
export const RESOURCE_IDS = Object.freeze({ NOTES: 'notes', INSTRUCTOR_NOTICES: 'notices' });
export function resourceIdForService(service) {
  switch (service) {
    case RESOURCE_IDS.NOTES: return RESOURCE_IDS.NOTES;
    case RESOURCE_IDS.INSTRUCTOR_NOTICES: return RESOURCE_IDS.INSTRUCTOR_NOTICES;
    default: return null;
  }
}
export function resourceIdForApiPath(path) {
  if (typeof path !== 'string') return null;
  if (/^\/api\/notes(?:\/[^/]+)?\/?$/u.test(path)) return RESOURCE_IDS.NOTES;
  if (/^\/api\/notices\/[0-9a-f-]{36}$/u.test(path)) return RESOURCE_IDS.INSTRUCTOR_NOTICES;
  return null;
}

const NOTE_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|demo)$/u;
// Match engine paths literally; never decode a function name into a data ID.
// The legacy demo leaf is the starter's virtual note ID, not an export/action route.
export function resourceRouteForRequest(request) {
  const resourceId = resourceIdForService(request?.service);
  if (resourceId === null || typeof request.path !== 'string' || request.queryLength !== 0) return null;
  // Only a verified engine subject/device can reach a recognized zone.
  if (typeof request.subjectId !== 'string' || !request.subjectId.trim()
      || !/^[0-9a-f]{16}$/u.test(request.deviceId ?? '')) return null;
  const prefix = resourceId === RESOURCE_IDS.NOTES ? '/notes' : '/notices';
  const paths = [prefix, `/api${prefix}`];
  for (const base of paths) {
    // An engine collection path does not identify an owned row. Do not grant a
    // whole zone based on registration or on the API's separate list filtering.
    if (!request.path.startsWith(`${base}/`)) continue;
    const id = request.path.slice(base.length + 1);
    if (!NOTE_ID.test(id) || request.route !== `${request.method} ${base}/:id`) continue;
    if (resourceId === RESOURCE_IDS.NOTES && request.method === 'GET') {
      return { resourceId, operation: 'read', id };
    }
    if (request.method === 'PUT') return { resourceId, operation: 'update', id };
  }
  return null;
}

const REQUEST_FIELDS = new Set(['schema', 'requestId', 'classId', 'projectId', 'subjectId',
  'deviceId', 'service', 'method', 'path', 'route', 'queryLength', 'querySha256', 'at',
  'policyRevision', 'deviceRegistered', 'stepUp', 'recentEvents', 'signals']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  // JSON may cross the engine's execution context; prototype identity is not provenance.
  && Object.prototype.toString.call(value) === '[object Object]';
const fields = (value, names) => record(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const nonempty = value => typeof value === 'string' && value.length > 0 && value.trim() === value;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// Administrator-managed authorization, separate from the engine input. Never read
// this policy from headers, query strings, request bodies or user-editable metadata.
// Engine pseudonyms and Supabase UUIDs are separate namespaces; no inferred binding.
export function serverZonePolicy() {
  try {
    const raw = globalThis.process?.env?.VAULT_ZONE_POLICY;
    if (typeof raw !== 'string' || raw.length > 65536) return null;
    const policy = JSON.parse(raw);
    if (!fields(policy, ['version', 'noteOwners', 'noticeEditors', 'apiNoticeEditors'])
        || policy.version !== 1) return null;
    for (const key of ['noteOwners', 'noticeEditors', 'apiNoticeEditors']) {
      const entries = policy[key];
      const names = key === 'apiNoticeEditors' ? ['userId', 'id']
        : ['classId', 'projectId', 'subjectId', 'id'];
      if (!Array.isArray(entries) || entries.length > 256
          || entries.some(entry => !fields(entry, names)
            || names.some(name => !nonempty(entry[name])) || !UUID.test(entry.id)
            || (key === 'apiNoticeEditors' && !UUID.test(entry.userId)))) return null;
    }
    // An ambiguous owner catalog must not grant a note to two different people.
    const owners = new Set();
    for (const entry of policy.noteOwners) {
      const key = JSON.stringify([entry.classId, entry.projectId, entry.id]);
      if (owners.has(key)) return null;
      owners.add(key);
    }
    return policy;
  } catch { return null; }
}

export function canEditNoticeInApi(userId, id) {
  const policy = serverZonePolicy();
  return UUID.test(userId ?? '') && UUID.test(id ?? '') && policy !== null
    && policy.apiNoticeEditors.some(entry => entry.userId === userId && entry.id === id);
}

function authorizedZone(request, route) {
  // Ownership of the starter's virtual demo is explicit server policy, using the
  // existing fixture's scope. A registered device alone grants no other subject
  // access to this note. These fixture IDs do not bind any real Supabase account.
  if (route.resourceId === RESOURCE_IDS.NOTES && route.operation === 'read' && route.id === 'demo') {
    return request.classId === 'class_fixture' && request.projectId === 'project_fixture'
      && request.subjectId === 'learner_fixture';
  }
  const policy = serverZonePolicy();
  if (!policy || !UUID.test(route.id ?? '')) return false;
  const entries = route.resourceId === RESOURCE_IDS.NOTES ? policy.noteOwners : policy.noticeEditors;
  return entries.some(entry => entry.classId === request.classId
    && entry.projectId === request.projectId && entry.subjectId === request.subjectId
    && entry.id === route.id);
}

// Validate the engine envelope; this is not proof of a caller's identity.
// Never promote browser headers or fixture data into real location evidence.
export function inspectConnectionInput(request) {
  const unavailable = () => ({ valid: false, source: null, kind: 'unknown',
    at: null, region: null, network: null, hour: null, recentEvents: null });
  if (!record(request) || request.schema !== 'aleph.decision.v1'
      || Object.keys(request).length !== REQUEST_FIELDS.size
      || Object.keys(request).some(name => !REQUEST_FIELDS.has(name))) return unavailable();
  const { signals, recentEvents, at } = request;
  if (!fields(signals, ['source', 'region', 'network', 'hour'])
      || !['none', 'judge_fixture'].includes(signals.source)
      || !nonempty(signals.region) || !nonempty(signals.network)
      || !Number.isInteger(signals.hour) || signals.hour < 0 || signals.hour > 23
      || (signals.source === 'none' && (signals.region !== 'unknown' || signals.network !== 'unknown'))) {
    return unavailable();
  }
  if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(at)
      || !Number.isFinite(Date.parse(at))) return unavailable();
  const canonicalAt = new Date(at).toISOString();
  if (canonicalAt !== at && canonicalAt.replace('.000Z', 'Z') !== at) return unavailable();
  if (!Array.isArray(recentEvents) || recentEvents.length > 12
      || recentEvents.some(event => !fields(event, ['kind', 'ageSeconds', 'count'])
        || !nonempty(event.kind) || !Number.isFinite(event.ageSeconds) || event.ageSeconds < 0
        || !Number.isSafeInteger(event.count) || event.count < 0)) return unavailable();
  return {
    valid: true, source: signals.source,
    kind: signals.source === 'judge_fixture' ? 'virtual' : 'unavailable',
    at,
    region: signals.region === 'unknown' ? null : signals.region,
    network: signals.network === 'unknown' ? null : signals.network,
    hour: signals.hour,
    // Missing events never become an empty (apparently quiet) history.
    recentEvents: recentEvents.map(({ kind, ageSeconds, count }) => ({ kind, ageSeconds, count })),
  };
}

export async function decide(request) {
  if (request.deviceRegistered !== true) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'deny',
      reasonCode: 'device_not_registered',
      ruleIds: ['device_registered'],
    };
  }
  // The engine has already verified the identity, service and allowed route.
  const connection = inspectConnectionInput(request);
  const resourceId = resourceIdForService(request.service);
  const resourceRoute = resourceRouteForRequest(request);
  if (connection.valid && resourceRoute && !authorizedZone(request, resourceRoute)) {
    return { schema: 'aleph.decision.v1', requestId: request.requestId,
      decision: 'deny', reasonCode: 'starter_not_ready',
      ruleIds: ['device_registered', 'resource_scope'] };
  }
  if (connection.valid && resourceRoute && resourceRoute.operation === 'update') {
    return { schema: 'aleph.decision.v1', requestId: request.requestId,
      decision: 'allow', reasonCode: 'approved', ruleIds: ['device_registered', 'resource_scope'] };
  }
  if (connection.valid && resourceId === RESOURCE_IDS.NOTES && resourceRoute?.operation === 'read') {
    // Fixed practice thresholds, not a claim of real location or a learned user baseline.
    // Only the engine's virtual fixture source can supply these signals today.
    const unusualHour = connection.hour < 6 || connection.hour >= 22;
    const recentReads = connection.recentEvents
      .filter(event => event.kind === 'risk_signal' && event.ageSeconds <= 60)
      .reduce((total, event) => total + event.count, 0);
    // Engine-verified virtual requests can exercise the post-confirmation decision.
    // This does not verify a real new login or connect the live reauthentication flow.
    const confirmedFixture = connection.source === 'judge_fixture'
      && fields(request.stepUp, ['verified', 'authAgeSeconds'])
      && request.stepUp.verified === true
      && Number.isFinite(request.stepUp.authAgeSeconds)
      && request.stepUp.authAgeSeconds >= 0 && request.stepUp.authAgeSeconds <= 900;
    if (connection.source === 'judge_fixture' && unusualHour
        && connection.network === 'unusual' && recentReads >= 20 && !confirmedFixture) {
      return {
        schema: 'aleph.decision.v1',
        requestId: request.requestId,
        decision: 'step_up',
        reasonCode: 'step_up_required',
        ruleIds: ['device_registered', 'step_up_required'],
      };
    }
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'allow',
      reasonCode: 'approved',
      ruleIds: [...(confirmedFixture ? ['device_registered', 'step_up_required'] : ['device_registered']),
        ...(UUID.test(resourceRoute.id ?? '') ? ['resource_scope'] : [])],
    };
  }
  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: 'deny',
    reasonCode: 'starter_not_ready',
    ruleIds: [RULE_IDS[0]],
  };
}
