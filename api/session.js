import crypto from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_SECONDS = 60 * 60;

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

  if (!hasValidAccessKey(request, process.env.CAMSTUDIO_ACCESS_KEY)) {
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
