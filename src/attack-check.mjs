// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  const ownerStage = [4, 5, 6, 7, 8].includes(config.step);
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (config.step >= 5) {
    let original;
    let issuer;
    try {
      original = new URL(config.originalApiUrl);
      issuer = new URL(config.identityProvider?.issuer);
    } catch {
      throw new Error('5단계 원본 자료 HTTPS 경로를 확인해 주세요.');
    }
    if (original.protocol !== 'https:' || original.username || original.password
        || original.search || original.hash || original.port
        || original.origin !== issuer.origin || original.pathname !== '/rest/v1/vault_notes') {
      throw new Error('5단계 원본 자료 경로는 같은 Supabase 프로젝트의 쿼리 없는 HTTPS 메모 테이블 주소여야 합니다.');
    }
  }
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  if (config.step === 3 || ownerStage) {
    const results = [{ attackId: 'anonymous_static_note_read', expected: '정적 /data.json 파일 없음',
      observed: response.status === 404 ? '정적 자료 요청이 HTTP 404로 거부됨'
        : `정적 자료 제거 점검 실패 (HTTP ${response.status})` }];
    // Invalid IDs and empty bodies cannot change a note even if login protection fails.
    for (const [method, path] of [
      ['GET', '/api/notes'], ['POST', '/api/notes'],
      ['PUT', '/api/notes/not-a-uuid'], ['DELETE', '/api/notes/not-a-uuid'],
      ...(ownerStage ? [['GET', '/api/notes/not-a-uuid']] : []),
    ]) {
      let observed;
      try {
        const result = await fetch(new URL(path, app), {
          method, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000),
          ...(['POST', 'PUT'].includes(method)
            ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
        });
        let jsonDenial = false;
        if (ownerStage && /^application\/json(?:\s*;|$)/iu.test(result.headers.get('content-type') ?? '')) {
          try {
            const data = await result.json();
            jsonDenial = data && !Array.isArray(data) && Object.keys(data).join(',') === 'error'
              && typeof data.error === 'string' && data.error.length > 0;
          } catch { /* HTML or invalid JSON must not count as a JSON denial. */ }
        }
        const denied = ownerStage
          ? [401, 403].includes(result.status) && jsonDenial : result.status === 401;
        observed = denied ? `비로그인 ${method} 요청이 HTTP ${result.status}${ownerStage ? ' JSON 오류로' : '로'} 거부됨`
          : `비로그인 ${method} 거부 점검 실패 (HTTP ${result.status})`;
        if (!result.bodyUsed) await result.body?.cancel();
      } catch {
        observed = `비로그인 ${method} 점검 요청 실패`;
      }
      results.push({ attackId: `anonymous_note_${method.toLowerCase()}${path.endsWith('not-a-uuid') && method === 'GET' ? '_single' : ''}`,
        expected: `비로그인 ${method} 요청은 자료 없이 HTTP ${ownerStage ? '401/403 JSON 오류' : '401'}`, observed });
    }
    if (ownerStage) {
      let identityObserved;
      try {
        const identityResponse = await fetch(new URL('/aleph.json', app), {
          credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        const identity = identityResponse.ok ? await identityResponse.json() : null;
        const valid = Number.isInteger(identity?.step) && /^[a-f0-9]{40}$/iu.test(identity?.commit ?? '');
        identityObserved = valid
          ? `HTTP ${identityResponse.status}, 배포 단계 ${identity.step}, 커밋 ${identity.commit}; 설정 단계·저장소 ${identity.step === config.step && identity.repoUrl?.toLowerCase() === config.repoUrl?.toLowerCase() ? '일치' : '불일치'}`
          : `배포 식별 점검 실패 (HTTP ${identityResponse.status})`;
      } catch { identityObserved = '배포 식별 점검 요청 실패'; }
      results.push({ attackId: 'deployment_identity', expected: `/aleph.json 200, ${config.step}단계와 같은 저장소; 제출 커밋 대조 필요`, observed: identityObserved });
      let headerObserved;
      try {
        const page = await fetch(app, {
          credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000),
        });
        headerObserved = page.status === 200 && page.headers.get('x-content-type-options')?.toLowerCase() === 'nosniff'
          ? '첫 화면 HTTP 200, nosniff 헤더 확인' : `첫 화면 보안 헤더 점검 실패 (HTTP ${page.status})`;
        await page.body?.cancel();
      } catch { headerObserved = '첫 화면 보안 헤더 점검 요청 실패'; }
      results.push({ attackId: 'document_security_header', expected: '첫 화면 HTTP 200, X-Content-Type-Options: nosniff', observed: headerObserved });
      if (config.step >= 5) {
        results.push(
          { attackId: 'authenticated_a_note_crud', expected: '직접 DB 권한 회수 후에도 A의 화면 조회·추가·수정·삭제 성공',
            observed: '미실행: 이번 자동 점검은 실제 A 로그인 요청을 보내지 않음. 사용자 화면 성공 보고는 README와 설명에 별도 기록' },
          { attackId: 'authenticated_b_note_crud', expected: '직접 DB 권한 회수 후에도 B의 본인 메모 CRUD 성공',
            observed: '미실행: 실제 B 로그인 요청을 보내지 않음' },
          { attackId: 'cross_owner_access', expected: '타인 GET·PUT·DELETE 404, PUT owner_id 변경 403; 자료와 소유자 보존',
            observed: '미실행: 실제 A/B 교차 접근·소유자 변경 요청을 보내지 않음' },
          { attackId: 'database_direct_privilege', expected: 'PUBLIC·anon·authenticated의 메모 테이블 직접 권한 없음; service_role CRUD 유지',
            observed: '미실행: 도구로 DB 권한을 조회하지 않음. 사용자 권한 결과 화면 확인은 README와 설명에 별도 기록' },
          { attackId: 'anonymous_original_note_read', expected: '원본 자료 경로에 anon 키로 직접 요청하면 자료 없이 거부',
            observed: '미실행: 원본 anon 키 요청은 심판 확인 항목. 학생 자기 점검에서 키를 요청하거나 원본에 보내지 않음' },
        );
        if (config.step >= 6) {
          results.push(
            { attackId: 'registered_device_note_read', expected: '실제 엔진이 확인한 등록 기기로 자료실 읽기 허용',
              observed: '미실행: 실제 등록 기기와 운영 릴레이를 통한 요청을 보내지 않음. 판정기 가상 연습 결과와 구분' },
            { attackId: 'unregistered_device_note_read', expected: '미등록 기기 요청은 deny와 device_not_registered로 거부',
              observed: '미실행: 실제 미등록 기기 공격은 심판 확인 항목. 로컬 가상 요청을 운영 공격 결과로 기록하지 않음' },
          );
        }
        if (config.step >= 7) {
          results.push(
            { attackId: 'composite_risk_step_up', expected: '엔진의 복합 가상 이상 요청은 step_up와 step_up_required로 추가 확인',
              observed: '미실행: 실제 엔진 요청을 보내지 않음. 로컬 fixture:7 결과는 README에 별도 기록' },
            { attackId: 'step_up_pending_note_read', expected: '계약이 준비된 환경에서 재로그인 확인 전 자료 요청 차단',
              observed: '미실행: 같은 주체의 새 로그인 시각 확인 호출 계약과 운영 릴레이 연결이 제공되지 않음' },
            { attackId: 'step_up_reauthenticated_note_read', expected: '같은 주체의 새 로그인 시각 검증 뒤 새 요청을 재판정하여 정상 읽기 허용',
              observed: '미실행: 실제 재로그인 확인·새 요청을 보내지 않음. stepUp 플래그를 실제 로그인 증거로 기록하지 않음' },
          );
        }
        if (config.step === 8) {
          results.push(
            { attackId: 'resource_zone_access', expected: '본인 메모 읽기·수정 허용, 타인 메모·미등록 경로·기능 쿼리 거부; API에서 소유자 재확인',
              observed: '미실행: 실제 A/B 직접 API·엔진 구역 요청을 보내지 않음. 소유권 연결 계약은 없으며 서버 관리 정책은 실제 미설정. 정책이 없으면 UUID 메모 읽기·수정 거부' },
            { attackId: 'instructor_notice_update', expected: '서버가 확인한 강사만 공지 수정, 일반 학생의 직접 API 수정은 거부',
              observed: '미실행: 공지 API의 서버 승인 권한·DB 소유자 검사 구현. 실제 서버 정책·공지 테이블은 미설정이며 실제 공지 수정 성공은 미확인. 본문 role로 권한을 만들지 않음' },
          );
        }
        return results;
      }
      results.push(
        { attackId: 'authenticated_ab_own_crud', expected: 'A/B 각각 본인 목록·한 건 조회·추가·수정·삭제 성공, 삭제 뒤 GET 404',
          observed: '미실행: 실제 A/B 로그인 시험 필요. 로컬 모의 시험 결과를 실제 요청으로 기록하지 않음' },
        { attackId: 'cross_owner_access', expected: '타인 GET·PUT·DELETE 404, PUT owner_id 변경 403; 자료와 소유자 보존',
          observed: '미실행: 실제 A/B 교차 접근·소유자 변경 요청을 아직 보내지 않음' },
        { attackId: 'database_least_privilege', expected: 'anon 권한 없음; authenticated CRUD만, auth.uid()와 owner_id 일치 행만 허용',
          observed: '미실행: RLS·최소 권한 SQL은 제안만 했으며 적용 전후 DB 권한을 조회하지 않음' },
      );
      return results;
    }
    results.push({ attackId: 'authenticated_a_note_crud',
      expected: '정상 A 로그인 후 메모 CRUD 성공, 삭제 뒤 GET 404',
      observed: '미실행: 정상 A 로그인은 자료실 화면에서 직접 확인해야 함. 토큰을 파일이나 제출 묶음에 넣지 않음' });
    return results;
  }
  if (config.step === 2) {
    const apiResponse = await fetch(new URL('/api/notes', app), {
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    let fourNotes = false;
    if (apiResponse.ok) {
      try {
        const data = await apiResponse.json();
        fourNotes = Array.isArray(data?.notes) && data.notes.length === 4
          && data.notes.every(note => typeof note.title === 'string' && typeof note.content === 'string');
      } catch { /* Invalid JSON is a failed check. */ }
    }
    return [
      { attackId: 'anonymous_note_read', expected: '정적 /data.json 파일 없음',
        observed: response.status === 404 ? '정적 자료 요청이 HTTP 404로 거부됨'
          : `정적 자료 제거 점검 실패 (HTTP ${response.status})` },
      { attackId: 'public_server_note_read', expected: '공개 서버 함수에서 가상 메모 네 건을 읽음 (인증 보호 전)',
        observed: fourNotes ? '공개 서버 함수 응답에서 메모 네 건 확인'
          : `서버 함수 자료 점검 실패 (HTTP ${apiResponse.status})` },
    ];
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}
