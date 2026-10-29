// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
export function createStudentView({ api, onChange } = {}) {
  // 관제 데이터는 이 페이지의 메모리에만 둔다. 기존 인증·판정 입력과 합치지 않는다.
  const pc = {status: 'idle', data: null, message: '', auto: false, example: false, filter: 'all', history: [], samples: []};
  let pcGeneration = 0, pcTimer = null, pcDeadline = null, pcStaleTimer = null, disposed = false;
  const opened = new Map();
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const percent = value => number(value) && value <= 100;
  const capacity = value => value?.state === 'ok' && number(value.totalBytes) && value.totalBytes > 0
    && number(value.freeBytes) && value.freeBytes <= value.totalBytes;
  const memoryOk = value => value?.state === 'ok' && number(value.totalBytes) && value.totalBytes > 0
    && number(value.usedBytes) && value.usedBytes <= value.totalBytes;
  const gib = value => (value / 1024 ** 3).toFixed(1) + ' GiB';
  const time = value => new Date(value).toLocaleString('ko-KR');
  const reasonText = metric => ({
    permission_denied: '일반 권한으로 읽을 권한이 없습니다. 권한을 높이지 않고 확인 불가로 둡니다.',
    unsupported: '이 운영체제에서 제공되지 않는 조회입니다.',
    timeout: '조회 시간이 초과됐습니다.',
    cancelled: '조회가 취소됐습니다.',
    query_failed: '제공 조회 기능이 이 항목을 읽지 못했습니다.',
    invalid_response: '응답 값이나 형식을 확인할 수 없습니다.',
    invalid_sample: 'CPU 표본의 시간 차이를 확인할 수 없습니다.',
  }[metric?.reason] ?? (metric?.state === 'ok' ? '응답 값이나 단위를 확인할 수 없습니다.' : '제공된 조회 결과가 없습니다.'));
  const sampleOf = data => {
    const m = data.metrics;
    return {at: data.measuredAt,
      cpu: m.cpu?.state === 'ok' && percent(m.cpu.usagePercent) ? m.cpu.usagePercent : null,
      memory: memoryOk(m.memory) ? m.memory.usedBytes / m.memory.totalBytes * 100 : null,
      memoryUsed: memoryOk(m.memory) ? m.memory.usedBytes : null,
      memoryTotal: memoryOk(m.memory) ? m.memory.totalBytes : null,
      drives: m.drives && ['ok', 'partial'].includes(m.drives.state) ? driveRows(data).map(d => capacity(d)
        ? {id: d.id, free: d.freeBytes, total: d.totalBytes}
        : {id: d.id, free: null, reason: reasonText(d)}) : null,
      reasons: {cpu: reasonText(m.cpu), memory: reasonText(m.memory), drives: reasonText(m.drives)},
    };
  };
  const profilesOk = value => value?.state === 'ok' && Array.isArray(value.profiles) && value.profiles.length === 3
    && ['Domain', 'Private', 'Public'].every(name => value.profiles.some(p => p.name === name && typeof p.enabled === 'boolean'));
  const driveRows = data => Array.isArray(data?.metrics?.drives?.volumes)
    ? data.metrics.drives.volumes.filter(value => typeof value?.id === 'string' && /^[A-Z]:$/.test(value.id)) : [];
  const networkOk = value => value?.state === 'ok'
    && Number.isSafeInteger(value.interfaceCount) && value.interfaceCount >= 0
    && Number.isSafeInteger(value.ipv4Count) && value.ipv4Count >= 0;
  const eventsOk = value => value?.state === 'ok'
    && Number.isSafeInteger(value.warningCount) && value.warningCount >= 0
    && Number.isSafeInteger(value.errorCount) && value.errorCount >= 0
    && value.warningCount + value.errorCount <= 5000 && value.sampleLimit === 5000
    && typeof value.truncated === 'boolean' && typeof value.since === 'string'
    && /(?:Z|[+-]\d{2}:\d{2})$/.test(value.since) && Number.isFinite(Date.parse(value.since));
  const metricChecks = data => {
    const m = data.metrics;
    return [
      ['CPU', m.cpu?.state === 'ok' && percent(m.cpu.usagePercent)],
      ['메모리', memoryOk(m.memory)],
      ['드라이브', m.drives?.state === 'ok' && driveRows(data).length > 0 && driveRows(data).every(capacity)],
      ['네트워크 구성', networkOk(m.network)],
      ['방화벽 설정', profilesOk(m.firewall)],
      ['Windows 기록', eventsOk(m.events) && Date.parse(m.events.since) <= Date.parse(data.measuredAt)],
    ];
  };
  const notify = focusKey => {
    if (disposed) return;
    // 다시 그리기 직전 학생 영역의 초점만 기억한다. 다른 영역으로 이동한 초점은 가져오지 않는다.
    const previous = document.activeElement;
    const restoreKey = previous?.getAttribute?.('data-dashboard-control') || focusKey;
    if (typeof onChange === 'function') onChange();
    if (restoreKey && typeof queueMicrotask === 'function') queueMicrotask(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      document.querySelector?.('[data-dashboard-control="' + restoreKey + '"]')?.focus();
    });
  };
  const stopTimer = () => { if (pcTimer !== null) clearTimeout(pcTimer); pcTimer = null; };
  const schedule = () => {
    stopTimer();
    if (!disposed && pc.auto && !document.hidden) pcTimer = setTimeout(() => { void readPc(); }, 10000);
  };
  const remember = row => { pc.history.unshift(row); pc.history.length = Math.min(pc.history.length, 100); };
  async function readPc() {
    if (disposed || pc.status === 'loading' || document.hidden) return;
    stopTimer(); clearTimeout(pcStaleTimer);
    const generation = ++pcGeneration;
    pc.status = 'loading'; pc.message = '이 PC에서 읽는 중입니다.'; pc.data = null; notify();
    const fail = message => {
      pc.status = 'error'; pc.data = null; pc.message = message;
      remember({kind: 'failed', at: new Date().toISOString(), summary: message, detail: '확인하지 못한 항목: CPU·메모리·드라이브·네트워크·방화벽·Windows 기록. 앱 실행 상태를 확인한 뒤 다시 조회 버튼을 직접 누르세요. 이 기록은 침해 사고 판정이 아닙니다.'});
      notify(); schedule();
    };
    pcDeadline = setTimeout(() => {
      if (generation !== pcGeneration || disposed) return;
      ++pcGeneration; fail('조회 시간이 초과됐습니다. 직접 다시 조회하세요.');
    }, 12000);
    try {
      if (typeof api?.get !== 'function') throw Error('unavailable');
      const response = await api.get('/api/pc/status');
      if (generation !== pcGeneration || disposed) return;
      clearTimeout(pcDeadline);
      const data = response?.ok === true ? response.data : null;
      const at = typeof data?.measuredAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(data.measuredAt) ? Date.parse(data.measuredAt) : NaN;
      if (data?.schema !== 'aleph.on.pc-status.v1' || data.source !== 'local-pc' || !Number.isFinite(at)
          || Date.now() - at > 60000 || at - Date.now() > 5000 || !data.metrics || typeof data.metrics !== 'object') throw Error('unverified');
      pc.data = structuredClone(data); pc.status = 'ok'; pc.message = '';
      const checks = metricChecks(pc.data), missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
      const m = pc.data.metrics;
      const cpu = m.cpu?.state === 'ok' && percent(m.cpu.usagePercent) ? m.cpu.usagePercent : null;
      const memory = memoryOk(m.memory) ? m.memory.usedBytes / m.memory.totalBytes * 100 : null;
      if (!pc.samples.some(sample => sample.at === data.measuredAt)) {
        pc.samples.push(sampleOf(pc.data));
        if (pc.samples.length > 120) pc.samples.shift();
      }
      remember({kind: missing.length ? 'partial' : 'measured', at: data.measuredAt,
        summary: '실측 ' + (checks.length - missing.length) + '/' + checks.length + '항목 · 확인 불가 ' + missing.length + '항목',
        detail: '출처: 이 PC(local-pc). ' + (missing.length ? '확인 불가: ' + missing.join(', ') + '.' : '이번 조회의 여섯 항목을 읽었습니다.')
          + ' CPU ' + (cpu === null ? '확인 불가' : cpu.toFixed(1) + '%') + ', 메모리 ' + (memory === null ? '확인 불가' : memory.toFixed(1) + '%')
          + '. Windows 기록의 값이나 건수만으로 침해·안전을 판정하지 않습니다.'});
      pcStaleTimer = setTimeout(() => { if (pc.status === 'ok') { pc.status = 'stale'; pc.message = '마지막 실측이 60초를 지났습니다. 현재 상태는 다시 확인하세요.'; notify(); } }, Math.max(1, at + 60001 - Date.now()));
      notify(); schedule();
    } catch {
      if (generation !== pcGeneration || disposed) return;
      clearTimeout(pcDeadline); fail('현재 PC 조회를 확인할 수 없습니다. 이전 값을 현재 상태로 표시하지 않습니다.');
    }
  }
  if (typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTimer();
      if (pc.status === 'loading') { ++pcGeneration; clearTimeout(pcDeadline); pc.status = 'error'; pc.message = '화면을 보지 않는 동안 조회 표시를 중단했습니다. 다시 조회하세요.'; pc.data = null; }
    } else if (pc.auto) { void readPc(); }
  });
  if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('pagehide', () => {
    disposed = true; ++pcGeneration; stopTimer(); clearTimeout(pcDeadline); clearTimeout(pcStaleTimer);
  }, {once: true});
  const button = (label, key, action) => {
    const control = node('button', label, 'btn'); control.type = 'button'; control.setAttribute('data-dashboard-control', key);
    control.addEventListener('click', action); return control;
  };
  const details = (key, label) => {
    const section = node('details'), summary = node('summary', label);
    summary.setAttribute('data-dashboard-control', 'details-' + key);
    section.open = opened.get(key) === true; section.append(summary);
    section.addEventListener('toggle', () => opened.set(key, section.open)); return section;
  };
  function comparison(data) {
    const section = node('section', undefined, 'card');
    section.setAttribute('data-dashboard-comparison', 'previous-sample');
    section.append(node('h4', '직전 실측과 비교한 변화 설명'));
    if (!data) {
      section.append(node('p', '비교 확인 불가: 현재 실측이 없습니다. 조회 중·실패·오래된 결과를 현재 비교에 사용하지 않습니다.'));
      return section;
    }
    const current = sampleOf(data), index = pc.samples.findIndex(sample => sample.at === current.at);
    const previous = index > 0 ? pc.samples[index - 1] : null;
    if (!previous) {
      section.append(node('p', '비교 확인 불가: 직전 실측 표본이 없습니다. 직접 한 번 더 조회하세요.'));
      return section;
    }
    if (Date.parse(previous.at) >= Date.parse(current.at)) {
      section.append(node('p', '비교 확인 불가: 두 표본의 시간 순서를 확인할 수 없습니다.'));
      return section;
    }
    section.append(node('p', '직전: ' + time(previous.at) + ' → 현재: ' + time(current.at)
      + ' · 서버 조회 완료 시각 기준. 값별 독립 측정 시각은 제공되지 않습니다.'));
    const list = node('ul');
    const change = (before, after, unit) => {
      const delta = after - before;
      return Math.abs(delta).toFixed(1) + ' ' + unit + (delta > 0 ? ' 증가' : delta < 0 ? ' 감소' : ' 변화 없음')
        + (delta !== 0 && Math.abs(delta) < .05 ? ' (표시 정밀도보다 작음)' : '');
    };
    for (const [key, label] of [['cpu', 'CPU 사용률'], ['memory', '메모리 사용률']]) {
      if (current[key] === null || previous[key] === null) {
        list.append(node('li', label + ': 비교 확인 불가 · '
          + (current[key] === null ? '현재: ' + current.reasons[key] : '직전: ' + previous.reasons[key])));
      } else if (key === 'memory' && current.memoryTotal !== previous.memoryTotal) {
        list.append(node('li', label + ': 비교 확인 불가 · 두 표본의 전체 메모리 용량이 다릅니다.'));
      } else {
        list.append(node('li', label + ': ' + previous[key].toFixed(1) + '% → ' + current[key].toFixed(1) + '% · '
          + change(previous[key], current[key], '퍼센트포인트(%p)')));
      }
    }
    if (current.memoryUsed !== null && previous.memoryUsed !== null && current.memoryTotal === previous.memoryTotal) {
      list.append(node('li', '메모리 사용량: ' + gib(previous.memoryUsed) + ' → ' + gib(current.memoryUsed)
        + ' · ' + change(previous.memoryUsed / 1024 ** 3, current.memoryUsed / 1024 ** 3, 'GiB')));
    }
    if (!current.drives || !previous.drives) {
      list.append(node('li', '드라이브 여유: 비교 확인 불가 · ' + (!current.drives ? '현재: ' + current.reasons.drives : '직전: ' + previous.reasons.drives)));
    } else {
      const ids = [...new Set([...previous.drives, ...current.drives].map(d => d.id))].sort();
      if (!ids.length) list.append(node('li', '드라이브 여유: 비교 확인 불가 · 두 표본에 조회 대상 드라이브가 없습니다.'));
      for (const id of ids) {
        const before = previous.drives.find(d => d.id === id), after = current.drives.find(d => d.id === id);
        const reason = !before ? '직전 표본에 이 드라이브가 없습니다.' : !after ? '현재 표본에 이 드라이브가 없습니다.'
          : before.free === null ? '직전: ' + before.reason : after.free === null ? '현재: ' + after.reason
          : before.total !== after.total ? '두 표본의 전체 용량이 달라 같은 범위인지 확인할 수 없습니다.' : null;
        list.append(node('li', id + ' 여유: ' + (reason ? '비교 확인 불가 · ' + reason
          : gib(before.free) + ' → ' + gib(after.free) + ' · ' + change(before.free / 1024 ** 3, after.free / 1024 ** 3, 'GiB'))));
      }
    }
    section.append(list, node('p', '제공 PC 조회 결과 두 개의 차이만 설명합니다. 변화만으로 원인·침해·안전을 판단하지 않습니다. 예시 값은 비교하지 않습니다.'));
    return section;
  }
  function drawTrend(samples, key, title) {
    const article = node('section', undefined, 'card'); article.append(node('h4', title + ' · 실측 추이'));
    if (!samples.length) { article.append(node('p', '수집한 실측 표본이 없습니다. 과거 구간을 예시 값으로 채우지 않습니다.')); return article; }
    const canvas = node('canvas'); canvas.width = 260; canvas.height = 140;
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', title + ' 실측 추이. 아래 표에서 시각별 값을 확인할 수 있습니다.');
    article.append(canvas, node('p', '0~100% · ' + time(samples[0].at) + ' ~ ' + time(samples[samples.length - 1].at)));
    try {
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (context) {
        context.clearRect(0, 0, 260, 140); context.strokeStyle = '#d9dde3'; context.beginPath(); context.moveTo(24, 8); context.lineTo(24, 116); context.lineTo(250, 116); context.stroke();
        context.fillStyle = '#5a6472'; context.fillText('100%', 0, 10); context.fillText('0%', 4, 128);
        let started = false;
        context.strokeStyle = key === 'cpu' ? '#2357c6' : '#6b3fb3'; context.lineWidth = 2; context.beginPath();
        samples.forEach((sample, i) => {
          if (!percent(sample[key])) { started = false; return; }
          const x = 26 + i * 220 / Math.max(1, samples.length - 1), y = 114 - sample[key] / 100 * 104;
          if (started) context.lineTo(x, y); else context.moveTo(x, y); started = true;
        }); context.stroke();
        samples.forEach((sample, i) => { if (percent(sample[key])) { context.beginPath(); context.arc(26 + i * 220 / Math.max(1, samples.length - 1), 114 - sample[key] / 100 * 104, 2, 0, Math.PI * 2); context.fillStyle = key === 'cpu' ? '#2357c6' : '#6b3fb3'; context.fill(); } });
      }
    } catch { article.append(node('p', '그래프를 표시할 수 없습니다. 아래 실측 표를 확인하세요.')); }
    return article;
  }
  const nextStep = metric => metric?.reason === 'permission_denied'
    ? '다음 행동: 일반 권한에서 확인 불가로 유지하세요. 관리자 실행이나 권한 변경은 하지 않습니다.'
    : metric?.reason === 'unsupported' ? '다음 행동: 이 환경에서는 확인 불가로 유지하세요. 지원 여부를 설명서에서 확인하세요.'
    : pc.status === 'loading' ? '다음 행동: 현재 조회 결과를 기다리세요. 중복 요청을 보내지 않습니다.'
    : '다음 행동: 앱 실행 상태를 확인하고 위쪽 다시 조회 버튼을 직접 누르세요.';
  function pcObservations(data) {
    const section = node('section', undefined, 'card'); section.setAttribute('data-dashboard-pc-observations', 'true');
    section.append(node('h4', 'PC 조회 결과 · 읽기 전용'), node('p', data ? 'PC 조회 응답 수신 · 항목별 확인 결과는 아래와 같습니다.' : 'PC 현재 조회 결과 확인 불가'));
    const m = data?.metrics ?? {};
    const show = (key, title, valid, lines, note) => {
      const article = node('section'); article.setAttribute('data-dashboard-observation', key);
      article.append(node('h5', title));
      if (valid) {
        for (const line of lines) article.append(node('p', line));
        article.append(node('p', '실측 기준 시각(서버 조회 완료): ' + time(data.measuredAt)));
      } else {
        article.append(node('p', '확인 불가 · ' + (data ? reasonText(m[key]) : pc.status === 'idle' ? '아직 조회하지 않았습니다.' : pc.status === 'loading' ? '조회 중입니다.' : pc.message || '현재 실측이 없습니다.')),
          node('p', '측정 시각: 확인 불가'), node('p', nextStep(data ? m[key] : null)));
      }
      article.append(node('p', note)); section.append(article);
    };
    show('network', '네트워크 구성', networkOk(m.network),
      ['네트워크 인터페이스 ' + m.network?.interfaceCount + '개 · IPv4 구성 ' + m.network?.ipv4Count + '개'],
      '로컬 구성 개수입니다. 인터넷 접속·SDP 연결·접근 허용을 확인한 결과가 아닙니다.');
    show('firewall', 'Windows 방화벽 프로필', profilesOk(m.firewall),
      profilesOk(m.firewall) ? ['Domain', 'Private', 'Public'].map(name => name + ': ' + (m.firewall.profiles.find(p => p.name === name).enabled ? '켜짐' : '꺼짐')) : [],
      '설정은 읽기만 합니다. 방화벽·보안 설정을 바꾸거나 관리자 권한을 요청하지 않습니다. 켜짐은 전체 보호·안전 판정이 아닙니다.');
    const eventValid = eventsOk(m.events) && data && Date.parse(m.events.since) <= Date.parse(data.measuredAt);
    show('events', '최근 Windows 기록 · System·Application 합산', eventValid,
      eventValid ? ['경고 ' + m.events.warningCount + '건 · 오류 ' + m.events.errorCount + '건',
        '조회 범위: ' + time(m.events.since) + ' ~ ' + time(data.measuredAt) + ' · 최근 24시간 기준',
        m.events.truncated ? '일부 집계 · 최대 5,000건으로 제한한 결과입니다. 전체 건수가 아닙니다.' : '최대 5,000건 범위에서 집계했습니다.'] : [],
      'Windows 경고·오류 건수는 침해나 공격 탐지 결과가 아닙니다. 확인 불가를 0건으로 바꾸지 않으며, 0건도 안전을 보장하지 않습니다.');
    section.append(node('p', '출처: 제공 PC 조회 기능(/api/pc/status). 값별 독립 측정 시각은 제공되지 않습니다.'));
    return section;
  }
  function sdpConnection({devices, sessions, mode} = {}) {
    const section = node('section', undefined, 'card'); section.setAttribute('data-dashboard-sdp', 'unknown');
    section.append(node('h4', 'SDP 연결 상태 · PC 조회와 별도'));
    const resources = [devices, sessions];
    let state = 'unknown', label = 'SDP 연결 확인 불가', reason = '현재 기기·세션 조회 결과만으로 연결을 확인할 수 없습니다.';
    if (resources.some(r => r?.status === 'loading')) {
      state = 'loading'; label = 'SDP 연결 확인 중'; reason = '제공 화면의 현재 기기·세션 조회 결과를 기다립니다. 이전 결과를 현재 상태로 표시하지 않습니다.';
    } else if (mode === 'demo' && resources.every(r => r?.mode === 'demo' && ['ok', 'error'].includes(r.status))) {
      state = 'demo'; label = '예제 자료 · 실제 SDP 연결 미확인'; reason = '예제 기기·세션 응답은 실제 SDP 연결의 증거가 아닙니다.';
    } else if (resources.some(r => r?.status === 'error' && r.error?.code === 'ENGINE_NOT_CONNECTED')
        && resources.every(r => r && ['ok', 'error'].includes(r.status) && r.mode === 'disconnected')) {
      state = 'disconnected'; label = 'SDP 미연결'; reason = '기기·세션 조회에서 서버가 ENGINE_NOT_CONNECTED를 반환했습니다. PC 조회 응답 수신과 별개입니다.';
    } else if (mode === 'connected' && resources.every(r => r?.status === 'ok' && r.mode === 'connected' && Array.isArray(r.data))) {
      state = 'connected'; label = 'SDP 조회 응답 수신(connected)'; reason = '제공 화면에서 현재 기기·세션 조회 응답을 받았습니다. 모든 업무 앱 접근 허용이나 지속 연결을 보장하지 않습니다.';
    }
    section.setAttribute('data-dashboard-sdp', state);
    section.append(node('p', label), node('p', reason),
      node('p', '판단 출처: 제공 화면의 기기·세션 조회 상태와 mode. PC 실측·방화벽 켜짐·AI 승인·진단 설정 정보로 SDP 연결을 대신 판단하지 않습니다.'),
      node('p', 'SDP 확인 시각: 이 입력에는 제공되지 않습니다. PC 측정 시각을 대신 쓰지 않습니다.'));
    return section;
  }
  function dashboard(existingStatus, sdp) {
    const root = node('div'); root.setAttribute('data-student-dashboard', 'pc-monitor');
    root.append(node('h3', '케셰브 · 내 PC 관제'), node('p', '실측은 이 PC에서 읽은 값입니다. 예시는 별도 영역에만 표시합니다. 이 화면은 보안 차단·안전 인증이 아닙니다.', 'muted'));
    const navigation = node('nav'); navigation.setAttribute('aria-label', '학생 관제 핵심 기능');
    const links = node('ul');
    for (const [key, label] of [['pc', '1. 내 PC 상태'], ['trends', '2. 실측 추이·비교'], ['history', '3. 조회 기록']]) {
      const item = node('li'), link = node('a', label); link.setAttribute('href', '#keshev-dashboard-' + key);
      link.setAttribute('data-dashboard-control', 'jump-' + key); item.append(link); links.append(item);
    }
    navigation.append(links); root.append(navigation,
      node('p', 'Tab으로 항목을 이동하고 버튼은 Enter 또는 Space로 실행하세요. 핵심 기능 바로가기는 Enter로 이동합니다.', 'muted'));
    const feature = (key, title) => {
      const section = node('section'), heading = node('h4', title);
      heading.id = 'keshev-dashboard-' + key; heading.tabIndex = -1; heading.setAttribute('data-dashboard-control', 'heading-' + key);
      section.setAttribute('aria-labelledby', heading.id); section.setAttribute('data-dashboard-feature', key); section.append(heading); return section;
    };
    const pcSection = feature('pc', '1. 내 PC 상태'); root.append(pcSection);
    const controls = node('div');
    const refresh = button(pc.status === 'loading' ? '조회 중…' : '다시 조회', 'refresh', () => { void readPc(); });
    // aria-disabled와 readPc의 중복 요청 방지를 함께 사용해 대기 중에도 키보드 초점을 유지한다.
    refresh.setAttribute('aria-disabled', pc.status === 'loading' ? 'true' : 'false');
    refresh.setAttribute('aria-describedby', 'keshev-pc-query-status');
    const autoLabel = node('label'), auto = node('input'); auto.type = 'checkbox'; auto.checked = pc.auto; auto.setAttribute('data-dashboard-control', 'auto');
    auto.addEventListener('change', () => { pc.auto = auto.checked; if (pc.auto) void readPc(); else stopTimer(); notify('auto'); }); autoLabel.append(auto, node('span', '10초마다 실측 (보이는 동안)'));
    const exampleLabel = node('label'), example = node('input'); example.type = 'checkbox'; example.checked = pc.example; example.setAttribute('data-dashboard-control', 'example');
    example.addEventListener('change', () => { pc.example = example.checked; notify('example'); }); exampleLabel.append(example, node('span', '설명용 예시 보기 (실측과 별도)'));
    controls.append(refresh, autoLabel, exampleLabel); pcSection.append(controls);
    const fresh = pc.status === 'ok' && pc.data && Date.now() - Date.parse(pc.data.measuredAt) <= 60000;
    const data = fresh ? pc.data : null, m = data?.metrics ?? {};
    const status = node('p', pc.status === 'loading' ? '조회 중… 결과를 기다리는 중입니다. 이전 값은 현재 상태로 표시하지 않습니다.' : pc.status === 'idle' ? '미조회 · 다시 조회 버튼을 직접 눌러 시작하세요.' : fresh ? '실측 · ' + time(data.measuredAt) : pc.message || '오래된 실측 · 현재 상태 확인 불가');
    status.id = 'keshev-pc-query-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true'); pcSection.append(status);
    if (pc.status === 'error' || pc.status === 'stale') {
      pcSection.append(node('p', '확인하지 못한 항목: CPU·메모리·드라이브·네트워크·방화벽·Windows 기록.'), node('p', nextStep(null)));
    } else if (data) {
      const missing = metricChecks(data).filter(([, ok]) => !ok).map(([label]) => label);
      if (missing.length) pcSection.append(node('p', '확인 불가 항목: ' + missing.join(', ') + '. 항목별 이유와 다음 행동은 아래 PC 상세에서 확인하세요.'));
    }
    const cards = node('div', undefined, 'grid-2'), firstPair = node('div', undefined, 'grid-2'), secondPair = node('div', undefined, 'grid-2');
    const card = (key, title, value, note) => {
      const item = node('article', undefined, 'card'); item.setAttribute('data-dashboard-metric', key);
      const valid = value !== '확인 불가';
      const metric = key === 'disk' ? (m.drives ?? m.disk) : m[key];
      item.append(node('h4', title), node('p', value), node('p', note, 'muted'),
        node('p', valid ? '실측 기준 시각(서버 조회 완료): ' + time(data.measuredAt)
          : '확인 불가 이유: ' + (data ? reasonText(metric) : pc.status === 'idle' ? '아직 조회하지 않았습니다.' : pc.status === 'loading' ? '조회 중입니다.' : pc.message || '현재 실측을 확인할 수 없습니다.')),
        node('p', valid ? '값별 독립 측정 시각은 제공되지 않습니다.' : '측정 시각: 확인 불가'));
      if (!valid) item.append(node('p', nextStep(data ? metric : null)));
      return item;
    };
    const cpu = m.cpu?.state === 'ok' && percent(m.cpu.usagePercent) ? m.cpu.usagePercent.toFixed(1) + '%' : '확인 불가';
    const memory = memoryOk(m.memory) ? (m.memory.usedBytes / m.memory.totalBytes * 100).toFixed(1) + '% · ' + gib(m.memory.usedBytes) + ' / ' + gib(m.memory.totalBytes) : '확인 불가';
    const drives = data ? driveRows(data) : [], known = drives.filter(capacity), unknownCount = drives.length - known.length;
    const free = known.reduce((sum, value) => sum + value.freeBytes, 0), total = known.reduce((sum, value) => sum + value.totalBytes, 0);
    let diskValue = known.length ? gib(free) + ' 여유 / ' + gib(total) : '확인 불가';
    let diskNote = known.length ? '확인된 ' + known.length + '개 고정 로컬 볼륨 합계' + (unknownCount ? '(일부) · 확인 불가 ' + unknownCount + '개' : '') : '드라이브별 조회 결과를 확인하세요.';
    if (data && !m.drives && capacity(m.disk)) { diskValue = gib(m.disk.freeBytes) + ' 여유 / ' + gib(m.disk.totalBytes); diskNote = '이전 서버 응답: 앱이 있는 볼륨만 실측했습니다. 여러 드라이브 조회에는 서버 재실행이 필요합니다.'; }
    const firewall = profilesOk(m.firewall) ? m.firewall.profiles.filter(p => p.enabled).length + '/3 프로필 켜짐' : '확인 불가';
    firstPair.append(card('cpu', 'CPU', cpu, '짧은 200ms 구간의 실측'), card('memory', '메모리', memory, '현재 PC 전체 메모리'));
    secondPair.append(card('disk', '드라이브 여유', diskValue, diskNote), card('firewall', '방화벽 설정', firewall, '설정 관찰이며 전체 보호·안전 판정이 아닙니다.'));
    cards.append(firstPair, secondPair); cards.setAttribute('aria-busy', pc.status === 'loading' ? 'true' : 'false'); pcSection.append(cards);
    const pcDetail = details('pc-detail', 'PC 상세 · 네트워크·방화벽·Windows 기록·SDP');
    const observations = node('div', undefined, 'grid-2'); observations.append(pcObservations(data), sdpConnection(sdp)); pcDetail.append(observations);
    const driveDetail = details('drives', '드라이브별 용량 · 범위와 확인 불가');
    if (drives.length) {
      const list = node('ul'); for (const drive of drives) list.append(node('li', drive.id + ' · ' + (capacity(drive) ? gib(drive.freeBytes) + ' 여유 / ' + gib(drive.totalBytes) + ' · 실측 기준 시각(서버 조회 완료): ' + time(data.measuredAt) : '확인 불가 · ' + reasonText(drive) + ' · 측정 시각 확인 불가 (0으로 합산하지 않음) · ' + nextStep(drive)))); driveDetail.append(list);
    } else driveDetail.append(node('p', data ? '전체 드라이브 목록 확인 불가 또는 조회 대상 없음' : '아직 현재 실측 목록이 없습니다.'));
    driveDetail.append(node('p', '문자가 있는 고정 로컬 볼륨만 조회합니다. 이동식·네트워크·문자 없는 볼륨은 합계에서 제외합니다. 1 GiB = 1024³ bytes.'));
    pcDetail.append(driveDetail); pcSection.append(pcDetail);
    const trendSection = feature('trends', '2. 실측 추이·비교'); root.append(trendSection);
    const trends = node('div', undefined, 'grid-2'); trends.append(drawTrend(pc.samples, 'cpu', 'CPU'), drawTrend(pc.samples, 'memory', '메모리')); trendSection.append(trends);
    trendSection.append(node('p', '이 페이지에서 받은 실측만 최근 120회까지 유지합니다. 새로고침하면 지워집니다. 미측정 구간·예시를 추이에 채우지 않습니다.', 'muted'));
    const sampleTable = details('samples', '시각별 실측 표');
    const sampleList = node('ul');
    for (const sample of pc.samples) sampleList.append(node('li', time(sample.at) + ' · CPU ' + (sample.cpu === null ? '확인 불가' : sample.cpu.toFixed(1) + '%') + ' · 메모리 ' + (sample.memory === null ? '확인 불가' : sample.memory.toFixed(1) + '%')));
    sampleTable.append(sampleList); trendSection.append(sampleTable, comparison(data));
    const history = feature('history', '3. 조회 기록'); history.append(node('p', '이 앱의 조회 기록이며 실제 XDR 경보와 별도입니다.'));
    const filterLabel = node('label', '조회 기록 필터'), filter = node('select'); filter.setAttribute('aria-label', '조회 기록 필터'); filter.setAttribute('data-dashboard-control', 'filter');
    for (const [value, label] of [['all', '전체'], ['measured', '실측 확인'], ['partial', '일부 확인 불가'], ['failed', '조회 실패']]) { const option = node('option', label); option.value = value; filter.append(option); } filter.value = pc.filter;
    filter.addEventListener('change', () => { pc.filter = filter.value; notify('filter'); }); filterLabel.append(filter); history.append(filterLabel);
    const shown = pc.history.filter(row => pc.filter === 'all' || row.kind === pc.filter);
    history.append(node('p', '표시 ' + shown.length + '건 / 이번 페이지의 조회 기록 ' + pc.history.length + '건 (최근 100건)'));
    if (!shown.length) history.append(node('p', '표시할 조회 기록이 없습니다. 실제 보안 사건이 없다는 뜻은 아닙니다.'));
    for (const row of shown) { const item = details('history-' + encodeURIComponent(row.at + '-' + row.kind), time(row.at) + ' · ' + row.summary); item.append(node('p', row.detail)); history.append(item); }
    root.append(history);
    if (pc.example) {
      const examples = node('section', undefined, 'card'); examples.setAttribute('data-dashboard-example', 'true');
      examples.append(node('h4', '예시 · 설명용 고정 값 (실제 조회 결과 아님)'), node('p', '예: CPU 25.0%, 메모리 40.0%, C: 여유 100 GiB, D: 여유 200 GiB. 측정 시각 없음: 실제로 측정한 값이 아닙니다. 화면 설명용 값이며 실제 카드·추이·비교·기록·합계에 넣지 않습니다.'));
      root.append(examples);
    }
    const provenance = details('provenance', '제공 기능·학생 추가와 조회 범위');
    provenance.append(node('p', '제공 기능: 내 PC 상태 조회(/api/pc/status). 학생 추가: 네 카드·추이·직전 실측 비교·조회 기록. 측정 기능을 새로 만들거나 관리자 권한을 요청하지 않습니다.'),
      node('p', '실측값·시각은 제공 조회 응답에서 읽습니다. 예시는 사용자가 선택한 별도 설명용 영역에만 표시하고 실패한 실측을 대신하지 않습니다.'));
    root.append(provenance);
    const prior = details('prior-status', '기존 기기·세션·알림·진단 정보'); prior.append(existingStatus); root.append(prior);
    return root;
  }

  return {
    renderIdentity({ me, devices, sessions } = {}) {
      const root = document.createElement('div');
      const deviceLabels = {
        compliant: '보안 기준 충족',
        noncompliant: '보안 기준 미충족',
        unknown: '확인 불가',
      };
      const sessionLabels = {
        active: '활성',
        expired: '만료',
        revoked: '철회됨',
        unknown: '확인 불가',
      };
      const modeLabels = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
      const textValue = value => typeof value === 'string' && value.trim() ? value : '확인 불가';
      const node = (tag, text) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
      };
      const field = (list, label, value) => {
        list.append(node('dt', label), node('dd', textValue(value)));
      };
      const statusLabel = (labels, status) => Object.hasOwn(labels, status) ? `${labels[status]}(${status})` : '확인 불가';
      const block = (title, resource, renderData) => {
        const section = node('section');
        section.append(node('h3', title));
        if (resource?.mode !== 'connected') {
          section.append(node('p', Object.hasOwn(modeLabels, resource?.mode) ? modeLabels[resource.mode] : '확인 불가'));
        }
        if (resource?.status === 'loading') {
          section.append(node('p', '불러오는 중'));
        } else if (resource?.status === 'error') {
          section.append(node('p', `연결 실패: ${textValue(resource.error?.message)}`));
        } else if (resource?.status === 'ok') {
          renderData(section, resource.data);
        } else {
          section.append(node('p', '확인 불가'));
        }
        return section;
      };

      root.append(block('현재 로그인 정보', me, (section, data) => {
        const list = node('dl');
        field(list, '사용자 이름', data?.user?.label);
        field(list, '사용자 ID', data?.user?.id);
        field(list, '현재 기기 이름', data?.device?.label);
        field(list, '현재 기기 ID', data?.device?.id);
        field(list, '현재 기기 상태', statusLabel(deviceLabels, data?.device?.status));
        field(list, '현재 세션 ID', data?.session?.id);
        field(list, '현재 세션 상태', statusLabel(sessionLabels, data?.session?.status));
        section.append(list);
      }));
      root.append(block('기기 목록', devices, (section, data) => {
        if (!Array.isArray(data)) {
          section.append(node('p', '확인 불가'));
          return;
        }
        if (data.length === 0) {
          section.append(node('p', '표시할 기기가 없습니다.'));
          return;
        }
        const items = node('ul');
        for (const device of data) {
          const item = node('li');
          const list = node('dl');
          field(list, '기기 이름', device?.label);
          field(list, '기기 ID', device?.id);
          field(list, '기기 상태', statusLabel(deviceLabels, device?.status));
          item.append(list);
          items.append(item);
        }
        section.append(items);
      }));
      root.append(block('세션 목록', sessions, (section, data) => {
        if (!Array.isArray(data)) {
          section.append(node('p', '확인 불가'));
          return;
        }
        if (data.length === 0) {
          section.append(node('p', '표시할 세션이 없습니다.'));
          return;
        }
        const items = node('ul');
        for (const session of data) {
          const item = node('li');
          const list = node('dl');
          field(list, '세션 ID', session?.id);
          field(list, '세션 상태', statusLabel(sessionLabels, session?.status));
          item.append(list);
          items.append(item);
        }
        section.append(items);
      }));
      return root;
    },
    renderDecision({ status, mode, data, error, appId } = {}) {
      const root = document.createElement('div');
      const node = (tag, text) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
      };
      const textValue = value => typeof value === 'string' && value.trim() ? value : '확인 불가';
      const modeLabels = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
      const decisionLabels = {
        allow: '접근 허용(allow)',
        deny: '접근 거부(deny)',
        challenge: '추가 확인 필요(challenge)',
        unknown: '판정 확인 불가(unknown)',
      };
      root.append(node('h3', '업무 앱 접근 요청 결과'));
      if (mode !== 'connected') {
        root.append(node('p', Object.hasOwn(modeLabels, mode) ? modeLabels[mode] : '확인 불가'));
      }
      if (status === 'idle') {
        root.append(node('p', '앱을 골라 접속을 요청하세요.'));
        return root;
      }
      if (status === 'loading') {
        root.append(node('p', '판정 확인 중'), node('p', `대상 앱 ID: ${textValue(appId)}`));
        return root;
      }
      if (status === 'error') {
        root.append(
          node('p', `요청 실패: ${textValue(error?.message)}`),
          node('p', '이 오류는 서버의 접근 거부 판정이 아닙니다.'),
          node('p', `대상 앱 ID: ${textValue(appId)}`),
        );
        return root;
      }
      if (status !== 'ok') {
        root.append(node('p', decisionLabels.unknown), node('p', '요청 상태를 확인할 수 없습니다.'));
        return root;
      }
      const decision = typeof data?.decision === 'string' && Object.hasOwn(decisionLabels, data.decision)
        ? data.decision : 'unknown';
      const list = node('dl');
      const field = (label, value) => {
        list.append(node('dt', label), node('dd', textValue(value)));
      };
      field('대상 앱 ID', data?.appId ?? appId);
      field('판정', decisionLabels[decision]);
      field('판정 이유', data?.reason);
      field('판정 시각', data?.checkedAt);
      root.append(list);
      if (decision === 'allow') {
        root.append(node('p', '정책상 접근이 허용된 결과이며 실제 업무 앱 접속 성공을 보장하지 않습니다.'));
      } else if (decision === 'challenge') {
        root.append(node('p', '추가 인증 또는 확인이 필요합니다. 이 앱은 해당 절차를 대신 수행하지 않습니다.'));
      } else if (decision === 'unknown') {
        root.append(node('p', '업무 앱의 접근 판정을 확인할 수 없습니다.'));
      }
      return root;
    },
    renderEvents({ status, mode, data, error } = {}) {
      const root = document.createElement('div');
      const node = (tag, text) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
      };
      const textValue = value => typeof value === 'string' && value.trim() ? value : '확인 불가';
      const modeLabels = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
      const kindLabels = { access: '접속 기록(access)', xdr: 'XDR 경보(xdr)' };
      const appLabel = value => typeof value === 'string' && value.trim() ? value : '앱 확인 불가(appId 없음)';
      root.append(node('h3', '내 접속 기록·XDR 경보'));
      if (mode !== 'connected') {
        root.append(node('p', Object.hasOwn(modeLabels, mode) ? modeLabels[mode] : '확인 불가'));
      }
      if (status === 'loading') {
        root.append(node('p', '기록을 불러오는 중'));
        return root;
      }
      if (status === 'error') {
        root.append(node('p', `기록을 불러오지 못했습니다: ${textValue(error?.message)}`));
        if (error?.code === 'CONTRACT_MISMATCH') root.append(node('p', '기록 확인 불가(CONTRACT_MISMATCH)'));
        return root;
      }
      if (status !== 'ok' || !Array.isArray(data)) {
        root.append(node('p', '기록 확인 불가: 전달된 기록 상태나 형식을 확인할 수 없습니다.'));
        return root;
      }
      if (data.length === 0) {
        root.append(node('p', '표시할 기록이 없습니다'));
        return root;
      }
      const events = [...data].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
      const accessLabels = { allowed: '접근 허용', denied: '접근 거부', unknown: '확인 불가' };
      const sessionLabels = { active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };
      const deviceLabels = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
      const stateLabel = (labels, value) => typeof value === 'string' && Object.hasOwn(labels, value)
        ? `${labels[value]}(${value})` : '확인 불가(unknown)';
      const filters = node('div');
      const count = node('p');
      const list = node('ul');
      const detailHost = node('div');
      detailHost.setAttribute('aria-live', 'polite');
      const makeFilter = (name, values, describe) => {
        const label = node('label');
        const select = node('select');
        select.setAttribute('aria-label', name);
        const all = node('option', '전체');
        all.value = 'all';
        select.append(all);
        for (const value of new Set(values.filter(value => typeof value === 'string' && value.trim()))) {
          const option = node('option', describe(value));
          option.value = value;
          select.append(option);
        }
        select.value = 'all';
        label.append(node('span', name), select);
        filters.append(label);
        return select;
      };
      const kindFilter = makeFilter('기록 종류', events.map(event => event.kind),
        value => Object.hasOwn(kindLabels, value) ? kindLabels[value] : value);
      const appFilter = makeFilter('업무 앱', events.map(event => event.appId), value => value);
      const accessFilter = makeFilter('접속 상태', events.map(event => event.state?.access),
        value => stateLabel(accessLabels, value));
      const showDetail = event => {
        const detail = node('section');
        detail.setAttribute('data-student-event-detail', event.id);
        detail.append(node('h4', `${textValue(event.id)} 상세`));
        const fields = node('dl');
        const field = (label, value) => fields.append(node('dt', label), node('dd', textValue(value)));
        field('사건 ID', event.id);
        field('업무 앱', appLabel(event.appId));
        field('접속 상태', stateLabel(accessLabels, event.state?.access));
        field('세션 상태', stateLabel(sessionLabels, event.state?.session));
        field('기기 상태', stateLabel(deviceLabels, event.state?.device));
        detail.append(fields);
        for (const [title, entries] of [['근거', event.evidence], ['규칙', event.rules]]) {
          const section = node('section');
          section.append(node('h5', title));
          if (!Array.isArray(entries)) {
            section.append(node('p', '확인 불가'));
          } else if (entries.length === 0) {
            section.append(node('p', `${title} 없음`));
          } else {
            const items = node('ul');
            for (const entry of entries) {
              items.append(node('li', `${textValue(entry?.id)}: ${textValue(entry?.text)}`));
            }
            section.append(items);
          }
          detail.append(section);
        }
        const unsupported = Array.isArray(event.supportedActions)
          ? event.supportedActions.filter(action => typeof action === 'string' && action.trim()) : [];
        if (unsupported.length > 0) {
          const section = node('section');
          section.append(node('h5', '미지원 조치'), node('p', '조치 실행 연결은 준비 중입니다. 아직 지원하지 않는 조치이며 요청을 보내지 않습니다.'));
          for (const action of unsupported) {
            const button = node('button', `${action} 미지원`);
            button.type = 'button';
            button.disabled = true;
            section.append(button);
          }
          detail.append(section);
        }
        detailHost.replaceChildren(detail);
      };
      const renderRows = () => {
        const visible = events.filter(event =>
          (kindFilter.value === 'all' || event.kind === kindFilter.value)
          && (appFilter.value === 'all' || event.appId === appFilter.value)
          && (accessFilter.value === 'all' || event.state?.access === accessFilter.value));
        list.replaceChildren();
        detailHost.replaceChildren();
        count.textContent = `표시 ${visible.length}건 / 받은 기록 ${events.length}건`;
        if (visible.length === 0) {
          list.append(node('li', '선택 조건에 맞는 기록이 없습니다'));
          return;
        }
        for (const event of visible) {
          const row = node('li');
          row.setAttribute('data-student-event-id', event.id);
          row.append(
            node('p', `사건 ID: ${textValue(event.id)}`),
            node('p', `발생 시각: ${textValue(event.at)}`),
            node('p', `기록 종류: ${Object.hasOwn(kindLabels, event.kind) ? kindLabels[event.kind] : textValue(event.kind)}`),
            node('p', `업무 앱: ${appLabel(event.appId)}`),
            node('p', `요약: ${textValue(event.summary)}`),
          );
          const button = node('button', `${textValue(event.id)} 상세`);
          button.type = 'button';
          button.addEventListener('click', () => showDetail(event));
          row.append(button);
          list.append(row);
        }
      };
      for (const filter of [kindFilter, appFilter, accessFilter]) filter.addEventListener('change', renderRows);
      root.append(filters, count, list, detailHost);
      renderRows();
      return root;
    },
    renderStatus({ devices, sessions, notifications, diagnostics, mode } = {}) {
      const root = document.createElement('div');
      const node = (tag, text) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
      };
      const sensitive = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sb_(?:secret|publishable)_|github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|passwd|token|secret|api[_ -]?key|authorization|비밀번호|토큰|인증키)\s*[:=]\s*\S+|https?:\/\/[^\s/]+:[^\s/]+@|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/iu;
      const safeText = value => {
        if (typeof value !== 'string' || !value.trim()) return '확인 불가';
        return sensitive.test(value) ? '[가림]' : value;
      };
      const modeLabels = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
      const showMode = (section, value) => {
        if (value !== 'connected') section.append(node('p', Object.hasOwn(modeLabels, value) ? modeLabels[value] : '확인 불가'));
      };
      const deviceLabels = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
      const sessionLabels = { active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };
      const stateLabel = (labels, value) => typeof value === 'string' && Object.hasOwn(labels, value)
        ? `${labels[value]}(${value})` : '확인 불가(unknown)';
      const retry = '다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요.';
      const diagnosticRetry = '진단 정보는 제공 화면의 도움정보 불러오기 버튼을 직접 눌러 다시 확인하세요.';
      const block = (title, resource, renderData, retryText = retry) => {
        const section = node('section');
        section.append(node('h4', title));
        showMode(section, resource?.mode);
        if (resource?.status === 'loading') {
          section.append(node('p', `“${title}” 항목을 불러오는 중`));
        } else if (resource?.status === 'error') {
          section.append(node('p', `“${title}” 항목을 불러오지 못했습니다: ${safeText(resource.error?.message)}`));
          if (typeof resource.error?.code === 'string' && /(?:^|_)(?:TIMEOUT|TIMED_OUT)$/u.test(resource.error.code)) {
            section.append(node('p', `${title} 조회 시간 초과`));
          }
          section.append(node('p', retryText));
        } else if (resource?.status === 'ok') {
          renderData(section, resource.data);
        } else if (resource?.status === 'idle') {
          section.append(node('p', `“${title}” 항목을 아직 불러오지 않았습니다.`), node('p', retryText));
        } else {
          section.append(node('p', `${title} 확인 불가`), node('p', retryText));
        }
        return section;
      };
      const field = (list, label, value) => list.append(node('dt', label), node('dd', safeText(value)));
      root.append(node('h3', '기기·현재 연결·알림·진단 정보'));
      showMode(root, mode);
      root.append(block('등록 기기', devices, (section, data) => {
        if (!Array.isArray(data)) {
          section.append(node('p', '등록 기기 확인 불가'), node('p', retry));
        } else if (data.length === 0) {
          section.append(node('p', '등록된 기기가 없습니다.'));
        } else {
          const items = node('ul');
          for (const device of data) {
            const item = node('li');
            const list = node('dl');
            field(list, '기기 이름', device?.label);
            field(list, '기기 상태', stateLabel(deviceLabels, device?.status));
            item.append(list);
            items.append(item);
          }
          section.append(items);
        }
      }));
      root.append(node('p', '세션 조회는 현재 검증된 연결 한 개를 대상으로 합니다.'));
      root.append(block('현재 연결 세션', sessions, (section, data) => {
        if (!Array.isArray(data)) {
          section.append(node('p', '현재 연결 확인 불가'), node('p', retry));
        } else if (data.length === 0) {
          section.append(node('p', '현재 연결이 없습니다.'));
        } else {
          const items = node('ul');
          for (const session of data) {
            const item = node('li');
            const list = node('dl');
            field(list, '세션 ID', session?.id);
            field(list, '세션 상태', stateLabel(sessionLabels, session?.status));
            item.append(list);
            items.append(item);
          }
          section.append(items);
        }
      }));
      const alerts = node('section');
      alerts.append(node('h4', '알림'));
      if (!Array.isArray(notifications)) {
        alerts.append(node('p', '알림 확인 불가'));
      } else if (notifications.length === 0) {
        alerts.append(node('p', '주의할 알림이 없습니다.'));
      } else {
        const items = node('ul');
        for (const notification of notifications) {
          const item = node('li');
          const list = node('dl');
          field(list, '알림 자료(resource)', notification?.resource);
          field(list, '알림 코드(code)', notification?.code);
          field(list, '알림 내용(message)', notification?.message);
          item.append(list);
          items.append(item);
        }
        alerts.append(items);
      }
      root.append(alerts);
      let help = null;
      root.append(block('진단 정보', diagnostics, (section, data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          section.append(node('p', '진단 정보 확인 불가'), node('p', diagnosticRetry));
          return;
        }
        help = {
          requestId: safeText(data.requestId),
          component: safeText(data.component),
          version: safeText(data.version),
          checkedAt: safeText(data.checkedAt),
          engine: { mode: safeText(data.engine?.mode), code: safeText(data.engine?.code) },
        };
        const list = node('dl');
        for (const key of ['requestId', 'component', 'version', 'checkedAt']) field(list, key, help[key]);
        field(list, 'engine.mode', help.engine.mode);
        field(list, 'engine.code', help.engine.code);
        section.append(list);
      }, diagnosticRetry));
      root.append(node('p', '도움정보 복사는 표시된 여섯 항목을 도움 요청에 사용하도록 클립보드에 복사합니다. 내용을 확인한 뒤 직접 누르세요.'));
      const copy = node('button', '도움정보 복사');
      copy.type = 'button';
      copy.disabled = help === null;
      const copyStatus = node('p');
      copyStatus.setAttribute('role', 'status');
      copy.addEventListener('click', async () => {
        if (!help || copy.disabled) return;
        try {
          if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') throw new Error('COPY_UNAVAILABLE');
          await globalThis.navigator.clipboard.writeText(JSON.stringify(help, null, 2));
          copyStatus.textContent = '도움정보를 클립보드에 복사했습니다.';
        } catch {
          copyStatus.textContent = '도움정보를 복사하지 못했습니다. 화면에 표시된 여섯 항목을 직접 선택해 복사하세요.';
        }
      });
      root.append(copy, copyStatus);
      return dashboard(root, {devices, sessions, mode});
    },
    renderVulnerabilities({ status, mode, data, error } = {}) {
      const root = document.createElement('div');
      const node = (tag, text) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
      };
      const sensitive = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sb_(?:secret|publishable)_|github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|passwd|token|secret|api[_ -]?key|authorization|비밀번호|토큰|인증키)\s*[:=]\s*\S+|https?:\/\/[^\s/]+:[^\s/]+@|(?:^|\n)\s*at\s+\S|\bTraceback\b|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/iu;
      const safeText = value => typeof value === 'string' && value.trim()
        ? sensitive.test(value) ? '[가림]' : value : '확인 불가';
      const modeLabels = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
      const scanLabels = {
        complete: '모두 조회(complete)',
        partial: '일부 조회 실패(partial)',
        not_checked: '아직 조회 안 함(not_checked)',
        not_configured: '조회 준비 미완료(not_configured)',
        unverifiable: 'lock 파일 확인 불가(unverifiable)',
      };
      root.append(node('h3', '설치 패키지 버전과 알려진 취약점 조회 결과'));
      if (mode !== 'connected') root.append(node('p', Object.hasOwn(modeLabels, mode) ? modeLabels[mode] : '확인 불가'));
      if (status === 'idle') {
        root.append(node('p', '조회 전(idle). 제공 화면의 설치 패키지 조회 버튼을 직접 눌러 확인하세요.'));
        return root;
      }
      if (status === 'loading') {
        root.append(node('p', '조회 중(loading). 이전 패키지 표는 현재 조회 결과로 표시하지 않습니다.'));
        return root;
      }
      if (status === 'error') {
        root.append(node('p', `조회 실패: ${safeText(error?.message)}`));
        if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(error.code)) root.append(node('p', `오류 코드: ${error.code}`));
        root.append(node('p', '조회 실패는 취약점이 없다는 결과가 아닙니다. 다시 확인하려면 제공 화면의 설치 패키지 조회 버튼을 직접 누르세요. 자동으로 다시 요청하지 않습니다.'));
        return root;
      }
      if (status !== 'ok' || !data || !Object.hasOwn(scanLabels, data.status) || !Array.isArray(data.packages)) {
        root.append(node('p', '조회 결과 확인 불가: 전달된 조회 상태나 자료 형식을 확인할 수 없습니다.'));
        return root;
      }
      root.append(node('p', `전체 조회 상태: ${scanLabels[data.status]}`));
      if (data.status === 'not_configured') root.append(node('p', '조회 대상 프로젝트 설정이 필요합니다. 미조회 상태이며 취약점이 없다는 뜻이 아닙니다. 대상 경로와 공개 조회 허용 목록은 담당자가 준비합니다.'));
      if (data.status === 'not_checked') root.append(node('p', '승인된 공개 조회 대상이 없거나 아직 조회하지 않은 상태입니다. 취약점이 없다는 결과가 아닙니다.'));
      if (data.status === 'unverifiable') root.append(node('p', 'lock 파일을 확인할 수 없어 설치 패키지 조회를 확인하지 못했습니다. 취약점이 없다는 결과가 아닙니다.'));
      if (data.status === 'partial') root.append(node('p', '일부 조회에 실패했습니다. 이미 받은 취약점 ID는 유지하며, 미확인 패키지를 알려진 항목 없음으로 바꾸지 않습니다.'));
      const metadata = node('dl');
      const addMetadata = (label, value) => {
        if (typeof value === 'string' && value.trim()) metadata.append(node('dt', label), node('dd', safeText(value)));
        else if (Number.isSafeInteger(value)) metadata.append(node('dt', label), node('dd', String(value)));
      };
      addMetadata('lock 파일 버전(lockfileVersion)', data.lockfileVersion);
      addMetadata('lock 파일 해시(lockfileHash)', data.lockfileHash);
      addMetadata('조회 시각(checkedAt)', data.checkedAt);
      if (metadata.children.length > 0) root.append(metadata);
      const packageLabels = {
        known_vulnerabilities: '알려진 항목 있음(known_vulnerabilities)',
        none_found: '알려진 항목 없음(none_found)',
        unverifiable: '조회 확인 불가(unverifiable)',
      };
      const exactVersion = value => {
        if (typeof value !== 'string' || safeText(value) !== value) return false;
        const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(value);
        return Boolean(match) && (!match[4] || match[4].split('.').every(part => !/^0\d+$/u.test(part)));
      };
      if (data.packages.length === 0) {
        root.append(node('p', '표시할 패키지 조회 결과가 없습니다. 빈 목록만으로 취약점이 없다고 판단하지 않습니다.'));
      } else {
        const table = node('table');
        table.append(node('caption', '전달받은 설치 패키지별 OSV 조회 결과'));
        const header = node('thead');
        const headings = node('tr');
        for (const title of ['패키지 이름(name)', '설치된 정확한 버전(version)', '조회 상태(status)', '조회 출처(source)', '조회 시각(checkedAt)', '취약점 ID·수정 시각']) {
          const cell = node('th', title);
          cell.setAttribute('scope', 'col');
          headings.append(cell);
        }
        header.append(headings);
        table.append(header);
        const body = node('tbody');
        for (const pkg of data.packages) {
          const row = node('tr');
          const versionVerified = exactVersion(pkg?.version);
          const findings = Array.isArray(pkg?.vulnerabilities) ? pkg.vulnerabilities : [];
          let packageStatus = Object.hasOwn(packageLabels, pkg?.status) ? pkg.status : 'unverifiable';
          if (!versionVerified || !Array.isArray(pkg?.vulnerabilities)
              || packageStatus === 'none_found' && findings.length > 0
              || packageStatus === 'known_vulnerabilities' && findings.length === 0) packageStatus = 'unverifiable';
          if (typeof pkg?.name === 'string' && pkg.name.trim() && safeText(pkg.name) === pkg.name) row.setAttribute('data-student-package-name', pkg.name);
          if (versionVerified) row.setAttribute('data-student-package-version', pkg.version);
          const state = node('td', packageLabels[packageStatus]);
          if (packageStatus === 'unverifiable') state.append(node('p', findings.length > 0
            ? '일부 확인·전체 조회 확인 불가. 아래에 이미 받은 취약점 ID를 유지합니다.'
            : '조회를 확인할 수 없습니다. 취약점이 없다는 결과가 아닙니다.'));
          if (packageStatus === 'none_found') state.append(node('p', '이 정확한 버전의 조회 범위에서 알려진 항목이 없다는 뜻입니다.'));
          const vulnerabilities = node('td');
          if (findings.length > 0) {
            const list = node('ul');
            for (const finding of findings) {
              const item = node('li');
              item.append(node('p', `취약점 ID: ${safeText(finding?.id)}`), node('p', `수정 시각(modified): ${safeText(finding?.modified)}`));
              list.append(item);
            }
            vulnerabilities.append(list);
          } else {
            vulnerabilities.append(node('p', packageStatus === 'none_found'
              ? '조회 범위에서 알려진 취약점 항목이 없습니다.' : '확인된 취약점 항목을 표시할 수 없습니다.'));
          }
          row.append(node('td', safeText(pkg?.name)), node('td', versionVerified ? pkg.version : '설치 버전 확인 불가: 정확한 버전이 전달되지 않았습니다.'),
            state, node('td', safeText(pkg?.source)), node('td', safeText(pkg?.checkedAt)), vulnerabilities);
          body.append(row);
        }
        table.append(body);
        root.append(table);
      }
      root.append(node('p', 'OSV는 알려진 취약점 데이터베이스입니다. 조회 범위에서 알려진 항목이 없다는 결과만으로 패키지나 앱 전체의 안전을 보장할 수 없습니다.'));
      return root;
    },
    renderAiConnection({ status, mode, data, error, checkedAt, explanationAccepted } = {}) {
      const root = document.createElement('div');
      const node = (tag, text) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
      };
      const sensitive = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sb_(?:secret|publishable)_|github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|passwd|token|secret|api[_ -]?key|authorization|비밀번호|토큰|인증키)\s*[:=]\s*\S+|https?:\/\/[^\s/]+:[^\s/]+@|(?:^|\n)\s*at\s+\S|\bTraceback\b|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/iu;
      const safeText = value => typeof value === 'string' && value.trim()
        ? sensitive.test(value) ? '[가림]' : value : '확인 불가';
      const modeLabels = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
      const manual = '재점검은 제공 화면의 현재 API 연결 점검 버튼을 직접 누르세요. 자동으로 다시 점검하지 않습니다.';
      root.append(node('h3', '앱 내부 AI 연결 점검'));
      if (mode !== 'connected') {
        root.append(node('p', Object.hasOwn(modeLabels, mode) ? modeLabels[mode] : '확인 불가'));
      }
      if (status === 'idle') {
        root.append(node('p', 'AI 연결 점검 전'), node('p', manual));
      } else if (status === 'loading') {
        root.append(node('p', 'AI 연결 점검 중'));
      } else if (status === 'error') {
        const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(error.code)
          ? error.code : 'AI_REQUEST_UNVERIFIED';
        const groups = [
          [['ON_AI_PROVISIONING_PENDING', 'ON_AI_TRANSPORT_PENDING', 'ON_AI_AUTHORIZATION_CHANGED', 'AI_REQUEST_UNVERIFIED', 'SUBJECT_SCOPE_UNVERIFIED', 'WB_CLCO_INVALID_RESPONSE'],
            '권한 준비 중 또는 확인 불가', '담당자에게 계정 연결·앱 권한 발급과 연결 준비 상태를 확인해 주세요. 학생 코드만으로 연결할 수 있는 상태가 아닙니다.'],
          [['WB_CLCO_AUTH_REQUIRED'], '인증 실패', '계정 연결과 앱 승인을 다시 확인하고 담당자에게 앱 인증 상태를 확인해 주세요.'],
          [['WB_CLCO_ACCESS_BLOCKED'], '접근 제한', '담당자에게 현재 계정의 앱 이용 권한과 접근 제한 상태를 확인해 주세요.'],
          [['WB_CLCO_COHORT_BUDGET_EXHAUSTED', 'WB_CLCO_LIMIT_REACHED'], '사용량·이용 한도', '담당자에게 반 사용량과 이용 한도를 확인해 주세요.'],
          [['WB_CLCO_SESSION_CLOSED'], '이용 시간 아님', '현재 AI 이용 시간을 확인한 뒤 직접 다시 점검하세요.'],
          [['WB_CLCO_RATE_LIMITED'], '요청 제한', '잠시 뒤 현재 API 연결 점검을 직접 다시 요청하세요.'],
          [['WB_CLCO_TIMEOUT', 'REQUEST_TIMEOUT', 'ENGINE_TIMEOUT', 'TIMEOUT'], '시간 초과', '응답 시간이 초과됐습니다. 잠시 뒤 직접 다시 점검하세요.'],
          [['WB_CLCO_NETWORK_ERROR', 'WB_CLCO_SERVER_UNAVAILABLE', 'NETWORK_ERROR', 'SERVER_UNAVAILABLE'], '네트워크·서버 연결 실패', '연결 상태를 확인하고 잠시 뒤 직접 다시 점검하세요.'],
          [['WB_CLCO_CANCELLED', 'CANCELLED', 'REQUEST_CANCELLED'], '취소됨', '점검이 취소됐습니다. 이전 응답은 현재 결과가 아닙니다.'],
          [['MODEL_NOT_CONFIGURED', 'ON_AI_MODEL_LIST_EMPTY'], '쓸 수 있는 모델 없음', '담당자에게 앱에서 사용할 모델의 허용 설정을 확인해 주세요.'],
          [['ON_AI_INVALID_INPUT', 'ON_AI_INVALID_OUTPUT'], '사건 근거·응답 확인 불가', '사건의 근거와 응답 형식을 확인할 수 없습니다. 기존 기록을 확인해 주세요.'],
        ];
        const info = groups.find(([codes]) => codes.includes(code));
        root.append(
          node('p', `AI 연결 점검 실패: ${code}`),
          node('p', `오류 안내: ${safeText(error?.message)}`),
          node('p', info ? info[1] : 'AI 연결 점검 원인 확인 불가'),
          node('p', info ? info[2] : '계정 연결과 앱 권한 상태를 담당자에게 확인한 뒤 직접 다시 점검하세요.'),
          node('p', manual),
        );
      } else if (status === 'ok' && data?.transportChecked === true
          && ['test', 'verified'].includes(data?.audienceAuthorization)
          && Number.isSafeInteger(data?.modelCount) && data.modelCount >= 0 && data.modelCount <= 10000) {
        const list = node('dl');
        list.append(
          node('dt', '연결 점검 구분'),
          node('dd', data.audienceAuthorization === 'test' ? '시험 연결 점검(test)' : '앱 권한 확인 후 점검(verified)'),
          node('dt', '응답 모델 수(modelCount)'), node('dd', String(data.modelCount)),
          node('dt', '점검 시각(checkedAt)'), node('dd', safeText(checkedAt)),
        );
        root.append(list,
          node('p', '연결만 점검했습니다. 사건 설명은 아직 실행하지 않았습니다.'),
          node('p', '사건 설명은 보안 기록에서 별도로 요청하고 그 결과를 확인합니다.'),
          node('p', manual),
        );
        if (data.audienceAuthorization === 'test') root.append(node('p', '시험 연결 점검은 실제 앱 권한 확인이나 사건 설명 실행을 의미하지 않습니다.'));
      } else {
        root.append(node('p', 'AI 연결 점검 결과 확인 불가'), node('p', manual));
      }
      return root;
    },
    renderExplanation({ event, explanation, checkedAt } = {}) {
      const root = document.createElement('div');
      const node = (tag, text) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
      };
      const sensitive = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sb_(?:secret|publishable)_|github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|passwd|token|secret|api[_ -]?key|authorization|비밀번호|토큰|인증키)\s*[:=]\s*\S+|https?:\/\/[^\s/]+:[^\s/]+@|(?:^|\n)\s*at\s+\S|\bTraceback\b|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/iu;
      const safeText = value => typeof value === 'string' && value.trim()
        ? sensitive.test(value) ? '[가림]' : value : '확인 불가';
      const validText = value => typeof value === 'string' && Boolean(value.trim()) && safeText(value) === value;
      const errorCode = typeof explanation?.error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(explanation.error.code)
        ? explanation.error.code : null;
      const modeLabels = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가' };
      const preserved = '기록은 그대로 유지됩니다. AI 설명 실패를 사건의 접근 판정이나 과제 실패로 바꾸지 않습니다.';
      root.append(node('h3', '선택한 사건의 AI 설명'));
      if (explanation?.mode !== 'connected') {
        root.append(node('p', Object.hasOwn(modeLabels, explanation?.mode) ? modeLabels[explanation.mode] : '확인 불가'));
      }
      const unusable = reason => {
        root.append(node('p', `AI 설명을 사용할 수 없습니다: ${reason}`));
        if (errorCode) root.append(node('p', `오류 코드: ${errorCode}`));
        root.append(node('p', preserved));
        return root;
      };
      if (explanation?.status === 'error') {
        root.append(
          node('p', `AI 설명 실패: ${errorCode ?? 'AI_REQUEST_UNVERIFIED'}`),
          node('p', `오류 안내: ${safeText(explanation.error?.message)}`),
        );
        if (errorCode === 'ON_AI_INVALID_INPUT') root.append(node('p', '사건의 근거·규칙이 부족하거나 입력을 확인할 수 없습니다.'));
        if (errorCode === 'ON_AI_INVALID_OUTPUT') root.append(node('p', '설명의 근거·제안·응답 형식을 확인할 수 없습니다.'));
        root.append(node('p', preserved));
        return root;
      }
      if (!event) {
        root.append(node('p', '보안 기록에서 기록을 먼저 고르세요.'));
        return root;
      }
      if (explanation?.status === 'loading') {
        root.append(node('p', '사건 설명 요청 중'));
        return root;
      }
      if (explanation?.status === 'idle') {
        root.append(node('p', '사건 설명 요청 전입니다. 보안 기록에서 설명을 직접 요청하세요.'));
        return root;
      }
      if (explanation?.status !== 'ok' || !explanation.data) return unusable('설명 자료를 확인할 수 없습니다.');
      const data = explanation.data;
      if (data.executed === true) return unusable('AI가 이미 실행했다고 답한 설명은 사용할 수 없습니다.');
      if (data.executed !== false || data.requiresHumanConfirmation !== true) {
        return unusable('미실행 상태와 사람 확인 필요 여부를 확인할 수 없습니다.');
      }
      if (!validText(event.id) || !validText(data.summary)) return unusable('사건 ID 또는 AI 요약을 확인할 수 없습니다.');
      if (!Array.isArray(event.evidence) || event.evidence.length === 0
          || !event.evidence.every(row => validText(row?.id) && validText(row?.text))) {
        return unusable('설명에 필요한 현재 사건의 근거가 부족하거나 확인되지 않았습니다.');
      }
      const evidence = new Map(event.evidence.map(row => [row.id, row.text]));
      const validRefs = ids => Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length
        && ids.every(id => validText(id) && evidence.has(id));
      if (evidence.size !== event.evidence.length || !validRefs(data.evidenceIds) || data.evidenceIds.length !== evidence.size) {
        return unusable('근거가 맞지 않습니다. 인용된 근거 ID가 현재 사건의 근거와 일치하지 않습니다.');
      }
      if (!Array.isArray(event.rules) || event.rules.length === 0
          || !event.rules.every(row => validText(row?.id) && validText(row?.text))) {
        return unusable('현재 사건의 규칙 자료가 부족하거나 확인되지 않았습니다.');
      }
      if (!Array.isArray(event.supportedActions) || !Array.isArray(data.proposals)
          || !data.proposals.every(proposal => validText(proposal?.action) && validText(proposal?.reason)
            && event.supportedActions.includes(proposal.action) && validRefs(proposal.evidenceIds))) {
        return unusable('제안의 지원 조치 또는 근거를 현재 사건과 대조할 수 없습니다.');
      }
      const states = [
        ['access', '접속', ['allowed', 'denied', 'unknown']],
        ['session', '세션', ['active', 'expired', 'revoked', 'unknown']],
        ['device', '기기', ['compliant', 'noncompliant', 'unknown']],
      ];
      if (!states.every(([key, , allowed]) => allowed.includes(event.state?.[key]))) {
        return unusable('현재 사건의 접속·세션·기기 상태를 확인할 수 없습니다.');
      }
      root.append(node('h4', 'AI 설명(참고용)'), node('p', `사건 ID: ${event.id}`), node('p', data.summary),
        node('p', 'AI 설명은 참고용 해석입니다. 사실 판단은 사건 근거와 연동 시스템이 알려 준 상태를 기준으로 합니다.'));
      if (typeof checkedAt === 'string' && checkedAt.trim()) root.append(node('p', `확인 시각: ${safeText(checkedAt)}`));
      const cited = node('section');
      cited.append(node('h4', '인용한 근거'));
      const citations = node('ul');
      for (const id of data.evidenceIds) citations.append(node('li', `${id} — ${evidence.get(id)}`));
      cited.append(citations);
      root.append(cited);
      const rules = node('section');
      rules.append(node('h4', '사건 규칙'));
      const ruleItems = node('ul');
      for (const rule of event.rules) ruleItems.append(node('li', `${rule.id} — ${rule.text}`));
      rules.append(ruleItems);
      root.append(rules);
      const unknown = node('section');
      unknown.append(node('h4', '확인 불가 상태'));
      const unknownStates = states.filter(([key]) => event.state[key] === 'unknown');
      if (unknownStates.length === 0) {
        unknown.append(node('p', '없음'));
      } else {
        const items = node('ul');
        for (const [, label] of unknownStates) items.append(node('li', `${label}: 확인 불가(unknown)`));
        unknown.append(items);
      }
      root.append(unknown);
      const proposals = node('section');
      proposals.append(node('h4', 'AI 조치 제안(미실행)'));
      if (data.proposals.length === 0) {
        proposals.append(node('p', event.supportedActions.length === 0
          ? '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상).'
          : 'AI가 제안한 조치가 없습니다.'));
      } else {
        const items = node('ul');
        for (const proposal of data.proposals) {
          const item = node('li');
          item.append(node('p', `조치: ${proposal.action}`), node('p', `이유: ${proposal.reason}`),
            node('p', '사람 확인이 필요하며 실행되지 않았습니다.'));
          items.append(item);
        }
        proposals.append(items);
      }
      root.append(proposals);
      root.setAttribute('data-student-explanation-event', event.id);
      return root;
    },
    renderAction({ status, event, actionId, target, receipt, observation, message, confirmationExpiresAt, error } = {}) {
      const root = document.createElement('div');
      const node = (tag, text) => {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        return element;
      };
      const sensitive = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sb_(?:secret|publishable)_|github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|passwd|token|secret|api[_ -]?key|authorization|비밀번호|토큰|인증키)\s*[:=]\s*\S+|https?:\/\/[^\s/]+:[^\s/]+@|(?:^|\n)\s*at\s+\S|\bTraceback\b|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/iu;
      const safeText = value => typeof value === 'string' && value.trim()
        ? sensitive.test(value) ? '[가림]' : value : '확인 불가';
      const labels = {
        idle: '아직 미실행(idle)',
        loading: '조치 준비 또는 결과 조회 중(loading)',
        prepared: '준비됨·미실행(prepared)',
        executing: '서버에 전달 중(executing)',
        pending: '서버 접수·처리 중(pending)',
        succeeded: '효과 확인(succeeded)',
        denied: '거절(denied)',
        failed: '실패(failed)',
        unknown: '결과 불명(unknown)',
        expired: '확인 기한 지남(expired)',
        error: '요청 처리 안 됨(error)',
      };
      const currentStatus = Object.hasOwn(labels, status)
        && (status !== 'succeeded' || observation?.effectApplied === true) ? status : 'unknown';
      root.append(node('h3', '보안 조치 요청 상태와 실제 결과'), node('p', labels[currentStatus]));
      if (currentStatus === 'idle') {
        root.append(node('p', '조치 제안만으로 실행되지 않습니다. 조치 준비와 집행은 제공 화면의 별도 사람 확인 절차를 따릅니다.'));
      } else if (currentStatus === 'loading') {
        root.append(node('p', '조치 준비 또는 원천 결과를 확인하고 있습니다. 실제 효과는 아직 확인되지 않았습니다.'));
      } else if (currentStatus === 'prepared') {
        root.append(node('p', '준비만 되었으며 아직 실행되지 않았습니다. 사건·근거·조치·실제 대상과 확인 기한을 읽고 제공 화면에서 사람이 직접 확인해야 서버에 전달됩니다.'));
        root.append(node('p', `사람 확인 기한(confirmationExpiresAt): ${safeText(confirmationExpiresAt)}`));
      } else if (currentStatus === 'executing') {
        root.append(node('p', '서버에 전달 중이며 결과는 아직 확인되지 않았습니다.'));
      } else if (currentStatus === 'pending') {
        root.append(node('p', '서버가 요청을 받았다는 응답(ACK)이며 실제 효과는 아직 확인되지 않았습니다.'));
      } else if (currentStatus === 'succeeded') {
        root.append(node('p', `관측 시각(observedAt): ${safeText(observation.observedAt)}`), node('p', 'effectApplied: true'));
      } else if (currentStatus === 'unknown') {
        if (status === 'succeeded') root.append(node('p', '전달된 상태는 succeeded이지만 observation.effectApplied가 true가 아니므로 효과를 확인할 수 없습니다.'));
        root.append(node('p', '성공 또는 효과 없음으로 판단하지 마세요. 재전송하지 말고 제공 화면의 결과 재조회 버튼으로 결과만 직접 확인하세요.'));
      } else if (currentStatus === 'expired') {
        root.append(node('p', '이번 확인 기한으로는 집행할 수 없습니다. 현재 사건에서 조치를 다시 준비하고 사람이 대상을 확인하세요.'));
      }
      if (['idle', 'denied', 'failed', 'unknown', 'expired', 'error'].includes(currentStatus)
          && typeof message === 'string' && message.trim()) root.append(node('p', `안내: ${safeText(message)}`));
      if (error && ['denied', 'failed', 'unknown', 'expired', 'error'].includes(currentStatus)) {
        const code = typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(error.code)
          ? error.code : 'ACTION_RESULT_UNVERIFIED';
        root.append(node('p', `오류 코드: ${code}`), node('p', `오류 안내: ${safeText(error.message)}`));
      } else if (currentStatus === 'error') {
        root.append(node('p', '요청 실패의 상세 원인은 확인할 수 없습니다.'));
      }
      const fields = node('dl');
      const addField = (label, value) => {
        if (typeof value === 'string' && value.trim()) fields.append(node('dt', label), node('dd', safeText(value)));
        else if (Number.isSafeInteger(value)) fields.append(node('dt', label), node('dd', String(value)));
      };
      addField('현재 사건 ID(event.id)', event?.id);
      addField('조치 ID(actionId)', actionId);
      addField('실제 대상 ID(target.id)', target?.id);
      addField('대상 세대(target.generation)', target?.generation);
      addField('요청 ID(requestId)', receipt?.requestId);
      addField('영수증 ID(receiptId)', receipt?.receiptId);
      addField('영수증 버전(version)', receipt?.version);
      if (fields.children.length > 0) root.append(fields);
      if (Array.isArray(event?.evidence) && event.evidence.length > 0) {
        const section = node('section');
        const ids = node('ul');
        for (const evidence of event.evidence) {
          if (typeof evidence?.id === 'string' && evidence.id.trim()) ids.append(node('li', safeText(evidence.id)));
        }
        if (ids.children.length > 0) {
          section.append(node('h4', '현재 사건 근거 ID'), ids);
          root.append(section);
        }
      }
      if (typeof receipt?.replayed === 'boolean') {
        root.append(node('p', `기존 요청 응답 재사용(replayed): ${receipt.replayed}`));
        if (receipt.replayed) root.append(node('p', '동일 요청의 기존 영수증 응답입니다. 새 조치가 실행됐다는 뜻이 아니며 실제 효과는 현재 관측 결과로 확인합니다.'));
      }
      if (typeof event?.id === 'string' && event.id.trim() && safeText(event.id) === event.id) {
        root.setAttribute('data-student-action-event', event.id);
      }
      if (typeof receipt?.requestId === 'string' && receipt.requestId.trim() && safeText(receipt.requestId) === receipt.requestId) {
        root.setAttribute('data-student-action-request', receipt.requestId);
      }
      root.append(node('p', '조치 화면 취소는 이미 서버에 전달된 조치의 효과를 되돌리지 않습니다.'));
      return root;
    },
  };
}
