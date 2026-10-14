const DEVICE_STATES = ['pending','approved','rejected','revoked'];
const fields = (value,names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name=>Object.hasOwn(value,name));
const fail = () => {throw new Error('INVALID_OPERATIONS_SNAPSHOT');};
// Both the API and UI use this allowlist. No raw API errors, identities or note fields are projected.
export function readOperationsSnapshot(input) {
  if (!fields(input,['schema','observedAt','records']) || input.schema !== 'vault.operations.v1'
      || typeof input.observedAt !== 'string' || !Number.isFinite(Date.parse(input.observedAt))
      || new Date(input.observedAt).toISOString() !== input.observedAt
      || !Array.isArray(input.records) || input.records.length < 5 || input.records.length > 261) fail();
  const singletons = new Set();const devices = new Set();
  const records = input.records.map(row=>{
    if (row?.kind === 'device') {
      if (!fields(row,['kind','source','status','ref']) || row.source !== 'database_snapshot'
          || !DEVICE_STATES.includes(row.status) || !/^d-[0-9a-f]{12}$/u.test(row.ref??'') || devices.has(row.ref)) fail();
      devices.add(row.ref);return {kind:'device',source:'database_snapshot',status:row.status,ref:row.ref};
    }
    if (!['rules','decisions','detection','revocation_execution','recovery'].includes(row?.kind) || singletons.has(row.kind)) fail();
    singletons.add(row.kind);
    if (row.kind === 'rules') {
      if (!fields(row,['kind','source','status','ruleIds']) || row.source !== 'server_configuration' || row.status !== 'confirmed'
          || !Array.isArray(row.ruleIds) || row.ruleIds.length > 80
          || row.ruleIds.some(id=>typeof id !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/u.test(id))
          || new Set(row.ruleIds).size !== row.ruleIds.length) fail();
      return {kind:'rules',source:'server_configuration',status:'confirmed',ruleIds:[...row.ruleIds]};
    }
    const recovery = row.kind === 'recovery';
    if (!fields(row,['kind','source','status','reasonCode',...(recovery?['version']:[])]) || row.status !== 'unrun'
        || row.source !== (recovery?'restore_execution':'engine')
        || row.reasonCode !== (row.kind === 'revocation_execution'?'execution_not_connected':'record_not_connected')
        || (recovery && row.version !== null)) fail();
    return {kind:row.kind,source:row.source,status:'unrun',reasonCode:row.reasonCode,...(recovery?{version:null}:{})};
  });
  if (singletons.size !== 5) fail();
  return {schema:'vault.operations.v1',observedAt:input.observedAt,records};
}
export function operationsView(input) {
  const snapshot=readOperationsSnapshot(input);
  const ids=snapshot.records.find(row=>row.kind==='rules').ruleIds;
  const counts=Object.fromEntries(DEVICE_STATES.map(status=>[status,0]));
  for (const row of snapshot.records) if (row.kind==='device') counts[row.status]++;
  const total=Object.values(counts).reduce((sum,value)=>sum+value,0);
  const labels={pending:'승인 대기',approved:'승인',rejected:'거절',revoked:'회수'};
  return {
    ruleCount:`${ids.length}개`,ruleDetail:'서버 규칙 구성 확인 · 실제 접속 판정 기록은 미연결',
    detectionCount:'미실행',detectionDetail:'연결된 탐지 사건 기록이 없습니다. 사건 수를 0건으로 추정하지 않습니다.',
    revocationCount:`${counts.revoked} / ${total}개`,
    revocationDetail:`내 기기 DB 현재 상태: 승인 ${counts.approved} · 대기 ${counts.pending} · 거절 ${counts.rejected} · 회수 ${counts.revoked}. 엔진 회수 집행은 미실행입니다.`,
    recoveryVersion:'미실행',recoveryDetail:'확인된 복구 실행 버전이 없습니다. 사본·정책 형식 버전을 복구 완료로 표시하지 않습니다.',
    records:snapshot.records.map(row=>row.kind==='rules'?`서버 구성 확인 · 규칙 ${ids.length}개: ${ids.join(', ')}`
      :row.kind==='device'?`DB 현재 상태 · 표시용 가명 ${row.ref} · ${labels[row.status]}`
        :row.kind==='decisions'?'실제 접속 판정 · 미실행 / 기록 미연결'
          :row.kind==='detection'?'탐지 사건 · 미실행 / 기록 미연결'
            :row.kind==='revocation_execution'?'엔진 회수 집행 · 미실행 / 집행 기록 미연결'
              :'복구 실행 버전 · 미실행 / 기록 미연결'),
    observedAt:snapshot.observedAt,
  };
}
