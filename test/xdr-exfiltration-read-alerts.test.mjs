import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { extractAlerts, readAlerts } from '../xdr/exfiltration/read-alerts.mjs';

const fixtureUrl = new URL('../xdr/fixtures/exfiltration.json', import.meta.url);
const readerUrl = new URL('../xdr/exfiltration/read-alerts.mjs', import.meta.url);
const fixture = alerts => ({schema:'aleph.xdr.fixture.v1',moduleKey:'exfiltration',alerts});
const sample = () => ({timestamp:'2026-09-27T09:12:01+09:00',
  data:{srcip:'203.0.113.10',srcuser:'user01'},rule:{level:12,description:'가상 자료 전송 경보입니다.'}});
const keys = ['timestamp','srcip','srcuser','level','description'];
const digest = value => createHash('sha256').update(value).digest('hex');

test('inspection outputs one safe JSON line per original alert and leaves the fixture unchanged', async () => {
  const before = await readFile(fixtureUrl);
  const input = JSON.parse(before);
  const rows = await readAlerts();
  const child = spawnSync(process.execPath,[fileURLToPath(readerUrl)],{encoding:'utf8',windowsHide:true});
  assert.equal(child.status,0);
  const lines = child.stdout.trimEnd().split(/\r?\n/u);
  assert.equal(lines.length,input.alerts.length);
  assert.equal(rows.length,input.alerts.length);
  assert.deepEqual(lines.map(line=>JSON.parse(line)),rows);
  for (const row of rows) assert.deepEqual(Object.keys(row),keys);
  assert.equal(child.stderr,`경보 ${input.alerts.length}건 · 출력 ${lines.length}줄\n`);
  assert.equal(digest(await readFile(fixtureUrl)),digest(before));
});

test('projection never reads unrelated full logs, credentials, agent or data fields', () => {
  const alert = sample();
  const unreadable = {get(){throw new Error('UNSELECTED_FIELD_READ');}};
  for (const name of ['agent','full_log','id']) Object.defineProperty(alert,name,unreadable);
  for (const name of ['password','token','accounts','dstip','bytes','files']) Object.defineProperty(alert.data,name,unreadable);
  Object.defineProperty(alert.rule,'mitre',unreadable);
  const row = extractAlerts(fixture([alert]))[0];
  assert.deepEqual(row,{timestamp:alert.timestamp,srcip:'203.0.113.10',srcuser:'user01',level:12,description:'가상 자료 전송 경보입니다.'});
});

test('secret-like selected text is fully redacted and typed fields cannot echo credentials', () => {
  const fake = ['training','only','opaque','value'].join('-');
  const jwt = [Buffer.from(JSON.stringify({typ:'JWT'})).toString('base64url'),Buffer.from('{}').toString('base64url'),'sample-signature'].join('.');
  const values = ['password='+fake,'토큰: '+fake,'Authorization: Bearer '+fake,
    ['sb','secret',fake].join('_'),['sb','publishable',fake].join('_'),
    'https://example.invalid:'+fake+'@example.invalid/',
    ['user','example.invalid'].join('@'),jwt,'a'.repeat(64),
    ['-----BEGIN','PRIVATE KEY-----'].join(' ')];
  for (const value of values) {
    const alert = sample();
    alert.rule.description = value;alert.data.srcuser = value;
    alert.timestamp = value;alert.data.srcip = value;alert.rule.level = value;
    const row = extractAlerts(fixture([alert]))[0];
    assert.ok(row.description==='[가림]' && row.srcuser==='[가림]','selected sensitive text must be masked');
    assert.ok(row.timestamp===null && row.srcip===null && row.level===null,'typed fields must reject sensitive strings');
    assert.ok(!JSON.stringify(row).includes(fake),'secret fragment leaked');
  }
});

test('missing fields and multiline descriptions preserve exactly one row and five fields', () => {
  const alert = sample();alert.rule.description='첫 줄\n다음 줄\u001b\u2028끝';
  const rows = extractAlerts(fixture([null,{},alert]));
  assert.equal(rows.length,3);
  for (const row of rows) assert.deepEqual(Object.keys(row),keys);
  assert.ok(Object.values(rows[0]).every(value=>value===null));
  assert.ok(!JSON.stringify(rows[2]).includes('\n'));
  assert.equal(rows[2].description,'첫 줄 다음 줄  끝');
});

test('invalid inputs expose only fixed errors and importing the reader prints nothing', async () => {
  assert.throws(()=>extractAlerts({schema:'other',alerts:[]}),/^Error: ALERT_FIXTURE_INVALID$/u);
  await assert.rejects(readAlerts(new URL('../xdr/fixtures/absent-reader-input.json',import.meta.url)),/^Error: ALERT_INPUT_INVALID$/u);
  const child = spawnSync(process.execPath,['--input-type=module','--eval',`await import(${JSON.stringify(readerUrl.href)});`],{encoding:'utf8',windowsHide:true});
  assert.equal(child.status,0);assert.equal(child.stdout,'');assert.equal(child.stderr,'');
});