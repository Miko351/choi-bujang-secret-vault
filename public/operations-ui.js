import { operationsView } from './operations-model.js';
export function createOperationsUI({document,fetch:send=globalThis.fetch,onDenied=()=>{}}) {
  const section=document.querySelector('#operations');
  const status=document.querySelector('#operations-status');
  const refresh=document.querySelector('#operations-refresh');
  const recordList=document.querySelector('#operations-records');
  const recordTitle=document.querySelector('#operations-record-title');
  const ids={'operations-rules':'ruleCount','operations-rules-detail':'ruleDetail',
    'operations-detection':'detectionCount','operations-detection-detail':'detectionDetail',
    'operations-revocation':'revocationCount','operations-revocation-detail':'revocationDetail',
    'operations-recovery':'recoveryVersion','operations-recovery-detail':'recoveryDetail'};
  const nodes=Object.fromEntries(Object.keys(ids).map(id=>[id,document.querySelector(`#${id}`)]));
  let allowed=false,revision=0,controller;
  const empty=()=>{
    for (const node of Object.values(nodes)) node.textContent='미확인';
    recordList.replaceChildren();recordTitle.textContent='가린 서버 확인 기록';
  };
  const clear=()=>{
    allowed=false;revision++;controller?.abort();section.hidden=true;empty();
    status.textContent='로그인과 기기 승인 확인 후 조회합니다.';refresh.disabled=true;
  };
  const load=async()=>{
    if (!allowed) return;
    const current=++revision;controller?.abort();controller=new AbortController();
    empty();refresh.disabled=true;status.textContent='서버 확인 기록을 불러오는 중입니다.';
    try {
      const response=await send('/api/operations',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal});
      if (current!==revision||!allowed) return;
      if ([401,403].includes(response.status)) {clear();onDenied();return;}
      if (!response.ok) throw new Error('OPERATIONS_UNAVAILABLE');
      const view=operationsView(await response.json());
      if (current!==revision||!allowed) return;
      for (const [id,key] of Object.entries(ids)) nodes[id].textContent=view[key];
      recordList.replaceChildren(...view.records.map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));
      recordTitle.textContent=`가린 서버 확인 기록 · ${view.records.length}개`;
      status.textContent=`서버 조회 시각: ${view.observedAt} · 현재 상태 스냅샷이며 사건 발생 시각이 아닙니다.`;
    } catch {
      if (current===revision&&allowed) {empty();status.textContent='서버 기록을 확인하지 못했습니다. 수치를 0이나 성공으로 표시하지 않습니다.';}
    } finally {if (current===revision&&allowed) refresh.disabled=false;}
  };
  refresh.addEventListener('click',()=>{void load();});
  clear();
  return {clear,open(){allowed=true;section.hidden=false;void load();}};
}
