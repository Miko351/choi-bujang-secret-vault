// Keys remain in the authenticator. Only public WebAuthn ceremony messages cross this transport.
export function createDeviceClient({ fetch: send = globalThis.fetch, sdk = globalThis.SimpleWebAuthnBrowser } = {}) {
  const call = async (action, body) => {
    const response = await send(`/api/device-${action}`, { method:action === 'status'?'GET':'POST',
      credentials:'same-origin',cache:'no-store',redirect:'error',
      ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}) });
    const data = await response.json();
    if (!response.ok) throw new Error('DEVICE_REQUEST_FAILED');
    return data;
  };
  return {
    status: () => call('status'),
    async requestRegistration() {
      if (typeof sdk?.startRegistration !== 'function') throw new Error('DEVICE_UNSUPPORTED');
      const {challengeId,options} = await call('registration-options',{});
      const credential = await sdk.startRegistration({optionsJSON:options});
      return call('registration',{challengeId,credential});
    },
    async confirmDevice() {
      if (typeof sdk?.startAuthentication !== 'function') throw new Error('DEVICE_UNSUPPORTED');
      const {challengeId,options} = await call('authentication-options',{});
      const credential = await sdk.startAuthentication({optionsJSON:options});
      return call('authentication',{challengeId,credential});
    },
  };
}
