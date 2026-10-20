import { getStore, hashToken } from '../lib/database.js';
import { json, configuration } from '../lib/auth.js';
import { checkPassword, receiverLease, mediaToken, liveKitConfig } from '../lib/rooms.js';
import { rateLimit } from '../lib/cache.js';
import { readJson, requestIdentity } from '../lib/http.js';

export function createPairHandler({ store = getStore } = {}) {
  return async function handler(request, response) {
    if (request.method !== 'POST') return json(response, 405, { error: 'method_not_allowed' });
    try {
      const db = store(), input = await readJson(request);
      const action = new URL(request.url, 'http://localhost').searchParams.get('action');
      if (action === 'token') {
        const lease = /^Bearer ([\w-]{43})$/.exec(request.headers.authorization || '')?.[1];
        if (!lease || typeof input.client !== 'string' || !/^[a-f0-9]{32}$/.test(input.client)) return json(response, 401, { error: 'invalid_pairing' });
        if (!await rateLimit(db, 'receiver-token', lease, 60)) return json(response, 429, { error: 'too_many_attempts' });
        const pairing = await db.pairingByLease(lease);
        if (!pairing) return json(response, 401, { error: 'invalid_pairing' });
        return json(response, 200, await mediaToken(pairing, `receiver-${pairing.revision}-${input.client}`, false));
      }
      const code = typeof input.code === 'string' ? input.code.toUpperCase().replace(/\s/g, '') : '';
      const password = typeof input.password === 'string' ? input.password.toUpperCase().replace(/\s/g, '') : '';
      if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code) || !/^[A-HJ-NP-Z2-9]{10}$/.test(password) || !/^[\w-]{43}$/.test(input.device || '')) return json(response, 401, { error: 'invalid_pairing' });
      const limits = await Promise.all([
        rateLimit(db, 'claim-ip', requestIdentity(request), 30), rateLimit(db, 'claim-code', code, 8),
      ]);
      if (limits.includes(false)) return json(response, 429, { error: 'too_many_attempts' });
      const pairing = await db.pairingByCode(code);
      const correct = await checkPassword(pairing || { passwordSalt: 'unknown-pairing', passwordHash: '0'.repeat(64) }, password);
      if (!pairing || !correct) return json(response, 401, { error: 'invalid_pairing' });
      const lease = receiverLease(pairing, input.device);
      const claimed = await db.claimPairing(code, pairing.revision, hashToken(input.device), hashToken(lease));
      if (!claimed) return json(response, 401, { error: 'invalid_pairing' });
      const config = liveKitConfig();
      // The stored Android credential is revocable; it is never a long-lived LiveKit JWT.
      const credential = `lease.${Buffer.from(configuration().origin).toString('base64url')}.${lease}`;
      const params = new URLSearchParams({ v: '3', room: code, token: credential,
        expires: String(Math.floor(pairing.expires_at.getTime() / 1000)), origin: config.url });
      return json(response, 200, { uri: `camvirtual://pair?${params}` });
    } catch (error) {
      return json(response, error.status || 503, { error: error.status ? error.message : 'pairing_service_unavailable' });
    }
  };
}
export default createPairHandler();
