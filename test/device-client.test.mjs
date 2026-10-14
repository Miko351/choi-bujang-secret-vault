import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeviceClient } from '../public/device-client.js';

test('device browser transport uses official SDK ceremonies and same-origin APIs without persisting keys or approving locally',async()=>{
  const calls=[];let ceremonies=0;
  const sdk={async startRegistration({optionsJSON}){ceremonies++;assert.equal(optionsJSON.challenge,'public-challenge');return {id:'public-credential'};},
    async startAuthentication(){ceremonies++;return {id:'public-credential'};}};
  const client=createDeviceClient({sdk,fetch:async(url,options)=>{
    calls.push({url,options});assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
    assert.equal(options.redirect,'error');assert.equal(options.headers?.Authorization,undefined);
    if (url.endsWith('-options')) return Response.json({challengeId:'public-challenge-id',options:{challenge:'public-challenge'}});
    if (url.endsWith('-registration')) {
      assert.deepEqual(JSON.parse(options.body),{challengeId:'public-challenge-id',credential:{id:'public-credential'}});
      return Response.json({status:'pending',deviceRegistered:false});
    }
    return Response.json({status:'approved',deviceRegistered:true});
  }});
  assert.equal((await client.requestRegistration()).deviceRegistered,false);
  assert.equal((await client.confirmDevice()).deviceRegistered,true);
  assert.equal((await client.status()).deviceRegistered,true);
  assert.equal(ceremonies,2);assert.equal(calls.length,5);
  const unavailable=createDeviceClient({sdk:{},fetch:()=>assert.fail('No ceremony support must not send an approval request')});
  await assert.rejects(unavailable.requestRegistration());await assert.rejects(unavailable.confirmDevice());
});
