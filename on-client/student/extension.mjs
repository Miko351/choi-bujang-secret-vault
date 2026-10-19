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
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
