import { createClient } from 'redis';
import { hashToken } from './database.js';

let client, connecting, retryAt = 0;
async function redis() {
  if (!process.env.REDIS_URL || Date.now() < retryAt) return null;
  if (client?.isReady) return client.withCommandOptions({ timeout: 700 });
  if (connecting) return connecting;
  client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 700, reconnectStrategy: false }, disableOfflineQueue: true });
  client.on('error', () => {});
  connecting = client.connect().then(() => client.withCommandOptions({ timeout: 700 })).catch(() => {
    retryAt = Date.now() + 30000;
    try { client?.destroy(); } catch {}
    return null;
  }).finally(() => { connecting = undefined; });
  return connecting;
}
export function closeCache() {
  try { client?.destroy(); } catch {}
  client = undefined; connecting = undefined; retryAt = 0;
}
export async function rateLimit(store, scope, identity, maximum, windowMs = 60000) {
  const key = hashToken(identity);
  const connection = await redis();
  if (connection) {
    try {
      const bucket = Math.floor(Date.now() / windowMs);
      const count = await connection.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n", {
        keys: [`camstudio:rate:${scope}:${key}:${bucket}`], arguments: [String(windowMs * 2)],
      });
      if (Number(count) > maximum) return false;
    } catch { /* MongoDB remains the authoritative fallback below. */ }
  }
  return store.allowRequest(scope, key, maximum, windowMs);
}
export async function cachedPresence(revision, fetchPresence, fresh = false) {
  const connection = await redis();
  const key = `camstudio:presence:${revision}`;
  if (connection && !fresh) {
    try { const value = await connection.get(key); if (value !== null) return value === '1'; } catch {}
  }
  const present = await fetchPresence();
  if (connection) { try { await connection.set(key, present ? '1' : '0', { PX: 1500 }); } catch {} }
  return present;
}
