# 9단계 탐지 연습 사건 계약

`npm run detect:test`는 학생이 작성한 `src/detect.mjs`의 `detect(events)`에 가상 조회 사건을 전달합니다. 원래 제공된 사건 계약은 다음 세 값입니다.

```js
{ at: '2026-10-01T00:00:00.000Z', method: 'GET', identity: { sub: 'learner_fixture' } }
```

원본 계약은 같은 `identity.sub`의 GET이 어느 10분 구간에서든 120건을 초과하면 `{action:'propose_revocation', reasonCode:'burst_read', subject:'해당 sub'}`를 반환합니다. 정확히 120건·다른 사용자 합산·10분 밖 사건은 `observe`입니다. 원본의 정확한 세 필드와 `identity.sub`만 있는 사건에 적용하며 불완전한 확장 사건을 필드 제거로 원본 사건으로 바꾸지 않습니다. 원본에는 기기 ID·네트워크 정보가 없으므로 이를 추측하거나 등록된 기기라고 인증하지 않습니다. 원본의 `subject`와 실제 대상 기기를 연결하는 운영 계약·집행은 미확인입니다.

사용자가 요청한 “평소와 다른 네트워크와 갑작스러운 다량 조회가 함께 나타날 때만 의심” 규칙의 로컬 시험에는 다음 가상 신호를 명시적으로 추가합니다. 이는 운영 엔진이 제공한다고 확인된 새 계약이 아닙니다.

```js
{
  at: '2026-10-01T00:00:00.000Z', method: 'GET',
  identity: { sub: 'learner_fixture' },
  deviceId: 'aaaaaaaaaaaaaaaa', deviceRegistered: true,
  signals: { source: 'judge_fixture', network: 'unusual' }
}
```

`network`는 로컬 사건에서 지정한 `usual` 또는 `unusual`입니다. 사용자별 평소 네트워크를 자동으로 학습했다고 해석하지 않습니다. `source: 'judge_fixture'`도 호출자의 신원을 인증하는 수단이 아니며 이 탐지 함수에 브라우저 입력을 직접 연결하지 않습니다.

같은 `identity.sub`·같은 등록된 가상 `deviceId`의 **`source: 'judge_fixture'`·`network: 'unusual'`인 GET** 사건이 어느 10분 구간에서든 **120건을 넘을 때만** 아래 형식의 `propose_revocation`을 돌려줍니다. 이는 의심 표시와 회수 제안일 뿐 실제 권한 회수가 아닙니다. 그 밖에는 `{ action: 'observe' }`입니다. 정확히 120건은 대상이 아닙니다. 다른 사용자·다른 기기의 사건, 평소 네트워크의 사건, GET 이외의 사건, 10분 밖의 사건을 같은 묶음으로 세지 않습니다. 네트워크 누락·출처 불명·지역 단독 정보는 의심 근거로 사용하지 않습니다. 추가 필드의 메모 내용·토큰·실명·지역은 복사하거나 출력하지 않습니다.

확장 사건의 회수 제안 대상은 등록된 가상 기기 한 개로 제한합니다. `deviceId`는 16자리 소문자 16진수이며 `deviceRegistered`가 정확히 `true`인 사건만 사용합니다. 확장 사건에 기기 정보가 없거나 잘못됐거나 미등록이면 제안하지 않습니다. 여러 기기가 각각 기준을 넘더라도 호출 한 번의 결과는 한 기기에 대한 제안 하나입니다.

확장 사건의 별도 결과는 다음 형식입니다. `subject`는 대상 기기와 연결된 가명 주체이며 사용자 전체를 회수하는 지시가 아닙니다. 단일 `deviceId`만 회수 대상으로 제안합니다. 원본 사건에는 위의 원본 결과 세 항목만 반환합니다. 정상 결과는 기존 `{ action: 'observe' }`로 유지하고 `decide(request)`의 접속 허용/거부 응답 다섯 항목은 바꾸지 않습니다.

```js
{
  action: 'propose_revocation', reasonCode: 'burst_read',
  subject: 'learner_fixture', deviceId: 'aaaaaaaaaaaaaaaa'
}
```

이 파일의 사건 모양과 등록된 기기 표시는 **로컬 연습용**입니다. 형식 검사로 실제 기기 등록 여부를 인증하는 것은 아닙니다. 브라우저의 등록 주장·사용자 번호를 신원으로 취급하지 않습니다. 운영 반 엔진이 검증한 사건과 기기 정보를 전달하고 회수 제안을 집행하는 경로는 별도로 연결·시험해야 합니다. 회수 API를 만들거나 권한을 변경하지 않으며 실제 회수 여부와 시간은 심판 확인으로 남깁니다. 이 명령의 통과를 실제 접속 차단이나 심판 판정으로 표시하지 않습니다.
