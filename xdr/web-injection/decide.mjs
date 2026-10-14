const PATTERNS = Object.freeze([
  {
    "name": "요청 인자의 SQL 구문 삽입",
    "condition": "요청 인자에 데이터베이스 조회를 이어 붙이거나 원래 조회 조건을 바꾸는 SQL 구문 조합이 있는지 찾는다. 경보가 해당 구문의 반복 요청을 명시한 경우도 포함한다. select 또는 SQL이라는 단어, 따옴표 하나만으로 공격을 확정하지 않는다.",
    "evidence": "MITRE ATT&CK T1190은 외부 공개 앱을 통한 SQL 주입 사례를 제시하며, MITRE CWE-89는 외부 입력이 원래 SQL 명령의 의미를 바꾸는 취약점을 설명한다.",
    "source": "https://cwe.mitre.org/data/definitions/89.html"
  },
  {
    "name": "요청 인자의 스크립트 태그 삽입",
    "condition": "요청 인자에 <script> 같은 실제 스크립트 태그 구조가 삽입되어 있는지 찾는다. 경보가 스크립트 삽입 표식과 반복 요청을 명시한 경우도 포함한다. 수업명이나 설명의 script 또는 스크립트라는 단어만으로 공격을 확정하지 않으며, 태그 발견만으로 실행 성공을 주장하지 않는다.",
    "evidence": "T1190의 외부 공개 웹앱 악용 맥락에서 참고하는 MITRE CWE-79는 사용자 입력이 웹 페이지에 안전하게 처리되지 않아 스크립트 삽입으로 이어지는 취약점을 설명한다.",
    "source": "https://cwe.mitre.org/data/definitions/79.html"
  },
  {
    "name": "반복된 상위 경로 이동 표식",
    "condition": "요청 경로나 경로를 받는 인자에 ../가 반복되어 여러 상위 디렉터리로 이동하려는 구조가 있는지 찾는다. 경보가 반복된 상위 경로 이동 또는 경로 이탈 요청을 명시한 경우도 포함한다. up이라는 단어나 긴 주소만으로 공격을 확정하지 않으며, 표식 발견만으로 파일 접근 성공을 주장하지 않는다.",
    "evidence": "MITRE ATT&CK T1190은 디렉터리 순회 취약점 악용 사례를 제시하며, MITRE CWE-22는 제한된 디렉터리 밖으로 경로가 벗어나는 취약점을 설명한다.",
    "source": "https://cwe.mitre.org/data/definitions/22.html"
  },
  {
    "name": "요청 인자의 명령 구분자 삽입",
    "condition": "요청 인자의 명령 구분자와 명령 결합 구문 또는 해당 표식을 명시한 경보를 찾는다. 같은 출발 주소의 반복 요청이 확인될 때만 차단 후보로 삼고, 구분 문자 한 번만으로 차단하지 않는다.",
    "evidence": "MITRE ATT&CK T1190은 외부 공개 앱의 명령 주입 악용 사례를 제시하며, MITRE CWE-78은 입력의 명령 구분자가 추가 명령 실행으로 이어질 수 있음을 설명한다.",
    "source": "https://cwe.mitre.org/data/definitions/78.html"
  },
  {
    "name": "불완전한 웹 주입 의심 신호",
    "condition": "T1190으로 분류된 수준 5 이상 웹 요청 경보에서 단발 구문 조각·수업 단어·긴 주소·이상한 검색 등 불완전한 신호를 찾으면 alert로만 남긴다. 분류·수준·단어만으로 block하지 않으며 정상 조회 경보는 record로 둔다. 수준 5는 이 학습 코드의 기준이다.",
    "evidence": "MITRE ATT&CK T1190 탐지 전략은 의심스러운 웹 요청을 다른 신호와 연관해 조사하며, 이 학습 규칙은 불완전한 요청 경보를 공격 확정 없이 알림으로 보존한다.",
    "source": "https://attack.mitre.org/techniques/T1190/"
  }
].map(pattern => Object.freeze(pattern)));
// Evidence weights are local heuristics, not calibrated probabilities or MITRE thresholds.
const text = value => typeof value === 'string' ? value.slice(0, 8192).toLowerCase() : '';
const countOf = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,12}$/u.test(value))) return 0;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
};
const decoded = value => {
  let current = text(value).replace(/\+/gu, ' ');
  for (let index = 0; index < 2; index++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch { break; }
  }
  return current;
};
const result = (score, reason) => {
  const confidence = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  return {action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record', confidence, reason};
};

export function decide(alert) {
  const description = text(alert?.rule?.description);
  const url = text(alert?.data?.url);
  const question = url.indexOf('?');
  const path = decoded((question < 0 ? url : url.slice(0, question)).split('#')[0]);
  // Examine parameter values, not parameter names or arbitrary credential fields.
  const values = question < 0 ? [] : url.slice(question + 1).split('#')[0].split('&').map(part => {
    const equals = part.indexOf('=');
    return equals < 0 ? '' : decoded(part.slice(equals + 1));
  });
  const countMatch = /(\d+)\s*(?:번|건|회)|\b(\d+)\s+(?:requests?|attempts?)\b/iu.exec(description);
  const count = Math.max(countOf(alert?.data?.count), countOf(countMatch?.[1] ?? countMatch?.[2]));
  const level = countOf(alert?.rule?.level);
  const highLevel = level >= 10 && level <= 16;
  const hasSource = typeof alert?.data?.srcip === 'string' && alert.data.srcip.trim().length > 0;
  const tagged = Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.includes('T1190');
  const repeated = /반복|연속|번갈아|\brepeated\b|\bconsecutive\b/iu.test(description)
    && !/반복(?:은|이|도)?\s*없|반복되지\s*않|\bnot\s+repeated\b|\bno\s+repeat/iu.test(description);
  const noSql = /sql\s*(?:구문|주입|표식|표기)?(?:은|는|이|가)?\s*(?:없|아니)|\bno\s+sql\s+injection/iu.test(description);
  const noScript = /(?:삽입|스크립트)\s*(?:표식|표기)?(?:은|는|이|가)?\s*(?:없|아니)|\bno\s+(?:script\s+injection|xss)/iu.test(description);
  const noTraversal = /경로\s*(?:이탈|순회)(?:은|는|이|가)?\s*(?:없|아니)|\bno\s+(?:path|directory)\s+traversal/iu.test(description);
  const summary = [
    !noSql && /sql\s*(?:구문|주입|표식|표기)|데이터베이스\s*조회를\s*이어\s*붙|\bsql\s+injection\b/iu.test(description),
    !noScript && /스크립트\s*(?:태그|삽입|표식|표기)|\bscript\s+(?:tag|injection)\b|\bcross.site\s+scripting\b|\bxss\b/iu.test(description),
    !noTraversal && /경로\s*(?:이탈|순회)|경로를\s*여러\s*단계\s*거슬러|\b(?:path|directory)\s+traversal\b/iu.test(description),
    /명령\s*(?:구분자|주입)|\bcommand\s+(?:separator|injection)\b/iu.test(description)
      && !/명령\s*(?:구분자|주입)(?:는|가|은|이)?\s*(?:없|아니)|\bno\s+command\s+injection/iu.test(description),
  ];
  const raw = [
    values.some(value => /\bunion\s+(?:all\s+)?select\b|;\s*(?:select|insert|update|delete|drop)\b|['"]\s*(?:or|and)\s+(?:['"]?\w+['"]?)\s*=\s*(?:['"]?\w+['"]?)/iu.test(value)),
    values.some(value => /<\s*script(?:\s|>|\/)/iu.test(value)),
    [path, ...values].some(value => (value.match(/\.\.[\\/]/gu) ?? []).length >= 2),
    values.some(value => /(?:;|&&|\|\|)\s*(?:echo|printf|id|whoami)\b/iu.test(value)),
  ];
  const partial = [
    !noSql && /따옴표|\bquotation\s+mark\b/iu.test(description),
    false,
    [path, ...values].some(value => /\.\.[\\/]/u.test(value)),
    false,
  ];
  // A tagged, nontrivial Wazuh warning can remain uncertain even when its
  // description explicitly says the fragment is not a confirmed exploit.
  const weakRequest = tagged && level >= 5 && question >= 0
    && /따옴표|\bselect\b|\bsql\b|\bscript\b|스크립트|\bup\b|구분\s*문자|주입처럼|이상한\s*검색|주소.{0,16}(?:길|깁)|\b(?:possible|suspicious|fragment)\b/iu.test(description)
    && /한\s*번|1\s*(?:건|회)|수업|단어|처럼|이상한|평소보다|\b(?:single|one|possible|suspicious|fragment)\b/iu.test(description);
  let bestScore = weakRequest ? 0.5 : 0;
  let reason = weakRequest ? PATTERNS[4].name : '일치 패턴 없음';
  for (let index = 0; index < 4; index++) {
    let score = raw[index] || summary[index] ? 0.65 : partial[index] ? 0.5 : 0;
    if (raw[index] || summary[index]) {
      if (count >= 5 || (count >= 2 && repeated)) score += 0.2;
      else if (count >= 2 || repeated) score += 0.1;
      if (highLevel) score += 0.05;
    }
    if (!hasSource || count < 2) score = Math.min(score, 0.8);
    if (score > bestScore) { bestScore = score; reason = PATTERNS[index].name; }
  }
  return result(bestScore, reason);
}
