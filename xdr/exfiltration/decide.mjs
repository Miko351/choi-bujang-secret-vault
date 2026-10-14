const PATTERNS = Object.freeze([
  {
    "name": "낯선 외부 목적지로의 대용량 송신",
    "condition": "처음 보는 외부 목적지로 실제 자료 송신이 있었는지 찾고, 평소보다 큰 전송량·많은 파일·자료 접근 직후 전송 같은 단서를 함께 대조한다. 정상 다운로드·승인된 백업과 구별하고 목적지나 전송량 하나만으로 유출을 확정하지 않는다. 평소 목록이나 통로 정보가 없으면 목적지의 낯섦 또는 명령 통로 사용을 임의로 추정하지 않는다.",
    "evidence": "MITRE ATT&CK T1041은 기존 명령·제어 통로를 통한 자료 유출을 설명하며 탐지 전략에서 자료 접근 뒤 비정상 송신량과 드문 외부 목적지로의 연결을 연관해 살핀다.",
    "source": "https://attack.mitre.org/techniques/T1041/"
  },
  {
    "name": "명령 통로와 다른 프로토콜을 통한 자료 반출",
    "condition": "자료 송신에 사용된 프로토콜이 확인된 기존 명령·제어 통로와 다른지 찾고, 대체 목적지·비정상 전송량·승인 범위 밖 송신과 함께 대조한다. 프로토콜 이름이나 암호화 여부만으로 유출을 확정하지 않으며, 기존 통로와 전송 프로토콜 정보가 없으면 다른 프로토콜 사용으로 채우지 않는다.",
    "evidence": "MITRE ATT&CK T1048은 기존 명령·제어 통로와 다른 프로토콜로 자료를 반출하거나 주 명령 서버와 다른 네트워크 위치로 보내는 형태를 설명한다.",
    "source": "https://attack.mitre.org/techniques/T1048/"
  },
  {
    "name": "업무 시간 밖 압축 자료 반출",
    "condition": "압축 자료가 실제 외부로 송신되고 경보 또는 검증된 기준에서 업무 시간 밖임이 확인되는지 찾은 뒤, 낯선 목적지·대용량 송신·평소와 다른 전송 흐름을 함께 대조한다. 압축 생성만 있고 송신이 없거나 승인된 정기 백업인 경우와 구별하고, 파일 확장자나 시각 하나만으로 유출을 확정하지 않는다. 업무 시간 기준이 없으면 시각으로 근무표를 만들어 채우지 않는다.",
    "evidence": "MITRE ATT&CK T1560은 유출 전에 수집 자료를 압축·암호화하는 형태를 설명하며 압축 항목의 보완 근거이고, 업무 시간은 이 학습에서 다른 송신 증거와 함께 보는 보조 단서다.",
    "source": "https://attack.mitre.org/techniques/T1560/"
  }
].map(pattern => Object.freeze(pattern)));

// Local evidence weights and size cutoffs are heuristics, not calibrated probabilities or MITRE thresholds.
const text = value => typeof value === 'string' ? value.slice(0, 8192).toLowerCase() : '';
const numberOf = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,15}$/u.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};
const result = (score, reason) => {
  const confidence = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
  return { action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record', confidence, reason };
};

export function decide(alert) {
  const description = text(alert?.rule?.description);
  const bytes = numberOf(alert?.data?.bytes);
  const files = numberOf(alert?.data?.files);
  const count = numberOf(alert?.data?.count);
  const transferContext = /전송|송신|반출|나갔|올라갔|외부.{0,15}복사|\b(?:transfer|upload|outbound|exfiltrat\w*)\b/iu.test(description);
  const failed = /전송.{0,15}(?:실패|취소)|(?:실패|취소).{0,15}전송|\b(?:failed|cancelled|canceled)\s+(?:transfer|upload)\b/iu.test(description);
  const absent = /(?:외부\s*)?(?:전송|송신|반출)(?:은|이|는|가)?\s*(?:아직\s*)?없|전송(?:하지|되지)\s*않|\bno\s+(?:external\s+)?(?:transfer|upload)\b/iu.test(description);
  const completed = /나갔|올라갔|전송(?:됐|되었|했)|송신(?:됐|했)|반출(?:됐|했)|복사(?:됐|되었)|전송이\s*\d+\s*번|\b(?:sent|uploaded|transferred|exfiltrated)\b/iu.test(description);
  const actualTransfer = completed && !failed && !absent && bytes !== 0;
  const unfamiliarNegated = /처음\s*보는\s*(?:목적지|주소)(?:는|가)?\s*(?:아니|아닙)|낯선\s*(?:목적지|주소)(?:는|가)?\s*(?:아니|아닙)|\bnot\s+(?:an?\s+)?(?:unfamiliar|new)\s+destination\b/iu.test(description);
  const unfamiliar = !unfamiliarNegated && /처음\s*보는\s*(?:외부\s*)?(?:목적지|주소)|목적지(?:는|를)?\s*처음\s*봅|평소와\s*다른\s*(?:목적지|주소)|낯선\s*(?:목적지|주소)|\b(?:unfamiliar|new|unusual)\s+(?:external\s+)?destination\b/iu.test(description);
  const largeNegated = /(?:대용량|큰\s*파일)(?:은|이|는|가)?\s*(?:아니|아닙)|\bnot\s+(?:a\s+)?large\s+(?:file|transfer)\b/iu.test(description);
  const describedLarge = !largeNegated && /대용량|큰\s*파일|자료실\s*전체|\b(?:bulk|large\s+(?:file|transfer))\b/iu.test(description);
  const bulk = describedLarge || bytes >= 50000000 || files >= 50;
  const describedCount = /(?:전송(?:이|을)?|반복(?:이|을)?)\s*(\d+)\s*(?:번|건)/iu.exec(description);
  const repeated = /연속|반복|\brepeated\b/iu.test(description) || Math.max(count ?? 0, numberOf(describedCount?.[1]) ?? 0) >= 3;
  // Baselines, work hours and transport types must be described, never inferred from clock time or IPs.
  const outsideNegated = /시간\s*밖(?:은|이|는|가)?\s*(?:아니|아닙)|\bnot\s+outside\s+(?:work|class)\s+hours\b/iu.test(description);
  const outside = !outsideNegated && /(?:업무|수업)\s*시간\s*밖|\boutside\s+(?:work|class|usual)\s+hours\b/iu.test(description);
  const archive = /압축\s*(?:파일|자료)|\barchive\b|\b(?:zip|7z|rar)\s+(?:file|archive)\b/iu.test(description);
  const differentTransport = /(?:명령|제어).{0,15}통로와\s*다른\s*프로토콜|평소에?\s*쓰지\s*않던\s*포트|\b(?:different|alternate)\s+(?:protocol|channel)\b|\bunusual\s+port\b/iu.test(description)
    && !/다른\s*프로토콜(?:은|이|는|가)?\s*(?:아니|아닙)|\bnot\s+(?:a\s+)?different\s+protocol\b/iu.test(description);
  const entireExternalCopy = /자료실\s*전체.{0,20}외부.{0,15}복사|\bentire\s+repository\b.{0,30}\bexternal\b/iu.test(description);
  const deniedApproval = /승인\s*없이|무단|\bunauthorized\b|\bnot\s+approved\b/iu.test(description);
  const approvalUnknown = /승인.{0,15}(?:미확인|불명|모르|확인되지)|백업처럼|\bapproval\s+unknown\b/iu.test(description);
  const approved = !deniedApproval && !approvalUnknown && /승인된|허가된|승인받은|정기\s*백업|예정된\s*백업|\bapproved\b|\bauthorized\b|\bscheduled\s+backup\b/iu.test(description);
  if (approved) return result(0, '일치 패턴 없음');

  const scores = [0, 0, 0];
  if (actualTransfer) {
    if (unfamiliar) scores[0] = 0.65 + (bulk ? 0.2 : 0) + (bulk && repeated ? 0.05 : 0);
    if (bulk && (repeated || entireExternalCopy)) scores[0] = Math.max(scores[0], 0.85);
    // A port anomaly supports this pattern but is not proof of a particular protocol or C2 channel.
    if (differentTransport) scores[1] = 0.65 + (bulk || repeated ? 0.2 : 0);
    if (archive) scores[2] = 0.65 + (outside ? 0.2 : 0) + (outside && unfamiliar ? 0.05 : 0);
  }
  let score = 0;
  let reason = '일치 패턴 없음';
  for (let index = 0; index < scores.length; index++) {
    if (scores[index] > score) { score = scores[index]; reason = PATTERNS[index].name; }
  }
  if (score > 0) return result(score, reason);

  // An incomplete relevant warning can justify review, never a block by severity or technique tag alone.
  const tagged = Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.some(value => typeof value === 'string' && /^(?:T1041|T1048(?:\.\d{3})?|T1560(?:\.\d{3})?)$/u.test(value));
  const level = alert?.rule?.level;
  const changedVolume = /전송량.{0,25}(?:평소보다|높|증가)|파일\s*수.{0,20}(?:늘|증가)/iu.test(description);
  const channelClue = /명령\s*통로.{0,30}자료\s*이름/iu.test(description);
  const contradictoryTransfer = completed && bytes === 0;
  const incompleteTransfer = transferContext && /전송(?:은|이)\s*\d+\s*건|백업처럼|미확인|불명|\buncertain\b/iu.test(description);
  if (tagged && Number.isSafeInteger(level) && level >= 5 && (actualTransfer || contradictoryTransfer || failed || archive || changedVolume || channelClue || incompleteTransfer)) {
    return result(0.5, archive ? PATTERNS[2].name : differentTransport ? PATTERNS[1].name : PATTERNS[0].name);
  }
  return result(0, '일치 패턴 없음');
}