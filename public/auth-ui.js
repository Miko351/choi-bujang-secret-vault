import { createDeviceClient } from './device-client.js';
import { createServerAuthClient } from './auth-client.js';

function failureReason(error) {
  const reasons = {
    invalid_credentials: '이메일 또는 비밀번호가 맞지 않습니다.',
    email_not_confirmed: '이메일 인증을 완료한 뒤 로그인해 주세요.',
    user_banned: '로그인이 제한된 계정입니다.',
    over_request_rate_limit: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    over_email_send_rate_limit: '이메일 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    email_provider_disabled: '프로젝트에서 이메일 로그인을 사용할 수 없습니다.',
    session_not_found: '세션이 만료되었습니다. 다시 로그인해 주세요.',
    refresh_token_not_found: '세션이 만료되었습니다. 다시 로그인해 주세요.',
    refresh_token_already_used: '세션이 만료되었습니다. 다시 로그인해 주세요.',
  };
  if (Object.hasOwn(reasons, error?.code)) return reasons[error.code];
  if (error?.name === 'AuthRetryableFetchError' || error?.name === 'TypeError') {
    return '로그인 서버에 연결하지 못했습니다. 네트워크와 프로젝트 설정을 확인해 주세요.';
  }
  if (error?.status >= 500) return '로그인 서버 오류입니다. 잠시 후 다시 시도해 주세요.';
  if (error?.status === 429) return reasons.over_request_rate_limit;
  // Raw SDK messages can contain request details; display only safe reasons.
  return '인증 요청을 처리하지 못했습니다. 프로젝트 설정을 확인한 뒤 다시 시도해 주세요.';
}

export async function mountAuthUI({ document, createClient = createServerAuthClient, fetch: fetchNotes = globalThis.fetch, deviceClient }) {
  const form = document.querySelector('#login-form');
  const email = document.querySelector('#login-email');
  const password = document.querySelector('#login-password');
  const login = document.querySelector('#login-button');
  const logout = document.querySelector('#logout-button');
  const status = document.querySelector('#auth-status');
  const errorBox = document.querySelector('#auth-error');
  const notes = document.querySelector('#notes');
  const editor = document.querySelector('#note-editor');
  const noteForm = document.querySelector('#note-form');
  const noteHeading = document.querySelector('#note-heading');
  const noteTitle = document.querySelector('#note-title');
  const noteBody = document.querySelector('#note-body');
  const noteSave = document.querySelector('#note-save');
  const noteCancel = document.querySelector('#note-cancel');
  const noteStatus = document.querySelector('#note-status');
  const deviceStatus = document.querySelector('#device-approval-status');
  const deviceRequestId = document.querySelector('#device-request-id');
  const registerDevice = document.querySelector('#device-register');
  const checkDeviceButton = document.querySelector('#device-check');
  let deviceRegistered = false;
  let deviceBusy = false;
  let deviceUser = null;
  let deviceRevision = 0;
  let signedIn = false;
  let busy = true;
  let noteRevision = 0;
  let noteRequest;
  let noteUser = null;
  let currentSession = null;
  let activeUser = null;
  let sessionRevision = 0;
  let editingId = null;
  let mutationBusy = false;
  let mutationRequest;
  let cardButtons = [];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

  const syncNoteControls = () => {
    for (const control of [noteTitle, noteBody, noteSave, noteCancel, ...cardButtons]) {
      control.disabled = mutationBusy || busy || !noteUser || !deviceRegistered;
    }
    noteForm.setAttribute('aria-busy', String(mutationBusy));
  };
  const resetEditor = () => {
    editingId = null;
    noteTitle.value = '';
    noteBody.value = '';
    noteHeading.textContent = '가상 메모 추가';
    noteSave.textContent = '추가';
    noteCancel.hidden = true;
  };

  const noteMessage = message => {
    cardButtons = [];
    const item = document.createElement('li');
    item.textContent = message;
    notes.replaceChildren(item);
  };
  const refreshNotes = (session, force = false) => {
    const user = session?.user && typeof session.user.id === 'string' ? session.user.id : null;
    if (user && user === noteUser && !force) return;
    noteUser = user;
    const revision = ++noteRevision;
    noteRequest?.abort();
    if (!user) {
      noteMessage('로그인 후 자료를 볼 수 있습니다.');
      return;
    }
    const controller = new AbortController();
    noteRequest = controller;
    noteMessage('메모를 불러오는 중입니다.');
    // Server verifies the HttpOnly cookie. UI state is never an authorization claim.
    void (async () => {
      try {
        const response = await fetchNotes('/api/notes', {
          cache: 'no-store', credentials: 'same-origin', redirect: 'error',
          signal: controller.signal,
        });
        if (revision !== noteRevision) return;
        if (response.status === 403) { lockDevice('기기 승인 확인이 필요합니다. 이 기기를 다시 확인해 주세요.'); return; }
        if (response.status === 401) {
          noteMessage('로그인 확인에 실패했습니다. 다시 로그인해 주세요.');
          return;
        }
        if (response.status === 503) {
          noteMessage('자료 서버의 로그인 연결 설정이 필요합니다.');
          return;
        }
        if (!response.ok) throw new Error('메모를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.');
        const data = await response.json();
        if (revision !== noteRevision) return;
        if (!Array.isArray(data) || data.some(note => !UUID.test(note?.id ?? '')
          || typeof note.title !== 'string' || typeof note.body !== 'string')) {
          throw new Error('자료 형식이 맞지 않습니다.');
        }
        cardButtons = [];
        if (data.length === 0) noteMessage('아직 메모가 없습니다.');
        else notes.replaceChildren(...data.map(note => {
          const item = document.createElement('li');
          const title = document.createElement('strong');
          const content = document.createElement('span');
          title.textContent = note.title;
          content.textContent = note.body;
          const actions = document.createElement('div');
          actions.className = 'actions';
          const edit = document.createElement('button');
          edit.type = 'button';
          edit.textContent = '수정';
          edit.setAttribute('aria-label', `${note.title} 수정`);
          edit.addEventListener('click', async () => {
            const result = await noteOperation('GET', note.id);
            if (!result) return;
            editingId = result.id;
            noteTitle.value = result.title;
            noteBody.value = result.body;
            noteHeading.textContent = '가상 메모 수정';
            noteSave.textContent = '수정 저장';
            noteCancel.hidden = false;
            noteStatus.textContent = '메모를 수정한 뒤 저장해 주세요.';
            noteTitle.focus();
          });
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'danger';
          remove.textContent = '삭제';
          remove.setAttribute('aria-label', `${note.title} 삭제`);
          remove.addEventListener('click', async () => {
            if (!await noteOperation('DELETE', note.id)) return;
            if (editingId === note.id) resetEditor();
            noteStatus.textContent = '메모를 삭제했습니다.';
            refreshNotes(currentSession, true);
          });
          cardButtons.push(edit, remove);
          actions.append(edit, remove);
          item.append(title, content, actions);
          return item;
        }));
        syncNoteControls();
      } catch {
        // Do not expose network exceptions, tokens or untrusted API errors.
        if (revision === noteRevision) noteMessage('자료를 불러오지 못했습니다. 로그인 상태와 서버 설정을 확인해 주세요.');
      }
    })();
  };

  const noteOperation = async (method, id, input) => {
    if (!signedIn || !deviceRegistered || !noteUser || mutationBusy || busy) return null;
    const revision = sessionRevision;
    const controller = new AbortController();
    mutationRequest = controller;
    mutationBusy = true;
    syncNoteControls();
    noteStatus.textContent = '요청을 처리하는 중입니다.';
    try {
      const response = await fetchNotes(id ? `/api/notes/${encodeURIComponent(id)}` : '/api/notes', {
        method, cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
        headers: { ...(input ? { 'Content-Type': 'application/json' } : {}) },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
      if (revision !== sessionRevision) return null;
      if (response.status === 403) { lockDevice('기기 승인 확인이 필요합니다. 이 기기를 다시 확인해 주세요.'); return null; }
      if (!response.ok) {
        const reasons = {
          400: '제목·내용·메모 ID 형식을 확인해 주세요.',
          401: '로그인 확인에 실패했습니다. 다시 로그인해 주세요.',
          404: '메모를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.',
          409: '같은 ID의 메모가 이미 있습니다.',
          415: '자료 요청 형식이 맞지 않습니다.',
          503: '자료 서버의 로그인 연결 설정이 필요합니다.',
        };
        noteStatus.textContent = reasons[response.status] ?? '자료 요청을 처리하지 못했습니다. 서버 설정과 연결을 확인해 주세요.';
        return null;
      }
      const data = method === 'DELETE' ? {} : await response.json();
      if (revision !== sessionRevision) return null;
      if (method !== 'DELETE' && (!UUID.test(data?.id ?? '') || (method === 'GET'
        && (typeof data.title !== 'string' || typeof data.body !== 'string')))) {
        noteStatus.textContent = '자료 응답 형식이 맞지 않습니다.';
        return null;
      }
      return data;
    } catch {
      if (revision === sessionRevision) noteStatus.textContent = '자료 요청을 처리하지 못했습니다. 연결을 확인해 주세요.';
      return null;
    } finally {
      if (revision === sessionRevision) {
        mutationBusy = false;
        mutationRequest = null;
        syncNoteControls();
      }
    }
  };

  noteForm.addEventListener('submit', async event => {
    event.preventDefault();
    const updating = Boolean(editingId);
    const result = await noteOperation(updating ? 'PUT' : 'POST', editingId, {
      title: noteTitle.value, body: noteBody.value,
    });
    if (!result) return;
    resetEditor();
    noteStatus.textContent = updating ? '메모를 수정했습니다.' : '메모를 추가했습니다.';
    refreshNotes(currentSession, true);
  });
  noteCancel.addEventListener('click', () => {
    if (mutationBusy || busy) return;
    resetEditor();
    noteStatus.textContent = '수정을 취소했습니다.';
  });

  const showError = message => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };
  const syncDeviceControls = () => {
    registerDevice.disabled = !signedIn || busy || deviceBusy || deviceRegistered;
    checkDeviceButton.disabled = !signedIn || busy || deviceBusy;
  };
  const lockDevice = message => {
    deviceRegistered = false;
    sessionRevision++;
    mutationRequest?.abort();
    mutationRequest = null;
    mutationBusy = false;
    resetEditor();
    noteStatus.textContent = '';
    refreshNotes(null);
    noteMessage('로그인 후 기기 승인 확인 전에는 보호 자료를 표시하지 않습니다.');
    editor.hidden = true;
    deviceStatus.textContent = message;
    deviceRequestId.textContent = '';
    syncNoteControls();
    syncDeviceControls();
  };
  const deviceMessages = {
    not_registered: '기기 승인: 미등록. 이 기기에서 승인 요청을 시작해 주세요.',
    verification_required: '기기 승인: 재확인 필요. 이 기기 확인 버튼을 눌러 주세요.',
    pending: '기기 승인: 대기 중. 요청이 접수됐으며 아직 자료를 열 수 없습니다.',
    approved: '기기 승인: 서버 확인 완료.',
    rejected: '기기 승인: 거절됨. 보호 자료를 열 수 없습니다.',
    revoked: '기기 승인: 회수됨. 보호 자료를 열 수 없습니다.',
  };
  const refreshDevice = async (session, action = 'status', force = false) => {
    const user = session?.user?.id ?? null;
    if (!force && user && user === deviceUser) return;
    deviceUser = user;
    const revision = ++deviceRevision;
    lockDevice(user ? '기기 승인 상태를 서버에서 확인 중입니다.' : '기기 승인: 미확인. 먼저 로그인해 주세요.');
    if (!user) { deviceBusy = false; syncDeviceControls(); return; }
    deviceBusy = true;
    syncDeviceControls();
    try {
      let state = action === 'register' ? await deviceClient.requestRegistration() : await deviceClient.status();
      if (action === 'confirm' && ['not_registered','verification_required'].includes(state?.status)) state = await deviceClient.confirmDevice();
      if (revision !== deviceRevision || currentSession?.user?.id !== user) return;
      if (!state || !Object.hasOwn(deviceMessages,state.status) || typeof state.deviceRegistered !== 'boolean'
          || state.deviceRegistered !== (state.status === 'approved')) throw new Error('INVALID_DEVICE_STATE');
      deviceRegistered = state.deviceRegistered;
      deviceStatus.textContent = deviceMessages[state.status];
      if (UUID.test(state.requestId ?? '')) deviceRequestId.textContent = `승인 요청 번호: ${state.requestId}`;
      if (deviceRegistered) {
        refreshNotes(session, true);
        editor.hidden = false;
        syncNoteControls();
      }
    } catch {
      if (revision === deviceRevision) lockDevice('기기 승인: 확인 실패. 서버 설정·연결·인증 장치 지원을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      if (revision === deviceRevision) { deviceBusy = false; syncDeviceControls(); }
    }
  };
  registerDevice.addEventListener('click', () => {
    if (!signedIn || busy || deviceBusy || deviceRegistered) return;
    void refreshDevice(currentSession,'register',true);
  });
  checkDeviceButton.addEventListener('click', () => {
    if (!signedIn || busy || deviceBusy) return;
    void refreshDevice(currentSession,'confirm',true);
  });
  const render = session => {
    currentSession = session;
    const nextUser = session?.user?.id ?? null;
    if (nextUser !== activeUser) {
      activeUser = nextUser;
      sessionRevision++;
      mutationRequest?.abort();
      mutationRequest = null;
      mutationBusy = false;
      resetEditor();
      noteStatus.textContent = '';
    }
    signedIn = Boolean(session?.user);
    status.textContent = signedIn ? '로그인됨' : '로그아웃됨';
    form.hidden = signedIn;
    logout.hidden = !signedIn;
    form.setAttribute('aria-busy', String(busy));
    for (const control of [email, password, login, logout]) control.disabled = busy;
    if (signedIn) password.value = '';
    void refreshDevice(session);
    editor.hidden = !signedIn || !deviceRegistered;
    syncNoteControls();
    syncDeviceControls();
  };
  const idle = () => {
    busy = false;
    form.setAttribute('aria-busy', 'false');
    for (const control of [email, password, login, logout]) control.disabled = false;
    syncNoteControls();
    syncDeviceControls();
  };

  deviceClient ??= createDeviceClient({ fetch: (...args) => fetchNotes(...args) });
  render(null);
  if (typeof createClient !== 'function') {
    showError('로그인 SDK를 불러오지 못했습니다. 페이지를 새로 고침해 주세요.');
    return;
  }

  let client;
  try {
    client = createClient({ fetch: fetchNotes });
    fetchNotes = client.fetch ?? fetchNotes;
  } catch {
    showError('로그인 연결 정보를 확인해 주세요.');
    return;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || signedIn) return;
    busy = true;
    render(null);
    showError('');
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.value.trim(), password: password.value,
      });
      if (error) showError(`로그인 실패: ${failureReason(error)}`);
      else if (data?.session?.user) render(data.session);
      else showError('로그인 실패: 세션을 받지 못했습니다. 다시 시도해 주세요.');
    } catch (error) {
      showError(`로그인 실패: ${failureReason(error)}`);
    } finally {
      password.value = '';
      idle();
    }
  });

  logout.addEventListener('click', async () => {
    if (busy || !signedIn) return;
    busy = true;
    for (const control of [email, password, login, logout]) control.disabled = true;
    syncNoteControls();
    showError('');
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) showError(`로그아웃 실패: ${failureReason(error)}`);
      else render(null);
    } catch (error) {
      showError(`로그아웃 실패: ${failureReason(error)}`);
    } finally {
      password.value = '';
      idle();
    }
  });

  // Subscribe synchronously; callbacks never make another Auth request.
  let stateChanges = 0;
  client.auth.onAuthStateChange((event, session) => {
    stateChanges++;
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') showError('');
    render(session);
    if (event === 'TOKEN_REFRESHED' && session?.user) void refreshDevice(session,'status',true);
  });
  const initialRevision = stateChanges;
  try {
    const { data, error } = await client.auth.getSession();
    if (error) showError(`세션 확인 실패: ${failureReason(error)}`);
    else if (stateChanges === initialRevision) render(data?.session);
  } catch (error) {
    showError(`세션 확인 실패: ${failureReason(error)}`);
  } finally {
    idle();
  }
}

if (globalThis.document) {
  await mountAuthUI({
    document: globalThis.document,
  });
}
