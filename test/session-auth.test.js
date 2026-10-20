import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createStore, hashToken } from '../lib/database.js';
import { createAuthHandler } from '../api/auth.js';
import { createSessionHandler } from '../api/session.js';

function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; return this; },
    getHeader(key) { return this.headers[key]; }, end(body) { this.body = body ? JSON.parse(body) : null; } };
}

test('Google account and persistent pairing integration on PostgreSQL engine', async (t) => {
  const env = { APP_ORIGIN: 'https://studio.test', DATABASE_URL: 'postgresql://test', GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
    LIVEKIT_URL: 'wss://test.livekit.cloud', LIVEKIT_API_KEY: 'test-key', LIVEKIT_API_SECRET: crypto.randomBytes(32).toString('hex') };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const db = new PGlite();
  const store = createStore({ query: (sql, args) => sql.startsWith('CREATE TABLE') ? db.exec(sql) : db.query(sql, args) });
  t.after(async () => { await db.close(); for (const key of Object.keys(env)) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  } });
  let options, profileOverride = {}, tokenCalls = 0, nonceOverride;
  const oauth = {
    async generateCodeVerifierAsync() { return { codeVerifier: 'test-pkce-verifier', codeChallenge: 'test-challenge' }; },
    generateAuthUrl(params) { options = params; return `https://accounts.google.com/o/oauth2/v2/auth?state=${params.state}`; },
    async getToken(params) { tokenCalls++; assert.equal(params.codeVerifier, 'test-pkce-verifier'); return { tokens: { id_token: 'mock-verified-id-token' } }; },
    async verifyIdToken(params) {
      assert.equal(params.audience, env.GOOGLE_CLIENT_ID);
      assert.equal(params.idToken, 'mock-verified-id-token');
      return { getPayload: () => ({ sub: 'google-one', email: 'one@example.test', email_verified: true,
        iss: 'https://accounts.google.com', nonce: nonceOverride || options.nonce, name: 'One', ...profileOverride }) };
    },
  };
  const auth = createAuthHandler({ store: () => store, client: () => oauth });
  const removed = [];
  const session = createSessionHandler({ store: () => store, remove: async (_url, _key, _secret, room) => removed.push(room) });
  async function call(handler, url, method = 'GET', cookie = '', extra = {}) {
    const res = response();
    await handler({ url, method, headers: { host: 'studio.test', origin: 'https://studio.test', cookie, ...extra } }, res);
    return res;
  }
  async function startLogin() {
    const start = await call(auth, '/api/auth?route=login');
    assert.equal(start.statusCode, 303);
    assert.ok(start.headers.Location.startsWith('https://accounts.google.com/'));
    const cookie = start.headers['Set-Cookie'][0].split(';')[0];
    return { cookie, callback: `/api/auth?route=callback&state=${options.state}&code=test-code` };
  }
  let cookie, accountId;
  await t.test('anonymous users cannot create or read Cloud rooms; old access keys no longer authorize', async () => {
    await store.migrate();
    assert.equal((await call(session, '/api/session', 'POST')).statusCode, 401);
    assert.equal((await call(session, '/api/session')).statusCode, 401);
    assert.equal((await call(session, '/api/session', 'POST', '', { 'x-camstudio-access-key': 'obsolete-key' })).statusCode, 401);
  });
  await t.test('OAuth binds browser, state, nonce and PKCE and stores only a hashed login token', async () => {
    const login = await startLogin();
    assert.equal(options.code_challenge_method, 'S256');
    assert.deepEqual(options.scope, ['openid', 'email', 'profile']);
    const denied = await call(auth, login.callback);
    assert.equal(denied.headers.Location, '/?login=failed');
    assert.equal(tokenCalls, 0);
    const result = await call(auth, login.callback, 'GET', login.cookie);
    assert.equal(result.headers.Location, '/?transport=cloud');
    const header = result.headers['Set-Cookie'].find((value) => value.startsWith('__Host-camstudio-login='));
    assert.match(header, /HttpOnly; SameSite=Lax; Secure/);
    assert.match(header, /Max-Age=2592000/);
    cookie = header.split(';')[0];
    const rawToken = cookie.split('=')[1];
    const saved = (await db.query('SELECT * FROM studio_logins')).rows[0];
    assert.equal(saved.token_hash, hashToken(rawToken));
    assert.equal(JSON.stringify(saved).includes(rawToken), false);
    const me = await call(auth, '/api/auth?route=me', 'GET', cookie);
    assert.equal(me.body.user.email, 'one@example.test');
    accountId = me.body.user.id;
    assert.equal((await call(auth, login.callback, 'GET', login.cookie)).headers.Location, '/?login=failed');
    assert.equal(tokenCalls, 1);
  });
  await t.test('wrong nonce and unverified Google identities cannot create a login', async () => {
    for (const override of [{ email_verified: false }, { iss: 'https://other.test' }]) {
      profileOverride = override;
      const login = await startLogin();
      const result = await call(auth, login.callback, 'GET', login.cookie);
      assert.equal(result.headers.Location, '/?login=failed');
      assert.equal(result.headers['Set-Cookie'].some((value) => value.startsWith('__Host-camstudio-login=')), false);
    }
    profileOverride = {};
    nonceOverride = 'wrong-nonce';
    const login = await startLogin();
    assert.equal((await call(auth, login.callback, 'GET', login.cookie)).headers.Location, '/?login=failed');
    nonceOverride = undefined;
  });
  await t.test('any verified Google account can register without an email allowlist', async () => {
    profileOverride = { sub: 'google-new-public-user', email: 'new-user@gmail.com', name: 'New User' };
    const login = await startLogin();
    const result = await call(auth, login.callback, 'GET', login.cookie);
    assert.equal(result.headers.Location, '/?transport=cloud');
    const header = result.headers['Set-Cookie'].find((value) => value.startsWith('__Host-camstudio-login='));
    assert.ok(header);
    const me = await call(auth, '/api/auth?route=me', 'GET', header.split(';')[0]);
    assert.equal(me.body.user.email, 'new-user@gmail.com');
    assert.notEqual(me.body.user.id, accountId);
    profileOverride = {};
  });
  await t.test('expired OAuth state cannot be consumed', async () => {
    const login = await startLogin();
    await db.query('UPDATE studio_oauth_states SET expires_at=now() - interval \'1 second\'');
    assert.equal((await call(auth, login.callback, 'GET', login.cookie)).headers.Location, '/?login=failed');
  });
  let room;
  await t.test('room survives a fresh browser request and restored QR keeps the original expiry', async () => {
    assert.equal((await call(session, '/api/session', 'GET', cookie)).statusCode, 404);
    const created = await call(session, '/api/session', 'POST', cookie);
    assert.equal(created.statusCode, 201);
    room = created.body.room;
    assert.match(room, /^[A-HJ-NP-Z2-9]{6}$/); // Existing Android QR contract.
    const restored = await call(session, '/api/session', 'GET', cookie);
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.body.room, room);
    assert.equal(restored.body.expires, created.body.expires);
    const stored = (await db.query('SELECT * FROM studio_pairings')).rows[0];
    assert.equal(stored.user_id, accountId);
    assert.equal(stored.publisherToken, undefined);
    const claims = JSON.parse(Buffer.from(restored.body.receiverToken.split('.')[1], 'base64url'));
    assert.equal(claims.video.canPublish, false);
    assert.equal(claims.video.room, room);
    assert.ok(claims.exp <= created.body.expires);
  });
  await t.test('another account cannot read, overwrite or delete this account pairing', async () => {
    const second = await store.upsertUser({ sub: 'google-two', email: 'two@example.test' });
    const token = await store.createLogin(second.id);
    const otherCookie = `__Host-camstudio-login=${token}`;
    assert.equal((await call(session, '/api/session', 'GET', otherCookie)).statusCode, 404);
    assert.equal((await call(session, '/api/session', 'DELETE', otherCookie)).statusCode, 200);
    assert.equal((await store.pairing(accountId)).room, room);
    assert.deepEqual(removed, []);
  });
  await t.test('mutating endpoints reject cross-site and missing-origin requests', async () => {
    assert.equal((await call(session, '/api/session', 'POST', cookie, { origin: 'https://other.test' })).statusCode, 403);
    assert.equal((await call(auth, '/api/auth?route=logout', 'POST', cookie, { origin: undefined })).statusCode, 403);
  });
  await t.test('new room replaces account record and closes previous LiveKit room', async () => {
    const result = await call(session, '/api/session', 'POST', cookie);
    assert.equal(result.statusCode, 201);
    assert.notEqual(result.body.room, room);
    assert.deepEqual(removed, [room]);
    assert.equal((await db.query('SELECT * FROM studio_pairings WHERE user_id=$1', [accountId])).rows.length, 1);
  });
  await t.test('expired rooms are not restored or silently renewed', async () => {
    await db.query('UPDATE studio_pairings SET expires_at=now() - interval \'1 second\' WHERE user_id=$1', [accountId]);
    assert.equal((await call(session, '/api/session', 'GET', cookie)).statusCode, 404);
  });
  await t.test('expiring a login revokes server access', async () => {
    await db.query('UPDATE studio_logins SET expires_at=now() - interval \'1 second\' WHERE user_id=$1', [accountId]);
    assert.equal((await call(session, '/api/session', 'GET', cookie)).statusCode, 401);
    cookie = `__Host-camstudio-login=${await store.createLogin(accountId)}`;
  });
  await t.test('logout deletes login from database and invalidates the browser token', async () => {
    assert.equal((await call(auth, '/api/auth?route=logout', 'POST', cookie)).statusCode, 200);
    assert.equal((await call(auth, '/api/auth?route=me', 'GET', cookie)).body.user, null);
    assert.equal((await call(session, '/api/session', 'POST', cookie)).statusCode, 401);
  });
});
