import crypto from 'node:crypto';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { currentUser, sameOrigin, json } from '../lib/auth.js';
import { getStore } from '../lib/database.js';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomRoom = () => Array.from({ length: 6 }, () => ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]).join('');

async function tokenFor(apiKey, apiSecret, room, identity, canPublish, seconds) {
  const token = new AccessToken(apiKey, apiSecret, { identity, ttl: seconds });
  token.addGrant({ roomJoin: true, room, canPublish, canSubscribe: true });
  return token.toJwt();
}

async function removeRoom(url, key, secret, room) {
  try {
    await new RoomServiceClient(url.replace(/^wss:/, 'https:'), key, secret).deleteRoom(room);
  } catch (error) {
    if (error.code !== 'not_found' && error.status !== 404) throw error;
  }
}

export function createSessionHandler({ store = getStore, user = currentUser, remove = removeRoom } = {}) {
  return async function handler(request, response) {
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST, DELETE');
      return json(response, 405, { error: 'method_not_allowed' });
    }
    try {
      if (request.method !== 'GET' && !sameOrigin(request)) return json(response, 403, { error: 'origin_denied' });
      const db = store();
      const account = await user(request, db);
      if (!account) return json(response, 401, { error: 'login_required' });
      const livekitUrl = process.env.LIVEKIT_URL;
      const apiKey = process.env.LIVEKIT_API_KEY, apiSecret = process.env.LIVEKIT_API_SECRET;
      let allowedUrl = false;
      try { const url = new URL(livekitUrl); allowedUrl = url.protocol === 'wss:' && url.hostname.endsWith('.livekit.cloud'); } catch {}
      if (!allowedUrl || !apiKey || !apiSecret) return json(response, 503, { error: 'livekit_not_configured' });
      let pairing = await db.pairing(account.id);
      if (request.method === 'DELETE') {
        if (pairing) await remove(livekitUrl, apiKey, apiSecret, pairing.room);
        await db.deletePairing(account.id);
        return json(response, 200, { ok: true });
      }
      if (request.method === 'GET' && !pairing) return json(response, 404, { error: 'no_active_pairing' });
      if (request.method === 'POST') {
        if (pairing) await remove(livekitUrl, apiKey, apiSecret, pairing.room);
        for (let attempt = 0; attempt < 5; attempt++) {
          pairing = { room: randomRoom(), expires_at: new Date(Date.now() + 3600000) };
          try {
            await db.savePairing(account.id, pairing.room, pairing.expires_at);
            break;
          } catch (error) {
            if (error.code !== '23505' || attempt === 4) throw error;
          }
        }
      }
      const expires = Math.floor(new Date(pairing.expires_at).getTime() / 1000);
      const seconds = expires - Math.floor(Date.now() / 1000);
      if (seconds <= 0) return json(response, 404, { error: 'no_active_pairing' });
      const [publisherToken, receiverToken] = await Promise.all([
        tokenFor(apiKey, apiSecret, pairing.room, `studio-${account.id}`, true, seconds),
        tokenFor(apiKey, apiSecret, pairing.room, `android-${crypto.randomUUID()}`, false, seconds),
      ]);
      return json(response, request.method === 'POST' ? 201 : 200, {
        version: 2, transport: 'livekit', ownerId: account.id, room: pairing.room, expires, livekitUrl, publisherToken, receiverToken,
      });
    } catch {
      return json(response, 503, { error: 'session_service_unavailable' });
    }
  };
}

export default createSessionHandler();
