const PATTERNS = Object.freeze([
  {
    "name": "낯선 서비스 등록·실행 파일 변경",
    "condition": "새 서비스 등록이나 기존 서비스 실행 파일 변경을 찾고, 서명 없음·임시 폴더 실행 경로·평소 목록 미등재·원격 반복 등록 등의 단서를 함께 대조한다. 서비스 설명만 바뀐 경우, 같은 실행 파일의 재시작, 서명 미확인은 실제 등록·실행 파일 변경이나 서명 없음과 구별하며 없는 정보를 임의로 채우지 않는다.",
    "evidence": "MITRE ATT&CK T1543.003은 Windows 서비스의 생성·변경과 실행 파일 경로 설정을 악용해 부팅 시 실행과 지속성을 확보하는 형태를 설명한다.",
    "source": "https://attack.mitre.org/techniques/T1543/003/"
  },
  {
    "name": "낯선 예약 작업과 의심스러운 실행 대상",
    "condition": "처음 보는 예약 작업 등록이나 변경에서 임시 폴더의 실행 파일, 임의 문자열 작업 이름, 평소와 다른 실행 시각 같은 단서를 함께 찾는다. 수업 시간의 작업 한 건이나 작업 이름 하나만으로 악성으로 확정하지 않고, 이미 알려진 정상 작업과 구별한다.",
    "evidence": "MITRE ATT&CK T1053.005는 Windows 작업 스케줄러를 악용해 악성 코드를 최초 또는 반복 실행하고 지속성을 확보하는 형태를 설명한다.",
    "source": "https://attack.mitre.org/techniques/T1053/005/"
  },
  {
    "name": "시작 폴더의 낯선 프로그램 추가",
    "condition": "시작 폴더나 시작 항목에 새 프로그램·바로가기가 추가되거나 실행 대상이 바뀌었는지 찾고, 평소 목록에 없는 항목 또는 다른 자동 실행 작업과 같은 임시 파일을 가리키는 연결을 대조한다. 목록 읽기만 한 경우, 변경 한 건만 있고 실행 여부가 불명확한 경우, 정상 수업 도구가 있는 경우를 강한 지속성 증거와 구별한다.",
    "evidence": "MITRE ATT&CK T1547.001은 시작 폴더에 프로그램이나 바로가기를 두어 로그인 시 자동 실행시키는 지속성 형태를 설명하며 시작 폴더 항목의 직접 근거를 보완한다.",
    "source": "https://attack.mitre.org/techniques/T1547/001/"
  }
].map(pattern => Object.freeze(pattern)));

// Local evidence weights, not calibrated probabilities or MITRE thresholds.
const text = value => typeof value === 'string' ? value.slice(0,8192).toLowerCase() : '';
const result = (score, reason) => {
  const confidence = Math.round(Math.max(0,Math.min(1,score))*100)/100;
  return {action:confidence>=0.85?'block':confidence>=0.5?'alert':'record',confidence,reason};
};

export function decide(alert) {
  const description = text(alert?.rule?.description);
  const path = text(alert?.data?.path).replace(/\\/gu,'/');
  const service = /서비스|\bservice\b/iu.test(description);
  const task = /예약\s*작업|\bscheduled\s+task\b/iu.test(description);
  const startup = /시작\s*(?:폴더|프로그램|항목)|\bstartup\b/iu.test(description)
    || /(?:^|\/)startup\//u.test(path);
  const temporary = /임시\s*(?:폴더|파일)|\btemp(?:orary)?\s+(?:folder|file)\b/iu.test(description)
    || /(?:^|\/)(?:temp|tmp)(?:\/|$)/u.test(path);
  const signatureUnknown = /서명.{0,16}(?:미확인|확인되지|모릅|모르|불명)|\bsignature\s+(?:unknown|unverified)\b/iu.test(description);
  const unsigned = !signatureUnknown && /서명(?:이|은|도)?\s*없|\bunsigned\b|\bnot\s+signed\b/iu.test(description)
    && !/서명\s*없는\s*(?:것|상태)(?:은|는|이)?\s*아니|\bnot\s+unsigned\b/iu.test(description);
  const unfamiliar = /평소\s*목록에\s*없|기준\s*목록.{0,12}미등재|처음\s*보는|낯선|\bunfamiliar\b|\bnot\s+in\s+(?:the\s+)?baseline\b/iu.test(description);
  const noServiceRegistration = /서비스\s*(?:등록|생성)(?:은|는|이|가)?\s*(?:없|아니)|서비스.{0,15}(?:등록|생성)(?:하지|되지)\s*않|\bno\s+service\s+(?:registration|creation)\b/iu.test(description);
  const newService = service && !noServiceRegistration
    && /새\s*서비스|서비스.{0,40}(?:등록|생성)|\bnew\s+service\b|\bservice\s+(?:registered|created|installed)\b/iu.test(description);
  const unchangedBinary = /실행\s*파일.{0,15}(?:그대로|변경(?:은|이)?\s*없|바뀌지\s*않)|\b(?:binary|executable)\s+unchanged\b/iu.test(description);
  const binaryChanged = service && !unchangedBinary
    && /실행\s*파일.{0,20}(?:바뀌|변경|교체)|\b(?:binary|executable).{0,20}(?:changed|replaced)\b/iu.test(description);
  const outsideHours = /수업\s*시간\s*밖|평소와\s*다른\s*(?:실행\s*)?시각|\boutside\s+(?:usual|class)\s+hours\b/iu.test(description);
  const randomTaskName = /이름.{0,20}임의\s*문자열|\brandom(?:ized)?\s+(?:task\s+)?name\b/iu.test(description);
  const linked = task && startup && temporary && /같은|함께|\bsame\b/iu.test(description);
  const noTaskCreation = /예약\s*작업.{0,15}(?:등록|생성|추가)(?:은|는|이|가)?\s*없|예약\s*작업.{0,15}(?:만들지|등록하지)\s*않/iu.test(description);
  const taskCreated = task && !noTaskCreation && /처음\s*보는|새|만들|등록|추가|변경|\b(?:created|registered|added|modified)\b/iu.test(description);
  const readOnly = /읽기만|조회만|\bread.only\b/iu.test(description);
  const noStartupChange = /추가(?:하지|되지)\s*않|등록(?:하지|되지)\s*않|변경(?:은|이)?\s*없/iu.test(description);
  const startupChanged = startup && !readOnly && !noStartupChange
    && /추가|등록|변경|\b(?:added|registered|changed)\b/iu.test(description);
  const scores = [
    newService || binaryChanged ? 0.65+(unsigned?0.2:0)+(unfamiliar?0.2:0)+(temporary?0.05:0) : 0,
    linked || (task && !noTaskCreation && temporary && (unfamiliar || outsideHours || randomTaskName)) ? 0.9 : taskCreated ? 0.65 : 0,
    linked ? 0.9 : startupChanged ? 0.65+(unfamiliar?0.2:0)+(temporary?0.05:0) : 0,
  ];
  let score = 0;
  let reason = '일치 패턴 없음';
  for(let index=0;index<scores.length;index++) {
    if(scores[index]>score) {score=scores[index];reason=PATTERNS[index].name;}
  }
  if(score>0) return result(score,reason);

  const tagged = Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.some(value=>typeof value==='string'
    && /^(?:T1543(?:\.\d{3})?|T1053(?:\.\d{3})?|T1547\.001)$/u.test(value));
  const level = alert?.rule?.level;
  const establishedNormal = /기존/iu.test(description) && /서명된|마쳤|그대로/iu.test(description);
  if(tagged && Number.isSafeInteger(level) && level>=5 && !readOnly && !establishedNormal
      && (service || task || startup || temporary)) {
    const pattern = task ? PATTERNS[1] : startup ? PATTERNS[2] : PATTERNS[0];
    return result(0.5,pattern.name);
  }
  return result(0,'일치 패턴 없음');
}
