// Display only: installation and browser connectivity never authorize a device or a note request.
export function mountWebAppUI({ document, window, navigator }) {
  const installation = document.querySelector('#app-install-status');
  const installButton = document.querySelector('#app-install');
  const network = document.querySelector('#app-network-status');
  const display = window.matchMedia('(display-mode: standalone)');
  let pendingPrompt = null;
  let installedEvent = false;
  const installed = () => display.matches || navigator.standalone === true || installedEvent;
  const renderInstallation = () => {
    installation.textContent = display.matches || navigator.standalone === true
      ? '설치형 앱 창에서 사용 중입니다. 기기 승인은 별도로 확인해야 합니다.'
      : installedEvent ? '자료실 앱이 설치되었습니다. 기기 승인은 별도로 확인해야 합니다.'
        : '브라우저에서 사용 중입니다. 지원하는 브라우저의 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택할 수 있습니다.';
    installButton.hidden = installed() || !pendingPrompt;
  };
  const renderNetwork = () => {
    network.textContent = navigator.onLine === false
      ? '오프라인입니다. 로그인과 메모 조회·추가·수정·삭제는 인터넷 연결 후 다시 시도해 주세요.'
      : '브라우저가 네트워크 연결을 감지했습니다. 실제 서버 연결 여부는 요청할 때 확인됩니다.';
  };
  window.addEventListener('online', renderNetwork);
  window.addEventListener('offline', renderNetwork);
  display.addEventListener?.('change', renderInstallation);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    pendingPrompt = event;
    installButton.disabled = false;
    renderInstallation();
  });
  window.addEventListener('appinstalled', () => {
    installedEvent = true;
    pendingPrompt = null;
    renderInstallation();
  });
  installButton.addEventListener('click', async () => {
    const prompt = pendingPrompt;
    if (!prompt || installed()) return;
    pendingPrompt = null;
    installButton.disabled = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
      // Accepting a prompt is not proof that installation or device approval finished.
      renderInstallation();
    } catch {
      renderInstallation();
      if (!installed()) installation.textContent = '설치 안내를 열지 못했습니다. 브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 확인해 주세요.';
    } finally { installButton.disabled = false; }
  });
  renderInstallation();
  renderNetwork();
}

if (globalThis.document && globalThis.window && globalThis.navigator) {
  mountWebAppUI({ document: globalThis.document, window: globalThis.window, navigator: globalThis.navigator });
}
