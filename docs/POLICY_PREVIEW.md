# 시험 정책 복원 전 차이 확인

`npm run policy:preview`는 파일을 읽어 비교만 합니다. 운영 환경변수·DB·판정기·권한·설정을 변경하거나 복원 API를 호출하지 않습니다. 단계 설정과 기존 화면 메뉴도 유지합니다.

비교 대상은 기존 `VAULT_ZONE_POLICY`와 같은 JSON 형식(`version: 1`, `noteOwners`, `noticeEditors`, `apiNoticeEditors`)의 별도 시험 파일입니다. 실제 서버 환경변수를 읽어 오지 않습니다. 정책 문법의 버전 1과 복원 사본의 버전 번호는 서로 다릅니다.

필요한 입력:

- `local-only/policy-safe.json`: 침해 전에 검증해 따로 보관한 정책 사본.
- `local-only/policy-trial.json`: 현재 시험 정책. 비교 방향은 현재 시험 정책에서 사본으로 되돌릴 때의 변경입니다.
- `local-only/policy-review.json`: 별도로 신뢰하는 사전 검증 기록. 정확한 항목은 `schema: "vault.policy.review.v1"`, 양의 정수 `backupVersion`, UTC ISO `verifiedAt`, 사본 원문 UTF-8 바이트의 소문자 SHA-256 `sha256`입니다.
- `--incident-at`: 실제로 기록한 침해/시험 침해 시각(UTC ISO). 사본 검증 시각은 이보다 빨라야 합니다.

검증 기록은 침해 전 검토에서 확보하고 별도로 보호한 기록이어야 합니다. 도구는 사전 안전 검토를 대신하지 않으며 `verified: true` 같은 자기 선언을 승인으로 받지 않습니다. 사본과 검증 기록을 함께 공격자가 바꿀 수 있다면 해시·시각 일치만으로 안전성과 기록 진위를 증명할 수 없습니다. 기존 서명 검증·불변 보관 체계가 연결됐다고 주장하지 않습니다. 이번 구현은 실제 사본이나 사전 검증 이력을 만들어 내지 않습니다.

실행 예시(시각은 실제 기록한 UTC 시각으로 교체):

```powershell
npm.cmd run policy:preview -- --incident-at "기록한 UTC ISO 시각"
```

다른 시험 파일은 `--backup`, `--current`, `--verification` 경로로 명시할 수 있습니다. 경로의 파일은 읽기만 하며, 개인자료나 키를 넣지 않습니다. 비교 결과에는 `restoreVersion`, `verifiedAt`, 변경 수, `add/remove/replace`와 필드 경로만 표시합니다. 사용자 ID·정책 값 전체·메모·토큰·실명은 출력하지 않습니다. 차이가 없으면 변경 수는 0입니다. 사본·검증 기록 누락, 해시 불일치, 사후 검증, 잘못된 정책은 결과 없이 비정상 종료합니다.

현재 저장소에는 실제 검증 사본과 검증 기록이 없으므로 기본 실행은 `backup_missing`으로 중단하는 것이 정상입니다. 가상 시험은 `node --test test/policy-preview.test.mjs`입니다. 성공한 미리보기 예시는 가상 파일로만 시험하며 실제 복원 성공으로 기록하지 않습니다. 미리보기는 파일을 변경하지 않으며, 시험 정책 적용은 아래 별도 절차에서만 수행합니다.

# 확인 후 시험 정책 되돌리기

복원 대상은 프로젝트 안의 `local-only/policy-trial.json` 하나로 고정합니다. 운영 환경변수·DB·API·기기 권한·`aleph.config.json`은 수정하지 않습니다. `--current`로 다른 파일을 지정하는 기능은 없습니다. 심볼릭 링크·공유 하드 링크·프로젝트 밖을 가리키는 시험 경로도 거부합니다.

1. 사본·사전 검증 기록과 현재 시험 정책을 준비하고 다음 명령으로 메모 규칙만의 변경 항목을 확인합니다. 실제 검증 자료가 없으면 중단하며 자동으로 안전 사본을 만들지 않습니다.

```powershell
npm.cmd run policy:restore -- --incident-at "기록한 UTC ISO 시각"
```

2. 출력의 `restoreVersion`, `scope: "notes"`, `changes`를 검토합니다. 표시된 `planId`는 로그인 토큰이 아닌 변경 확인번호입니다. 확인번호 없이 실행한 위 명령은 파일을 쓰지 않습니다.
3. 검토한 변경을 적용할 때만 같은 인자에 `--confirm "출력된 planId"`를 추가합니다. 실행 직전에 미리보기를 다시 표시하고 사본·검증 기록·현재 시험 정책·침해 시각이 같은지 재검사합니다. 하나라도 달라지면 기존 확인번호로 적용하지 않습니다.

```powershell
npm.cmd run policy:restore -- --incident-at "기록한 UTC ISO 시각" --confirm "검토한 planId"
```

적용하는 부분은 `noteOwners`뿐입니다. `noticeEditors`, `apiNoticeEditors`는 현재 시험 정책의 값을 유지하며 다른 서비스 파일·기존 감사 파일은 읽거나 쓰지 않습니다. 사본·검증 기록도 보존합니다. 결과는 `restored`, 이미 차이가 없으면 `unchanged`입니다. 잠금과 입력 재확인 후 임시 파일을 만들어 시험 파일 하나를 교체합니다. 잠금을 무시하는 다른 편집 프로세스까지 완벽하게 통제하는 운영 트랜잭션이라고 주장하지 않습니다.

검증: `node --test test/policy-preview.test.mjs test/policy-restore.test.mjs`. 가상 시험은 B가 A 메모를 허용하던 시험 소유권을 복원한 뒤 기존 판정기에 넣어 B→A GET·PUT 거부, A 본인 GET·PUT 허용, B 본인 GET·PUT 허용과 다른 서비스·감사 바이트 보존을 확인합니다. 이는 모의 정책의 검사이며 실제 Vercel·DB·A/B 로그인 세션을 복구한 결과가 아닙니다. 기존 화면 메뉴는 유지합니다.
