const PATTERNS = Object.freeze([
  {
    "name": "승인 범위를 벗어난 관리자 그룹 추가",
    "condition": "일반 계정이 관리자 그룹에 새로 추가되거나 높은 권한을 부여받은 사건을 찾고 승인 범위·기존 권한·이후의 관리자 작업을 대조한다. 그룹 목록 조회, 승인된 실습, 관리자라는 단어만 등장한 경우와 구별하며 그룹 이름만으로 실제 추가나 승인 여부를 추정하지 않는다.",
    "evidence": "MITRE ATT&CK T1098.007은 계정을 Administrators 등 높은 권한의 로컬·도메인 그룹에 추가해 권한과 접근을 유지하는 형태 및 무단 그룹 추가 탐지를 설명한다.",
    "source": "https://attack.mitre.org/techniques/T1098/007/"
  },
  {
    "name": "낯선 관리자 명령과 권한 상승 정황",
    "condition": "일반 계정이나 평소와 다른 실행 흐름에서 처음 보는 관리자 명령·높은 권한의 작업이 나타나는지 찾고 실제 권한 전환, 취약점 악용 정황, 허용 범위 밖 작업과 함께 대조한다. 명령 이름·실행 파일 이름만으로 취약점 악용이나 실행 성공을 확정하지 않고, 승인된 점검과 불완전한 경보는 별도로 구별한다.",
    "evidence": "MITRE ATT&CK T1068은 소프트웨어 취약점을 악용해 낮은 권한에서 높은 권한으로 이동하는 형태를 설명하므로 낯선 명령만으로 취약점 악용을 단정하지 않는다.",
    "source": "https://attack.mitre.org/techniques/T1068/"
  },
  {
    "name": "업무 시간 밖의 낯선 권한 사용",
    "condition": "기존 계정의 관리자 작업이나 권한 사용이 확인된 평소 시각·행동 범위와 어긋나는지 찾고 낯선 관리자 명령, 비정상 로그인 흐름, 승인 범위 밖 작업 같은 단서를 함께 대조한다. 경보나 검증된 기준에 업무 시간 밖이라는 정보가 없으면 시각만 보고 근무표를 만들어 채우지 않으며, 시각 하나만으로 계정 도용을 확정하지 않는다.",
    "evidence": "MITRE ATT&CK T1078의 탐지 전략은 정상 계정의 악용을 찾기 위해 비정상 로그인 유형·시간대와 예상 밖 권한 사용 및 프로세스 활동을 함께 살피도록 설명한다.",
    "source": "https://attack.mitre.org/techniques/T1078/"
  }
].map(pattern => Object.freeze(pattern)));

// Local evidence weights, not calibrated probabilities or MITRE thresholds.
const text = value => typeof value === 'string' ? value.slice(0,8192).toLowerCase() : '';
const countOf = value => {
  if(typeof value!=='number'&&!(typeof value==='string'&&/^\d{1,12}$/u.test(value)))return 0;
  const count=Number(value);return Number.isSafeInteger(count)&&count>=0?count:0;
};
const result = (score,reason) => {
  const confidence=Math.round(Math.max(0,Math.min(1,score))*100)/100;
  return {action:confidence>=0.85?'block':confidence>=0.5?'alert':'record',confidence,reason};
};

export function decide(alert) {
  const description=text(alert?.rule?.description);
  const group=text(alert?.data?.group).trim();
  const describedAdminGroup=/관리자\s*그룹|\badministrators\b|\badmin(?:istrator)?\s+group\b/iu.test(description);
  const adminGroup=group ? /^(?:administrators|administrator|관리자)$/iu.test(group) : describedAdminGroup;
  const groupContext=/그룹|\bgroup\b/iu.test(description);
  const noAdminAddition=/관리자\s*그룹(?:은|는|이|가)?\s*아니|그룹.{0,15}추가(?:는|은|이|가)?\s*없|추가(?:하지|되지)\s*않|\bnot\s+added\b/iu.test(description);
  const rejoined=adminGroup && /(?:빠진|제거된|탈퇴한).{0,55}다시.{0,20}(?:관리자|그룹).{0,15}(?:들어|추가)|\bremoved\b.{0,55}\bre.added\b/iu.test(description);
  const groupAdded=adminGroup && !noAdminAddition
    && (rejoined || /그룹.{0,30}(?:추가|들어가|들어왔|가입)|\badded\b.{0,30}\b(?:administrator|admin)\b/iu.test(description));
  const failed=/취소|실패|실행되지|명령(?:은|이)?\s*없|\b(?:cancelled|canceled|failed)\b/iu.test(description);
  const commandContext=/(?:관리자|권한)\s*명령|\b(?:admin|privileged)\s+command\b/iu.test(description)
    || (describedAdminGroup && /명령\s*실행/iu.test(description));
  const executed=commandContext && !failed && /실행(?:했|되|됐)|명령\s*실행|\bexecuted\b/iu.test(description);
  const recentAdmin=/방금.{0,15}관리자가\s*된|\bnewly\s+elevated\b/iu.test(description);
  const privilegeChanged=!failed && /관리자\s*권한으로\s*(?:바뀌|변경|전환)|권한\s*상승(?:이|은|가)?\s*\d+\s*건|\bprivileges?\s+(?:changed|elevated)\b/iu.test(description);
  const unfamiliar=/처음\s*(?:보는|봅니다)|낯선|평소와\s*다른\s*주소|\bunfamiliar\b|\bnew\s+source\b/iu.test(description);
  const remote=/원격\s*주소|\bremote\s+(?:address|source)\b/iu.test(description);
  const outsideHours=/수업\s*시간\s*밖|업무\s*시간\s*밖|업무처럼\s*보이지\s*않는\s*시각|\boutside\s+(?:work|class|usual)\s+hours\b/iu.test(description);
  const otherAccount=/다른\s*계정의\s*권한|\banother\s+account.s\s+privileges\b/iu.test(description);
  const accountCount=/계정\s*(\d+)\s*개/iu.exec(description);
  const multipleAdditions=groupAdded && Math.max(countOf(alert?.data?.count),countOf(accountCount?.[1]))>=2;
  const unauthorized=/무단|승인\s*(?:범위\s*밖|없이)|승인(?:이|은)?\s*없|\bunauthorized\b/iu.test(description);
  const approvalUnknown=/승인.{0,15}(?:미확인|확인되지|모르|불명)/iu.test(description);
  const approved=!unauthorized && !approvalUnknown && /승인된|승인받은|허가된|\bapproved\b|\bauthorized\b/iu.test(description);
  if(approved)return result(0,'일치 패턴 없음');
  const scores=[
    groupAdded ? 0.65+(remote||executed||multipleAdditions||rejoined||unauthorized?0.2:0)+(outsideHours?0.1:0) : 0,
    executed ? 0.65+(recentAdmin||privilegeChanged||otherAccount||unfamiliar||unauthorized?0.2:0)
      : privilegeChanged ? 0.65+(unfamiliar||unauthorized?0.2:0) : 0,
    outsideHours && executed ? 0.65+(unfamiliar||groupAdded||otherAccount||unauthorized?0.25:0) : 0,
  ];
  let score=0;let reason='일치 패턴 없음';
  for(let index=0;index<scores.length;index++){
    if(scores[index]>score){score=scores[index];reason=PATTERNS[index].name;}
  }
  if(score>0)return result(score,reason);

  // Only the supplied event describes its baseline; never derive work hours from a timestamp.
  const tagged=Array.isArray(alert?.rule?.mitre)&&alert.rule.mitre.some(value=>typeof value==='string'
    && /^(?:T1068|T1078(?:\.\d{3})?|T1098\.007)$/u.test(value));
  const level=alert?.rule?.level;
  const readOnly=/읽기만|조회만|\bread.only\b/iu.test(description);
  const relevant=groupContext||commandContext||/권한\s*상승|계정\s*종류|관리자\s*권한/iu.test(description)||outsideHours;
  if(tagged&&Number.isSafeInteger(level)&&level>=5&&!readOnly&&relevant){
    const pattern=outsideHours?PATTERNS[2]:groupContext?PATTERNS[0]:PATTERNS[1];
    return result(0.5,pattern.name);
  }
  return result(0,'일치 패턴 없음');
}
