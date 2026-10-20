import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';
import { createStore, hashToken } from '../lib/database.js';
import { createAuthHandler } from '../api/auth.js';
import { createSessionHandler } from '../api/session.js';
import { createPairHandler } from '../api/pair.js';
import { createPairing } from '../lib/rooms.js';

process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/camstudio-mongo';
function response() { return { headers: {}, setHeader(key, value) { this.headers[key] = value; return this; }, getHeader(key) { return this.headers[key]; }, end(body) { this.body = body ? JSON.parse(body) : null; } }; }

test('MongoDB accounts, room lifecycle and revocable pairing credentials', async (t) => {
  const mongo = await MongoMemoryServer.create();
  const client = new MongoClient(mongo.getUri()); await client.connect();
  const db = client.db('integration');
  const store = createStore(db);
  const names = ['APP_ORIGIN','MONGODB_URI','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','ROOM_SECRET_KEY','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','REDIS_URL'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, { APP_ORIGIN: 'https://studio.test', MONGODB_URI: mongo.getUri(), GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret', ROOM_SECRET_KEY: crypto.randomBytes(32).toString('hex'), LIVEKIT_URL: 'wss://test.livekit.cloud', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: crypto.randomBytes(32).toString('hex') });
  delete process.env.REDIS_URL;
  t.after(async () => { await client.close(); await mongo.stop(); for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });
  let options, profileOverride = {}, nonceOverride, tokenCalls = 0, connected = false, failRemove = false;
  const oauth = {
    async generateCodeVerifierAsync() { return { codeVerifier: 'test-pkce-verifier', codeChallenge: 'test-challenge' }; },
    generateAuthUrl(value) { options = value; return `https://accounts.google.com/o/oauth2/v2/auth?state=${value.state}`; },
    async getToken(value) { tokenCalls++; assert.equal(value.codeVerifier, 'test-pkce-verifier'); return { tokens: { id_token: 'mock-token' } }; },
    async verifyIdToken(value) { assert.equal(value.audience, 'test-client'); return { getPayload: () => ({ sub:'google-one',email:'one@gmail.com',email_verified:true,iss:'https://accounts.google.com',nonce:nonceOverride || options.nonce,name:'One',...profileOverride }) }; },
  };
  const auth = createAuthHandler({ store: () => store, client: () => oauth });
  const removed = [];
  const owner = createSessionHandler({ store: () => store, present: async () => connected, remove: async (value) => { if (failRemove) throw new Error('service unavailable'); removed.push(value.mediaRoom); } });
  const pair = createPairHandler({ store: () => store });
  async function call(handler, url, method = 'GET', cookie = '', data, headers = {}) {
    const request = Object.assign(Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]), {
      url, method, socket: { remoteAddress: '127.0.0.1' }, headers: { host:'studio.test', origin:'https://studio.test', cookie, 'content-type':'application/json', ...headers },
    });
    const result = response(); await handler(request, result); return result;
  }
  async function login() {
    const start = await call(auth, '/api/auth?route=login');
    assert.equal(start.statusCode,303); const cookie = start.headers['Set-Cookie'][0].split(';')[0];
    return { cookie, callback: `/api/auth?route=callback&state=${options.state}&code=test-code` };
  }
  let cookie, accountId, secondCookie, device = crypto.randomBytes(32).toString('base64url'), firstRoom, oldLease;
  await t.test('MongoDB indexes enforce identity uniqueness and expiry cleanup', async () => {
    await store.migrate();
    assert.equal((await db.collection('pairings').indexes()).find((index) => index.key.code).unique,true);
    assert.equal((await db.collection('logins').indexes()).find((index) => index.key.expires_at).expireAfterSeconds,0);
  });
  await t.test('anonymous requests and obsolete access keys cannot access owner APIs', async () => {
    assert.equal((await call(owner,'/api/session','POST','',{})).statusCode,401);
    assert.equal((await call(owner,'/api/session')).statusCode,401);
    assert.equal((await call(owner,'/api/session','POST','',{}, {'x-camstudio-access-key':'obsolete'})).statusCode,401);
  });
  await t.test('Google login binds browser/state/nonce/PKCE and hashes stored session tokens', async () => {
    const flow = await login();
    assert.equal(options.code_challenge_method,'S256');
    assert.equal((await call(auth,flow.callback)).headers.Location,'/login?error=failed');
    assert.equal(tokenCalls,0);
    const result = await call(auth,flow.callback,'GET',flow.cookie);
    assert.equal(result.headers.Location,'/?transport=cloud');
    const header = result.headers['Set-Cookie'].find((value) => value.startsWith('__Host-camstudio-login='));
    assert.match(header,/HttpOnly; SameSite=Lax; Secure/); cookie = header.split(';')[0];
    assert.equal((await db.collection('logins').findOne())._id,hashToken(cookie.split('=')[1]));
    accountId = (await call(auth,'/api/auth?route=me','GET',cookie)).body.user.id;
    assert.equal((await call(auth,flow.callback,'GET',flow.cookie)).headers.Location,'/login?error=failed');
    assert.equal(tokenCalls,1);
  });
  await t.test('invalid nonce and unverified or wrong-issuer profiles cannot log in', async () => {
    for (const override of [{email_verified:false},{iss:'https://other.test'}]) {
      profileOverride = override; const flow = await login();
      assert.equal((await call(auth,flow.callback,'GET',flow.cookie)).headers.Location,'/login?error=failed');
    }
    profileOverride={}; nonceOverride='wrong'; const flow=await login();
    assert.equal((await call(auth,flow.callback,'GET',flow.cookie)).headers.Location,'/login?error=failed'); nonceOverride=undefined;
  });
  await t.test('any verified Google user can sign up, independent of email allowlists', async () => {
    profileOverride={sub:'google-two',email:'new-person@gmail.com'}; const flow=await login();
    const result=await call(auth,flow.callback,'GET',flow.cookie);
    assert.equal(result.headers.Location,'/?transport=cloud');
    secondCookie=result.headers['Set-Cookie'].find((value)=>value.startsWith('__Host-camstudio-login=')).split(';')[0];
    assert.notEqual((await call(auth,'/api/auth?route=me','GET',secondCookie)).body.user.id,accountId); profileOverride={};
  });
  await t.test('expiry checks reject stale OAuth data even before MongoDB TTL removes it', async () => {
    const flow=await login(); await db.collection('oauth_states').updateMany({},{$set:{expires_at:new Date(0)}});
    assert.equal((await call(auth,flow.callback,'GET',flow.cookie)).headers.Location,'/login?error=failed');
  });
  await t.test('new room has a real code/password, encrypted password and no LiveKit token in owner payload', async () => {
    const result=await call(owner,'/api/session','POST',cookie,{action:'create'});
    assert.equal(result.statusCode,201); firstRoom=result.body;
    assert.match(firstRoom.code,/^[A-HJ-NP-Z2-9]{6}$/); assert.match(firstRoom.password,/^[A-HJ-NP-Z2-9]{10}$/);
    assert.equal(firstRoom.ownerId,accountId); assert.equal(firstRoom.publisherToken,undefined); assert.equal(firstRoom.receiverToken,undefined);
    const saved=await db.collection('pairings').findOne({_id:accountId});
    assert.equal(JSON.stringify(saved).includes(firstRoom.password),false); assert.ok(saved.passwordHash); assert.ok(saved.passwordCipher);
    assert.notEqual(saved.mediaRoom,saved.code);
    const restored=await call(owner,'/api/session','GET',cookie);
    assert.equal(restored.body.password,firstRoom.password); assert.equal(restored.body.expires,firstRoom.expires);
    assert.equal((await call(owner,'/api/session','POST',cookie,{action:'create'})).body.revision,firstRoom.revision);
  });
  await t.test('unique code and owner indexes reject duplicate rows and competing rotations are locked', async () => {
    const collision=await createPairing(firstRoom.code);
    await assert.rejects(store.insertPairing('other-owner',collision),{code:11000});
    let unlock; const pending=new Promise((resolve)=>{unlock=resolve;});
    let entered; const started=new Promise((resolve)=>{entered=resolve;});
    const held=store.withOwnerLock(accountId,async()=>{entered();await pending;}); await started;
    await assert.rejects(store.withOwnerLock(accountId,async()=>{}),{message:'room_busy'}); unlock(); await held;
  });
  await t.test('another account cannot read or remove someone else room', async () => {
    assert.equal((await call(owner,'/api/session','GET',secondCookie)).statusCode,404);
    assert.equal((await call(owner,'/api/session','DELETE',secondCookie,{mode:'if-unconnected',revision:firstRoom.revision})).body.removed,false);
    assert.ok(await store.pairing(accountId)); assert.equal(removed.length,0);
  });
  await t.test('password gates claims; one receiver device can retry, a second device cannot steal the room', async () => {
    const wrong=await call(pair,'/api/pair','POST','',{code:firstRoom.code,password:'AAAAAAAAAA',device}); assert.equal(wrong.statusCode,401);
    const input={code:firstRoom.code,password:firstRoom.password,device};
    const result=await call(pair,'/api/pair','POST','',input); assert.equal(result.statusCode,200);
    const token=new URL(result.body.uri).searchParams.get('token'); assert.ok(token.startsWith('lease.')); oldLease=token.split('.')[2];
    assert.equal((await call(pair,'/api/pair','POST','',input)).body.uri,result.body.uri);
    assert.equal((await call(pair,'/api/pair','POST','',{...input,device:crypto.randomBytes(32).toString('base64url')})).statusCode,401);
    const jwt=await call(pair,'/api/pair?action=token','POST','',{client:'a'.repeat(32)},{authorization:`Bearer ${oldLease}`});
    assert.equal(jwt.statusCode,200); const claims=JSON.parse(Buffer.from(jwt.body.token.split('.')[1],'base64url'));
    assert.equal(claims.video.canPublish,false); assert.notEqual(claims.video.room,firstRoom.code);
    assert.ok(claims.exp <= Math.floor(Date.now()/1000)+120); assert.ok(claims.exp > Math.floor(Date.now()/1000));
  });
  await t.test('closing an actually connected room keeps it; cache cannot replace authoritative presence', async () => {
    connected=true;
    const result=await call(owner,'/api/session','DELETE',cookie,{mode:'if-unconnected',revision:firstRoom.revision});
    assert.equal(result.body.kept,true); assert.equal((await store.pairing(accountId)).state,'connected'); connected=false;
    await call(pair,'/api/pair','POST','',{code:firstRoom.code,password:firstRoom.password,device});
    assert.equal((await store.pairing(accountId)).state,'connected');
    assert.equal((await call(owner,'/api/session','DELETE',cookie,{mode:'if-unconnected',revision:firstRoom.revision})).body.kept,true);
  });
  let newRoom;
  await t.test('replacement disconnects old media, removes old code/lease and issues a fresh password', async () => {
    const result=await call(owner,'/api/session','POST',cookie,{action:'replace',revision:firstRoom.revision});
    assert.equal(result.statusCode,201); newRoom=result.body; assert.notEqual(newRoom.revision,firstRoom.revision); assert.notEqual(newRoom.password,firstRoom.password);
    assert.equal(await store.pairingByLease(oldLease),null); assert.equal(await store.pairingByCode(firstRoom.code),null); assert.equal(removed.length,1);
    assert.equal((await call(pair,'/api/pair?action=token','POST','',{client:'a'.repeat(32)},{authorization:`Bearer ${oldLease}`})).statusCode,401);
    assert.equal((await call(owner,'/api/session','POST',cookie,{action:'replace',revision:firstRoom.revision})).statusCode,409);
  });
  await t.test('a delayed close for an old revision cannot delete the new room', async () => {
    assert.equal((await call(owner,'/api/session','DELETE',cookie,{mode:'if-unconnected',revision:firstRoom.revision})).body.removed,false);
    assert.equal((await store.pairing(accountId)).revision,newRoom.revision);
  });
  await t.test('beacon/normal close cancels an unused room and deletes credentials from MongoDB', async () => {
    const result=await call(owner,'/api/session','POST',cookie,{action:'cancel',mode:'if-unconnected',revision:newRoom.revision});
    assert.equal(result.body.removed,true); assert.equal(await store.pairing(accountId),null);
  });
  await t.test('failed media cleanup leaves code revoked, with a safe retry path', async () => {
    const created=await call(owner,'/api/session','POST',cookie,{action:'create'}); failRemove=true;
    assert.equal((await call(owner,'/api/session','POST',cookie,{action:'replace',revision:created.body.revision})).statusCode,503);
    assert.equal(await store.pairingByCode(created.body.code),null); failRemove=false;
    assert.equal((await call(owner,'/api/session','POST',cookie,{action:'create'})).statusCode,201);
  });
  await t.test('persistent claim limits block repeated guesses across requests', async () => {
    const result=await call(owner,'/api/session','GET',cookie);
    await db.collection('rate_limits').deleteMany({});
    for(let i=0;i<8;i++) assert.equal((await call(pair,'/api/pair','POST','',{code:result.body.code,password:'AAAAAAAAAA',device})).statusCode,401);
    assert.equal((await call(pair,'/api/pair','POST','',{code:result.body.code,password:result.body.password,device})).statusCode,429);
  });
  await t.test('cross-site mutations are rejected and logout invalidates a server session', async () => {
    assert.equal((await call(owner,'/api/session','POST',cookie,{}, {origin:'https://other.test'})).statusCode,403);
    assert.equal((await call(auth,'/api/auth?route=logout','POST',cookie,undefined,{origin:undefined})).statusCode,403);
    assert.equal((await call(auth,'/api/auth?route=logout','POST',cookie)).statusCode,200);
    assert.equal((await call(owner,'/api/session','GET',cookie)).statusCode,401);
  });
});
