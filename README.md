# BYTE BACK 방어전 시작 틀 R5

이 저장소는 방어전 R5 시작 틀에서 출발했습니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 3단계 저장점

로그인·로그아웃 화면, 시작 틀 도우미를 사용하는 서버 토큰 검사, 가상 메모 CRUD를 구현한 코드 저장점입니다. 공개 연결값과 발급자 주소는 사용자 지시에 따라 비워 두었으므로 실제 로그인과 배포 보호가 완료된 저장점은 아닙니다. 목록은 로그인 사용자 자료를 조회하고, 한 건 GET·PUT·DELETE의 소유자 검사는 4단계에서 추가합니다.

다시 실행: `npm run build -- --local`. 공개 연결값·발급자 정보와 공식 서버 설정을 갖추고 DB 쓰기 권한 SQL을 실행한 뒤, 자료실의 **로그인 → 추가 → 수정 저장 → 삭제 → 로그아웃**을 확인합니다. 무로그인 API는 401, 삭제한 메모 조회는 404가 정상 기대 결과입니다. 현재 빈 설정에서는 로그인 폼이 비활성화되고 인증된 API 요청도 자료 없이 503으로 거부합니다.

설정 대조: 단계 3, Git 원격과 같은 저장소 주소, 기존 Vercel 주소, 자료 API 경로 다섯 개를 기록했습니다. `issuer`·`jwksUrl`은 설정 대기이며 `audience`는 `authenticated`입니다. `judgeIssuer`는 보존했고 5단계 전의 `originalApiUrl`은 `null`입니다. 판정기의 `starter.deny`는 기존 기본 거부 응답으로 유지합니다. API의 로그인 검사를 판정기 규칙이나 심판 통과로 기록하지 않습니다.

제출 묶음 명령은 `npm run bundle`입니다. 발급자 정보가 비어 있어 제출 전 검증을 통과할 수 없는 상태입니다. 실제 발급자를 지어내거나 검사를 완화하지 않습니다. 3단계 자기 점검은 정적 파일 제거와 무로그인 GET·POST·PUT·DELETE의 실제 HTTP 결과를 기록하도록 구현했습니다. 쓰기 점검은 빈 본문과 잘못된 UUID를 사용해 메모를 변경하지 않으며, 정상 A의 실제 CRUD는 미실행으로 남깁니다. `bundle-notes.json`, `artifacts/`와 가상 메모 본문을 담은 로컬 이관 SQL은 커밋에서 제외합니다. 과거 공개 커밋과 배포의 노출은 해소됐다고 기록하지 않습니다.

저장점 검증: 로컬 시험 29개와 `npm run build -- --local`이 통과했습니다. 현재 소스·정적 결과물의 기존 가상 메모 문장과 비밀값 패턴 일치는 0건이며, `public/data.json`은 없습니다. 실제 로그인·배포 보호나 과거 사본 제거를 확인한 결과는 아닙니다.

## 3단계 구현: 로그인과 가상 메모 CRUD

이메일·비밀번호 로그인 폼, 로그인 상태 표시, 로그아웃 버튼을 추가했습니다. 공식 `@supabase/supabase-js` SDK의 `signInWithPassword`, `signOut({ scope: 'local' })`, `getSession`, `onAuthStateChange`를 사용합니다. SDK가 세션 유지·갱신을 담당하며 비밀번호나 JWT를 직접 생성하거나 별도로 저장·출력하지 않습니다. 제출을 마치면 비밀번호 입력칸을 지웁니다. 로그인 실패는 잘못된 자격 증명, 이메일 미인증, 연결 실패 등의 이유를 화면에 표시하며 원본 오류와 세션 내용은 출력하지 않습니다.

사용자 지시에 따라 `public/auth-config.js`의 공개 Project URL과 publishable key는 **빈 값**으로 두었습니다. 이 상태에서는 로그인 폼이 비활성화되고 연결 정보가 없다는 안내가 표시되며 Supabase Auth 요청을 보내지 않습니다. 실제 A 계정의 로그인·로그아웃은 아직 확인할 수 없습니다. 연결할 때는 해당 파일에 공식 프로젝트의 공개 URL과 `sb_publishable_…` 키만 넣습니다. 서버 전용 키, 비밀번호, JWT는 넣지 않습니다. 공식 SDK의 고정된 npm 버전은 빌드할 때 `/vendor/supabase.js`로 복사하며 외부 CDN은 사용하지 않습니다.

실행 명령: `npm run build -- --local`. 연결값을 설정하고 배포한 뒤 자료실의 **계정 로그인 → 이메일·비밀번호 → 로그인**을 누르면 정상적으로 `로그인됨`과 **로그아웃** 버튼이 표시되어야 합니다. **로그아웃**을 누르면 이 브라우저의 세션이 종료되고 `로그아웃됨`과 로그인 폼으로 돌아와야 합니다. 잘못된 비밀번호나 미인증 이메일은 로그인 실패 이유가 표시되고 로그인 상태로 바뀌지 않아야 합니다. 빈 연결값은 버튼이 비활성화되어야 합니다. 실제 비밀번호는 자료실 화면에서만 직접 입력하세요.

자료 API는 시작 틀의 **`src/verify-login.mjs`를 변경 없이 사용**합니다. `createLoginVerifier`의 검증 결과가 성공한 뒤에만 DB를 조회합니다. 브라우저의 `userId`, `role`, 쿼리나 본문으로 로그인 여부를 판정하지 않습니다. 도우미가 검사하는 서명·만료·발급자·대상·역할 조건을 통과하지 못하면 401 `LOGIN_REQUIRED`로 거부하며 메모나 원본 오류, 토큰을 응답·로그에 넣지 않습니다. 서버·발급자 설정이 없거나 일치하지 않으면 자료 없이 503으로 거부합니다. 토큰이 없으면 설정 여부와 관계없이 401입니다. 도우미의 정상 학생 로그인과 심판 A/B 로그인 흐름을 보존합니다.

화면은 SDK 세션의 access token을 `Authorization: Bearer …` 헤더에 담아 `/api/notes`와 `/api/notes/:id`에 보냅니다. 세션이 없으면 API를 요청하지 않고 로그인 안내를 표시합니다. 로그인과 세션 갱신 뒤에는 자료를 다시 조회하고, 로그아웃하면 카드와 편집 입력칸을 지우며 이전 요청의 늦은 응답도 무시합니다. 화면의 세션 자체는 서버의 접근 허용 근거가 아니며 서버 도우미가 따로 검증합니다.

`aleph.config.json`의 `step`은 3이며 `identityProvider`는 `issuer`, `audience`, `jwksUrl` 칸을 가집니다. 실제 Project URL이 의도적으로 비어 있어 **`issuer`, `jwksUrl`도 빈 값으로 남겼습니다.** `audience`는 Supabase 학생 로그인용 `authenticated`입니다. 실제 발급자 주소를 검사한 것으로 보고하지 않습니다. 연결할 때 같은 공개 Project URL(끝 `/` 제외)의 `/auth/v1`을 `issuer`에, `/auth/v1/.well-known/jwks.json`을 `jwksUrl`에 기록합니다. 서버 `SUPABASE_URL`과 같은 프로젝트여야 하며 비밀 키는 이 설정에 넣지 않습니다. `judgeIssuer`는 보존했고 `allowedRoutes`에는 아래 실제 API의 메서드·경로 다섯 개를 기록했습니다.

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

2단계 SQL이 서버에 SELECT만 허용했으므로, 기존 학습 테이블을 만든 프로젝트의 **Supabase → SQL Editor → New query → Run**에서 [sql/step3-server-write.sql](sql/step3-server-write.sql)을 실행하세요. `service_role`에 SELECT·INSERT·UPDATE·DELETE 권한을 부여합니다. RLS, `anon`·`authenticated` 권한과 학습 DB의 기존 자료는 그대로 유지합니다. 실제 DB에서 이 SQL은 아직 실행하지 않았습니다.

**4단계에서 고칠 허점:** 한 건 GET·PUT·DELETE는 로그인 검사 후 메모 ID만 조회하며 소유자 조건을 검사하지 않습니다. 따라서 B가 A의 메모 ID를 알면 A의 메모를 읽고 수정·삭제할 수 있습니다. 목록을 자기 메모로 제한한 것은 이 허점을 해결한 것이 아닙니다. 소유자 검사는 이번에 추가하지 않으며 실제 A/B 계정의 타인 접근 결과는 4단계에서 별도로 기록합니다.

로컬 검증 명령은 `node --test test/auth-ui.test.mjs test/r5.test.mjs test/package-starter.test.mjs test/notes.test.mjs`입니다. API 시험은 일회용 메모리 키와 합성 계정으로 실제 도우미 및 SDK의 서명 검증을 실행하고 네트워크·DB만 모의 처리합니다. 실제 토큰·키를 파일이나 로그에 남기지 않습니다. 화면 시험은 모의 SDK로 실행합니다. CRUD 구현 시 시험 28개와 로컬 빌드가 통과했습니다. 추가·수정·삭제·삭제 뒤 404, 무로그인 네 메서드 거부, 검증된 소유자 저장, 늦은 응답 무시와 입력 오류를 확인했습니다. 합성 계정의 타인 행 접근도 의도대로 남아 있습니다. 실제 A/B 계정·시크릿 창·Vercel 라우팅·새 배포 시험과 DB 권한 SQL 실행은 미실행입니다. 저장점에서는 3단계 자기 점검을 구현했으며, 발급자 설정 검증이 먼저 통과해야 `npm run bundle`이 실제 요청을 실행합니다. 아래 2단계 기록은 과거 저장점의 상태입니다.

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
