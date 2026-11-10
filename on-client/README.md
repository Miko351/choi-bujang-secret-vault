# 케셰브 보안 Agent (기반 시작 틀 0.2.21)

이 보안 Agent는 회사 직원이 자기 로그인 상태, 업무 앱 접속 결과, 최근 접속 기록과 보안 경보를 보는 보안 앱입니다. 이 개인 프로젝트는 ALEPH 13~22단계에서 만든 화면을 바탕으로 이어서 개발했습니다. 현재 프로젝트의 실행과 사용 방법은 [실행 설명서](docs/STUDENT_RUNBOOK.md), 당시의 제작 순서는 [시작 안내](docs/GETTING_STARTED_STUDENT.md)에 있습니다.

ALEPH 과정에서는 단계별 안내에 따라 student/extension.mjs를 구현하고, 화면을 직접 확인한 뒤 커밋을 제출했습니다. 당시 제작 안내는 docs/STUDENT_PROMPTS.md에 남아 있습니다. 제출 판정은 해당 커밋의 코드를 읽어 기준과 대조하는 방식이었으며, 실제 실행은 화면에서 따로 확인했습니다.

## 켜기

검수 환경은 Node.js 24.19.0이며 외부 npm 의존성이 없습니다. 이 폴더의 PowerShell에서 아래를 실행하고 PC 브라우저로 http://127.0.0.1:5189 를 엽니다. 자세한 켜기·끄기·다시 켜기는 docs/STUDENT_LAUNCH_GUIDE.md에 있습니다.

    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1

npm start도 같은 서버를 켭니다. 기본 실행은 실제 회사 시스템(기존 엔진)에 연결되지 않은 상태입니다. npm run demo는 예제 자료로 화면을 보여 줍니다. 실제 연결 여부는 별도로 확인합니다. npm run check는 student/extension.mjs의 문법만 확인합니다.

## 지킬 것

- 기존 1~3차 작업 기록과 직접 수정한 파일을 보존합니다. 새로 시작할 때는 빈 폴더를 쓰고, 기존 작업을 이어갈 때는 그 프로젝트 폴더를 씁니다.
- AI 열쇠·비밀번호·토큰을 코드, 커밋, 캡처, 도움정보에 넣지 않습니다. 주소나 열쇠를 직접 입력하는 칸도 만들지 않습니다.
- .env.example에는 비밀 없는 설정만 있습니다.

## 더 읽을 곳

- 당시 단계별 제작 안내와 프롬프트: docs/STUDENT_PROMPTS.md
- 당시 단계별 확인 항목: docs/CURRICULUM.json, docs/IMPLEMENTATION_CONTRACT.md
- 오류 코드별 해결: docs/CONNECTION_TROUBLESHOOT.md
- 시작 틀 업데이트(내 파일 보존): docs/STARTER_UPDATE.md
- 실제 회사 시스템(SDP)·앱 안 AI 연결은 각 시스템의 설정과 이용 권한이 준비된 환경에서 사용합니다. 연결 방법은 docs/SDP_HOST_CONNECTION.md와 docs/AI_SETUP_GUIDE.md에 있습니다. 로컬 시작, 실제 연결, 새 환경 재현은 각각 확인합니다.
