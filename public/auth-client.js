// Browser transport for the same-origin Auth API. Credentials stay in HttpOnly cookies.
export function createServerAuthClient({ fetch: send = globalThis.fetch } = {}) {
  const listeners = new Set();
  let session = null;
  let revision = 0;
  let refreshing;
  let channel;
  let queue = Promise.resolve();
  const withSessionLock = callback => {
    if (globalThis.navigator?.locks?.request) return globalThis.navigator.locks.request('vault-auth-refresh', callback);
    const work = queue.then(callback, callback);
    queue = work.catch(() => {});
    return work;
  };
  const emit = event => { for (const listener of listeners) listener(event, session); };
  const safeSession = data => {
    if (data?.user === null) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(data?.user?.id ?? '')) {
      throw new Error('invalid_auth_response');
    }
    return { user: { id: data.user.id } };
  };
  const call = async (action, body) => {
    try {
      const response = await send(`/api/auth/${action}`, {
        method: action === 'session' ? 'GET' : 'POST', cache: 'no-store',
        credentials: 'same-origin', redirect: 'error',
        ...(action !== 'session' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) } : {}),
      });
      const data = await response.json();
      if (!response.ok) return { error: { code: typeof data?.error === 'string' ? data.error : 'unknown', status: response.status } };
      return { session: safeSession(data) };
    } catch { return { error: { name: 'AuthRetryableFetchError' } }; }
  };
  const refresh = async () => {
    if (!refreshing) {
      const current = revision;
      const run = async () => {
        // Another tab may already have refreshed the shared cookies.
        const existing = await call('session');
        const result = existing.error?.status === 401 ? await call('refresh') : existing;
        if (current === revision) {
          if (!result.error) {
            session = result.session;
            emit(session ? 'TOKEN_REFRESHED' : 'SIGNED_OUT');
          } else if (result.error.status === 401) {
            session = null;
            emit('SIGNED_OUT');
          }
        }
        return result;
      };
      refreshing = withSessionLock(run).finally(() => { refreshing = null; });
    }
    return refreshing;
  };
  const auth = {
    onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } }; },
    async getSession() {
      const current = revision;
      let result = await call('session');
      if (result.error?.status === 401) result = await refresh();
      if (current === revision && !result.error) session = result.session;
      return { data: { session }, error: result.error ?? null };
    },
    async signInWithPassword(input) {
      const current = ++revision;
      const result = await withSessionLock(() => call('login', input));
      if (current === revision && !result.error) { session = result.session; emit('SIGNED_IN'); channel?.postMessage('changed'); }
      return { data: { session }, error: result.error ?? null };
    },
    async signOut() {
      const current = ++revision;
      const result = await withSessionLock(() => call('logout'));
      if (current === revision && !result.error) { session = null; emit('SIGNED_OUT'); channel?.postMessage('changed'); }
      return { error: result.error ?? null };
    },
  };
  if (typeof window !== 'undefined') {
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('vault-auth-state') : null;
    const sync = async () => {
      const result = await auth.getSession();
      if (!result.error) emit(session ? 'TOKEN_REFRESHED' : 'SIGNED_OUT');
    };
    if (channel) {
      channel.onmessage = () => { void sync(); };
    }
    window.addEventListener('focus', () => { void sync(); });
  }
  return { auth, async fetch(url, options = {}) {
    const init = { ...options, credentials: 'same-origin' };
    let response = await send(url, init);
    if (response.status === 401) {
      const result = await refresh();
      if (!result.error && result.session) {
        await response.body?.cancel();
        response = await send(url, init);
      }
    }
    return response;
  } };
}
