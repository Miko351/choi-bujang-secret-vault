import { approvedCookie, approvedDeviceResponse } from './approved-device-fixture.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import handler from '../api/note-recovery.js';
import config from '../aleph.config.json' with { type: 'json' };
import { noteContentSha256, readBNoteBackup } from '../src/note-backup.mjs';
import { ACCESS_COOKIE } from '../src/session-cookies.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function invoke({ authorization, method = 'POST', url, body, headers = {}, query } = {}) {
  const result = { headers: {} };
  await handler({ authorization, method, url, body, query,
    headers: { authorization, 'content-type': 'application/json', ...headers, cookie:[headers.cookie,approvedCookie].filter(Boolean).join('; ') } }, {
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
    status(code) { result.status = code; return { json(value) { result.body = value; }, end() {} }; },
  });
  return result;
}

test('B-only single-note recovery verifies the private copy and preserves other notes and audit history', async t => {
  const names = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VAULT_B_NOTE_BACKUP'];
  const savedEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const oldConfig = structuredClone(config);
  const originalFetch = globalThis.fetch;
  const logging = Object.fromEntries(['log','warn','error'].map(name => [name, console[name]]));
  let logCount = 0;
  const pair = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(pair.publicKey), kid: 'restore-fixture', alg: 'ES256', use: 'sig' };
  const ownerB = '22222222-2222-4222-8222-222222222222';
  const otherOwner = '33333333-3333-4333-8333-333333333333';
  const id = randomUUID();
  const backup = { schema: 'vault.note.backup.v1', account: 'b', id, owner_id: ownerB,
    title: `fixture-${randomUUID()}`, body: `fixture-${randomUUID()}` };
  backup.contentSha256 = noteContentSha256(backup);
  const protectedBId = randomUUID();
  const protectedOtherId = randomUUID();
  const rows = new Map([
    [id, { id, owner_id: ownerB, title: 'damaged_fixture', content: 'damaged_fixture' }],
    [protectedBId, { id: protectedBId, owner_id: ownerB, title: randomUUID(), content: randomUUID() }],
    [protectedOtherId, { id: protectedOtherId, owner_id: otherOwner, title: randomUUID(), content: randomUUID() }],
  ]);
  const audit = [{ event: 'existing_audit_fixture' }];
  const protectedDigest = digest([rows.get(protectedBId), rows.get(protectedOtherId), audit]);
  let dbCalls = 0;
  let writes = 0;
  let mode = 'normal';
  const project = 'https://training.supabase.co';
  const issuer = `${project}/auth/v1`;
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ sub: ownerB, iss: issuer, aud: 'authenticated', role: 'authenticated',
    iat: now, exp: now + 300 }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(pair.privateKey);
  const authorization = `Bearer ${jwt}`;
  const path = `/api/note-recovery/${id}`;
  const request = extras => invoke({ authorization, url: path, body: { contentSha256: backup.contentSha256 }, ...extras });
  const verifyProtected = () => assert.equal(digest([rows.get(protectedBId), rows.get(protectedOtherId), audit]), protectedDigest);
  try {
    for (const name of Object.keys(logging)) console[name] = () => { logCount++; };
    process.env.SUPABASE_URL = project;
    process.env.SUPABASE_SECRET_KEY = ['test','restore','credential'].join('-');
    process.env.VAULT_B_NOTE_BACKUP = JSON.stringify(backup);
    Object.assign(config, { identityProvider: { issuer, audience: 'authenticated', jwksUrl: `${issuer}/.well-known/jwks.json` } });
    globalThis.fetch = async (url, options = {}) => {
      const target = new URL(url);
      const deviceResponse = approvedDeviceResponse(target); if (deviceResponse) return deviceResponse;
      if (target.href === config.identityProvider.jwksUrl) return Response.json({ keys: [jwk] });
      assert.equal(target.origin, project);
      assert.equal(target.pathname, '/rest/v1/vault_notes');
      dbCalls++;
      if (mode === 'db-error') return Response.json({ message: process.env.SUPABASE_SECRET_KEY }, { status: 403 });
      const method = options.method ?? 'GET';
      const requestedId = target.searchParams.get('id')?.slice(3);
      const owner = target.searchParams.get('owner_id')?.slice(3);
      let selected = [...rows.values()].filter(row => (!requestedId || row.id === requestedId) && (!owner || row.owner_id === owner));
      if (method === 'PATCH') {
        assert.equal(requestedId, id);
        assert.equal(owner, ownerB);
        const values = JSON.parse(options.body);
        assert.equal(values.owner_id, ownerB);
        if (mode === 'owner-race') selected = [];
        selected.forEach(row => Object.assign(row, values));
        writes++;
      } else if (method === 'POST') {
        const values = JSON.parse(options.body);
        assert.equal(values.id, id);
        assert.equal(values.owner_id, ownerB);
        assert.ok(!new Headers(options.headers).get('prefer')?.includes('resolution=merge-duplicates'));
        if (mode === 'insert-race' || rows.has(id)) return Response.json({ code: '23505' }, { status: 409 });
        rows.set(id, values); selected = [values]; writes++;
      } else assert.equal(method, 'GET');
      let output = target.searchParams.get('select') === 'id,owner_id'
        ? selected.map(row => ({id:row.id,owner_id:row.owner_id}))
        : selected.map(row => ({ id:row.id,owner_id:row.owner_id,title:row.title,body:row.content }));
      if (method !== 'GET' && mode === 'wrong-result') output = output.map(row => ({ ...row, body: 'different_fixture' }));
      return Response.json(output);
    };
    await t.test('B restores its damaged row with matching ID, owner and content hash only', async () => {
      const result = await request();
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, {id,owner_id:ownerB,contentSha256:backup.contentSha256});
      assert.equal(noteContentSha256({title:rows.get(id).title,body:rows.get(id).content}), backup.contentSha256);
      assert.equal(rows.get(id).owner_id, ownerB);
      assert.ok(!JSON.stringify(result.body).includes(backup.body));
      assert.ok(!JSON.stringify(result.body).includes(backup.title));
      assert.equal(result.headers['cache-control'], 'no-store');
      verifyProtected();
    });
    await t.test('B restores a missing row under the original UUID without upserting other data', async () => {
      rows.delete(id);
      const result = await request();
      assert.equal(result.status, 200);
      assert.equal(rows.get(id).id, id);
      assert.equal(rows.get(id).owner_id, ownerB);
      assert.equal(noteContentSha256({title:rows.get(id).title,body:rows.get(id).content}), backup.contentSha256);
      verifyProtected();
    });
    await t.test('anonymous, invalid login and cross-origin cookie requests cannot write', async () => {
      const before = dbCalls;
      for (const auth of [undefined, 'Bearer invalid']) assert.equal((await request({authorization:auth})).status, 401);
      assert.equal((await request({ authorization: undefined,
        headers: {cookie:`${ACCESS_COOKIE}=${jwt}`,origin:'https://other.example'} })).status, 403);
      assert.equal(dbCalls,before);
    });
    await t.test('IDs, query functions and submitted owners cannot select another recovery target', async () => {
      const before = dbCalls;
      assert.equal((await request({url:`/api/note-recovery/${protectedBId}`})).status,404);
      assert.equal((await request({url:`${path}?action=restore`})).status,403);
      assert.equal((await request({url:`${path}?noteId=${protectedBId}`})).status,400);
      assert.equal((await request({body:{contentSha256:backup.contentSha256,owner_id:ownerB}})).status,400);
      assert.equal((await request({method:'PUT'})).status,405);
      assert.equal(dbCalls,before);
    });
    await t.test('missing, altered, non-B and mismatched private backups stop before DB access', async () => {
      const before = dbCalls;
      delete process.env.VAULT_B_NOTE_BACKUP;
      assert.equal((await request()).status,503);
      for(const change of [{account:'a'},{body:'changed_fixture'},{owner_id:'invalid'}]) {
        process.env.VAULT_B_NOTE_BACKUP=JSON.stringify({...backup,...change});
        assert.equal((await request()).status,503);
      }
      process.env.VAULT_B_NOTE_BACKUP=JSON.stringify({...backup,owner_id:otherOwner});
      assert.equal((await request()).status,404);
      process.env.VAULT_B_NOTE_BACKUP=JSON.stringify(backup);
      assert.equal((await request({body:{contentSha256:'0'.repeat(64)}})).status,409);
      assert.equal(dbCalls,before);
    });
    await t.test('a stored foreign owner is never overwritten; write races fail closed', async () => {
      const before = writes;
      const row = rows.get(id);
      row.owner_id=otherOwner;
      const foreignDigest=digest(row);
      assert.equal((await request()).status,404);
      assert.equal(digest(row),foreignDigest);
      assert.equal(writes,before);
      row.owner_id=ownerB;
      mode='owner-race';
      assert.equal((await request()).status,409);
      rows.delete(id); mode='insert-race';
      assert.equal((await request()).status,409);
      rows.set(id,row); mode='normal'; verifyProtected();
    });
    await t.test('returned content is rehashed and upstream details never reach responses or logs', async () => {
      mode='wrong-result';
      assert.equal((await request()).status,502);
      mode='db-error';
      const result=await request();
      assert.deepEqual(result.body,{error:'RESTORE_UNAVAILABLE'});
      assert.equal(logCount,0);
      mode='normal'; verifyProtected();
    });
    await t.test('the rewrite selects only the same B UUID and same-origin cookies retain verification', async () => {
      assert.equal((await request({url:`/api/note-recovery?noteId=${id}`,query:{noteId:id}})).status,200);
      assert.equal((await request({authorization:undefined,
        headers:{cookie:`${ACCESS_COOKIE}=${jwt}`,origin:new URL(config.publicAppUrl).origin}})).status,200);
      verifyProtected();
    });
    assert.equal(readBNoteBackup(JSON.stringify(backup))?.id,id);
  } finally {
    globalThis.fetch=originalFetch;
    for(const name of names) {if(savedEnv[name]===undefined)delete process.env[name];else process.env[name]=savedEnv[name];}
    for(const key of Object.keys(config))delete config[key]; Object.assign(config,oldConfig);
    Object.assign(console,logging);
  }
});
