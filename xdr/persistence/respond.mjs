import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';

const DEFAULT_LOG = fileURLToPath(new URL('../alerts.log',import.meta.url));
const DEFAULT_FIXTURE = new URL('../fixtures/persistence.json',import.meta.url);
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const SENSITIVE = /(?:sb_(?:secret|publishable)_|github_pat_|gh[pousr]_|eyJ[A-Za-z0-9_-]*\.|Bearer\s|-----BEGIN|password\s*[:=])/iu;
const TARGET_KEYS = ['classId','projectId','subjectId','deviceId'];
function verifiedTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== TARGET_KEYS.length
      || TARGET_KEYS.some(key=>typeof value[key]!=='string'||!ID.test(value[key])||SENSITIVE.test(value[key]))
      || !/^[0-9a-f]{16}$/u.test(value.deviceId)) return null;
  return Object.freeze(Object.fromEntries(TARGET_KEYS.map(key=>[key,value[key]])));
}
async function notify(logPath, entry) {
  try {
    await mkdir(dirname(logPath),{recursive:true});
    await appendFile(logPath,JSON.stringify(entry)+'\n',{encoding:'utf8',mode:0o600});
  } catch {throw new Error('RESPONSE_LOG_UNAVAILABLE');}
}

// This is a local adapter interface, not an invented ALEPH engine endpoint.
// Both callbacks must be supplied by a trusted server integration, never a browser.
// resolveVerifiedTarget must identify the verified device where this event was observed.
// Its return is exactly classId/projectId/subjectId/deviceId.
// registerDenyRule must add only this temporary scoped rule and acknowledge its ID.
export async function respond(alert, {
  resolveVerifiedTarget, registerDenyRule, logPath=DEFAULT_LOG,
  now=()=>Date.now(), ttlSeconds=900,
}={}) {
  if (!Number.isSafeInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>3600) throw new Error('RESPONSE_TTL_INVALID');
  const atMs=now();
  if (!Number.isSafeInteger(atMs)||atMs<0||!Number.isFinite(new Date(atMs+ttlSeconds*1000).getTime())) throw new Error('RESPONSE_TIME_INVALID');
  const at=new Date(atMs).toISOString();
  const decision=decide(alert); // Recompute; do not trust edited result.json or supplied actions.
  const rawId=alert?.id;
  const evidenceAlertId=typeof rawId==='string'&&ID.test(rawId)&&!SENSITIVE.test(rawId)?rawId:null;
  const summary={action:decision.action,confidence:decision.confidence,reason:decision.reason,evidenceAlertId};
  if (decision.action==='record') return {...summary,status:'recorded'};
  const base={moduleKey:'persistence',at,evidenceAlertId,action:decision.action,confidence:decision.confidence,pattern:decision.reason};
  if (decision.action==='alert') {
    await notify(logPath,{...base,status:'alerted'});
    return {...summary,status:'alerted'};
  }
  const sourceIp=alert?.data?.srcip;
  let target=null;
  if (decision.confidence>=0.85 && evidenceAlertId && typeof sourceIp==='string' && isIP(sourceIp)!==0
      && typeof resolveVerifiedTarget==='function' && typeof registerDenyRule==='function') {
    try {target=verifiedTarget(await resolveVerifiedTarget(Object.freeze({evidenceAlertId,sourceIp})));}
    catch { /* Do not forward resolver errors, identities or credentials. */ }
  }
  if (!target) {
    await notify(logPath,{...base,status:'pending',reasonCode:'verified_target_or_rule_sink_missing'});
    return {...summary,status:'pending'};
  }
  const expiresAt=new Date(atMs+ttlSeconds*1000).toISOString();
  const ruleId='xdr.persistence.'+createHash('sha256').update(JSON.stringify([evidenceAlertId,target])).digest('hex').slice(0,24);
  const rule=Object.freeze({ruleId,action:'deny',match:target,expiresAt,evidenceAlertId});
  // Record the request before changing policy. Logging failure prevents registration.
  await notify(logPath,{...base,status:'registration_requested',ruleId,expiresAt});
  let accepted=false;
  try {
    const receipt=await registerDenyRule(rule);
    accepted=receipt?.status==='registered'&&receipt.ruleId===ruleId;
  } catch { /* Fixed outcome only; never log an upstream error. */ }
  const status=accepted?'registered':'registration_unconfirmed';
  await notify(logPath,{...base,status,ruleId,expiresAt});
  // An acknowledgement is not proof that a live engine has enforced the rule.
  return {...summary,status,ruleId,expiresAt};
}

export async function respondFixture(options={}) {
  let fixture;
  try {fixture=JSON.parse(await readFile(options.fixtureUrl??DEFAULT_FIXTURE,'utf8'));}
  catch {throw new Error('RESPONSE_FIXTURE_INVALID');}
  if (fixture?.schema!=='aleph.xdr.fixture.v1'||fixture.moduleKey!=='persistence'||!Array.isArray(fixture.alerts)) throw new Error('RESPONSE_FIXTURE_INVALID');
  const outcomes=[];
  for (const alert of fixture.alerts) outcomes.push(await respond(alert,options));
  const counts={registered:0,pending:0,registration_unconfirmed:0,alerted:0,recorded:0};
  for (const item of outcomes) counts[item.status]++;
  return {outcomes,counts};
}
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const {counts}=await respondFixture();
    process.stdout.write(JSON.stringify(counts)+'\n');
    if (counts.pending) process.stderr.write('차단 후보 보류: 검증 대상·ZTNA 규칙 등록 연결이 없습니다. 실제 차단을 적용하지 않았습니다.\n');
  } catch {
    process.stderr.write('대응 처리 중단: 입력·로그·연결 설정을 확인하세요.\n');
    process.exitCode=1;
  }
}