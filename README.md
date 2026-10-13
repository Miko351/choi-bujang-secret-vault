# BYTE BACK 방어전 시작 틀 R5

이 저장소는 방어전 R5 시작 틀에서 출발했습니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 8단계 저장점 · 전체 목록 허용 수정 · 2026-10-13

사용자가 `78c51cf7f311`에서도 48점과 `S08_OTHER_ZONE_ALLOWED`가 남았다고 보고했습니다. 원인 후보는 판정기의 전체 목록 허용, 제공 엔진에서 서버 정책을 읽지 못하는 환경 차이, 규칙 식별 정보의 불일치입니다. 원본 시작 틀에는 추가 8단계 소유권 계약이나 규칙 ID 지정이 없으며 환경 차이는 실제 요청 자료가 없어 확정하지 않습니다. 로컬에서는 `GET /notes`와 `GET /api/notes`가 정상·다른 사용자 모두에게 `allow`인 문제를 재현했습니다. 지난 수정은 `demo` 예외만 제한해 이 목록 예외가 남았습니다.

이번에는 판정기의 전체 목록 경로 인식과 허용 예외만 제거했습니다. 소유권 정책이 있어도 한 건을 지정하지 않는 전체 목록은 `deny`입니다. 기존 한 건 소유권 검사·가상 `demo` 소유자 범위·기기 등록·복합 사건 추가 확인을 유지합니다. 화면의 메모 목록 API·A/B 본인 CRUD·공지 API·로그인·DB·설정·규칙 이름은 변경하지 않았습니다. 코드상 목록 허용은 확인했지만 심판의 비공개 요청도 이 경로였다고 확정하지는 않습니다.

직접 확인 명령: `node --test test/decider.test.mjs test/notes.test.mjs`. 정상은 가상 정책의 본인 한 건 GET·PUT과 API의 A/B 본인 CRUD, 거부는 판정기 전체 목록·타인 한 건·학생 공지 수정입니다. 실제 서버 정책·공지 DB의 미설정 상태는 유지하며 강사에게 요청할 항목은 없습니다. 수정 커밋을 배포한 뒤 `/aleph.json`의 최신 커밋을 확인하고 방어전 화면의 **심판에게 제출하기**를 눌러 재확인합니다. 이번 수정의 가상 시험을 심판 통과로 기록하지 않습니다. 아래는 이전 저장점 당시의 기록입니다.

이번 실행에서 판정기·메모 API의 로컬 시험 37개와 `npm run decider:test`의 기존 네 가상 검사가 통과했습니다. 별도 가상 요청에서 본인 `demo`는 `allow`, 타인 `demo`와 두 전체 목록 경로는 `deny`, 복합 사건은 `step_up`, 학생 공지 PUT은 `deny`였습니다. 후속 요청으로 수정 네 파일을 「8단계 저장점」으로 커밋하고 GitHub main에 올립니다. 설정 단계 8·저장소·배포·발급자·허용 경로 10개·원본 API와 구현 규칙 4개를 유지합니다. 이번 요청에서 묶음 재생성·새 배포 성공 확인·새 심판 제출은 실행하지 않습니다.

## 8단계 저장점 · 구역 규칙 오류 수정 · 2026-10-13

사용자가 커밋 `64614eaa3474`에서 `S08_OTHER_ZONE_ALLOWED`와 48점을 보고했습니다. 원인 후보는 `demo` 읽기의 소유권 검사 생략과 목록 읽기의 정책 없는 허용입니다. 로컬 재현에서 같은 가상 `demo` 메모의 사용자·반·프로젝트를 바꿔도 모두 `allow`였으며, 일반 학생의 공지 PUT은 이미 `deny`였습니다. 이번에는 재현된 `demo` 예외 하나만 기존 시작 틀 가상 소유자 범위로 제한했습니다. 실제 사용자 ID를 추측하거나 브라우저 값으로 권한을 만들지 않았습니다. 목록 API의 소유자 필터·공지 API·기기 규칙·복합 사건 추가 확인·설정·DB·화면은 보존합니다. 심판의 상세 요청은 없어 이번 원인이 실제 심판의 유일한 실패 원인이라고 확정하지 않습니다.

재실행: `node --test test/decider.test.mjs`. 기존 가상 소유자의 정상 읽기는 `allow`, 복합 사건은 `step_up`, 다른 사용자·반·프로젝트의 같은 메모 읽기는 `deny`여야 합니다. 재확인 완료 값도 타인의 소유권 거부를 우회하지 못합니다. 이는 로컬 가상 시험이며 실제 엔진·심판 통과로 보고하지 않습니다. 수정 커밋을 올리고 새 배포의 `/aleph.json` 커밋을 확인한 뒤 방어전 화면에서 **심판에게 제출하기**를 눌러 재확인합니다. 현재 실제 서버 구역 정책·공지 DB의 미설정 상태는 그대로이며 강사에게 요청할 항목은 없습니다. 아래는 수정 전 저장점 기록입니다.

이번 실행에서 판정기 시험 17개와 `npm run decider:test`의 기존 네 가상 검사가 통과했습니다. 별도 가상 요청에서도 기존 소유자 `allow`, 타인·다른 반·다른 프로젝트 `deny`, 복합 사건 `step_up`, 학생 공지 PUT `deny`를 확인했습니다. 후속 요청으로 이 수정 네 파일을 「8단계 저장점」으로 커밋하고 GitHub main에 올립니다. 설정 단계 8·저장소·배포·발급자·허용 경로 10개·원본 API와 구현 규칙 4개를 유지합니다. 이번 요청에는 묶음 재생성·새 배포 성공 확인·새 심판 제출이 포함되지 않습니다.

## 8단계 저장점 · 후속 보완 · 2026-10-13

강사에게 설정이나 자료를 요구하지 않고 서버 관리 접근 정책 검사와 공지 수정 API를 추가했습니다. `src/decider.mjs`의 `resource_zone` 규칙은 엔진의 기존 반·프로젝트·가명 사용자·등록 기기·메서드·정확한 경로를 서버 정책과 대조합니다. 정책 없이 UUID 메모 읽기를 허용하던 분기는 거부로 바꿨습니다. 정책이 확인되면 자기 메모 GET·PUT과 승인된 공지 PUT만 허용하며 타인 자료·알 수 없는 경로·위조 역할은 거부합니다. 이전 기기 규칙과 복합 이상 읽기 사건 추가 확인, 시작 틀의 `demo` 가상 연습과 목록 경로는 보존합니다.

실제 API는 기존 메모의 검증된 사용자·DB 소유자 검사를 유지하고, `PUT /api/notices/:id`에서 서버 승인 권한과 DB 기존·새 소유자를 모두 검사합니다. 정책이 없으면 DB 접근 전 403 `NOTICE_EDIT_FORBIDDEN`, 무로그인은 401 JSON입니다. 자원 ID는 메모 `notes`, 공지 `notices`이며 기존 자료·주소·메뉴·로그인 도우미·서버 전용 키 사용은 유지합니다. 설정 단계는 8, 허용 경로는 실제 구현된 10개, 판정 규칙은 4개이며 `judgeIssuer`는 변경하지 않았습니다. 패키징의 기존 함수 기준은 유지하고 새 공지 함수만 추가 목록에 명시했습니다.

**실제 설정·실측은 미완료입니다.** `VAULT_ZONE_POLICY`는 실제 환경에 설정하지 않았으며, 엔진 가명 ID와 DB 소유자를 연결한 정보도 없습니다. 실제 사용자 ID나 강사 역할을 임의로 만들어 넣지 않았습니다. 학습 DB의 공지 테이블·자료·권한 SQL도 적용하지 않았습니다. 현재 공지 수정은 거부되며, 가상 정책에서 정상 허용을 시험한 것으로 운영 엔진·심판 통과나 실제 공지 수정 성공을 주장하지 않습니다. 실제 8단계 전체 완료 여부는 아직 확인되지 않았습니다. 기존 앱의 A/B 메모 CRUD는 서버 API가 소유자를 검사하므로 판정 정책 누락으로 바꾸지 않습니다.

정책 형식과 확인 방법은 [docs/RESOURCE_ZONES.md](docs/RESOURCE_ZONES.md)를 참고하세요. 재실행: `node --test test/decider.test.mjs test/notices.test.mjs test/notes.test.mjs`. 화면에서는 **A/B 로그인 → 각자 메모 조회·수정**, 개발자 도구 **Network → 메모 요청 → Response Headers**를 확인합니다. 정상은 각자 자기 자료, 거부는 상대 자료와 일반 학생의 직접 공지 PUT입니다. 이번 저장점은 「8단계 저장점」 커밋 후 `npm run bundle`로 묶음을 만들고 오류가 없으면 GitHub main에 올리는 요청입니다. 푸시만으로 새 배포 성공을 확정하지 않습니다.

이번 보완의 전체 로컬 시험은 70개 통과했습니다. `npm run decider:test`의 기존 네 가상 검사, `npm run fixture:7`의 정상 `allow`·복합 `step_up`, `npm run build -- --local`도 통과했습니다. 이 시험은 운영 엔진·실제 공지 DB·새 배포를 확인한 결과가 아닙니다.

제출 묶음은 비로그인 HTTP 요청 8건의 실제 결과와 실제 로그인·DB·기기·구역 관련 미실행 12개를 구분합니다. 배포 `/aleph.json`의 단계·커밋이 아직 저장점과 다르면 그대로 기록합니다. 설정의 저장소·배포 주소·로그인 발급자·허용 경로·쿼리 없는 원본 API를 구현과 대조했으며 `judgeIssuer`를 유지합니다. `bundle-notes.json`과 `artifacts/submission.json`은 커밋하지 않습니다. 비밀값·메모 본문은 묶음에서 제외하며, 옛 공개 커밋과 옛 배포의 과거 노출이 해소됐다고 쓰지 않습니다. 아래는 최초 저장점 당시의 기록입니다.

## 8단계 최초 저장점 · 2026-10-13

메모와 강사 공지의 자원 ID를 `notes`, `notices`로 구분합니다. 판정기는 기존 계약의 `service`를 사용하며 요청·응답 항목은 추가하지 않습니다. 메모 API는 서버 경로로 `X-Resource-Id: notes`를 반환하고 브라우저의 자원·역할 주장으로 테이블이나 권한을 바꾸지 않습니다. 기존 자료·주소·화면 메뉴와 로그인·본인 메모 CRUD를 보존했습니다.

판정기는 `subjectId`와 기기 ID의 형식, 등록 여부, 메서드·서비스·정확한 경로 및 `route`를 검사합니다. 메모의 목록 GET과 UUID 자료 ID의 GET 경로, 시작 틀 가상 메모 `demo`만 읽기로 인식합니다. 미등록 경로·`export` 같은 기능 이름·인코딩/깊이 우회·미확인 쿼리는 거부하며 기존 복합 사건 추가 확인과 가상 재확인 뒤 허용을 유지합니다. 자료 ID는 경로로 선택하고 쿼리 원문이 없는 판정기에서 기능 선택이나 ID 쿼리를 임의로 해석하지 않습니다. 실제 메모 API의 기존 내부 `noteId` rewrite는 유지합니다.

**미구현·미실행:** 사용자가 추가 계약이 없다고 확인했습니다. 엔진의 가명 `subjectId`와 DB 소유자를 연결하는 계약 및 검증된 강사 역할이 없어, 판정기의 본인 메모 PUT 허용·A/B 소유권 구별과 강사 공지 PUT 허용은 미구현입니다. 인식된 수정 경로도 현재 기본 거부합니다. 공지 API·공지 자료·강사 권한 저장소도 없으며 실제 엔진의 구역 요청은 미실행입니다. 본문 `role`이나 임의 신원 필드로 권한을 만들어 8단계 완료라고 기록하지 않습니다.

기존 메모 서버 API는 변경하지 않은 로그인 도우미의 검증된 사용자 ID로 DB의 `owner_id`를 제한하고 GET·POST·PUT·DELETE 반환 행의 소유자도 재확인합니다. 누락·모순된 소유자는 자료 없이 502 `NOTES_UNAVAILABLE`, 타인 한 건 접근은 404 `NOT_FOUND`, 소유자 변경은 403 `OWNER_CHANGE_FORBIDDEN`, 무로그인은 401 `LOGIN_REQUIRED`로 짧게 거부합니다. 응답에는 소유자·비밀값을 넣지 않으며 메모 JSON 계약과 DB 자료·권한은 유지합니다. 공지·미등록 자원에 대한 서버 핸들러의 직접 가상 요청은 404로 거부하고 다른 테이블을 조회하지 않았습니다. 이는 실제 공지 API가 배포됐다는 뜻이 아닙니다.

다시 확인: `node --test test/decider.test.mjs test/notes.test.mjs`. 가상 요청과 모의 DB로 경로 거부·자원 구분·A/B 본인 CRUD·타인 거부·반환 소유자 재확인을 시험하며 실제 엔진·심판 판정으로 보고하지 않습니다. 기존 7단계 연습은 `npm run decider:test`입니다. 배포 후 **A 로그인 → 자기 메모 조회·수정**, **B 로그인 → 주소창에서 A 메모 API 직접 요청**으로 정상 동작과 404 거부를 확인하고, 개발자 도구 **Network → 메모 요청 → Response Headers**에서 자원 ID를 확인하세요. 이번 자동 점검에는 실제 A/B 로그인 요청을 넣지 않습니다.

저장점 검증에서 전체 로컬 시험 68개, `npm run decider:test`, `npm run fixture:7`, `npm run build -- --local`이 통과했습니다. 8단계 빌드의 정적 자료 제거·배포 식별 자동 생성과 자기 점검의 실제 요청/미실행 구분도 시험했습니다. 새 배포 성공이나 실제 강사 권한 허용 시험으로 보고하지 않습니다.

저장점 설정은 8단계이며 Git origin과 같은 저장소 주소·기존 Vercel 주소·Supabase 발급자/대상/공개 JWKS·자료 경로 다섯 개와 Auth 경로 네 개·쿼리 없는 원본 API 주소를 구현과 대조했습니다. 존재하지 않는 공지 API를 허용 경로에 넣지 않고 `judgeIssuer`와 실제 구현 규칙 세 개를 유지합니다. 제출 묶음 재생성은 `npm run bundle`입니다. 자기 점검 기록 20개는 공개 배포에 보내는 비로그인 HTTP 요청 8건과 미실행 12개를 구분하며 공지 허용 미구현도 기록합니다. GitHub push와 새 배포 확인은 이번 요청에서 실행하지 않습니다. `/aleph.json`의 단계·커밋 불일치는 그대로 기록합니다. 두 제출 생성 파일·비밀값·메모 본문은 커밋하지 않으며 과거 공개 사본 노출은 해소됐다고 쓰지 않습니다.

아래는 이전 7단계 통과 확인과 수정 당시의 기록입니다.

## 현재 상태 · 7단계 통과 확인 · 2026-10-13

최신 기능 저장점은 `7bd61f6a22e79e974f343139966031e0416544c5`의 「7단계 저장점」이며 `aleph.config.json`의 단계도 7입니다. 이 커밋을 GitHub main에 올린 뒤 사용자가 **7단계 심판 통과**를 보고했습니다. 기존 로그인·본인 메모 CRUD·서버 함수 통합·기기 등록·복합 사건 추가 확인과 가상 재확인 뒤 허용을 유지합니다. 8단계는 아직 구현하지 않았습니다.

통과 결과는 사용자의 심판 화면 확인 보고입니다. 도구가 새 심판 요청을 보내거나 실제 새 로그인 시각 검증·운영 릴레이 연결을 실측한 결과로 기록하지 않습니다. 이번에는 README의 확인 기록만 갱신하며 설정·앱 코드·DB 자료와 권한은 변경하지 않습니다.

아래는 통과 전 각 수정과 시험 당시의 기록이며, 당시의 미확인·실패 문구를 현재 심판 결과로 읽지 않습니다.

## 7단계 저장점 · 후속 수정 기록 · 2026-10-13

`11b6fa9bf711`에서도 사용자가 보고한 `S07_SAME_VERDICT`는 남아 있습니다. 공개 원본 시작 틀의 `scripts/decider-test.mjs`는 규칙 ID `step_up_required`가 있을 때만 두 7단계 검사를 추가합니다. 이번에는 임의 규칙 이름 `composite_risk_step_up`을 `step_up_required`로 맞추고 연습기의 선택 조건을 원본으로 되돌렸습니다. `RULE_IDS`에는 `starter.deny`, `device_registered`, `step_up_required` 세 구현 규칙만 있습니다. 판정 조건·기기·출처 검사·가상 재확인 뒤 허용과 다른 기능은 유지합니다. 심판이 규칙 ID로 검사를 선택하는지는 확인되지 않았고 상세 요청도 제공되지 않아 오류 해결을 확정하지 않습니다.

이번 재실행은 `npm run decider:test`이며 등록 정상·미등록 거부·복합 사건 추가 확인·가상 재확인 뒤 허용의 네 검사가 통과했습니다. `node --test test/decider.test.mjs`는 원본 연습기에서 네 검사가 선택되는 회귀 시험을 포함해 12개 통과했습니다. 설정 단계 7·저장소·배포 주소·발급자·허용 경로·원본 API 주소와 `judgeIssuer`는 유지합니다. 실제 재로그인 검증과 새 배포·심판 재제출 결과는 미확인이며 이번 요청에서 제출 묶음은 재생성하지 않습니다. Vercel 최신 배포의 `/aleph.json` 커밋을 확인하고 **심판에게 제출하기**로 재확인하세요. 아래는 이전 수정과 시험 당시의 기록입니다.

`5fde05a9d679` 재제출에서 사용자가 보고한 남은 실패는 `S07_SAME_VERDICT` 한 항목입니다. 후속 조사에서 다른 JavaScript 실행 환경이 만든 계약 형태의 JSON을 현재 환경의 `Object.prototype`과 직접 비교하여 정상 요청도 `deny`로 만드는 문제를 로컬에서 재현했습니다. 원형 동일성 검사만 JSON 객체 형식 검사로 바꾸고 회귀 시험을 추가했습니다. 다른 환경에서 온 전체 요청·중첩 신호·최근 사건·재확인 객체도 정상 `allow`, 복합 `step_up`, 가상 재확인 후 `allow`로 구분합니다. 기존 출처·필드·기기 검사와 복합 조건은 유지합니다. 심판의 실제 실행 구조는 확인되지 않아 이 문제가 심판 오류의 원인이라고 확정하지 않습니다.

이번 수정의 `node --test test/decider.test.mjs`는 11개 통과했고 `npm run decider:test`의 네 가상 검사도 통과했습니다. 정상 읽기는 허용하고 미등록 기기·위조 입력은 거부합니다. 실제 재로그인 연결·심판 재제출 결과는 미확인이며 기존 기능과 다른 작업을 보존했습니다. 아래 재확인 분기 기록은 이전 후속 수정 당시의 결과입니다.

초기 저장점 `7454a32`의 심판 기록에서 정상·복합 사건 구분과 재확인 뒤 허용이 실패했습니다. 정상 `allow`·복합 사건 `step_up`은 로컬에서 재현되지만 심판의 `S07_SAME_VERDICT` 원인은 아직 확정하지 못했습니다. 확인된 문제는 복합 사건의 재확인 상태를 판정에 쓰지 않았고 `decider:test`가 현재 규칙 ID를 인식하지 못해 두 관련 검사를 생략한 것입니다.

가상 요청에 한해 `judge_fixture` 출처와 계약 형태의 `stepUp`을 검사합니다. `verified`가 엄격히 true이고 숫자 `authAgeSeconds`가 0~900초이면 새 복합 사건 요청을 `allow` / `approved`로 재판정합니다. 확인 전·누락·잘못된 값·범위 밖 나이는 계속 `step_up` / `step_up_required`입니다. 기존 기기 등록·입력 출처·복합 조건은 유지하며 화면·메모 API·DB 권한·자료는 변경하지 않습니다. 실제 새 로그인 시각을 검증하는 호출이나 운영 릴레이 연결은 추가하지 않았으므로 실제 차단·재로그인 후 허용은 여전히 미실행입니다.

재실행은 `npm run decider:test`입니다. 등록 정상 요청, 미등록 거부, 복합 사건 추가 확인, 가상 재확인 뒤 허용의 네 검사가 모두 통과했습니다. `node --test test/decider.test.mjs`는 10개 통과했고 `npm run fixture:7`도 정상 `allow`·복합 `step_up`을 확인했습니다. 이는 로컬 가상 연습이며 심판의 재제출 통과 결과가 아닙니다.

설정 단계는 7입니다. Git origin·배포 주소·Supabase 발급자와 공개 JWKS·자료 및 Auth 허용 경로 아홉 개·쿼리 없는 원본 API 주소를 기존 구현과 대조했습니다. `judgeIssuer`와 실제 구현 규칙 세 개를 유지하며 자기 점검의 실제 HTTP 결과와 미실행 항목을 보존합니다. 후속 커밋을 GitHub에 올리는 요청이며 새 배포 확인과 묶음 재생성은 이번에 실행하지 않습니다. Vercel의 **Deployments → 최신 Production → Visit**에서 `/aleph.json`의 커밋을 확인한 뒤 방어전 화면의 **심판에게 제출하기**로 다시 확인하세요. 비밀값·토큰 원문·메모 본문과 두 제출 생성 파일은 커밋하지 않습니다.

아래는 최초 저장점 당시의 기록입니다.

## 7단계 최초 저장점 · 2026-10-13

제공된 `docs/DECIDER_REQUEST.md`에는 엔진이 검증한 `subjectId`와 `stepUp: {verified, authAgeSeconds}`가 있습니다. 그러나 같은 주체가 추가 확인 요구 뒤 새로 로그인한 시각을 조회·검증하는 호출 경로와 요청·응답 계약은 제공된 파일에서 확인하지 못했습니다. 계약은 “이 값만 보고 재인증 확인 요청을 건너뛰지 않습니다”라고 명시합니다. `at`은 요청 시각이며 새 로그인 시각으로 해석하지 않습니다. 로컬 가상 시험에서 `verified: true`와 나이를 넣는 것도 실제 재로그인 증거가 아닙니다. 현재 `api/notes.js`는 판정기를 직접 호출하지 않으며 운영 릴레이 연결도 미확인입니다.

이번에는 가상 사건 규칙만 시험했습니다. 엔진이 넘긴 `judge_fixture` 출처의 가상 신호에서 야간(22~05시), `unusual` 네트워크, 최근 60초 내 `risk_signal` 합계 20건 이상이 함께 있으면 `composite_risk_step_up` 규칙이 `step_up` / `step_up_required`로 추가 확인을 요청합니다. 지역은 이 조건에 쓰지 않습니다. 기존 미등록 기기 거부와 출처·누락 입력 검사를 유지하며 재인증 상태만 임의로 넣어 복합 사건을 허용하지 않습니다. 실제 위치나 개인의 평소 접속 이력을 측정한 규칙이 아닙니다.

재실행: 저장소 터미널에서 `npm run fixture:7`. 이번 실행 출력은 다음과 같습니다.

```text
정상 사건: allow
복합 이상 사건: step_up
```

`node --test test/decider.test.mjs`도 9개 통과했습니다. 정상 허용, 복합 사건 추가 확인과 사유, 미등록 기기 `deny` / `device_not_registered`, 지역 단독 비차단, 위조 헤더·불명확한 출처 거부, 재인증 플래그만으로 추가 확인을 우회하지 않는 동작을 로컬에서 확인했습니다. 이 결과는 실제 운영 엔진·심판의 판정이 아닙니다.

저장점 검증에서 판정기·Auth·메모 API·화면·빌드·자기 점검·시작 틀의 전체 로컬 시험 58개와 `npm run fixture:7`, 기존 기기 가상 연습 `npm run decider:test`, `npm run build -- --local`이 통과했습니다. 7단계 배포 식별 자동 생성과 정적 메모 제거를 시험했으며 이 로컬 검증을 실제 배포나 엔진의 재로그인 확인으로 보고하지 않습니다.

**미실행:** 실제 자료 요청의 재로그인 전 차단, 같은 주체의 새 로그인 시각 검증, 새 요청 재판정·허용. 해당 확인 계약과 엔진 연결이 준비된 환경에서만 실측합니다. 현재 화면에서 누를 재인증 확인 흐름은 연결되지 않았으므로 기존 로그인 화면 조작으로 이 세 항목을 통과했다고 기록하지 않습니다. 토큰 원문은 기록하지 않았습니다.

저장점 설정 대조: `aleph.config.json`의 단계는 7이며 Git origin과 같은 저장소 주소, 기존 Vercel 배포 주소, Supabase 발급자·대상·JWKS, 자료 경로 다섯 개와 Auth 경로 네 개, 쿼리 없는 원본 HTTPS 경로를 구현과 대조했습니다. `judgeIssuer`는 유지합니다. `RULE_IDS`에는 실제 구현된 기본 거부·기기 등록·복합 사건 추가 확인 규칙 세 개만 있습니다. 앞 단계 화면 로그인·소유자 검사·서버 전용 설정·학습 DB 자료와 권한을 보존했습니다.

제출 묶음 재생성은 `npm run bundle`입니다. 7단계 자기 점검은 공개 배포에 비로그인 HTTP 요청 8건을 보내며 로컬 가상 시험 결과를 실제 엔진 결과로 넣지 않습니다. 전체 기록 18개 중 실제 로그인·DB·기기·추가 확인 관련 10개는 미실행으로 남깁니다. GitHub 업로드와 새 배포는 이번 저장점 요청에서 실행하지 않습니다. Vercel의 **Deployments → 최신 Production → Visit**에서 화면을 열고 `/aleph.json`의 단계·커밋을 제출 묶음과 대조해야 합니다. 배포 단계·커밋 불일치는 그대로 기록하며 현재 배포를 7단계 완료라고 쓰지 않습니다. `bundle-notes.json`과 `artifacts/submission.json`은 커밋하지 않으며 비밀값·메모 본문을 묶음에서 제외합니다. 과거 공개 커밋·옛 배포의 노출은 해소됐다고 기록하지 않습니다. 아래는 이전 저장점 당시의 기록입니다.

## 6단계 저장점 · 2026-10-13

`docs/DECIDER_REQUEST.md`의 계약에 따라 엔진이 확인한 최상위 `deviceRegistered`를 사용합니다. `subjectId`는 가명 주체 ID이며 Supabase 사용자 UUID와 직접 비교하지 않습니다. 등록 여부가 엄격히 true인 `notes` 서비스 GET 읽기만 `device_registered` 규칙으로 허용합니다. 미등록·누락·잘못된 값은 deny와 `device_not_registered`로 거부하고, 등록된 기기의 쓰기·다른 서비스 요청은 기존 기본 거부를 유지합니다. 응답 다섯 항목과 `decide(request)` 계약은 유지합니다.

확인 순서:

1. 저장소 폴더의 터미널에서 `npm run decider:test`를 실행합니다. 따로 설치할 접속 프로그램이나 설치 명령은 없습니다.
2. 출력의 **등록 기기의 정상 요청**과 **미등록 기기의 가상 요청**이 모두 통과인지 확인합니다. 미등록 요청의 “통과”는 자료 읽기 허용이 아니라, deny와 `device_not_registered`를 반환하는 검사가 통과했다는 뜻입니다.
3. 실제 운영 릴레이가 연결된 뒤에는 등록한 기기로 자료실 화면을 여는 정상 흐름을 확인합니다. 실제 미등록 기기 공격은 심판이 맡으며 학생의 가상 요청 시험으로 대신하지 않습니다.

이번 실행의 원래 시험 출력:

```text
통과 · 등록 기기의 정상 요청
통과 · 미등록 기기의 가상 요청
이 명령은 가상 요청으로 연습하며 심판 통과 증거가 아닙니다.
```

같은 판정기에 가상 요청을 별도로 전달해 응답 값도 확인했습니다. 등록 요청은 `allow` / `approved`, 미등록 요청은 `deny` / `device_not_registered`이며 두 응답의 규칙 ID는 `device_registered`입니다. 이는 로컬 가상 요청 결과이며 실제 기기 등록·운영 릴레이 연결·심판 통과 증거가 아닙니다. 인증서·CA·서명 키는 만들지 않았습니다. 판정기 변경과 앞선 README 확인 기록을 이번 저장점에 포함하며 앞 단계 로그인·소유자 검사·공개 키 제거·DB 자료와 권한은 보존합니다. 아래 내용은 이전 단계 기록입니다.

저장점 설정 대조: 단계는 6이며 실제 Git origin과 같은 저장소 주소·기존 Vercel 배포 주소, Supabase 발급자·대상·JWKS, 실제 자료 경로 다섯 개와 Auth 경로 네 개, 쿼리 없는 원본 HTTPS 자료 경로를 유지합니다. `judgeIssuer`와 `restoreRoute: null`은 변경하지 않았습니다. `RULE_IDS`의 `device_registered`는 새 읽기 허용·미등록 거부를 나타내며 `starter.deny`는 나머지 요청의 실제 기본 거부로 유지합니다.

묶음 재생성 명령은 `npm run bundle`입니다. 자기 점검은 `/data.json`, 무로그인 메모 API GET·POST·PUT·DELETE, `/aleph.json`, 첫 화면 보안 헤더에 실제 요청을 보냅니다. 실제 등록·미등록 기기 요청은 보내지 않으므로 미실행으로 남깁니다. 현재 메모 서버 함수는 판정기를 직접 호출하지 않으며 운영 릴레이가 연결됐다는 증거도 아직 없으므로 기존 공개 Vercel 주소에 대한 로그인 거부 결과를 기기 차단으로 해석하지 않습니다. 접속 프로그램 설치나 새 인증서·CA·키 발급은 이번 작업에 없습니다.

6단계 저장점 생성 후 사용자 요청으로 GitHub main에 올렸습니다. 2026-10-13 후속 확인에서 로컬 HEAD·GitHub main·공개 배포 `/aleph.json`이 모두 저장점 `129071e6c2fee64f9439428b07fc9b375ee24c38`를 가리키고 배포 단계도 6이며 저장소 주소도 일치했습니다. 기록 정리 커밋 이후에는 `/aleph.json`의 커밋을 최신 GitHub main과 다시 대조해 제출 묶음을 재생성합니다. 이 배포 식별 확인을 실제 기기 등록·운영 릴레이 연결이나 심판 통과로 해석하지 않습니다. `bundle-notes.json`과 `artifacts/submission.json`은 커밋하지 않으며 비밀값·메모 본문도 묶음에 넣지 않습니다. 과거 공개 커밋·옛 배포의 노출은 해소됐다고 기록하지 않습니다.

저장점 검증: 판정기·Auth·메모 API·화면·빌드·자기 점검·시작 틀 시험 48개, `npm run decider:test`의 두 가상 요청, `npm run build -- --local`이 통과했습니다. 판정기는 등록 기기 읽기 허용, 미등록·누락·잘못된 값의 거부, 등록 기기의 쓰기·다른 서비스 기본 거부를 확인했습니다. 6단계 자기 점검은 실제 HTTP 결과와 미실행 기기 요청을 구분하며 빌드는 정적 메모 제거와 배포 식별 생성을 유지합니다. 로컬 시험을 실제 기기나 심판 판정으로 보고하지 않습니다.

## 5단계 공개 키 제거 가점 · 구현

기본 상태에서 학생이 A의 네 메모와 B의 한 시험 메모 목록 분리, A/B 각각의 정상 CRUD를 확인했습니다. 공개 키로 원본 메모 테이블을 읽은 실제 요청은 401 JSON 권한 오류 42501이며 메모를 반환하지 않았습니다. 5단계 커밋 `1827f9d`의 GitHub push·Vercel 배포와 배포 식별 일치, 무로그인 401 JSON·nosniff를 확인한 뒤 가점 작업을 시작했습니다. 실제 A/B 상대 ID의 한 건 접근 요청은 여전히 별도 미실행입니다.

화면에서 Supabase 공개 연결 파일과 브라우저 SDK를 제거했습니다. 로그인·로그아웃·세션 확인·갱신은 `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/api/auth/refresh`로 요청하며 Vercel rewrite가 기존 `api/notes.js` 하나로 모읍니다. 서버 Auth 처리는 `src/auth-handler.mjs`에서 공식 SDK의 `signInWithPassword`, `refreshSession`, `setSession`, `signOut({scope: 'local'})`을 사용합니다. 새 서버 환경변수는 필요 없으며 기존 서버 전용 URL·키를 사용합니다. 로그인 JSON 응답에는 검증된 사용자 UUID만 포함하고 키·비밀번호·세션 토큰을 넣지 않습니다. 실패는 허용 목록의 오류 코드만 전달해 화면에서 안전한 이유를 표시합니다.

SDK가 발급한 세션은 Secure·HttpOnly·SameSite=Lax·Path=/·Domain 없는 `__Host-` 쿠키 두 개로 전달하며 브라우저 JS가 토큰을 읽거나 만들지 않습니다. 갱신과 로그인·로그아웃은 브라우저에서 같은 세션 잠금으로 직렬화해 늦은 갱신 응답이 로그아웃 쿠키를 다시 살리지 않게 합니다. 다른 탭과 상태 변경은 토큰 없는 알림과 서버 재확인으로 반영합니다. 새 버전에서는 기존 SDK 저장 세션을 가져오지 않으므로 같은 시험 계정으로 다시 로그인해야 합니다.

메모 API는 Cookie 토큰도 변경하지 않은 `src/verify-login.mjs`에 전달해 검증하며 기존 Bearer 학생·심판 요청도 유지합니다. 쿠키를 사용하는 변경 요청과 Auth POST는 같은 출처 Origin을 확인합니다. 브라우저 userId·role·owner_id는 권한 근거로 쓰지 않고 기존 소유자 조건·CRUD 응답 계약·service_role DB 접속을 유지합니다. RLS와 DB 권한·메모 자료는 변경하지 않았습니다. `allowedRoutes`에 기존 자료 경로 다섯 개와 실제 Auth 경로 네 개를 기록하고 `judgeIssuer`·원본 자료 경로·기본 판정 규칙은 보존합니다.

검증 명령: `node --test test/auth.test.mjs test/auth-ui.test.mjs test/notes.test.mjs test/r5.test.mjs test/package-starter.test.mjs`. 새 배포에서 **A 로그인 → 조회 → 추가 → 수정 → 삭제 → 로그아웃 → B 로그인**을 다시 확인합니다. 자기 자료는 정상이고 상대 자료는 404, 무로그인은 401 JSON이어야 합니다. 첫 화면·현재 JS·폐기한 연결 파일에 공개 키가 남지 않아야 합니다. 로그인 문제가 확인되면 이번 가점 변경 파일만 이전 기본 통과 커밋 `1827f9d`로 되돌리고 학습 DB 자료와 다른 작업을 보존합니다. 과거 공개 커밋·옛 배포의 노출은 해소됐다고 기록하지 않습니다.

가점의 로컬 시험 44개와 `npm run build -- --local`이 통과했습니다. 실제 서버 SDK·시작 틀 도우미를 합성 계정과 모의 Auth 서버로 시험해 로그인 쿠키·갱신·로그아웃·요청별 세션 분리·쿠키 CRUD·다른 출처 거부·늦은 갱신과 로그아웃 순서를 확인했습니다. 기존 심판 Bearer 흐름과 시작 틀 서버 함수 기준표도 유지합니다.

2026-10-12 새 서버 로그인 배포 `796bd51`의 실제 점검: HTML·현재 JS의 공개 키·서버 키와 기존 메모 문장 일치는 0건, 옛 연결 파일·브라우저 SDK·정적 자료 파일은 404였습니다. 무로그인 자료 API는 401 JSON, 익명 세션은 사용자 없는 200, 가상 자격 증명 로그인은 세션 쿠키 없는 401과 안전한 실패 이유, 다른 출처 로그인은 403, 첫 화면은 nosniff, `/aleph.json`은 같은 5단계 커밋으로 확인했습니다. 키 값·메모 본문·가상 비밀번호는 출력하지 않았습니다.

같은 배포에서 학생은 새로고침 후 A/B 각각의 로그인·조회·추가·수정·삭제·로그아웃과 목록 분리를 재확인하고 **A/B 모두 정상**이라고 보고했습니다. 이는 새 서버 로그인 방식의 사용자 실제 화면 확인이며 기존 SDK 방식의 결과로 대신한 것이 아닙니다. 도구의 정상 계정 요청이나 심판 판정으로 기록하지 않습니다. 타인 ID를 직접 넣는 한 건 GET·PUT·DELETE 및 소유자 변경의 실제 요청과 심판 판정은 여전히 미확인입니다. 이번 후속 변경은 확인 기록만 갱신하며 앱 코드·DB 자료·권한을 수정하지 않습니다.

## 5단계 저장점 · 2026-10-12

브라우저의 메모 목록·한 건 읽기·추가·수정·삭제는 기존 서버 함수 `/api/notes`와 `/api/notes/:id`만 호출합니다. Supabase 자료를 직접 읽거나 고치는 브라우저 호출은 없어서 화면 코드는 수정하지 않았습니다. 공식 SDK의 로그인·로그아웃·세션 갱신 Auth 호출은 유지합니다. 서버는 기존 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`와 변경하지 않은 `src/verify-login.mjs`로 로그인과 소유자를 검사하며 자료 API 계약도 보존합니다.

학생이 검토·실행할 학습용 SQL을 제안했고, 이후 학생의 권한 결과 화면에서 `public.vault_notes`의 PUBLIC·anon·authenticated CRUD가 모두 false, service_role CRUD는 모두 true인 것을 확인했습니다. 화면 오른쪽의 일부 권한은 잘렸으므로 모든 권한을 독립적으로 조회한 결과로 기록하지 않습니다. 학생은 권한 회수 후 A 로그인·조회·추가·수정·삭제가 모두 문제없이 된다고 확인했습니다. 이는 사용자 화면 보고이며 도구가 실제 A 요청을 보낸 결과나 심판 판정은 아닙니다. B의 본인 CRUD·A/B 교차 접근·원본 anon 키 직접 요청은 미실행입니다. 다른 테이블과 메모 행은 이번 코드 작업에서 변경하지 않았습니다.

저장점 설정 대조: `step`은 5, 저장소·실제 Vercel 주소와 Supabase 발급자·대상·JWKS 주소는 기존 값입니다. `originalApiUrl`은 같은 프로젝트의 쿼리 없는 HTTPS 경로 `https://ytvrtibeicludqdgeltt.supabase.co/rest/v1/vault_notes`입니다. `allowedRoutes`는 `GET /api/notes`, `POST /api/notes`, `GET /api/notes/:id`, `PUT /api/notes/:id`, `DELETE /api/notes/:id` 다섯 개입니다. `judgeIssuer`와 `restoreRoute: null`, 구현된 기본 거부 규칙 `starter.deny`는 보존합니다. API 로그인 검사를 판정기 규칙으로 추가하지 않았습니다.

서버 전용 키의 DB 역할은 service_role이며 RLS를 우회하므로 서버 함수의 로그인·소유자 검사를 계속 유지합니다. 기존 RLS·소유자 정책은 삭제하지 않았고 학생이 실행한 SQL은 이 메모 테이블의 직접 권한 회수만 대상으로 했습니다. 권한 회수 SQL과 결과에 메모 본문·비밀값을 포함하지 않으며 원본 anon 키 요청은 심판 확인으로 남깁니다.

다시 실행: `npm run bundle`. 자기 점검은 정적 `/data.json` 제거, 무로그인 메모 목록·한 건 GET·POST·PUT·DELETE의 JSON 거부, 배포 `/aleph.json`, 첫 화면의 nosniff 헤더에 실제 요청을 보냅니다. 유효한 메모 쓰기를 시도하지 않고 응답 메모 본문을 기록하지 않습니다. 실제 A/B 요청과 DB 조회 및 원본 anon 키 요청은 실행하지 않은 것으로 남기며 사용자 확인은 설명에서 구분합니다. 이 JSON 생성은 학생 자기 점검이며 심판 통과를 의미하지 않습니다.

화면 재확인: 최신 배포에서 **A 로그인 → 메모 조회 → 추가 → 수정 → 삭제 → 로그아웃 → B 로그인**을 누릅니다. 본인 CRUD는 정상이어야 하며 상대 ID의 GET·PUT·DELETE는 404, PUT의 소유자 변경은 403, 무로그인은 자료 없는 401 JSON 오류여야 합니다. 권한 확인 SQL을 적용 전후 실행해 세 클라이언트 역할의 실제 권한이 모두 false이고 서버 CRUD는 true인지 대조합니다. 새 5단계 코드 배포 후에도 A/B 시험을 반복합니다.

4단계 커밋 `cdbce35`는 이후 GitHub push와 Vercel 배포가 완료됐고 공개 `/aleph.json`에서 같은 커밋·4단계를 확인했습니다. 아래 과거 절의 배포·SQL·시험 상태는 당시 기록입니다. 이번 5단계 요청은 로컬 커밋과 묶음 생성이며 push·새 배포는 실행하지 않습니다. 실제 배포 식별 결과가 4단계이면 5단계 저장점 배포와 재점검이 필요합니다. `bundle-notes.json`과 `artifacts/submission.json`은 커밋하지 않으며 옛 공개 커밋·옛 배포가 남는 동안 과거 노출이 해소됐다고 기록하지 않습니다.

저장점 로컬 검증은 `node --test test/notes.test.mjs test/auth-ui.test.mjs test/r5.test.mjs test/package-starter.test.mjs` 시험 35개와 `npm run build -- --local`이 통과했습니다. 5단계 빌드도 정적 자료 파일을 제거하고 배포 식별 자동 생성을 보존하는 것을 시험했습니다. 자기 점검의 원본 경로 검증·원본 키 요청 미실행·사용자 확인과 자동 요청 결과 구분을 확인했습니다. 서버 로그인 도우미·자료 함수·화면과 기존 DB 권한 SQL 파일은 변경하지 않았습니다.

## 4단계 저장점 · 2026-10-12

자료 API의 소유자 검사를 구현했습니다. 로그인 검증은 시작 틀의 `src/verify-login.mjs`를 그대로 사용합니다. URL·쿼리·본문의 `owner_id`, `userId`, `role`을 소유자 판단에 사용하지 않으며 검증된 사용자 ID만 DB 조건에 넣습니다. 목록과 한 건 GET은 그 ID와 `owner_id`가 일치하는 행만 반환합니다. 타인 메모의 GET·PUT·DELETE는 자료 없이 404 `NOT_FOUND`로 거부합니다. 메모가 없는 경우와 같은 응답입니다.

POST는 기존 `{id,title,body}` 계약을 유지하며 UUID 생략 시 서버가 생성합니다. 본문에 소유자 값을 보내더라도 저장할 `owner_id`는 서버 검증 결과로 정합니다. 기존 타인 ID로 추가를 시도해도 덮어쓰지 않으며 중복 ID는 409입니다. PUT 본문은 `{title,body}`입니다. PUT에 `owner_id`를 포함하면 값과 관계없이 403 `OWNER_CHANGE_FORBIDDEN`으로 거부합니다. 실제 수정은 ID와 기존 `owner_id` 조건을 한 DB 요청에 넣고 새 행의 소유자도 검증된 ID로 고정합니다. POST·PUT 결과의 소유자도 서버 내부에서 확인하며 소유자 필드는 응답에 넣지 않습니다. DELETE 역시 ID와 소유자 조건을 한 요청에 넣습니다.

한 건 GET 응답은 `{id,title,body}`, 목록은 이 객체들의 배열입니다. POST는 201 `{id}`, PUT은 200 `{id}`, DELETE는 204, 삭제 뒤 GET은 404입니다. `aleph.config.json`의 단계는 4이고 `allowedRoutes`에는 실제 경로 `GET /api/notes`, `POST /api/notes`, `GET /api/notes/:id`, `PUT /api/notes/:id`, `DELETE /api/notes/:id` 다섯 개를 유지합니다. 기존 로그인 발급자와 `judgeIssuer`도 유지합니다.

DB 권한 SQL과 RLS 정책은 실행하지 않았습니다. 학생은 앞선 학습용 소유자 연결 SQL의 성공을 알렸지만 실제 A/B 로그인과 소유자별 CRUD 시험은 아직 미실행입니다. 이후 RLS·최소 권한 SQL은 검토용으로 제안만 했으며 파일 저장·DB 적용·전후 권한 조회는 하지 않았습니다. 서버 전용 키로 DB에 접속하는 현재 API는 RLS를 우회하므로 API의 소유자 검사와 로그인 역할의 DB 정책은 각각 확인해야 합니다. 아래 3단계·2단계 항목은 당시 저장점과 점검 기록이며 현재 상태는 이 절을 기준으로 봅니다.

검증 명령: `node --test test/notes.test.mjs test/auth-ui.test.mjs test/r5.test.mjs test/package-starter.test.mjs`. 새 코드를 배포한 뒤 화면의 **A 로그인 → 자기 메모 추가 → 수정 저장 → 삭제 → 로그아웃 → B 로그인**을 확인합니다. 각 계정은 본인 메모만 관리할 수 있어야 합니다. 상대 ID의 GET·PUT·DELETE는 404, PUT 소유자 필드 추가는 403, 무로그인은 401 JSON 오류여야 합니다. 브라우저 개발자 도구에서 확인하더라도 비밀번호·토큰·키를 파일이나 제출 묶음에 복사하지 마세요.

앞선 로컬 검증은 시험 33개와 `npm run build -- --local`이 통과했습니다. 실제 시작 틀 도우미와 SDK를 사용하고 계정·서명 키는 합성 자료, 네트워크·DB는 모의 처리했습니다. A/B의 본인 CRUD, 서로의 메모 접근 거부, 소유자 필드 거부, 읽은 뒤 소유자가 바뀐 행의 수정·삭제 거부, 새 소유자 응답 검증을 확인했습니다. 실제 배포의 A/B 시험 결과로 보고하지 않습니다.

저장점 검증에서는 자기 점검의 HTML 오류·자료 섞인 오류 응답·옛 배포 구분 시험을 추가했습니다. 첫 시험 오류인 JSON 소비 후 응답 스트림의 중복 닫기만 수정한 뒤 전체 시험 34개와 `npm run build -- --local`이 통과했습니다. `public/data.json`은 생성되지 않았습니다.

저장점 설정 대조: 단계 4, Git origin과 같은 저장소 주소·기존 Vercel 주소, 위 다섯 자료 API 경로, 실제 Supabase 발급자·대상·JWKS 주소를 유지합니다. `judgeIssuer`는 변경하지 않고 5단계 전의 `originalApiUrl`은 `null`, 판정기 규칙은 구현된 기본 거부 `starter.deny`만 남깁니다. 로그인 도우미와 빌드의 `/aleph.json` 생성도 보존합니다.

다시 실행하는 명령은 `npm run bundle`입니다. 자기 점검은 `/data.json`, 무로그인 목록·한 건 GET·POST·PUT·DELETE, `/aleph.json`, 첫 화면 보안 헤더에 실제 요청을 보내고 결과만 기록합니다. 쓰기 요청에는 잘못된 UUID와 빈 본문을 사용합니다. 실제 A/B 정상·교차 접근 시험과 DB 권한 조회는 미실행으로 남깁니다. 묶음 JSON의 배포 식별 결과가 다른 단계·커밋이면 최신 배포 확인이 필요하며 묶음 생성 성공은 심판 통과를 뜻하지 않습니다. 이번 요청에서는 로컬 커밋만 만들며 GitHub push와 배포는 실행하지 않습니다. `bundle-notes.json`과 `artifacts/submission.json`은 커밋에서 제외하며 메모 본문·비밀값은 묶음에 넣지 않습니다. 옛 공개 커밋과 옛 배포가 남는 동안 과거 노출이 해소됐다고 기록하지 않습니다.

## 3단계 저장점

2026-10-12 저장점과 이후 연결 작업: 기존 로그인·서버 토큰 검사·가상 메모 CRUD 코드와 첫 화면의 `nosniff` 헤더 설정을 보존했습니다. 사용자가 제공한 공개 Project URL `https://ytvrtibeicludqdgeltt.supabase.co`로 `identityProvider.issuer`·`jwksUrl`을 기록해 제출 묶음의 첫 오류인 발급자 설정 누락을 수정했습니다. 공개 JWKS 요청은 200, 올바른 키 목록 형식과 공개키 한 개를 확인했습니다. 키 내용은 출력하지 않았습니다. 이후 같은 Project URL과 사용자 제공 공개 publishable key를 브라우저 설정에도 연결했습니다. 모의 UI 시험 9개와 API 시험 11개는 앞선 검증에서 통과했습니다. 실제 A 로그인은 미실행입니다. 다시 실행하는 명령은 `npm run build -- --local`이고, 연결·배포 후 화면의 **로그인 → 추가 → 수정 저장 → 삭제 → 로그아웃**에서 정상 흐름과 무로그인 401 JSON 거부를 확인해야 합니다.

2026-10-12 비로그인 실제 요청은 `/api/notes` 503 JSON `NOTES_NOT_CONFIGURED`(메모 미반환), `/aleph.json` 200·2단계·커밋 `0a37ab814c03b53234c7849395e59004c4196e22`였습니다. 로컬 3단계 구현과 배포는 아직 다르며 인증 보호 완료로 기록하지 않습니다. `npm run bundle`은 현재 저장점의 설정과 실제 배포 점검 결과로 다시 생성합니다. 생성 성공도 실제 로그인이나 심판 통과를 뜻하지 않습니다. 과거 공개 사본과 4단계에서 처리할 한 건 API의 소유자 검사 허점은 남아 있습니다.

로그인·로그아웃 화면, 시작 틀 도우미를 사용하는 서버 토큰 검사, 가상 메모 CRUD를 구현한 코드 저장점입니다. 브라우저 공개 연결값과 발급자 주소를 기록했습니다. 학생이 이관 SQL 실행 완료를 알렸고 서버 쓰기 권한 SQL은 학생 화면의 `Success. No rows returned`로 확인했습니다. Vercel 서버 환경변수와 실제 계정 시험은 확인 대기이므로 실제 로그인과 배포 보호가 완료된 상태는 아닙니다. 목록은 로그인 사용자 자료를 조회하고, 한 건 GET·PUT·DELETE의 소유자 검사는 4단계에서 추가합니다.

다시 실행: `npm run build -- --local`. Vercel의 공식 서버 설정과 최신 배포를 갖춘 뒤, 자료실의 **로그인 → 추가 → 수정 저장 → 삭제 → 로그아웃**을 확인합니다. 무로그인 API는 401, 삭제한 메모 조회는 404가 정상 기대 결과입니다. 브라우저의 공개 연결값은 설정했으며 실제 계정 시험은 미실행입니다. 서버 설정 미완료일 때 인증된 API 요청도 자료 없이 503으로 거부합니다.

설정 대조: 단계 3, Git 원격과 같은 저장소 주소, 기존 Vercel 주소, 자료 API 경로 다섯 개를 기록했습니다. `issuer`는 위 Project URL의 `/auth/v1`, `jwksUrl`은 발급자 주소의 `/.well-known/jwks.json`이며 `audience`는 `authenticated`입니다. `judgeIssuer`는 보존했고 5단계 전의 `originalApiUrl`은 `null`입니다. 판정기의 `starter.deny`는 기존 기본 거부 응답으로 유지합니다. API의 로그인 검사를 판정기 규칙이나 심판 통과로 기록하지 않습니다.

제출 묶음 명령은 `npm run bundle`입니다. 첫 실행에서는 발급자 정보 누락으로 중단됐으며 사용자 제공 Project URL로 그 설정만 수정했습니다. 검사는 완화하지 않습니다. 3단계 자기 점검은 정적 파일 제거와 무로그인 GET·POST·PUT·DELETE의 실제 HTTP 결과를 기록하도록 구현했습니다. 쓰기 점검은 빈 본문과 잘못된 UUID를 사용해 메모를 변경하지 않으며, 정상 A의 실제 CRUD는 미실행으로 남깁니다. `bundle-notes.json`, `artifacts/`와 가상 메모 본문을 담은 로컬 이관 SQL은 커밋에서 제외합니다. 과거 공개 커밋과 배포의 노출은 해소됐다고 기록하지 않습니다.

저장점 검증: 로컬 시험 29개와 `npm run build -- --local`이 통과했습니다. 현재 소스·정적 결과물의 기존 가상 메모 문장과 비밀값 패턴 일치는 0건이며, `public/data.json`은 없습니다. 실제 로그인·배포 보호나 과거 사본 제거를 확인한 결과는 아닙니다.

## 3단계 제출 조건 점검 · 2026-10-08

첫 `3단계 저장점` 커밋은 `b8c255f9a04e43cd5a2a23c41354c67d0e943e23`입니다. 2026-10-08 실제 배포 점검에서는 `/aleph.json`이 **2단계 저장점 `0a37ab814c03b53234c7849395e59004c4196e22`**를 가리켰습니다. 저장소 주소는 Git 원격과 일치하지만 당시 로컬 3단계 커밋과 배포는 달랐습니다. 아래 결과는 인증 헤더·쿠키 없이 보낸 GET 요청이며 실제 시크릿 창이나 A 계정의 시험 결과는 아닙니다.

| 조건 | 현재 배포 확인 | 현재 로컬 소스·남은 확인 |
| --- | --- | --- |
| 로그인 없이 자료가 보이지 않음 | `/api/notes` 503, JSON `NOTES_NOT_CONFIGURED`, 메모 미반환; `/data.json` 404 | 서버 설정 실패 결과입니다. 시크릿 창의 로그인 보호는 새 3단계 배포에서 확인해야 합니다. |
| 정상 A 로그인 후 추가·수정·삭제 | 미실행. 배포의 `/auth-config.js`, `/auth-ui.js`도 404 | 공개 연결값은 지시대로 빈 값입니다. 실제 연결·DB 권한 설정 후 A 시험이 필요합니다. |
| 브라우저에 서버 전용 키가 없음 | `/`, `/index.html`, `/aleph.json`, 404인 `/data.json` 응답에서 서버 전용 키 참조·비밀 키 패턴 0건 | 빌드한 `public/`의 네 파일에서도 같은 검사 0건. 응답 본문과 키 값은 출력하지 않았습니다. |
| 무로그인 목록 요청이 401/403과 JSON 오류 | **미충족:** 현재는 503과 JSON 오류 | 기존 API 시험에서 401 `{ "error": "LOGIN_REQUIRED" }`를 확인했습니다. 새 배포의 실제 응답 확인이 필요합니다. |
| 배포 `/aleph.json` 접근 가능 | 200, JSON, 위 2단계 커밋 | 빌드의 자동 생성 코드를 보존했습니다. 빌드 시험은 3단계 생성도 확인합니다. |
| 첫 화면에 `nosniff` 또는 CSP | **미충족:** `/` 200 응답에 두 헤더 모두 없음 | `vercel.json`의 `headers`에 전체 경로의 `X-Content-Type-Options: nosniff`를 추가했습니다. 새 배포 전에는 적용된 것으로 기록하지 않습니다. |

이번 변경은 `vercel.json`의 헤더 설정과 이 점검 기록입니다. 자료 API rewrite와 `/aleph.json` 자동 생성은 보존했습니다. `npm run build -- --local`과 `node --test test/notes.test.mjs test/r5.test.mjs`가 통과했습니다(시험 17개). 시험은 모의 DB·합성 로그인으로 실행했으며 실제 A 로그인이나 심판 점수 결과가 아닙니다. 점검한 정적 응답과 로컬 `public/`의 기존 가상 메모 문장 일치도 0건입니다. 옛 공개 커밋과 옛 배포의 노출은 해소된 것으로 기록하지 않습니다.

로컬 실행 명령: `npm run build -- --local`. 연결값을 설정하고 최신 변경을 배포한 뒤 **Vercel → Deployments → 최신 Production → Visit**에서 **시크릿 창 → 로그인 → 가상 메모 추가 → 수정 저장 → 삭제 → 로그아웃**을 확인하세요. 정상 A는 CRUD가 가능하고, 로그아웃 뒤 카드·편집기가 사라져야 합니다. 비로그인 `GET /api/notes`는 메모 없이 401/403과 JSON 오류를 반환해야 합니다. 브라우저 **개발자 도구 → Network → 첫 Document → Response Headers**에서 `X-Content-Type-Options: nosniff`를 확인하고, `/aleph.json`은 200·3단계·새 배포 커밋이어야 합니다. 503이나 옛 커밋을 위 조건 통과로 기록하지 마세요.

## 3단계 구현: 로그인과 가상 메모 CRUD

이메일·비밀번호 로그인 폼, 로그인 상태 표시, 로그아웃 버튼을 추가했습니다. 공식 `@supabase/supabase-js` SDK의 `signInWithPassword`, `signOut({ scope: 'local' })`, `getSession`, `onAuthStateChange`를 사용합니다. SDK가 세션 유지·갱신을 담당하며 비밀번호나 JWT를 직접 생성하거나 별도로 저장·출력하지 않습니다. 제출을 마치면 비밀번호 입력칸을 지웁니다. 로그인 실패는 잘못된 자격 증명, 이메일 미인증, 연결 실패 등의 이유를 화면에 표시하며 원본 오류와 세션 내용은 출력하지 않습니다.

처음에는 사용자 지시에 따라 `public/auth-config.js`의 공개 연결값을 비워 두었습니다. 실제 프로젝트 생성 후 제공받은 Project URL `https://ytvrtibeicludqdgeltt.supabase.co`와 공개 publishable key를 브라우저 설정에도 연결했습니다. 로그인·로그아웃은 공식 SDK가 담당하며 실제 A 계정 시험은 아직 미실행입니다. 브라우저 설정에는 공개 연결값만 있고 서버 전용 키, 비밀번호, JWT는 넣지 않습니다. 공식 SDK의 고정된 npm 버전은 빌드할 때 `/vendor/supabase.js`로 복사하며 외부 CDN은 사용하지 않습니다.

2026-10-12 공개 연결 점검: 공개 publishable key로 `GET /auth/v1/settings`는 200, 이메일 로그인 활성화를 확인했습니다. `GET /rest/v1/vault_notes?select=id&limit=0`은 404 `PGRST205`로 자료를 반환하지 않았습니다. 이는 공개키에서 테이블을 찾지 못한 결과이며 실제 테이블 생성·서버 권한은 SQL Editor에서 확인해야 합니다. 키 값·응답 본문·메모 문장은 출력하지 않았습니다. 연결값 설정 뒤 로컬 빌드와 모의 화면 시험 9개가 통과했습니다. 실제 A 로그인·CRUD와 새 배포 확인은 미실행입니다.

학습 DB의 이관 SQL은 학생의 실행 완료 보고, 서버 쓰기 권한 SQL은 실행 성공 화면으로 확인했습니다. 실제 DB의 행 수·RLS·권한 검증 결과는 별도로 확인해야 합니다. 테이블의 RLS와 클라이언트 권한 회수는 그대로 유지합니다. 남은 연결 설정은 사용자가 Vercel 환경변수 `SUPABASE_SECRET_KEY`에 서버 전용 secret key를 직접 등록하고 `SUPABASE_URL`에 위 공개 Project URL을 등록하는 것입니다. 시험 계정 A를 준비하고 최신 Production 배포를 확인해야 합니다. 서버 환경변수·계정 시험·새 배포 검증은 확인 대기이며, 실제 시크릿 창·A 로그인·CRUD·401 JSON 오류·첫 화면 헤더·새 `/aleph.json` 확인 전에는 조건 통과로 기록하지 않습니다.

실행 명령: `npm run build -- --local`. 연결값을 설정하고 배포한 뒤 자료실의 **계정 로그인 → 이메일·비밀번호 → 로그인**을 누르면 정상적으로 `로그인됨`과 **로그아웃** 버튼이 표시되어야 합니다. **로그아웃**을 누르면 이 브라우저의 세션이 종료되고 `로그아웃됨`과 로그인 폼으로 돌아와야 합니다. 잘못된 비밀번호나 미인증 이메일은 로그인 실패 이유가 표시되고 로그인 상태로 바뀌지 않아야 합니다. 빈 연결값은 버튼이 비활성화되어야 합니다. 실제 비밀번호는 자료실 화면에서만 직접 입력하세요.

자료 API는 시작 틀의 **`src/verify-login.mjs`를 변경 없이 사용**합니다. `createLoginVerifier`의 검증 결과가 성공한 뒤에만 DB를 조회합니다. 브라우저의 `userId`, `role`, 쿼리나 본문으로 로그인 여부를 판정하지 않습니다. 도우미가 검사하는 서명·만료·발급자·대상·역할 조건을 통과하지 못하면 401 `LOGIN_REQUIRED`로 거부하며 메모나 원본 오류, 토큰을 응답·로그에 넣지 않습니다. 서버·발급자 설정이 없거나 일치하지 않으면 자료 없이 503으로 거부합니다. 토큰이 없으면 설정 여부와 관계없이 401입니다. 도우미의 정상 학생 로그인과 심판 A/B 로그인 흐름을 보존합니다.

화면은 SDK 세션의 access token을 `Authorization: Bearer …` 헤더에 담아 `/api/notes`와 `/api/notes/:id`에 보냅니다. 세션이 없으면 API를 요청하지 않고 로그인 안내를 표시합니다. 로그인과 세션 갱신 뒤에는 자료를 다시 조회하고, 로그아웃하면 카드와 편집 입력칸을 지우며 이전 요청의 늦은 응답도 무시합니다. 화면의 세션 자체는 서버의 접근 허용 근거가 아니며 서버 도우미가 따로 검증합니다.

`aleph.config.json`의 `step`은 3이며 `identityProvider`는 `issuer`, `audience`, `jwksUrl` 칸을 가집니다. 2026-10-12 사용자가 제공한 공개 Project URL을 기준으로 **`issuer`는 `https://ytvrtibeicludqdgeltt.supabase.co/auth/v1`, `jwksUrl`은 `https://ytvrtibeicludqdgeltt.supabase.co/auth/v1/.well-known/jwks.json`**으로 기록했습니다. `audience`는 Supabase 학생 로그인용 `authenticated`입니다. 공개 JWKS 접근은 확인했지만 실제 A 토큰 검증은 미실행입니다. 서버 `SUPABASE_URL`도 같은 프로젝트여야 하며 비밀 키는 이 설정에 넣지 않습니다. `judgeIssuer`는 보존했고 `allowedRoutes`에는 아래 실제 API의 메서드·경로 다섯 개를 기록했습니다.

실행 명령: `npm run build -- --local`. 연결값을 갖추고 새로 배포한 뒤 **시크릿 창 → 자료실**에서는 메모와 편집기가 보이지 않아야 하며 비로그인 자료 API도 401이어야 합니다. **계정 로그인 → A 이메일·비밀번호 → 로그인** 뒤 **가상 메모 추가 → 제목·내용 → 추가**, 카드의 **수정 → 수정 저장**, **삭제**를 차례로 확인하세요. 새 메모 카드가 생기고 수정 내용이 반영된 뒤 삭제되어야 하며, 삭제한 ID의 GET은 404여야 합니다. **로그아웃** 뒤에는 카드와 편집기가 사라져야 합니다. 위조·만료·다른 발급자 토큰은 자료 없는 401 응답이어야 합니다. 서버 설정 미완료는 503이므로 정상 A 시험 성공으로 기록하지 않습니다. 실제 비밀번호는 화면에서만 직접 입력하세요.

### 자료 API 계약과 DB 쓰기 권한

| 메서드·경로 | 요청 | 정상 응답 |
| --- | --- | --- |
| `GET /api/notes` | Bearer 토큰 | 로그인 사용자의 `[{id,title,body}, ...]` 배열 |
| `POST /api/notes` | JSON `{id,title,body}`; UUID `id`는 선택 | 201 `{id}`; ID 생략 시 서버가 UUID 생성 |
| `GET /api/notes/:id` | UUID 경로 | 200 `{id,title,body}`; 없거나 삭제된 ID는 404 |
| `PUT /api/notes/:id` | JSON `{title,body}` | 200 `{id}`; 없는 ID는 404 |
| `DELETE /api/notes/:id` | UUID 경로 | 204, 본문 없음; 없는 ID는 404 |

`vercel.json`의 내부 rewrite가 `/api/notes/:id`를 기존 서버 함수로 연결합니다. 별도 인증 도우미를 만들지 않았습니다. 메모 본문은 기존 DB의 `content` 칸에 저장하며 API에서는 `body`로 표시합니다. 제목은 앞뒤 공백을 제거한 뒤 비어 있지 않은 200자 이내, 본문은 공백만 있지 않은 10,000자 이내 문자열이어야 합니다. 잘못된 입력은 400, JSON 이외 쓰기는 415, 중복 ID 추가는 409로 거부합니다. 원본 DB 오류와 키는 응답·로그에 출력하지 않습니다.

추가할 때 `owner_id`는 **서버 검증 도우미가 반환한 사용자 ID**로 저장합니다. 클라이언트가 보낸 `owner_id`, `userId`, `role`은 쓰지 않으며 PUT으로 소유자나 ID를 바꾸지 않습니다. 목록만 `owner_id`를 로그인 사용자 ID로 조회합니다. 2단계 SQL의 `owner_id = null`인 기존 가상 메모는 보존하며 개인 목록에 포함하지 않습니다. 이 메모들의 소유자를 임의로 배정하지 않습니다.

2단계 SQL이 서버에 SELECT만 허용했으므로, 기존 학습 테이블을 만든 프로젝트의 **Supabase → SQL Editor → New query → Run**에서 [sql/step3-server-write.sql](sql/step3-server-write.sql)을 실행합니다. `service_role`에 SELECT·INSERT·UPDATE·DELETE 권한을 부여합니다. RLS, `anon`·`authenticated` 권한과 학습 DB의 기존 자료는 그대로 유지합니다. 2026-10-12 학생의 SQL 실행 화면에서 성공을 확인했습니다.

**4단계에서 고칠 허점:** 한 건 GET·PUT·DELETE는 로그인 검사 후 메모 ID만 조회하며 소유자 조건을 검사하지 않습니다. 따라서 B가 A의 메모 ID를 알면 A의 메모를 읽고 수정·삭제할 수 있습니다. 목록을 자기 메모로 제한한 것은 이 허점을 해결한 것이 아닙니다. 소유자 검사는 이번에 추가하지 않으며 실제 A/B 계정의 타인 접근 결과는 4단계에서 별도로 기록합니다.

로컬 검증 명령은 `node --test test/auth-ui.test.mjs test/r5.test.mjs test/package-starter.test.mjs test/notes.test.mjs`입니다. API 시험은 일회용 메모리 키와 합성 계정으로 실제 도우미 및 SDK의 서명 검증을 실행하고 네트워크·DB만 모의 처리합니다. 실제 토큰·키를 파일이나 로그에 남기지 않습니다. 화면 시험은 모의 SDK로 실행합니다. CRUD 구현 시 시험 28개와 로컬 빌드가 통과했습니다. 추가·수정·삭제·삭제 뒤 404, 무로그인 네 메서드 거부, 검증된 소유자 저장, 늦은 응답 무시와 입력 오류를 확인했습니다. 합성 계정의 타인 행 접근도 의도대로 남아 있습니다. 실제 A/B 계정·시크릿 창·Vercel 라우팅·새 배포 시험은 미실행이며 DB 권한 SQL 실행은 학생의 성공 화면으로 확인했습니다. 저장점에서는 3단계 자기 점검을 구현했으며, 발급자 설정 검증이 먼저 통과해야 `npm run bundle`이 실제 요청을 실행합니다. 아래 2단계 기록은 과거 저장점의 상태입니다.

## 2단계 저장점

가상 메모 이관 SQL은 로컬에만 보관하고, 최신 Git 파일과 정적 배포에서 메모 본문을 제거했습니다. 화면은 서버 함수 `/api/notes`를 호출하도록 구현했습니다. 실제 배포 확인은 `/` 200, `/data.json` 404, `/aleph.json` 200·2단계이며, API는 503 `NOTES_NOT_CONFIGURED`라 메모 네 건의 표시를 아직 확인하지 못했습니다.

설정의 저장소 주소와 배포 주소는 Git 원격 및 `https://choi-bujang-secret-vault-nu.vercel.app`에 맞췄습니다. 로그인 발급자와 경로별 접근 정책은 미구현으로 `identityProvider: null`, `allowedRoutes: []`를 유지하며, 원본 API 주소는 5단계 전이므로 `null`입니다. 판정기의 `starter.deny`는 실제로 구현된 기본 거부 응답이며, 2단계의 로그인 보호 규칙을 의미하지 않습니다. `judgeIssuer`는 변경하지 않았습니다.

다시 실행: `npm run build -- --local`. Vercel의 **Deployments → 최신 Production 배포 → Visit**에서 화면을 확인합니다. Supabase SQL 실행과 Vercel 서버 환경변수 설정은 사용자가 공식 설정 화면에서 수행해야 합니다. 정상 기대 결과는 카드 네 개와 정적 `/data.json` 404이며, API 설정 미완료와 인증 없는 공개 함수·과거 노출은 해결된 것으로 보고하지 않습니다.

이 저장점의 제출 묶음은 `npm run bundle`로 만듭니다. 로컬 `bundle-notes.json`의 설명과 실제 배포 요청 결과를 사용하며 `artifacts/submission.json`으로 저장합니다. 두 파일, 키 값, 실명, 메모 본문과 이관 SQL은 커밋하지 않습니다. 생성 성공은 학생의 자기 점검 기록 생성이며 심판 판정이나 자료실 보호 성공을 뜻하지 않습니다.

## 이전 기록: 2단계 · 자료를 코드 밖으로 옮깁니다

기존 가상 메모 네 건의 이관 SQL은 로컬 `local-only/step2-supabase.sql`에만 보관합니다. 이 폴더는 Git에서 제외되며 정적 배포 결과물 `public/`에도 포함하지 않습니다. 새로 저장소를 복제한 경우 이 SQL 파일은 따라오지 않습니다. 원본 SQL은 본인의 로컬 파일로 보관하세요.

Supabase의 **SQL Editor → New query**에서 SQL 전체를 붙여넣고 **Run**을 누르세요. 기존 `public.vault_notes`가 있으면 변경 없이 중단하므로 처음 한 번만 실행합니다. 생성하는 테이블은 `owner_id uuid`를 가지며 외래키가 없습니다. RLS를 켜고 `PUBLIC`, `anon`, `authenticated`의 테이블 권한을 회수하며 읽기 정책을 만들지 않습니다. 확인 결과는 `note_count = 4`, `unassigned_owner_count = 4`, `owner_id`의 형식 `uuid`, `rls_enabled = true`, 두 `can_read = false`, `foreign_key_count = 0`이어야 합니다. SQL Editor는 관리 권한으로 확인하므로 행이 보이지만 클라이언트의 읽기는 권한 오류로 거부되어야 합니다. 실제 Supabase 프로젝트에서의 실행과 확인은 아직 사용자가 수행해야 합니다.

메모 조회 화면은 Vercel 서버 함수 `GET /api/notes`를 호출합니다. `api/notes.js`가 서버 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`로 Supabase의 `public.vault_notes`에서 `title`, `content`만 조회하고 카드로 표시합니다. 메모 조회는 브라우저에서 Supabase에 직접 요청하지 않으며 서버 전용 키는 브라우저 파일·함수 응답·로그에 넣지 않습니다. 실패 시에는 고정된 오류 코드만 응답하고 원본 DB 오류를 출력하지 않습니다.

Vercel 프로젝트의 **Settings → Environment Variables**에서 `SUPABASE_URL`(프로젝트 URL)과 `SUPABASE_SECRET_KEY`(서버 전용 secret key)를 Production에 직접 등록하고 **Deployments → Redeploy**로 적용하세요. 키 값은 채팅·Git·브라우저 코드에 넣지 마세요. 기존 테이블에 서버 읽기 권한이 없다면 Supabase SQL Editor에서 `grant select on table public.vault_notes to service_role;` 한 줄만 실행합니다. `anon`·`authenticated`의 권한과 RLS는 그대로 유지합니다. 처음 실행하는 로컬 이관 SQL에도 같은 서버 읽기 권한을 포함했습니다.

2단계 당시 약점: **`/api/notes`는 인증 없는 공개 주소였습니다.** 해당 코드의 서버 설정과 DB 조회가 정상화되면 비로그인 방문자도 가상 메모를 볼 수 있었습니다. 현재 로컬 3단계 소스에는 위의 토큰 검사를 연결했지만 새 배포와 실제 로그인 시험 전에는 배포의 약점이 해소됐다고 보고하지 않습니다. 공개 키로 Supabase에 직접 요청했을 때의 거부 판정은 심판이 확인합니다.

`aleph.config.json`은 2단계입니다. 2~12단계 빌드는 `public/data.json`을 만들지 않으며 이전 빌드의 해당 파일도 제거합니다. 루트 `data.json`은 비어 있고, 본문을 다시 넣으면 빌드를 실패시킵니다. Vercel 배포에서는 단계에 맞는 `/aleph.json`을 계속 생성하고 저장소·커밋·배포 URL을 검증합니다.

정상 확인: `/`에서 가상 메모 카드 네 개, `/api/notes`에서 메모 네 건, `/aleph.json`에서 2단계와 현재 커밋. 정적 `/data.json`은 404여야 합니다. 서버 환경변수가 없으면 API는 503, DB 조회에 실패하면 502, GET 이외 요청은 405로 거부합니다. 실제 배포의 카드 네 개 확인에는 사용자의 SQL 실행과 환경변수 설정이 필요합니다.

로컬 확인 명령: `npm run build -- --local`. GitHub 최신 파일과 새 정적 배포에서 기존 메모 본문이 없는지 확인하세요. 과거 커밋과 과거 배포는 이 변경으로 삭제되지 않습니다. SQL 이관과 정적 메모 제거에는 `npm run bundle`이 필요하지 않습니다. `judgeIssuer`와 다른 단계의 기능은 보존합니다.

## 최신 파일의 메모 문장 검색 절차

저장소 폴더에서 아래 **PowerShell 7** 명령 묶음을 실행하세요. `git fetch`로 GitHub의 최신 `main`을 확인하며 작업 중인 파일은 바꾸지 않습니다. 네 검색 문장은 1단계 커밋의 `data.json`에서 메모리로만 읽습니다. 문장 자체를 README나 검색 결과 파일에 복사하지 마세요. Git 검색은 `origin/main`의 추적 파일 전체를 대상으로 하며, 로컬 이관 SQL과 과거 커밋은 최신 파일 검색에 포함하지 않습니다.

```powershell
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'GitHub 최신 파일 확인 실패' }
$vaultCommit = git rev-parse origin/main
$vaultInitial = git show 8a0927400ec0d0a8ff08146db773fec80fb6d216:data.json
if ($LASTEXITCODE -ne 0) { throw '검색 기준 자료 확인 실패' }
$vaultNeedles = @(($vaultInitial | ConvertFrom-Json).notes.content)
if ($vaultNeedles.Count -ne 4) { throw '검색 기준은 메모 문장 네 개여야 합니다' }

$vaultHits = @(foreach ($vaultNeedle in $vaultNeedles) {
  git grep -l -F -e $vaultNeedle $vaultCommit -- .
  if ($LASTEXITCODE -gt 1) { throw 'Git 파일 검색 실패' }
})
$vaultHits = @($vaultHits | Sort-Object -Unique)
[pscustomobject]@{ target = 'GitHub main'; commit = $vaultCommit;
  matchedFileCount = $vaultHits.Count; matchedFiles = $vaultHits } | ConvertTo-Json -Compress

$vaultApp = 'https://choi-bujang-secret-vault-nu.vercel.app'
$vaultStaticPaths = @('/', '/data.json', '/aleph.json', '/vendor/supabase.js') + @(
  git -c core.quotePath=false ls-tree -r --name-only $vaultCommit public |
    ForEach-Object { '/' + $_.Substring('public/'.Length) }
)
$vaultStaticPaths = @($vaultStaticPaths | Select-Object -Unique)
foreach ($vaultPath in $vaultStaticPaths + @('/api/notes')) {
  try {
    $vaultResponse = Invoke-WebRequest -Uri ($vaultApp + $vaultPath) -UseBasicParsing `
      -SkipHttpErrorCheck -TimeoutSec 20 -Headers @{ 'Cache-Control' = 'no-cache' }
    $vaultResult = [ordered]@{ path = $vaultPath; status = [int]$vaultResponse.StatusCode;
      matchedSentenceCount = @($vaultNeedles | Where-Object {
        $vaultResponse.Content.Contains($_)
      }).Count }
    if ($vaultPath -eq '/aleph.json' -and $vaultResponse.StatusCode -eq 200) {
      $vaultIdentity = $vaultResponse.Content | ConvertFrom-Json
      $vaultResult.deployedCommit = $vaultIdentity.commit
      $vaultResult.matchesGitHub = $vaultIdentity.commit -eq $vaultCommit
    }
    $vaultResult | ConvertTo-Json -Compress
  } catch {
    [pscustomobject]@{ path = $vaultPath; status = 'request_failed' } | ConvertTo-Json -Compress
  }
}
```

### 문장 검색 결과 기록

2026-10-08에 README 기록 추가 전 GitHub `main`의 기능 구현 커밋 `7aedca31937ac3bad4abdb5a25b7c35aab8d55d8`과 위 배포 주소를 실제 점검했습니다. 쿠키와 인증 헤더 없이 요청했으며 키 값과 메모 본문은 출력하지 않았습니다.

| 검색 대상 | HTTP 상태 또는 기준 | 네 문장의 검색 결과 |
| --- | --- | --- |
| GitHub 최신 커밋의 추적 파일 전체 | 위 커밋 | 일치 파일 0개 |
| 현재 배포 `/` | 200 | 일치 문장 0개 |
| 현재 배포 `/index.html` | 200 | 일치 문장 0개 |
| 현재 배포 `/data.json` | 404 | 파일 없음, 일치 문장 0개 |
| 현재 배포 `/aleph.json` | 200, 위 커밋과 일치, 2단계 | 일치 문장 0개 |

GitHub에서 **Code → 브랜치 main**의 최신 커밋을 확인하고, Vercel에서 **Deployments → 최신 Production 배포 → Visit**를 눌러 다시 점검하세요. `/aleph.json`의 `matchesGitHub`가 `false`면 배포가 최신 GitHub 파일과 다르므로 최신 배포 검증 완료로 적지 마세요. 요청 실패도 0건으로 세지 않습니다. 정상 결과는 최신 추적 파일과 정적 응답의 문장 검색 0건, `/data.json` 요청은 404로 거부되는 것입니다.

이 결과는 점검한 최신 파일과 현재 정적 경로의 검색 결과입니다. **옛 공개 커밋과 옛 배포가 남아 있는 한 과거 노출은 해소됐다고 쓰지 않습니다.** 이번 작업은 옛 커밋·옛 배포를 삭제하지 않았고, 최신 파일에서 문장이 사라져도 과거 공개 사본이 사라진 것을 의미하지 않습니다.

### 검색 결과와 별도로 기록하는 공개 API의 남은 약점

같은 점검에서 비로그인 `GET /api/notes`는 **503 `NOTES_NOT_CONFIGURED`**, 응답의 문장 일치는 0건이었습니다. 이는 서버 설정 검증 실패이며 인증으로 자료 읽기를 거부한 결과가 아닙니다. 실제 배포에서 메모 네 건을 읽는 성공 결과는 아직 확인하지 못했습니다.

위 2단계 점검 당시 API에는 호출자 인증과 `owner_id` 제한이 없었습니다. 현재 로컬 소스에는 호출자 토큰 검사를 연결했으며 소유자 제한은 아직 없습니다. 최신 배포의 비로그인 401과 정상 로그인 후 200을 실제 확인하기 전에는 배포의 인증 보호를 완료로 기록하지 않습니다. 정적 파일 검색 0건도 접근 보호 완료를 의미하지 않습니다. 인증된 함수 응답의 문장 검색은 정적 파일과 분리해서 기록하고, 공개 키를 이용한 Supabase 직접 요청의 거부 여부는 심판 확인 항목으로 남깁니다.

아래는 1단계 시작 틀의 흐름을 보존한 기록입니다. 현재 정적 공개 JSON 파일은 제거했습니다.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 해당 단계의 공개 상태를 점검합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
