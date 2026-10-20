import crypto from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_SECONDS = 60 * 60;
const AUTH_SECONDS = 30 * 24 * 60 * 60;
const AUTH_COOKIE = '__Host-camstudio-auth';

function authSignature(payload, key) {
  return crypto.createHmac('sha256', key).update(`camstudio-browser-v1:${payload}`).digest('base64url');
}

function hasBrowserSession(request, key) {
  if (typeof key !== 'string' || key.length < 24) return false;
  const cookie = (request.headers.cookie || '').split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(`${AUTH_COOKIE}=`));
  if (!cookie) return false;
  const value = cookie.slice(AUTH_COOKIE.length + 1);
  const parts = value.split('.');
  if (parts.length !== 3 || !/^\d+$/.test(parts[0]) || !/^[\w-]{32}$/.test(parts[1])) return false;
  const expires = Number(parts[0]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + AUTH_SECONDS) return false;
  const expected = Buffer.from(authSignature(`${parts[0]}.${parts[1]}`, key));
  const supplied = Buffer.from(parts[2]);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function rememberBrowser(response, key) {
  const expires = Math.floor(Date.now() / 1000) + AUTH_SECONDS;
  const payload = `${expires}.${crypto.randomBytes(24).toString('base64url')}`;
  response.setHeader('Set-Cookie', `${AUTH_COOKIE}=${payload}.${authSignature(payload, key)}; Path=/; Max-Age=${AUTH_SECONDS}; HttpOnly; Secure; SameSite=Strict`);
}

function isSameOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (!origin) return true; // Non-browser clients still need a valid access key.
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function randomRoom() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (value) => ROOM_ALPHABET[value % ROOM_ALPHABET.length]).join('');
}

function sendJson(response, status, body) {
  response.status(status).setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function allowedLiveKitUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'wss:' && url.hostname.endsWith('.livekit.cloud');
  } catch {
    return false;
  }
}

function hasValidAccessKey(request, expected) {
  const supplied = request.headers['x-camstudio-access-key'];
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length >= 24 && crypto.timingSafeEqual(left, right);
}

async function tokenFor(apiKey, apiSecret, room, identity, canPublish) {
  const token = new AccessToken(apiKey, apiSecret, { identity, ttl: SESSION_SECONDS });
  token.addGrant({ roomJoin: true, room, canPublish, canSubscribe: true });
  return token.toJwt();
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'method_not_allowed' });
  }

  if (!isSameOrigin(request)) {
    return sendJson(response, 403, { error: 'origin_denied' });
  }
  const accessKey = process.env.CAMSTUDIO_ACCESS_KEY;
  const keyAccepted = hasValidAccessKey(request, accessKey);
  if (!keyAccepted && !hasBrowserSession(request, accessKey)) {
    return sendJson(response, 401, { error: 'access_denied' });
  }

  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!allowedLiveKitUrl(livekitUrl) || !apiKey || !apiSecret) {
    return sendJson(response, 503, { error: 'livekit_not_configured' });
  }

  const room = randomRoom();
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  try {
    const [publisherToken, receiverToken] = await Promise.all([
      tokenFor(apiKey, apiSecret, room, `studio-${crypto.randomUUID()}`, true),
      tokenFor(apiKey, apiSecret, room, `android-${crypto.randomUUID()}`, false),
    ]);
    if (keyAccepted) rememberBrowser(response, accessKey);
    return sendJson(response, 201, {
      version: 2,
      transport: 'livekit',
      room,
      expires,
      livekitUrl,
      publisherToken,
      receiverToken,
    });
  } catch {
    return sendJson(response, 502, { error: 'session_creation_failed' });
  }
}
