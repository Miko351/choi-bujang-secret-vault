// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2, 3].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
  if (config.step === 3) {
    const results = [{ attackId: 'anonymous_static_note_read', expected: '정적 /data.json 파일 없음',
      observed: response.status === 404 ? '정적 자료 요청이 HTTP 404로 거부됨'
        : `정적 자료 제거 점검 실패 (HTTP ${response.status})` }];
    // Invalid IDs and empty bodies cannot change a note even if login protection fails.
    for (const [method, path] of [
      ['GET', '/api/notes'], ['POST', '/api/notes'],
      ['PUT', '/api/notes/not-a-uuid'], ['DELETE', '/api/notes/not-a-uuid'],
    ]) {
      let observed;
      try {
        const result = await fetch(new URL(path, app), {
          method, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000),
          ...(['POST', 'PUT'].includes(method)
            ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
        });
        observed = result.status === 401 ? `비로그인 ${method} 요청이 HTTP 401로 거부됨`
          : `비로그인 ${method} 거부 점검 실패 (HTTP ${result.status})`;
        await result.body?.cancel();
      } catch {
        observed = `비로그인 ${method} 점검 요청 실패`;
      }
      results.push({ attackId: `anonymous_note_${method.toLowerCase()}`,
        expected: `비로그인 ${method} 요청은 자료 없이 HTTP 401`, observed });
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
