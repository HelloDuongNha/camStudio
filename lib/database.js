import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
export const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function createStore(db) {
  let ready;
  const query = async (sql, args = []) => {
    if (!ready) ready = db.query(schema).catch((error) => { ready = undefined; throw error; });
    await ready;
    return db.query(sql, args);
  };
  return {
    async saveState(state, verifier, nonce, returnPath) {
      await query('DELETE FROM studio_oauth_states WHERE expires_at <= now()');
      await query('INSERT INTO studio_oauth_states VALUES ($1,$2,$3,$4,now() + interval \'10 minutes\')', [hashToken(state), verifier, nonce, returnPath]);
    },
    async consumeState(state) {
      const { rows } = await query('DELETE FROM studio_oauth_states WHERE state_hash=$1 AND expires_at > now() RETURNING *', [hashToken(state)]);
      return rows[0];
    },
    async upsertUser(profile) {
      const { rows } = await query(`INSERT INTO studio_users (id,google_sub,email,display_name) VALUES ($1,$2,$3,$4)
        ON CONFLICT (google_sub) DO UPDATE SET email=EXCLUDED.email,display_name=EXCLUDED.display_name,updated_at=now()
        RETURNING id,email,display_name`, [crypto.randomUUID(), profile.sub, profile.email, profile.name || profile.email]);
      return rows[0];
    },
    async createLogin(userId) {
      await query('DELETE FROM studio_logins WHERE expires_at <= now()');
      const token = crypto.randomBytes(32).toString('base64url');
      await query('INSERT INTO studio_logins VALUES ($1,$2,now() + interval \'30 days\')', [hashToken(token), userId]);
      return token;
    },
    async userForToken(token) {
      if (!/^[\w-]{43}$/.test(token || '')) return null;
      const { rows } = await query(`SELECT u.id,u.email,u.display_name FROM studio_users u
        JOIN studio_logins l ON l.user_id=u.id WHERE l.token_hash=$1 AND l.expires_at > now()`, [hashToken(token)]);
      return rows[0] || null;
    },
    async deleteLogin(token) {
      await query('DELETE FROM studio_logins WHERE token_hash=$1', [hashToken(token || '')]);
    },
    async pairing(userId) {
      const { rows } = await query('SELECT room,expires_at FROM studio_pairings WHERE user_id=$1 AND expires_at > now()', [userId]);
      return rows[0] || null;
    },
    async savePairing(userId, room, expiresAt) {
      await query('DELETE FROM studio_pairings WHERE expires_at <= now()');
      await query(`INSERT INTO studio_pairings (user_id,room,expires_at) VALUES ($1,$2,$3)
        ON CONFLICT (user_id) DO UPDATE SET room=EXCLUDED.room,expires_at=EXCLUDED.expires_at,created_at=now()`, [userId, room, expiresAt]);
    },
    async deletePairing(userId) {
      await query('DELETE FROM studio_pairings WHERE user_id=$1', [userId]);
    },
    async migrate() { await query('SELECT 1'); },
  };
}

let store;
export function getStore() {
  if (!process.env.DATABASE_URL) throw new Error('database_not_configured');
  if (!store) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000 });
    pool.on('error', () => {}); // Request handlers return a generic error without connection secrets.
    store = createStore(pool);
  }
  return store;
}
