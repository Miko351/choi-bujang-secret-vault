const PATTERNS = Object.freeze([
  {
    "name": "요청 머리글의 JNDI 원격 조회 구문",
    "condition": "User-Agent 등 요청 머리글에 JNDI 조회 기능과 원격 조회 대상이 결합된 완전한 구문이 있는지 찾는다. 경보가 머리글의 CVE-2021-44228 형태 원격 조회 구문을 명시한 경우도 포함한다. jndi라는 단어, 중괄호, 취약점 이름만으로 악용을 확정하지 않는다.",
    "evidence": "Apache의 CVE-2021-44228 공지는 공격자가 제어하는 로그 메시지와 인자의 JNDI 기능이 LDAP 등 외부 대상과 연결되어 원격 코드 실행으로 이어질 수 있음을 설명한다.",
    "source": "https://logging.apache.org/security.html#CVE-2021-44228"
  },
  {
    "name": "요청 인자의 JNDI 원격 조회 구문",
    "condition": "요청 주소의 인자에 JNDI 조회 기능과 원격 조회 대상이 결합된 완전한 구문이 있는지 찾는다. 경보가 인자의 원격 조회 구문 또는 같은 CVE-2021-44228 형태의 반복 요청을 명시한 경우도 포함한다. 단순 취약점 검색, 잘린 구문, 라이브러리 이름은 완전한 악용 구문과 구별하며 입력 문자열을 실행하거나 원격 대상에 접속하지 않는다.",
    "evidence": "Apache의 CVE-2021-44228 공지는 로그 메시지 인자에 포함된 공격자 제어 JNDI 조회를 취약점의 원인으로 설명하며, MITRE ATT&CK T1190은 Log4Shell을 외부 공개 앱 악용 사례로 제시한다.",
    "source": "https://logging.apache.org/security.html#CVE-2021-44228"
  },
  {
    "name": "취약점 점검 도구 흔적과 악용 구문의 결합",
    "condition": "알려진 Log4j 취약점 점검 도구의 흔적이 있는 요청에서 완전한 JNDI 원격 조회 구문도 함께 있는지 찾는다. 도구 이름이나 비슷한 수업용 프로그램 이름만으로 악성 요청으로 확정하지 않는다. 구문이 없거나 불완전한 점검 흔적은 낮은 확신의 조사 단서로 구별하고, 형태가 맞아도 실제 취약점 존재나 악용 성공을 주장하지 않는다.",
    "evidence": "CISA는 log4j-scanner를 취약할 수 있는 웹 서비스를 찾는 점검 도구로 공개하므로 도구 흔적만으로 공격 의도를 단정하지 않고 Apache가 설명한 JNDI 악용 구문과 함께 대조한다.",
    "source": "https://github.com/cisagov/log4j-scanner"
  }
].map(pattern => Object.freeze(pattern)));

// Local evidence weights, not calibrated probabilities or scores supplied by MITRE.
const text = value => typeof value === 'string' ? value.slice(0, 8192).toLowerCase() : '';
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
const completeLookup = value => /\$\{\s*jndi\s*:\s*(?:ldaps?|rmi|dns):\/\/[^\s{}/?#]+(?:\/[^\s{}]*)?\}/iu.test(value);
const lookupFragment = value => /\$\{\s*jndi\s*:/iu.test(value);
const result = (score, reason) => {
  const confidence = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  return {action:confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record',confidence,reason};
};

export function decide(alert) {
  const data = alert?.data;
  const description = text(alert?.rule?.description);
  const headers = [data?.useragent, data?.referer,
    data?.headers?.['user-agent'], data?.headers?.['User-Agent'],
    data?.headers?.referer, data?.headers?.Referer,
    data?.headers?.['x-api-version'], data?.headers?.['X-Api-Version']].map(decoded);
  const url = text(data?.url);
  const question = url.indexOf('?');
  const parameters = question < 0 ? [] : url.slice(question + 1).split('#')[0].split('&').map(part => {
    const equals = part.indexOf('=');
    return equals < 0 ? '' : decoded(part.slice(equals + 1));
  });
  const headerMatch = headers.some(completeLookup);
  const parameterMatch = parameters.some(completeLookup);
  const combined = [...headers, ...parameters];
  const toolTrace = /취약점\s*점검|점검\s*(?:흔적|도구)|\blog4j[-_ ]?(?:scan|scanner)\b/iu.test(description)
    || headers.some(value => /\blog4j[-_ ]?(?:scan|scanner)\b/iu.test(value));
  const level = alert?.rule?.level;
  const highLevel = Number.isSafeInteger(level) && level >= 10 && level <= 16;
  if (headerMatch || parameterMatch) {
    const pattern = toolTrace ? PATTERNS[2] : headerMatch ? PATTERNS[0] : PATTERNS[1];
    return result(0.85 + (highLevel ? 0.05 : 0) + (toolTrace || (headerMatch && parameterMatch) ? 0.05 : 0),pattern.name);
  }

  // Incomplete lookup syntax is a warning, never proof of a complete remote lookup.
  if (combined.some(lookupFragment)) return result(0.65,headers.some(lookupFragment) ? PATTERNS[0].name : PATTERNS[1].name);
  const tagged = Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.includes('T1190');
  const relevant = /\bcve-2021-44228\b|\bjndi\b|\blog4j\b|\blog4shell\b|취약점|점검\s*(?:흔적|도구)|라이브러리|중괄호|조회\s*(?:형태|구문)/iu.test(description)
    || combined.some(value => /\bcve-2021-44228\b|\bjndi\b|\blog4j\b/iu.test(value));
  if (tagged && Number.isSafeInteger(level) && level >= 5 && relevant) {
    const pattern = toolTrace ? PATTERNS[2] : /머리글|\bheader\b/iu.test(description) ? PATTERNS[0] : PATTERNS[1];
    return result(0.5,pattern.name);
  }
  return result(0,'일치 패턴 없음');
}
