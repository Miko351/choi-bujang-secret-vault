import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {decide} from '../xdr/exfiltration/decide.mjs';

const sourceUrl = new URL('../xdr/exfiltration/decide.mjs', import.meta.url);
const fixtureUrl = new URL('../xdr/fixtures/exfiltration.json', import.meta.url);
const original = await readFile(fixtureUrl);
const alerts = JSON.parse(original).alerts;
const patterns = JSON.parse(await readFile(new URL('../xdr/exfiltration/patterns.json', import.meta.url), 'utf8')).patterns;
const sample = (description, data = {}, level = 6, mitre = ['T1041','T1048']) => ({rule: {description, level, mitre}, data});
const check = out => {
  assert.deepEqual(Object.keys(out).sort(), ['action','confidence','reason']);
  assert.ok(Number.isFinite(out.confidence) && out.confidence >= 0 && out.confidence <= 1);
  assert.equal(out.action, out.confidence >= 0.85 ? 'block' : out.confidence >= 0.5 ? 'alert' : 'record');
  assert.ok(typeof out.reason === 'string' && out.reason.length > 0 && !/[\r\n]/u.test(out.reason));
  assert.ok(out.reason === '일치 패턴 없음' || patterns.some(pattern => pattern.name === out.reason));
};

test('one isolated file exports only decide and embeds all three exact patterns without runtime access', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.ok(source.startsWith('const PATTERNS ='));
  assert.doesNotMatch(source, /\bimport\b|\brequire\b|\bprocess\b|\bfetch\b|\beval\b|\bFunction\b|\bconsole\b/u);
  const blocked = () => {throw new Error('EXTERNAL_ACCESS');};
  const isolated = runInNewContext(source.replace('export function decide','function decide') + '\n({decide,patterns:PATTERNS});',
    {fetch: blocked, require: blocked, console: {log: blocked, error: blocked}, process: new Proxy({}, {get: blocked})}, {timeout: 1000});
  assert.deepEqual(JSON.parse(JSON.stringify(isolated.patterns)), patterns);
  assert.deepEqual(Object.keys(await import(sourceUrl.href)), ['decide']);
  for (const alert of alerts) assert.deepEqual(JSON.parse(JSON.stringify(isolated.decide(alert))), decide(alert));
});

test('completed bulk or repeated outbound compounds and off-hours archives block independent of fixture labels', () => {
  for (const alert of alerts.slice(0,10)) {
    const out = decide(alert); check(out); assert.equal(out.action, 'block', alert.id);
    assert.deepEqual(decide({...alert, id: 'different', timestamp: 'invalid', rule: {...alert.rule, level: 1, mitre: []}}), out);
  }
  assert.equal(decide(alerts[0]).reason, patterns[0].name);
  assert.equal(decide(alerts[3]).reason, patterns[1].name);
  assert.equal(decide(alerts[1]).reason, patterns[2].name);
  for (const alert of [
    sample('처음 보는 목적지로 자료를 전송했습니다.', {bytes: '55000000', files: '4'}),
    sample('업무 시간 밖에 압축 파일을 전송했습니다.'),
    sample('명령 통로와 다른 프로토콜로 대용량 파일을 전송했습니다.'),
    sample('같은 목적지로 대용량 전송이 7번 반복됐습니다.'),
  ]) assert.equal(decide(alert).action, 'block');
});

test('small, incomplete, failed, uncertain backup and one-off volume warnings alert without claiming completed theft', () => {
  for (const alert of alerts.slice(10,20)) { const out = decide(alert); check(out); assert.equal(out.action, 'alert', alert.id); }
  for (const alert of [
    sample('처음 보는 주소로 작은 파일이 나갔습니다.', {bytes: '1000'}),
    sample('수업 시간 밖에 압축 파일을 만들었습니다. 외부 전송은 아직 없습니다.', {bytes: '600000000'}),
    sample('처음 보는 주소로 대용량 전송이 실패 8건입니다.', {bytes: '0', count: '8'}),
    sample('처음 보는 주소로 대용량 전송이 취소됐습니다.', {bytes: '90000000'}),
    sample('처음 보는 목적지로 대용량 자료가 나갔습니다.', {bytes: '0'}),
  ]) assert.equal(decide(alert).action, 'alert');
});

test('ordinary events and approved backups stay record even with elevated tags, counts and levels', () => {
  for (const alert of alerts.slice(20)) {
    check(decide(alert)); assert.equal(decide(alert).action, 'record');
    assert.equal(decide({...alert, rule: {...alert.rule, level: 15, mitre: ['T1041','T1048']}, data: {...alert.data, bytes: '999999999', files: '999', count: '99'}}).action, 'record');
  }
  for (const description of [
    '승인된 백업으로 처음 보는 목적지로 대용량 자료를 전송했습니다.',
    '정기 백업으로 업무 시간 밖에 압축 파일을 전송했습니다.',
    '자료실 화면을 열었습니다.',
    '평소 자료 주소와 동기화가 끝났습니다.',
  ]) assert.equal(decide(sample(description, {bytes: '999999999', count: '99'}, 15)).action, 'record');
});

test('size alone, archive creation alone and unknown destination or schedule never become block evidence', () => {
  for (const alert of [
    sample('자료를 전송했습니다.', {bytes: '300000000', files: '400'}),
    sample('압축 파일을 전송했습니다.', {bytes: '300000000'}),
    sample('처음 보는 주소입니다.', {bytes: '300000000', files: '400'}),
    sample('처음 보는 주소는 아닙니다. 큰 파일은 아닙니다. 자료를 전송했습니다.', {bytes: '3000'}),
    sample('업무 시간 밖은 아닙니다. 압축 파일을 전송했습니다.'),
    sample('명령 통로와 다른 프로토콜은 아닙니다. 자료를 전송했습니다.', {bytes: '500000000'}),
  ]) assert.notEqual(decide(alert).action, 'block');
  const ordinary = sample('압축 파일을 전송했습니다.', {bytes: '1000'});
  for (const timestamp of ['2026-10-14T03:00:00+09:00','2026-10-14T13:00:00+09:00','invalid']) {
    assert.deepEqual(decide({...ordinary, timestamp}), decide(ordinary));
  }
});

test('threshold boundaries, numeric types and descriptive evidence control the response', () => {
  const warning = decide(sample('수업 시간에 압축 파일을 만들었습니다. 외부 전송은 없습니다.'));
  assert.equal(warning.confidence, 0.5); assert.equal(warning.action, 'alert');
  const block = decide(sample('처음 보는 목적지로 자료를 전송했습니다.', {bytes: '50000000'}));
  assert.equal(block.confidence, 0.85); assert.equal(block.action, 'block');
  assert.equal(decide(sample('처음 보는 목적지로 자료를 전송했습니다.', {bytes: '49999999'})).action, 'alert');
  for (const bytes of [true, {}, [], 'bad', '-1', 'Infinity', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(decide(sample('처음 보는 목적지로 자료를 전송했습니다.', {bytes})).action, 'alert');
  }
});

test('malformed input returns valid output with static reasons, no sensitive reads, mutation or shared state', () => {
  for (const value of [null, undefined, true, 1, '', [], {}, {rule: {description: [], level: 'bad', mitre: 'T1041'}, data: null}]) check(decide(value));
  const alert = structuredClone(alerts[0]);
  const secret = ['training','credential','only'].join('-'); alert.rule.description += ' token=' + secret;
  const unreadable = {get() {throw new Error('UNRELATED_FIELD_READ');}};
  for (const name of ['password','token','full_log','srcuser','srcip','dstip','protocol']) Object.defineProperty(alert.data, name, unreadable);
  for (const name of ['timestamp','id','agent']) Object.defineProperty(alert, name, unreadable);
  Object.freeze(alert.data); Object.freeze(alert.rule); Object.freeze(alert);
  const before = decide(alert); check(before); assert.equal(before.action, 'block');
  assert.ok(!JSON.stringify(before).includes(secret)); assert.ok(!JSON.stringify(before).includes(alert.rule.description));
  decide(sample('정상 조회', {}, 3, [])); assert.deepEqual(decide(alert), before);
});

test('all thirty original alerts receive valid decisions with normal events unblocked and original bytes preserved', async () => {
  const counts = {block: 0, alert: 0, record: 0};
  for (const alert of alerts) {const out = decide(alert); check(out); counts[out.action]++;}
  assert.deepEqual(counts, {block: 10, alert: 10, record: 10});
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(await readFile(fixtureUrl)), hash(original));
});