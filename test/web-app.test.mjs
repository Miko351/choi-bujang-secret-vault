import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { mountWebAppUI } from '../public/app-ui.js';

function fixture({ online = true, standalone = false, appleStandalone = false } = {}) {
  const nodes = Object.fromEntries(['app-install-status', 'app-install', 'app-network-status',
    'device-approval-status'].map(id => [id, { textContent: id === 'device-approval-status' ? '기기 승인: 미확인' : '',
    hidden: true, disabled: false, listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; } }]));
  const listeners = {};
  const media = { matches: standalone, addEventListener(type, callback) { this[type] = callback; } };
  const nav = { onLine: online, standalone: appleStandalone };
  const forbidden = () => { throw new Error('App display must not access credentials, storage or transport'); };
  const win = { matchMedia(query) { assert.equal(query, '(display-mode: standalone)'); return media; },
    addEventListener(type, callback) { listeners[type] = callback; } };
  for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'fetch']) {
    Object.defineProperty(win, key, { get: forbidden });
  }
  Object.defineProperty(nav, 'serviceWorker', { get: forbidden });
  const document = { querySelector(selector) {
    assert.ok(Object.hasOwn(nodes, selector.slice(1)), 'Do not change the login, memo or approval UI');
    return nodes[selector.slice(1)];
  } };
  mountWebAppUI({ document, window: win, navigator: nav });
  return { nodes, listeners, media, nav };
}

test('manifest launches the existing same-origin app and supplies real 192/512 PNG icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'BYTE BACK 내 자료실');
  assert.equal(manifest.short_name, '내 자료실');
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.prefer_related_applications, false);
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    assert.match(icon.src, /^\/icons\/vault-(192|512)\.png$/u);
    const bytes = await readFile(new URL(`../public${icon.src}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    const size = Number(icon.sizes.split('x')[0]);
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/u);
  assert.match(html, /src="\/auth-ui.js"/u);
  assert.match(html, /기기 승인: 미확인/u);
  assert.match(html, /앱 설치나 로그인 성공은 기기 승인을 뜻하지 않습니다/u);
  assert.match(html, /인터넷 연결이 필요/u);
});

test('offline and online display changes neither device approval nor authentication and uses no persistence', () => {
  const f = fixture({ online: false });
  assert.match(f.nodes['app-network-status'].textContent, /오프라인.*인터넷 연결 후/u);
  assert.equal(f.nodes['app-install'].hidden, true);
  f.nav.onLine = true;
  f.listeners.online();
  assert.match(f.nodes['app-network-status'].textContent, /실제 서버 연결 여부는 요청할 때/u);
  f.nav.onLine = false;
  f.listeners.offline();
  assert.match(f.nodes['app-network-status'].textContent, /오프라인/u);
  assert.equal(f.nodes['device-approval-status'].textContent, '기기 승인: 미확인');
});

test('install prompts require a click, are single use, and acceptance cannot approve a device', async () => {
  const f = fixture();
  let prompts = 0;
  let prevented = 0;
  f.listeners.beforeinstallprompt({ preventDefault() { prevented++; },
    async prompt() { prompts++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  assert.equal(prevented, 1);
  assert.equal(prompts, 0);
  assert.equal(f.nodes['app-install'].hidden, false);
  await f.nodes['app-install'].listeners.click();
  await f.nodes['app-install'].listeners.click();
  assert.equal(prompts, 1);
  assert.match(f.nodes['app-install-status'].textContent, /브라우저에서 사용 중/u);
  f.listeners.appinstalled();
  assert.equal(f.nodes['app-install'].hidden, true);
  assert.match(f.nodes['app-install-status'].textContent, /앱이 설치되었습니다.*별도로/u);
  assert.equal(f.nodes['device-approval-status'].textContent, '기기 승인: 미확인');
});

test('standalone, dismissal and failed install keep approval unknown and preserve menu fallback', async () => {
  for (const options of [{ standalone: true }, { appleStandalone: true }]) {
    const f = fixture(options);
    assert.match(f.nodes['app-install-status'].textContent, /앱 창에서 사용 중.*별도로/u);
    assert.equal(f.nodes['app-install'].hidden, true);
    assert.equal(f.nodes['device-approval-status'].textContent, '기기 승인: 미확인');
  }
  const f = fixture();
  f.listeners.beforeinstallprompt({ preventDefault() {}, async prompt() {},
    userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  await f.nodes['app-install'].listeners.click();
  assert.match(f.nodes['app-install-status'].textContent, /브라우저.*메뉴/u);
  f.listeners.beforeinstallprompt({ preventDefault() {}, async prompt() { throw new Error('PRIVATE_DETAILS'); } });
  await f.nodes['app-install'].listeners.click();
  assert.match(f.nodes['app-install-status'].textContent, /설치 안내를 열지 못했습니다.*브라우저 메뉴/u);
  assert.doesNotMatch(f.nodes['app-install-status'].textContent, /PRIVATE_DETAILS/u);
  f.media.matches = true;
  f.media.change();
  assert.match(f.nodes['app-install-status'].textContent, /앱 창에서 사용 중/u);
  assert.equal(f.nodes['device-approval-status'].textContent, '기기 승인: 미확인');
});
