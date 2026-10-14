// This projection validates local fixture shape, not the caller's identity.
// Device registration is explicit in extended local fixtures, not authenticated here.
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.prototype.toString.call(value) === '[object Object]';

export function readDetectionEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  return Array.from(events, event => {
    if (!record(event)) throw new TypeError('invalid_detection_event');
    // Explicitly select contract fields. Do not spread, log or retain raw events.
    const at = event.at;
    const method = event.method;
    const identity = event.identity;
    const sub = record(identity) ? identity.sub : undefined;
    if (typeof at !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(at)
        || !Number.isFinite(Date.parse(at))
        || typeof method !== 'string' || !METHODS.has(method)
        || typeof sub !== 'string' || !sub.length || sub.trim() !== sub) {
      throw new TypeError('invalid_detection_event');
    }
    const canonicalAt = new Date(at).toISOString();
    if (canonicalAt !== at && canonicalAt.replace('.000Z', 'Z') !== at) {
      throw new TypeError('invalid_detection_event');
    }
    const signals = event.signals;
    // Only explicit local fixture provenance is supported. Missing or unknown
    // provenance never becomes a usual/unusual network; region is not read.
    const network = record(signals) && signals.source === 'judge_fixture'
      && ['usual', 'unusual'].includes(signals.network) ? signals.network : null;
    const deviceId = network === null ? undefined : event.deviceId;
    const registeredDevice = typeof deviceId === 'string' && /^[0-9a-f]{16}$/u.test(deviceId)
      && event.deviceRegistered === true;
    return { at, method, identity: { sub },
      ...(network === null ? {} : { signals: { source: 'judge_fixture', network } }),
      ...(registeredDevice ? { deviceId, deviceRegistered: true } : {}) };
  });
}

// A local suspicion proposal only; no live engine connection or revocation.
export function detect(events) {
  const readsByDevice = new Map();
  for (const event of readDetectionEvents(events)) {
    if (event.method !== 'GET' || event.signals?.network !== 'unusual'
        || event.deviceRegistered !== true) continue;
    const subject = event.identity.sub;
    const deviceId = event.deviceId;
    const key = JSON.stringify([subject, deviceId]);
    if (!readsByDevice.has(key)) readsByDevice.set(key, { subject, deviceId, times: [] });
    readsByDevice.get(key).times.push(Date.parse(event.at));
  }
  for (const { subject, deviceId, times } of readsByDevice.values()) {
    times.sort((a, b) => a - b);
    let start = 0;
    for (let end = 0; end < times.length; end++) {
      while (times[end] - times[start] > 10 * 60 * 1000) start++;
      if (end - start + 1 > 120) {
        return { action: 'propose_revocation', reasonCode: 'burst_read', subject, deviceId };
      }
    }
  }
  return { action: 'observe' };
}
