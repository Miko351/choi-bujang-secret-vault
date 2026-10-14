const PATTERNS = Object.freeze([
  Object.freeze({
    name: '같은 출발 주소의 연속 로그인 실패',
    condition: '같은 data.srcip에서 짧은 시간에 로그인 실패가 연속 발생하는지 찾는다. 개별 경보가 해당 시간 동안 같은 주소의 반복 실패 집계를 명시한 경우도 포함한다. 단순 로그인 성공은 이 신호에 해당하지 않는다.',
    evidence: 'MITRE ATT&CK T1110.001은 반복적인 비밀번호 추측을 설명하고, 탐지 전략에서 같은 원격 호스트의 반복 로그인 실패를 제시한다.',
    source: 'https://attack.mitre.org/techniques/T1110/001/',
  }),
  Object.freeze({
    name: '여러 계정에 같은 비밀번호 대입',
    condition: '여러 계정에 같은 비밀번호를 대입한 사실이 경보 설명에 명시되어 있는지 찾는다. 여러 계정의 실패만으로 같은 비밀번호 사용을 추정하지 않으며, 비밀번호 원문을 읽거나 저장하지 않는다.',
    evidence: 'MITRE ATT&CK T1110.003은 하나 또는 소수의 비밀번호를 여러 계정에 대입하는 Password Spraying을 설명한다.',
    source: 'https://attack.mitre.org/techniques/T1110/003/',
  }),
]);

// Local evidence weights, not probabilities or thresholds supplied by MITRE.
// Each call uses only this alert's aggregate evidence; no cross-call history.
const text = value => typeof value === 'string' ? value.slice(0, 4096).toLowerCase() : '';
const countOf = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,15}$/u.test(value))) return 0;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
};
const result = (score, reason) => {
  const confidence = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  return {action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record', confidence, reason};
};

export function decide(alert) {
  const description = text(alert?.rule?.description);
  const data = alert?.data;
  const hasSource = typeof data?.srcip === 'string' && data.srcip.trim().length > 0;
  const levelValue = countOf(alert?.rule?.level);
  const highLevel = levelValue >= 10 && levelValue <= 16;
  const tagged = Array.isArray(alert?.rule?.mitre)
    && alert.rule.mitre.some(value => typeof value === 'string' && /^T1110(?:\.00[1-4])?$/u.test(value));
  const authContext = tagged || /로그인|로그온|인증|비밀번호|계정|\blog(?:in|on)\b|\bauthentication\b|\bpassword\b|\baccount\b/iu.test(description);
  const failed = /실패|\bfail(?:ed|ure|ures)?\b/iu.test(description)
    && !/실패(?:가|는|이)?\s*(?:없|아니)|\bno\s+(?:authentication\s+|login\s+)?failures?\b/iu.test(description);
  const attempted = /대입|시도|넣었|넣어|\battempt(?:s|ed)?\b|\btr(?:y|ies|ied)\b/iu.test(description);
  const samePassword = /(?:같은|동일(?:한)?)\s*비밀번호|\b(?:same|single)\s+password\b/iu.test(description)
    && !/(?:같은|동일(?:한)?)\s*비밀번호(?:를|의)?\s*(?:대입하지|사용하지|(?:대입|사용)(?:이|은)?\s*없)|\bno\s+password\s+spray/iu.test(description);
  const accounts = Array.isArray(data?.accounts) ? data.accounts
    : typeof data?.accounts === 'string' ? data.accounts.slice(0,4096).split(',') : [];
  const multipleAccounts = new Set(accounts.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim())).size >= 2
    || /(?:여러|다수(?:의)?|서로\s*다른|두)\s*계정|계정\s*(?:[2-9]|\d{2,})\s*개|\b(?:multiple|many|different|several)\s+(?:user\s+)?accounts\b/iu.test(description);
  if (samePassword && multipleAccounts && (failed || attempted)) {
    // Missing source evidence must not become a confirmed source-linked attack.
    return result(hasSource ? 0.9 + (highLevel ? 0.05 : 0) : 0.8, PATTERNS[1].name);
  }
  if (!authContext || !failed) return result(0, '일치 패턴 없음');

  const countMatch = /실패(?:가|는|이)?\s*(\d+)\s*(?:건|회)|\b(\d+)\s+(?:failed\s+(?:logins?|logons?|passwords?)|authentication\s+failures?)\b/iu.exec(description);
  const count = Math.max(countOf(data?.count), countOf(countMatch?.[1] ?? countMatch?.[2]));
  const repeated = /연속|반복|이어|쌓|같은\s*간격|한\s*글자씩|\brepeated\b|\bconsecutive\b|\bburst\b/iu.test(description);
  if (count < 2 && !repeated) return result(0.2, PATTERNS[0].name);
  if (!hasSource) return result(0.35, PATTERNS[0].name);

  const duration = /(\d+(?:\.\d+)?)\s*(초|분|시간|일|seconds?|minutes?|hours?|days?)/iu.exec(description);
  let seconds = null;
  if (duration) {
    const unit = duration[2];
    const factor = unit === '초' || unit.startsWith('second') ? 1
      : unit === '분' || unit.startsWith('minute') ? 60
        : unit === '시간' || unit.startsWith('hour') ? 3600 : 86400;
    seconds = Number(duration[1]) * factor;
  }
  let score = 0.5;
  if (count >= 3) score += 0.05;
  if (count >= 8) score += 0.05;
  if (count >= 20) score += 0.15;
  if (highLevel) score += 0.1;
  if (repeated) score += 0.05;
  if (seconds !== null && seconds > 0 && seconds <= 300) score += 0.15;
  // Explicitly slow failures cannot satisfy a short-time burst strongly enough to block.
  if (seconds !== null && seconds > 300) score = Math.min(score, 0.8);
  return result(score, PATTERNS[0].name);
}