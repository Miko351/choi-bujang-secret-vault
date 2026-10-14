import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import {decide} from '../xdr/web-injection/decide.mjs';

const sourceUrl = new URL('../xdr/web-injection/decide.mjs', import.meta.url);
const fixtureUrl = new URL('../xdr/fixtures/web-injection.json', import.meta.url);
const sample = (description = '', url = '/search?q=week3', count = 1, level = 6) => ({
  rule:{description,level,mitre:['T1190']},data:{url,count:String(count),srcip:'192.0.2.10'},
});
const check = value => {
  assert.deepEqual(Object.keys(value).sort(), ['action','confidence','reason']);
  assert.ok(Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1);
  assert.equal(value.action, value.confidence >= 0.85 ? 'block' : value.confidence >= 0.5 ? 'alert' : 'record');
  assert.ok(typeof value.reason === 'string' && value.reason.length > 0 && !/[\r\n]/u.test(value.reason));
};

test('one isolated file exports only decide and embeds exactly the three documented patterns', async () => {
  const source = await readFile(sourceUrl,'utf8');
  assert.ok(source.startsWith('const PATTERNS ='));
  assert.doesNotMatch(source,/\bimport\b|\brequire\b|\bprocess\b|\bfetch\b|\beval\b|\bFunction\b/u);
  const blocked = () => { throw new Error('EXTERNAL_ACCESS'); };
  const isolated = runInNewContext(source.replace('export function decide','function decide') + '\n({decide,patterns:PATTERNS});',
    {fetch:blocked,require:blocked,console:{log:blocked,error:blocked},process:new Proxy({},{get:blocked})}, {timeout:1000});
  const patterns = JSON.parse(await readFile(new URL('../xdr/web-injection/patterns.json',import.meta.url),'utf8')).patterns;
  assert.deepEqual(JSON.parse(JSON.stringify(isolated.patterns)), patterns);
  assert.deepEqual(Object.keys(await import(sourceUrl.href)), ['decide']);
  for (const item of JSON.parse(await readFile(fixtureUrl,'utf8')).alerts) {
    assert.deepEqual(JSON.parse(JSON.stringify(isolated.decide(item))),decide(item));
  }
});

test('explicit SQL combinations, script tags and repeated traversal block, including encoded values', () => {
  for (const url of [
    '/search?q=UNION SELECT title FROM notes',
    '/search?q=%27%20OR%20%271%27%3D%271',
    '/search?q=%253Cscript%253Eexample%253C%252Fscript%253E',
    '/search?q=<script>example</script>',
    '/files?path=../../training.txt',
    '/files?path=%2e%2e%2f%2e%2e%2ftraining.txt',
    '/../../training.txt',
  ]) { const out=decide(sample('',url)); check(out); assert.equal(out.action,'block'); }
});

test('aggregated structural pattern descriptions block without depending on fixture IDs or marker strings', () => {
  for (const description of [
    'SQL 구문을 이어 붙인 요청이 12번 반복됐습니다.',
    '스크립트 삽입 표기가 9번 반복됐습니다.',
    '경로를 여러 단계 거슬러 올라가는 표기가 8번 반복됐습니다.',
    '데이터베이스 조회를 이어 붙이는 표기가 10번 반복됐습니다.',
    'Repeated SQL injection in 12 requests',
  ]) {
    const out=decide(sample(description,'/unrelated?input=training',0,3)); check(out); assert.equal(out.action,'block');
  }
});

test('partial pattern evidence alerts and thresholds include exactly 0.5 and 0.85', () => {
  const partial=decide(sample('검색어에 따옴표가 한 번 있습니다. 반복은 없습니다.'));
  assert.equal(partial.confidence,0.5); assert.equal(partial.action,'alert');
  assert.equal(decide(sample('','/files?path=../training.txt')).action,'alert');
  assert.equal(decide(sample('SQL 주입 표기가 1건입니다.')).action,'alert');
  const clear=decide(sample('SQL 주입 요청 5건입니다.','/search?q=training',5,3));
  assert.equal(clear.confidence,0.85); assert.equal(clear.action,'block');
});

test('normal words, negations, high levels, MITRE tags and counts alone never prove injection', () => {
  for (const alert of [
    sample('주소에 select 라는 수업명이 한 번 있습니다.','/search?q=select-course',1,12),
    sample('스크립트라는 수업 단어입니다. 삽입 표식은 아닙니다.','/search?q=script-class',1,12),
    sample('SQL 이라는 수업 공지 제목을 조회했습니다.','/search?q=sql-class-notice',1,12),
    sample('경로에 up 이 한 번 있습니다.','/files?path=up-notes',1,12),
    sample('공격 표기는 없습니다.','/search?q=week3',1000,12),
    sample('SQL 주입은 없습니다.','/search?q=week3',1000,12),
    sample('경로 이탈이 없습니다.','/files?path=training.txt',1000,12),
    sample('정상 조회','/search?q=O%27Reilly',1000,12),
    sample('정상 조회','/search?%3Cscript%3E=week3',1000,12),
    sample('명령 구분자만 있습니다.','/search?q=doc-cmd-separator',11,11),
  ]) { const out=decide(alert); check(out); assert.equal(out.action,'record'); }
});

test('malformed input stays valid, selected secrets never appear in reasons and calls have no shared state', () => {
  for(const value of [null,undefined,true,1,'',[],{}, {rule:{description:[],level:'bad'},data:null},sample('','/search?q=%E0%A4%A')]) check(decide(value));
  const secret=['training','only','opaque'].join('-');
  const alert=sample('SQL 주입 요청 12건입니다. password='+secret,'/search?q=training',12,12);
  Object.defineProperty(alert.data,'password',{get(){throw new Error('UNRELATED_FIELD_READ');}});
  Object.freeze(alert.data);Object.freeze(alert.rule);Object.freeze(alert);
  const before=decide(alert);
  assert.ok(!JSON.stringify(before).includes(secret));
  decide(sample('정상 조회'));
  assert.deepEqual(decide(alert),before);
  const renamed={...alert,id:'different',data:{url:alert.data.url,count:'12',srcip:'203.0.113.99',srcuser:'user99'}};
  assert.deepEqual(decide(renamed),before);
});

test('all fixture alerts receive valid responses, all three actions occur, and original bytes stay unchanged', async () => {
  const before=await readFile(fixtureUrl);
  const counts={block:0,alert:0,record:0};
  for(const alert of JSON.parse(before).alerts){const out=decide(alert);check(out);counts[out.action]++;}
  assert.ok(Object.values(counts).every(value=>value>0));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(await readFile(fixtureUrl)),hash(before));
});
