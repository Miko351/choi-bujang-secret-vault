# XDR 보너스 경보

이 폴더는 보너스 여섯 개의 연습 경보입니다. 경보는 수업용으로 만든 Wazuh 모양이며, 실제 로그가 아닙니다. 정답은 이 저장소에 없습니다.

## 경보 묶음

`xdr/fixtures/<moduleKey>.json` 을 읽습니다. `moduleKey` 는 아래 여섯 개입니다.

| moduleKey | 보는 것 |
|---|---|
| `brute-force` | 짧은 시간에 몰린 로그인 실패 |
| `web-injection` | 웹 요청에 섞인 주입 형태 |
| `known-cve` | 이미 공개된 취약점을 노린 요청 형태 |
| `persistence` | 다시 켜도 남도록 심긴 서비스·예약 작업 |
| `privilege` | 평범한 계정의 갑작스러운 권한 상승 |
| `exfiltration` | 처음 보는 곳으로 빠지는 큰 전송 |

한 파일에는 명확한 공격, 애매한 시도, 정상 이벤트가 함께 들어 있습니다. 주소는 문서용 대역만 쓰고, 계정은 `user01` 같은 가상 이름입니다. `known-cve` 의 원격 조회 구문은 문서용 표기입니다. 그 문자열을 다른 시스템에 넣거나 변형하지 않습니다.

## 학생이 만드는 파일

항목마다 `xdr/<moduleKey>/decide.mjs` 를 만듭니다. `decide(alert)` 를 내보냅니다. 비동기 함수여도 됩니다. 반환은 아래 세 값입니다.

- `action`: `block`, `alert`, `record` 중 하나
- `confidence`: 0 이상 1 이하 숫자
- `reason`: 짧은 이유

명확한 공격은 `block`, 애매한 시도는 `alert`, 정상 이벤트는 `record` 입니다. 경보 원본은 고치지 않습니다.

## 실행

저장소 루트에서 항목 키 하나를 넣습니다.

```
node scripts/xdr-run.mjs brute-force
```

`npm run xdr:run -- brute-force` 도 같은 명령입니다. 실행기는 해당 경보마다 `decide` 를 부르고, 결과를 `xdr/<moduleKey>/result.json` 에 씁니다. 형식은 `aleph.xdr.result.v1` 이고, `decisions` 에는 경보 id·행동·확신도·이유가, `counts` 에는 `block`·`alert`·`record` 건수가 있습니다.

반환 형식이 틀린 경보는 `record` 로 남고, 오류 한 줄이 출력됩니다. 실행기 자체는 네트워크를 쓰지 않습니다. 판정자는 격리된 환경에서 같은 명령을 다시 실행해 결과를 봅니다. 이미 커밋된 `result.json` 만으로 판정이 끝나지 않습니다.

## 무차별 로그인 대응 연결

`node xdr/brute-force/respond.mjs`는 가상 경보를 원래의 순수 decide 함수로 다시 판정하고, block 후보와 alert 알림을 `xdr/alerts.log`에 JSON 한 줄씩 추가합니다. 경보 본문·비밀번호·토큰·원본 계정/IP·기기 식별자를 로그에 넣지 않습니다. record는 경고를 만들지 않습니다. 기존 로그를 덮어쓰지 않습니다.

현재 제공 자료에는 경보를 검증된 ZTNA 신원/기기에 연결하는 매핑과 규칙 등록 함수가 **없습니다**. 따라서 기본 실행은 차단 후보 10건을 pending으로 기록하고, alert 9건·record 9건을 구분합니다. **실제 거부 규칙 등록은 0건이며 운영 차단은 미연결**입니다. account 이름만으로 차단하지 않으며 정상·공격 경보에 겹친 계정 전체를 막지 않습니다. 원본 `src/decider.mjs`의 규칙과 입력/응답 계약은 변경하지 않았습니다.

respond.mjs의 `respond(alert, options)`는 추후 신뢰하는 서버 연결에서 전달할 `resolveVerifiedTarget({evidenceAlertId, sourceIp})`와 `registerDenyRule(rule)`을 받는 **학생 코드의 로컬 연결 지점**을 제공합니다. 제공 ALEPH 엔진의 API나 검증 계약을 새로 발견한 것이 아닙니다. resolver는 공격 출발 세션의 실제 확인된 classId·projectId·subjectId·deviceId 네 값만 돌려줘야 하며, 공격자가 대입한 계정의 주인을 차단 대상으로 삼으면 안 됩니다. 브라우저의 주장·가상 사용자 이름·IP 해시로 검증 신원을 만들지 않습니다. 연결 누락·대상 불명·잘못된 대상은 보류하고 규칙 등록 함수를 호출하지 않습니다.

등록 요청은 한 검증 대상 묶음에만 적용되는 `{ruleId, action:'deny', match:{classId,projectId,subjectId,deviceId}, expiresAt, evidenceAlertId}`입니다. TTL 기본값은 900초이며 1~3600초만 허용합니다. 등록 연결 측은 정확한 대상 조건과 만료 시각을 집행하고 기존 규칙을 보존해야 합니다. 이 형식은 로컬 어댑터의 전달 자료이며 운영 엔진의 규칙 형식으로 주장하지 않습니다. 요청 전 알림을 남기고 `{status:'registered', ruleId}` 확인 응답 뒤 결과 알림을 남깁니다. 등록 요청과 결과는 각각 한 줄이며 확인 응답도 실제 요청 차단의 실측을 대신하지 않습니다.

`node --test test/xdr-brute-force-respond.test.mjs`로 모의 연결을 확인합니다. 검증된 시험 공격 기기만 거부, 정상 기기 기존 allow 유지, 기존 미등록·타인 요청 거부 유지, 만료 후 원래 판정 복귀, alert/record의 등록 없음, 누락 매핑 보류와 로그 보존을 검사합니다. 관련 XDR 시험 20개가 통과했습니다. 실제 기본 실행은 기존 이력을 보존하며 알림 19줄(보류 10·alert 9)을 추가했고 등록은 0건이었습니다. 실제 제공 엔진의 새 규칙 집행과 정상/금지 요청 실측은 미실행입니다. 연결이 제공되기 전에는 운영 연동 완료라고 쓰지 않습니다.