// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  const ownerStage = [4, 5, 6, 7, 8, 9, 10, 11].includes(config.step);
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
        if (config.step === 11) {
          const html = await page.text();
          const shell = /rel="manifest"\s+href="\/manifest.webmanifest"/u.test(html)
            && /id="device-register"/u.test(html) && /id="device-check"/u.test(html);
          headerObserved += shell ? '; 설치·기기 승인 화면 표시 확인' : '; 설치·기기 승인 화면 표시 누락';
        } else await page.body?.cancel();
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
        if (config.step >= 8) {
          results.push(
            { attackId: 'resource_zone_access', expected: '본인 메모 읽기·수정 허용, 타인 메모·미등록 경로·기능 쿼리 거부; API에서 소유자 재확인',
              observed: '미실행: 실제 A/B 직접 API·엔진 구역 요청을 보내지 않음. 소유권 연결 계약은 없으며 서버 관리 정책은 실제 미설정. 정책이 없으면 UUID 메모 읽기·수정 거부' },
            { attackId: 'instructor_notice_update', expected: '판정기는 모든 공지 쓰기 거부; API는 별도 서버 승인 권한·DB 소유자를 확인하며 일반 학생 수정 거부',
              observed: '미실행: 공지 API의 서버 승인 권한·DB 소유자 검사 구현. 실제 서버 정책·공지 테이블은 미설정이며 실제 공지 수정 성공은 미확인. 본문 role로 권한을 만들지 않음' },
          );
        }
        if (config.step >= 9) {
          // Keep the v2 limit of 20 records without representing virtual tests as HTTP evidence.
          const devices = results.find(item => item.attackId === 'registered_device_note_read');
          devices.attackId = 'device_registration_access';
          devices.expected = '엔진이 확인한 등록 기기는 읽기 허용, 미등록은 deny와 device_not_registered로 거부';
          devices.observed = '미실행: 실제 등록·미등록 기기와 운영 릴레이 요청을 보내지 않음. 로컬 연습을 실제 공격 결과로 기록하지 않음';
          results.splice(results.findIndex(item => item.attackId === 'unregistered_device_note_read'), 1);
          const confirmation = results.find(item => item.attackId === 'step_up_pending_note_read');
          confirmation.attackId = 'step_up_confirmation_access';
          confirmation.expected = '새 로그인 확인 전 자료 차단, 같은 주체의 새 로그인 시각 검증 뒤 새 요청 재판정·허용';
          confirmation.observed = '미실행: 새 로그인 시각 확인 호출 계약·운영 릴레이 연결과 실제 재로그인 요청이 확인되지 않음';
          results.splice(results.findIndex(item => item.attackId === 'step_up_reauthenticated_note_read'), 1);
          results.push(
            { attackId: 'composite_detection_proposal', expected: '확인된 가상 기기 한 개의 낯선 네트워크·10분 내 GET 120건 초과만 propose_revocation, deviceId·burst_read 포함; 정상은 observe',
              observed: '미실행: 운영 엔진 사건 전달을 확인하지 않음. 확장된 signals·기기 필드는 로컬 시험용이며 심판 계약으로 확인되지 않음' },
            { attackId: 'device_revocation_execution', expected: '심판이 제안 대상 한 기기의 실제 회수와 시간을 확인; 다른 기기와 정상 사용자 유지',
              observed: '미실행: 회수 API·기기 권한 변경·실제 회수 시간 측정을 하지 않음. 탐지 제안을 회수 완료로 기록하지 않음' },
          );
        }
        if (config.step >= 10) {
          // Group only unrun checks; preserve every actual HTTP observation within v2's limit.
          const mergeUnrun = (firstId, secondId, attackId, expected, observed) => {
            const first = results.find(item => item.attackId === firstId);
            Object.assign(first, { attackId, expected, observed });
            results.splice(results.findIndex(item => item.attackId === secondId), 1);
          };
          mergeUnrun('authenticated_a_note_crud', 'authenticated_b_note_crud', 'authenticated_ab_note_crud',
            '복구 후 A/B 각자 자기 메모 CRUD와 삭제 뒤 GET 404 유지',
            '미실행: 복구 후 실제 A/B 로그인 요청을 보내지 않음. 과거 화면 성공과 모의 시험은 별도 기록');
          mergeUnrun('database_direct_privilege', 'anonymous_original_note_read', 'database_original_access',
            'PUBLIC·anon·authenticated 직접 권한 없음, 원본 anon 요청 자료 없이 거부, 서버 CRUD 유지',
            '미실행: DB 권한 조회와 원본 anon 요청을 보내지 않음. 공개 키 요청은 심판 확인 항목');
          mergeUnrun('composite_detection_proposal', 'device_revocation_execution', 'detection_and_revocation',
            '계약에 맞는 의심 사건만 대상·이유가 있는 propose_revocation; 실제 회수·시간은 심판 확인, 정상 기기 유지',
            '미실행: 실제 사건 전달·회수·시간 측정 없음. 원본 계약과 로컬 확장 계약의 제안은 실제 기기 회수 증거가 아님');
          let observed;
          try {
            // Invalid ID and empty body cannot select or restore a real note, even if auth fails.
            const result = await fetch(new URL('/api/note-recovery/not-a-uuid', app), {
              method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000),
              headers: { 'Content-Type': 'application/json' }, body: '{}',
            });
            let denied = false;
            if ([401, 403].includes(result.status)
                && /^application\/json(?:\s*;|$)/iu.test(result.headers.get('content-type') ?? '')) {
              try {
                const data = await result.json();
                denied = data && !Array.isArray(data) && Object.keys(data).join(',') === 'error'
                  && typeof data.error === 'string' && data.error.length > 0;
              } catch { /* Never include an upstream body in the bundle. */ }
            }
            observed = denied ? `비로그인 복구 POST가 HTTP ${result.status} JSON 오류로 거부됨`
              : `비로그인 복구 거부 점검 실패 (HTTP ${result.status})`;
            if (!result.bodyUsed) await result.body?.cancel();
          } catch { observed = '비로그인 복구 점검 요청 실패'; }
          results.push(
            { attackId: 'anonymous_note_restore', expected: '비로그인 복구 POST는 자료 없이 HTTP 401/403 JSON 오류', observed },
            { attackId: 'trial_policy_restore', expected: '검증된 사본의 버전·차이 확인 후 시험 noteOwners만 복원; A 본인 허용, B→A 거부, 다른 규칙·감사 보존',
              observed: '미실행: 실제 사전 검증 사본·기록이 없어 시험 정책 적용을 하지 않음. 로컬 모의 복원은 별도 시험' },
            { attackId: 'private_b_note_restore', expected: 'B 지정 한 건의 ID·소유자·내용 해시가 비공개 사본과 일치, 다른 메모·감사 보존; 잘못된 사본·대상 거부',
              observed: '미실행: 실제 B 사본·로그인 세션이 없어 DB 복구 요청을 보내지 않음. 모의 DB 시험을 실제 복구로 기록하지 않음' },
          );
        }
        if (config.step === 11) {
          // Group only unrun items to keep all real requests within the v2 20-record limit.
          const group = (ids, attackId, expected, observed) => {
            const first = results.find(item => item.attackId === ids[0]);
            Object.assign(first,{attackId,expected,observed});
            for (const id of ids.slice(1)) results.splice(results.findIndex(item => item.attackId === id),1);
          };
          group(['device_registration_access','composite_risk_step_up','step_up_confirmation_access'],
            'engine_device_and_step_up','엔진 등록 기기 정상 허용·미등록 거부, 복합 이상 추가 확인과 새 로그인 뒤 재판정',
            '미실행: 실제 제공 엔진의 등록 기기·복합 사건·새 로그인 검증 요청을 보내지 않음. 앱 자체 WebAuthn과 별도');
          group(['resource_zone_access','instructor_notice_update'],'resource_zone_and_notice_access',
            '본인 한 건 허용, 타인·미등록 경로·기능 쿼리·판정기의 모든 공지 쓰기 거부; API도 권한 재확인',
            '미실행: 실제 A/B·엔진 구역·공지 요청을 보내지 않음. 로컬 소유자·공지 시험은 별도 기록');
          group(['trial_policy_restore','private_b_note_restore'],'policy_and_note_restore',
            '검증한 시험 정책과 B 한 건만 복원, A 정상·B→A 거부 유지, ID·소유자·해시 일치와 다른 자료·감사 보존',
            '미실행: 실제 사전 정책 사본·B 사본·세션이 없어 정책 적용·DB 복구 요청을 보내지 않음');
          let manifestObserved;
          try {
            const result = await fetch(new URL('/manifest.webmanifest',app),{
              credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000),
            });
            let valid = false;
            if (result.ok) {
              try {
                const data = await result.json();
                valid = data?.name === 'BYTE BACK 내 자료실' && data.short_name === '내 자료실'
                  && data.start_url === '/' && data.scope === '/' && data.display === 'standalone'
                  && Array.isArray(data.icons) && [192,512].every(size => data.icons.some(icon =>
                    icon.src === `/icons/vault-${size}.png` && icon.sizes === `${size}x${size}` && icon.type === 'image/png'));
              } catch { /* Never echo a manifest or error body. */ }
            }
            manifestObserved = valid ? 'manifest HTTP 200, 앱 이름·시작 주소·범위·192/512 PNG 아이콘 참조 확인; 실제 설치 미실행'
              : `설치 manifest 점검 실패 (HTTP ${result.status})`;
            if (!result.bodyUsed) await result.body?.cancel();
          } catch { manifestObserved = '설치 manifest 점검 요청 실패'; }
          results.push({attackId:'web_app_manifest',expected:'manifest에 앱 이름·같은 출처 시작 주소·standalone·192/512 아이콘 참조 포함',observed:manifestObserved});
          for (const [attackId,path,method] of [
            ['anonymous_device_status','/api/device-status','GET'],
            ['anonymous_device_registration','/api/device-registration','POST'],
          ]) {
            let observed;
            try {
              const result = await fetch(new URL(path,app),{method,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000),
                ...(method === 'POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
              let denied=false;
              if ([401,403].includes(result.status) && /^application\/json(?:\s*;|$)/iu.test(result.headers.get('content-type')??'')) {
                try {const data=await result.json();denied=data && !Array.isArray(data)
                  && Object.keys(data).join(',')==='error' && typeof data.error==='string' && data.error.length>0;}
                catch { /* An HTML denial is a failed check. */ }
              }
              observed=denied?`비로그인 기기 ${method}가 HTTP ${result.status} JSON 오류로 거부됨`
                :`비로그인 기기 요청 거부 점검 실패 (HTTP ${result.status})`;
              if (!result.bodyUsed) await result.body?.cancel();
            } catch {observed='비로그인 기기 점검 요청 실패';}
            results.push({attackId,expected:'비로그인 기기 상태·등록 요청은 자료 없이 HTTP 401/403 JSON 오류',observed});
          }
          results.push({attackId:'device_approval_flow',
            expected:'실기기 등록은 pending만 생성, 별도 서버 승인·WebAuthn 증명 뒤 자기 CRUD, 미승인·회수·다른 로그인은 자료 없이 거부',
            observed:'미실행: 실제 SQL 적용·기기 등록/승인·WebAuthn·승인 뒤 A/B 요청 없음. 로컬 SDK·모의 DB 시험과 설치 표시를 승인 증거로 쓰지 않음'});
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
