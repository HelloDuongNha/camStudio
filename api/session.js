import { currentUser, sameOrigin, json } from '../lib/auth.js';
import { getStore } from '../lib/database.js';
import { createPairing, ownerPairing, mediaToken, removeMediaRoom, receiverPresent } from '../lib/rooms.js';
import { cachedPresence, rateLimit } from '../lib/cache.js';
import { readJson } from '../lib/http.js';

export function createSessionHandler({ store = getStore, user = currentUser, remove = removeMediaRoom, present = receiverPresent } = {}) {
  return async function handler(request, response) {
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) return json(response, 405, { error: 'method_not_allowed' });
    try {
      if (request.method !== 'GET' && !sameOrigin(request)) return json(response, 403, { error: 'origin_denied' });
      const db = store(), account = await user(request, db);
      if (!account) return json(response, 401, { error: 'login_required' });
      const query = new URL(request.url, 'http://localhost').searchParams;
      if (request.method === 'GET') {
        const pairing = await db.pairing(account.id);
        if (!pairing) return json(response, 404, { error: 'no_active_pairing' });
        if (query.get('action') === 'status') {
          const connected = pairing.state === 'connected' || await cachedPresence(pairing.revision, () => present(pairing));
          if (connected && pairing.state !== 'connected') await db.markConnected(account.id, pairing.revision);
          return json(response, 200, { revision: pairing.revision, connected, expires: Math.floor(pairing.expires_at.getTime() / 1000) });
        }
        return json(response, 200, ownerPairing(pairing, account.id));
      }
      const input = await readJson(request);
      if (request.method === 'POST' && !['create', 'replace', 'publisher', 'cancel'].includes(input.action)) {
        return json(response, 400, { error: 'invalid_request' });
      }
      if (request.method === 'POST' && input.action === 'publisher') {
        const pairing = await db.pairing(account.id);
        if (!pairing || pairing.revision !== input.revision) return json(response, 409, { error: 'pairing_changed' });
        return json(response, 200, await mediaToken(pairing, `publisher-${pairing.revision}`, true));
      }
      if (!await rateLimit(db, 'owner-room', account.id, 20)) return json(response, 429, { error: 'too_many_attempts' });
      return await db.withOwnerLock(account.id, async () => {
        let pairing = await db.ownedPairing(account.id);
        if (request.method === 'DELETE' || input.action === 'cancel') {
          if (!pairing || pairing.revision !== input.revision) return json(response, 200, { removed: false });
          if (input.mode !== 'if-unconnected') return json(response, 400, { error: 'invalid_request' });
          const connected = pairing.state === 'connected' || await cachedPresence(pairing.revision, () => present(pairing), true);
          if (connected) { await db.markConnected(account.id, pairing.revision); return json(response, 200, { kept: true }); }
          await db.markClosing(account.id, pairing.revision);
          await remove(pairing);
          await db.deletePairing(account.id, pairing.revision);
          return json(response, 200, { removed: true });
        }
        if (pairing && pairing.state !== 'closing' && pairing.expires_at > new Date() && input.action !== 'replace') {
          return json(response, 200, ownerPairing(pairing, account.id));
        }
        if (input.action === 'replace' && pairing && input.revision !== pairing.revision) return json(response, 409, { error: 'pairing_changed' });
        if (pairing) {
          // Revoke DB credentials before disconnecting the private LiveKit room.
          await db.markClosing(account.id, pairing.revision);
          await remove(pairing);
          await db.deletePairing(account.id, pairing.revision);
        }
        for (let attempt = 0; attempt < 10; attempt++) {
          pairing = await createPairing();
          try { await db.insertPairing(account.id, pairing); break; }
          catch (error) { if (error.code !== 11000 || attempt === 9) throw error; }
        }
        return json(response, 201, ownerPairing(pairing, account.id));
      });
    } catch (error) {
      return json(response, error.status || 503, { error: error.status ? error.message : 'session_service_unavailable' });
    }
  };
}
export default createSessionHandler();
