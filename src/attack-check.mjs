// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (![1, 2].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
