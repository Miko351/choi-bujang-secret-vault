import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOperationsUI } from '../public/operations-ui.js';
import { operationsView } from '../public/operations-model.js';
const snapshot=()=>({schema:'vault.operations.v1',observedAt:'2026-10-14T01:00:00.000Z',records:[
  {kind:'rules',source:'server_configuration',status:'confirmed',ruleIds:['starter.deny','device_registered']},
  {kind:'decisions',source:'engine',status:'unrun',reasonCode:'record_not_connected'},
  {kind:'detection',source:'engine',status:'unrun',reasonCode:'record_not_connected'},
  {kind:'revocation_execution',source:'engine',status:'unrun',reasonCode:'execution_not_connected'},
  {kind:'recovery',source:'restore_execution',status:'unrun',reasonCode:'record_not_connected',version:null},
  {kind:'device',source:'database_snapshot',status:'approved',ref:'d-aaaaaaaaaaaa'},
  {kind:'device',source:'database_snapshot',status:'revoked',ref:'d-bbbbbbbbbbbb'},
]});
function fixture(send) {
  const ids=['operations','operations-status','operations-refresh','operations-records','operations-record-title',
    'operations-rules','operations-rules-detail','operations-detection','operations-detection-detail',
    'operations-revocation','operations-revocation-detail','operations-recovery','operations-recovery-detail'];
  const nodes=Object.fromEntries(ids.map(id=>[id,{textContent:'',hidden:false,disabled:false,children:[],listeners:{},
    replaceChildren(...children){this.children=children;},addEventListener(type,callback){this.listeners[type]=callback;}}]));
  let denied=0,calls=0;
  const controller=createOperationsUI({document:{querySelector:selector=>nodes[selector.slice(1)],createElement:()=>({textContent:''})},
    onDenied:()=>{denied++;},fetch:async(...args)=>{calls++;assert.equal(args[0],'/api/operations');
      assert.equal(args[1].credentials,'same-origin');assert.equal(args[1].cache,'no-store');return send(...args);}});
  return {nodes,controller,get denied(){return denied;},get calls(){return calls;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('operation cards and redacted evidence count match one API snapshot; hidden before approval and cleared on logout',async()=>{
  const data=snapshot();const f=fixture(async()=>Response.json(data));
  assert.equal(f.nodes.operations.hidden,true);assert.equal(f.calls,0);
  f.nodes['operations-refresh'].listeners.click();assert.equal(f.calls,0);
  f.controller.open();await settle();
  assert.equal(f.nodes.operations.hidden,false);assert.equal(f.nodes['operations-rules'].textContent,'2개');
  assert.equal(f.nodes['operations-revocation'].textContent,'1 / 2개');
  assert.equal(f.nodes['operations-detection'].textContent,'미실행');assert.equal(f.nodes['operations-recovery'].textContent,'미실행');
  assert.equal(f.nodes['operations-records'].children.length,data.records.length);
  assert.equal(f.nodes['operations-record-title'].textContent,`가린 서버 확인 기록 · ${data.records.length}개`);
  assert.deepEqual(f.nodes['operations-records'].children.map(row=>row.textContent),operationsView(data).records);
  assert.match(f.nodes['operations-status'].textContent,new RegExp(data.observedAt.replaceAll('.','\\.')));
  f.controller.clear();assert.equal(f.nodes.operations.hidden,true);assert.equal(f.nodes['operations-records'].children.length,0);
  assert.equal(f.nodes['operations-rules'].textContent,'미확인');
});

test('unavailable or malformed API records cannot become zero counts, fabricated recoveries or exposed note fields',async()=>{
  const extra=snapshot();extra.records[0].body='PRIVATE_NOTE';
  const duplicate=snapshot();duplicate.records.push(duplicate.records.at(-1));
  const fakeRecovery=snapshot();fakeRecovery.records[4].version=9;fakeRecovery.records[4].status='confirmed';
  const missing=snapshot();missing.records=missing.records.filter(row=>row.kind!=='detection');
  for (const result of [new Response('PRIVATE_NOTE',{status:503}),Response.json(extra),Response.json(duplicate),Response.json(fakeRecovery),Response.json(missing)]) {
    const f=fixture(async()=>result);f.controller.open();await settle();
    assert.equal(f.nodes['operations-rules'].textContent,'미확인');assert.equal(f.nodes['operations-revocation'].textContent,'미확인');
    assert.equal(f.nodes['operations-records'].children.length,0);assert.match(f.nodes['operations-status'].textContent,/확인하지 못했습니다/u);
    assert.ok(!JSON.stringify(f.nodes).includes('PRIVATE_NOTE'));
  }
});

test('a late snapshot after lock cannot reappear, and server permission denial closes the approved UI',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  f.controller.open();f.controller.clear();finish(Response.json(snapshot()));await settle();
  assert.equal(f.nodes.operations.hidden,true);assert.equal(f.nodes['operations-records'].children.length,0);
  for (const status of [401,403]) {
    const denied=fixture(async()=>Response.json({error:'DEVICE_NOT_REGISTERED'},{status}));
    denied.controller.open();await settle();assert.equal(denied.denied,1);assert.equal(denied.nodes.operations.hidden,true);
    assert.equal(denied.nodes['operations-records'].children.length,0);
  }
});

test('refresh replaces every displayed count from the new redacted records rather than retaining an old event total',async()=>{
  const data=snapshot();const f=fixture(async()=>Response.json(data));f.controller.open();await settle();
  data.records.at(-1).status='approved';f.nodes['operations-refresh'].listeners.click();await settle();
  assert.equal(f.nodes['operations-revocation'].textContent,'0 / 2개');
  assert.equal(f.nodes['operations-detection'].textContent,'미실행');
  assert.match(f.nodes['operations-revocation-detail'].textContent,/엔진 회수 집행은 미실행/u);
});
