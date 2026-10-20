import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';

export const hashToken = (value) => crypto.createHash('sha256').update(value).digest('hex');
const publicUser = (user) => user ? { id: user._id, email: user.email, display_name: user.display_name } : null;

export function createStore(db) {
  const users = db.collection('users'), logins = db.collection('logins'), states = db.collection('oauth_states');
  const rooms = db.collection('pairings'), locks = db.collection('owner_locks'), limits = db.collection('rate_limits');
  let ready;
  async function initialize() {
    if (!ready) ready = Promise.all([
      users.createIndex({ google_sub: 1 }, { unique: true }),
      logins.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      states.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      rooms.createIndex({ code: 1 }, { unique: true }),
      rooms.createIndex({ mediaRoom: 1 }, { unique: true }),
      rooms.createIndex({ receiverLeaseHash: 1 }, { unique: true, sparse: true }),
      rooms.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      locks.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      limits.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    ]).catch((error) => { ready = undefined; throw error; });
    await ready;
  }
  const active = () => ({ expires_at: { $gt: new Date() }, state: { $nin: ['closing', 'closed'] } });
  return {
    migrate: initialize,
    async saveState(state, verifier, nonce, returnPath) {
      await initialize();
      await states.insertOne({ _id: hashToken(state), verifier, nonce, return_path: returnPath, expires_at: new Date(Date.now() + 600000) });
    },
    async consumeState(state) {
      await initialize();
      return states.findOneAndDelete({ _id: hashToken(state), expires_at: { $gt: new Date() } });
    },
    async upsertUser(profile) {
      await initialize();
      // Unique Google subject, never merge identities by their display email.
      try {
        return publicUser(await users.findOneAndUpdate({ google_sub: profile.sub }, {
          $set: { email: profile.email, display_name: profile.name || profile.email, updated_at: new Date() },
          $setOnInsert: { _id: crypto.randomUUID(), created_at: new Date() },
        }, { upsert: true, returnDocument: 'after' }));
      } catch (error) {
        if (error.code !== 11000) throw error;
        return publicUser(await users.findOne({ google_sub: profile.sub }));
      }
    },
    async createLogin(userId) {
      await initialize();
      const token = crypto.randomBytes(32).toString('base64url');
      await logins.insertOne({ _id: hashToken(token), user_id: userId, expires_at: new Date(Date.now() + 2592000000) });
      return token;
    },
    async userForToken(token) {
      if (!/^[\w-]{43}$/.test(token || '')) return null;
      await initialize();
      const login = await logins.findOne({ _id: hashToken(token), expires_at: { $gt: new Date() } });
      return login ? publicUser(await users.findOne({ _id: login.user_id })) : null;
    },
    async deleteLogin(token) { await initialize(); await logins.deleteOne({ _id: hashToken(token || '') }); },
    async pairing(userId) { await initialize(); return rooms.findOne({ _id: userId, ...active() }); },
    async ownedPairing(userId) { await initialize(); return rooms.findOne({ _id: userId }); },
    async pairingByCode(code) { await initialize(); return rooms.findOne({ code, ...active() }); },
    async pairingByLease(lease) { await initialize(); return rooms.findOne({ receiverLeaseHash: hashToken(lease), ...active() }); },
    async insertPairing(userId, pairing) { await initialize(); await rooms.insertOne({ _id: userId, ...pairing }); },
    async markClosing(userId, revision) {
      await initialize();
      return rooms.findOneAndUpdate({ _id: userId, revision }, { $set: { state: 'closing' } }, { returnDocument: 'after' });
    },
    async deletePairing(userId, revision) { await initialize(); await rooms.deleteOne({ _id: userId, revision }); },
    async claimPairing(code, revision, deviceHash, leaseHash) {
      await initialize();
      return rooms.findOneAndUpdate({ code, revision, ...active(), $or: [{ receiverDevice: { $exists: false } }, { receiverDevice: deviceHash }] },
        [{ $set: { receiverDevice: deviceHash, receiverLeaseHash: leaseHash,
          state: { $cond: [{ $eq: ['$state', 'connected'] }, 'connected', 'claimed'] } } }], { returnDocument: 'after' });
    },
    async markConnected(userId, revision) {
      await initialize();
      await rooms.updateOne({ _id: userId, revision, ...active(), receiverDevice: { $exists: true } }, { $set: { state: 'connected', connected_at: new Date() } });
    },
    async allowRequest(scope, key, limit, windowMs = 60000) {
      await initialize();
      const bucket = Math.floor(Date.now() / windowMs);
      const id = `${scope}:${key}:${bucket}`;
      const result = await limits.findOneAndUpdate({ _id: id }, {
        $inc: { count: 1 }, $setOnInsert: { expires_at: new Date((bucket + 2) * windowMs) },
      }, { upsert: true, returnDocument: 'after' });
      return result.count <= limit;
    },
    async withOwnerLock(userId, fn) {
      await initialize();
      const token = crypto.randomBytes(24).toString('hex');
      try {
        await locks.findOneAndUpdate({ _id: userId, expires_at: { $lte: new Date() } },
          { $set: { token, expires_at: new Date(Date.now() + 60000) } }, { upsert: true });
      } catch (error) {
        if (error.code === 11000) throw Object.assign(new Error('room_busy'), { status: 409 });
        throw error;
      }
      try { return await fn(); } finally { await locks.deleteOne({ _id: userId, token }); }
    },
  };
}

let store;
export function getStore() {
  if (!process.env.MONGODB_URI) throw new Error('database_not_configured');
  if (!store) {
    const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 10, minPoolSize: 0,
      serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000 });
    store = createStore(client.db(process.env.MONGODB_DATABASE || 'camstudio'));
  }
  return store;
}
