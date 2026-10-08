# BYTE BACK 방어전 시작 틀 R5

이 저장소는 방어전 R5 시작 틀에서 출발했습니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 현재 기록: 2단계 · 자료를 코드 밖으로 옮깁니다

기존 가상 메모 네 건의 이관 SQL은 로컬 `local-only/step2-supabase.sql`에만 보관합니다. 이 폴더는 Git에서 제외되며 정적 배포 결과물 `public/`에도 포함하지 않습니다. 새로 저장소를 복제한 경우 이 SQL 파일은 따라오지 않습니다. 원본 SQL은 본인의 로컬 파일로 보관하세요.

Supabase의 **SQL Editor → New query**에서 SQL 전체를 붙여넣고 **Run**을 누르세요. 기존 `public.vault_notes`가 있으면 변경 없이 중단하므로 처음 한 번만 실행합니다. 생성하는 테이블은 `owner_id uuid`를 가지며 외래키가 없습니다. RLS를 켜고 `PUBLIC`, `anon`, `authenticated`의 테이블 권한을 회수하며 읽기 정책을 만들지 않습니다. 확인 결과는 `note_count = 4`, `unassigned_owner_count = 4`, `owner_id`의 형식 `uuid`, `rls_enabled = true`, 두 `can_read = false`, `foreign_key_count = 0`이어야 합니다. SQL Editor는 관리 권한으로 확인하므로 행이 보이지만 클라이언트의 읽기는 권한 오류로 거부되어야 합니다. 실제 Supabase 프로젝트에서의 실행과 확인은 아직 사용자가 수행해야 합니다.

화면은 Vercel 서버 함수 `GET /api/notes`를 호출합니다. `api/notes.js`가 서버 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`로 Supabase의 `public.vault_notes`에서 `title`, `content`만 조회하고 카드로 표시합니다. 브라우저는 Supabase에 직접 요청하지 않으며 키는 브라우저 파일·함수 응답·로그에 넣지 않습니다. 실패 시에는 고정된 오류 코드만 응답하고 원본 DB 오류를 출력하지 않습니다.

Vercel 프로젝트의 **Settings → Environment Variables**에서 `SUPABASE_URL`(프로젝트 URL)과 `SUPABASE_SECRET_KEY`(서버 전용 secret key)를 Production에 직접 등록하고 **Deployments → Redeploy**로 적용하세요. 키 값은 채팅·Git·브라우저 코드에 넣지 마세요. 기존 테이블에 서버 읽기 권한이 없다면 Supabase SQL Editor에서 `grant select on table public.vault_notes to service_role;` 한 줄만 실행합니다. `anon`·`authenticated`의 권한과 RLS는 그대로 유지합니다. 처음 실행하는 로컬 이관 SQL에도 같은 서버 읽기 권한을 포함했습니다.

현재 약점: **`/api/notes`는 아직 인증 없는 공개 주소입니다.** 주소를 아는 비로그인 방문자도 함수가 읽어 온 가상 메모 네 건을 볼 수 있습니다. 서버에 키를 두고 정적 메모를 제거했지만 로그인과 소유자별 접근 제어를 구현한 상태는 아닙니다. 공개 키로 Supabase에 직접 요청했을 때의 거부 판정은 심판이 확인하며, 서버 함수 응답 성공만으로 그 판정을 통과했다고 보고하지 않습니다.

`aleph.config.json`은 2단계입니다. 2~12단계 빌드는 `public/data.json`을 만들지 않으며 이전 빌드의 해당 파일도 제거합니다. 루트 `data.json`은 비어 있고, 본문을 다시 넣으면 빌드를 실패시킵니다. Vercel 배포에서는 단계에 맞는 `/aleph.json`을 계속 생성하고 저장소·커밋·배포 URL을 검증합니다.

정상 확인: `/`에서 가상 메모 카드 네 개, `/api/notes`에서 메모 네 건, `/aleph.json`에서 2단계와 현재 커밋. 정적 `/data.json`은 404여야 합니다. 서버 환경변수가 없으면 API는 503, DB 조회에 실패하면 502, GET 이외 요청은 405로 거부합니다. 실제 배포의 카드 네 개 확인에는 사용자의 SQL 실행과 환경변수 설정이 필요합니다.

로컬 확인 명령: `npm run build -- --local`. GitHub 최신 파일과 새 정적 배포에서 기존 메모 본문이 없는지 확인하세요. 과거 커밋과 과거 배포는 이 변경으로 삭제되지 않습니다. SQL 이관과 정적 메모 제거에는 `npm run bundle`이 필요하지 않습니다. `judgeIssuer`와 다른 단계의 기능은 보존합니다.

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
