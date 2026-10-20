import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../api/session.js';

test('Cloud browser authentication', async (t) => {
  const names = ['CAMSTUDIO_ACCESS_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const key = crypto.randomBytes(32).toString('hex');
  process.env.CAMSTUDIO_ACCESS_KEY = key;
  process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
  process.env.LIVEKIT_API_KEY = 'test-api-key';
  process.env.LIVEKIT_API_SECRET = crypto.randomBytes(32).toString('hex');
  t.after(() => names.forEach((name) => {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }));
  async function call(headers = {}, method = 'POST') {
    const response = { headers: {}, status(code) { this.statusCode = code; return this; },
      setHeader(name, value) { this.headers[name] = value; return this; },
      end(body) { this.body = JSON.parse(body); } };
    await handler({ method, headers: { host: 'studio.test', ...headers } }, response);
    return response;
  }
  let cookie;
  await t.test('anonymous and wrong-key requests remain unauthorized', async () => {
    assert.equal((await call()).statusCode, 401);
    assert.equal((await call({ 'x-camstudio-access-key': 'wrong' })).statusCode, 401);
  });
  await t.test('first login sets a protected persistent cookie without returning the master key', async () => {
    const result = await call({ 'x-camstudio-access-key': key, origin: 'https://studio.test' });
    assert.equal(result.statusCode, 201);
    const header = result.headers['Set-Cookie'];
    for (const attribute of ['__Host-camstudio-auth=', 'Max-Age=2592000', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(header.includes(attribute));
    assert.equal(JSON.stringify(result).includes(key), false);
    cookie = header.split(';')[0];
  });
  await t.test('a later tab can create a room with only the cookie', async () => {
    const result = await call({ cookie });
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.transport, 'livekit');
    assert.equal(result.headers['Set-Cookie'], undefined); // No unlimited sliding renewal.
  });
  await t.test('tampered, malformed and expired sessions are denied', async () => {
    assert.equal((await call({ cookie: `${cookie}x` })).statusCode, 401);
    assert.equal((await call({ cookie: '__Host-camstudio-auth=invalid' })).statusCode, 401);
    const payload = `${Math.floor(Date.now() / 1000) - 1}.${crypto.randomBytes(24).toString('base64url')}`;
    const signature = crypto.createHmac('sha256', key).update(`camstudio-browser-v1:${payload}`).digest('base64url');
    assert.equal((await call({ cookie: `__Host-camstudio-auth=${payload}.${signature}` })).statusCode, 401);
  });
  await t.test('cross-origin requests cannot use a cookie or key to create rooms', async () => {
    assert.equal((await call({ cookie, origin: 'https://other.test' })).statusCode, 403);
    assert.equal((await call({ 'x-camstudio-access-key': key, 'sec-fetch-site': 'cross-site' })).statusCode, 403);
  });
  await t.test('rotating or removing the server key revokes remembered browsers', async () => {
    process.env.CAMSTUDIO_ACCESS_KEY = crypto.randomBytes(32).toString('hex');
    assert.equal((await call({ cookie })).statusCode, 401);
    delete process.env.CAMSTUDIO_ACCESS_KEY;
    assert.equal((await call({ cookie })).statusCode, 401);
    process.env.CAMSTUDIO_ACCESS_KEY = key;
  });
  await t.test('unsupported methods do not issue cookies', async () => {
    const result = await call({ cookie }, 'GET');
    assert.equal(result.statusCode, 405);
    assert.equal(result.headers['Set-Cookie'], undefined);
  });
});
