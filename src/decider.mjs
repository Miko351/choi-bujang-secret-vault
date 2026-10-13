// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 등록 기기의 자료실 읽기에 복합 가상 이상 신호가 있으면 추가 확인을 요청합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered', 'composite_risk_step_up']);

const REQUEST_FIELDS = new Set(['schema', 'requestId', 'classId', 'projectId', 'subjectId',
  'deviceId', 'service', 'method', 'path', 'route', 'queryLength', 'querySha256', 'at',
  'policyRevision', 'deviceRegistered', 'stepUp', 'recentEvents', 'signals']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fields = (value, names) => record(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const nonempty = value => typeof value === 'string' && value.length > 0 && value.trim() === value;

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
  if (connection.valid && request.service === 'notes' && request.method === 'GET') {
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
        ruleIds: ['device_registered', 'composite_risk_step_up'],
      };
    }
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'allow',
      reasonCode: 'approved',
      ruleIds: confirmedFixture ? ['device_registered', 'composite_risk_step_up'] : ['device_registered'],
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
