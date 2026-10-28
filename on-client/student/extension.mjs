// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
export function createStudentView() {
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
      return root;
    },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
