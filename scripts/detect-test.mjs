import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);
const subject = 'learner_fixture';
const deviceId = 'a'.repeat(16);

function reads(count, { intervalSeconds = 2, owner = subject, start = START,
  network = 'unusual', source = 'judge_fixture', device = deviceId, registered = true } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    at: new Date(start + index * intervalSeconds * 1000).toISOString(),
    method: 'GET', identity: { sub: owner },
    ...(device === null ? {} : { deviceId: device, deviceRegistered: registered }),
    ...(network === null ? {} : { signals: { source, network } }),
  }));
}

const cases = [
  ...[
    { name: '원본 계약·정상 조회 30건', count: 30 },
    { name: '원본 계약·10분 안에 120건', count: 120 },
    { name: '원본 계약·10분 안에 121건', count: 121, proposal: true },
    { name: '원본 계약·폭주 조회 200건', count: 200, proposal: true },
    { name: '원본 계약·10분 밖 조회 200건', count: 200, options: { intervalSeconds: 7 } },
  ].map(item => ({ name: item.name,
    events: reads(item.count, item.options).map(({ at, method, identity }) => ({ at, method, identity })),
    expected: item.proposal ? { action: 'propose_revocation', reasonCode: 'burst_read', subject }
      : { action: 'observe' } })),
  { name: '원본 계약·다른 사용자 각각 100건', events: [...reads(100),
    ...reads(100, { owner: 'other_fixture' })].map(({ at, method, identity }) => ({ at, method, identity })),
    expected: { action: 'observe' } },
  { name: '정상 네트워크 조회 30건', events: reads(30, { network: 'usual' }), expected: { action: 'observe' } },
  { name: '낯선 네트워크·10분 안에 120건', events: reads(120), expected: { action: 'observe' } },
  { name: '복합 의심: 낯선 네트워크·10분 안에 121건', events: reads(121), expected: {
    action: 'propose_revocation', reasonCode: 'burst_read', subject, deviceId } },
  { name: '복합 의심: 낯선 네트워크·폭주 조회 200건', events: reads(200), expected: {
    action: 'propose_revocation', reasonCode: 'burst_read', subject, deviceId } },
  { name: '서로 다른 사용자 각 100건', events: [...reads(100),
    ...reads(100, { owner: 'other_fixture' })].sort((a, b) => a.at.localeCompare(b.at)),
  expected: { action: 'observe' } },
  { name: '10분 밖으로 흩어진 조회 200건', events: reads(200,
    { intervalSeconds: 7 }), expected: { action: 'observe' } },
  { name: '정상 네트워크·다량 조회만 있음', events: reads(200, { network: 'usual' }),
    expected: { action: 'observe' } },
  { name: '네트워크 정보 없음·다량 조회', events: reads(200, { network: null }),
    expected: { action: 'observe' } },
  { name: '출처 불명 네트워크·다량 조회', events: reads(200, { source: 'client' }),
    expected: { action: 'observe' } },
  { name: '지역만 다름·정상 네트워크', events: reads(200, { network: 'usual' })
    .map(event => ({ ...event, signals: { ...event.signals, region: 'foreign' } })),
    expected: { action: 'observe' } },
  { name: '기기 정보 없음·복합 의심 신호', events: reads(200, { device: null }),
    expected: { action: 'observe' } },
  { name: '미등록 기기·복합 의심 신호', events: reads(200, { registered: false }),
    expected: { action: 'observe' } },
  { name: '같은 사용자·다른 기기 각각 100건', events: [...reads(100),
    ...reads(100, { device: 'b'.repeat(16) })], expected: { action: 'observe' } },
];

// This is a practice contract, not a live engine assertion or judge score.
export async function checkDetection(detect) {
  if (typeof detect !== 'function') throw new TypeError('src/detect.mjs에서 detect 함수를 내보내야 합니다.');
  const results = [];
  for (const item of cases) {
    const actual = await detect(item.events);
    const passed = isDeepStrictEqual(actual, item.expected);
    results.push({ name: item.name, passed: Boolean(passed) });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { detect } = await import('../src/detect.mjs');
    const results = await checkDetection(detect);
    for (const item of results) process.stdout.write(`${item.passed ? '통과' : '확인 필요'} · ${item.name}\n`);
    process.stdout.write('가상 사건 연습이며 실제 접속 회수나 심판 통과 증거가 아닙니다.\n');
    if (results.some(item => !item.passed)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`탐지 연습 첫 오류: ${error.message}\n`);
    process.exitCode = 1;
  }
}
