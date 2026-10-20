import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const scrypt = promisify(crypto.scrypt);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const randomCode = () => Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const randomPassword = () => Array.from({ length: 10 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');

export function secretKey() {
  const key = process.env.ROOM_SECRET_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('room_secret_not_configured');
  return Buffer.from(key, 'hex');
}

export function encryptPassword(password, revision) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  cipher.setAAD(Buffer.from(revision));
  return { iv: iv.toString('base64url'), data: Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]).toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}
export function decryptPassword(pairing) {
  const value = pairing.passwordCipher;
  const cipher = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(value.iv, 'base64url'));
  cipher.setAAD(Buffer.from(pairing.revision));
  cipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(value.data, 'base64url')), cipher.final()]).toString('utf8');
}
export async function createPairing(code = randomCode()) {
  const password = randomPassword(), revision = crypto.randomUUID(), salt = crypto.randomBytes(16).toString('hex');
  return { code, revision, mediaRoom: `studio-${crypto.randomUUID()}`, passwordCipher: encryptPassword(password, revision),
    passwordSalt: salt, passwordHash: (await scrypt(password, salt, 32)).toString('hex'), state: 'waiting',
    expires_at: new Date(Date.now() + 3600000), created_at: new Date() };
}
export async function checkPassword(pairing, password) {
  const supplied = await scrypt(password, pairing.passwordSalt, 32);
  return crypto.timingSafeEqual(Buffer.from(pairing.passwordHash, 'hex'), supplied);
}
export function receiverLease(pairing, device) {
  return crypto.createHmac('sha256', secretKey()).update(`receiver:${pairing.revision}:${device}`).digest('base64url');
}
export function liveKitConfig() {
  const url = new URL(process.env.LIVEKIT_URL || 'https://invalid');
  if (url.protocol !== 'wss:' || !url.hostname.endsWith('.livekit.cloud') || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) throw new Error('livekit_not_configured');
  return { url: url.origin, key: process.env.LIVEKIT_API_KEY, secret: process.env.LIVEKIT_API_SECRET };
}
export async function mediaToken(pairing, identity, publish) {
  const config = liveKitConfig();
  const ttl = Math.min(120, Math.floor((new Date(pairing.expires_at).getTime() - Date.now()) / 1000));
  if (ttl <= 0) throw Object.assign(new Error('pairing_expired'), { status: 410 });
  const token = new AccessToken(config.key, config.secret, { identity, ttl });
  token.addGrant({ roomJoin: true, room: pairing.mediaRoom, canPublish: publish, canSubscribe: !publish });
  return { livekitUrl: config.url, token: await token.toJwt() };
}
export function liveKitService() {
  const { url, key, secret } = liveKitConfig();
  return new RoomServiceClient(url.replace(/^wss:/, 'https:'), key, secret);
}
export async function removeMediaRoom(pairing) {
  try { await liveKitService().deleteRoom(pairing.mediaRoom); }
  catch (error) { if (error.code !== 'not_found' && error.status !== 404) throw error; }
}
export async function receiverPresent(pairing) {
  if (!pairing.receiverDevice) return false;
  try {
    return (await liveKitService().listParticipants(pairing.mediaRoom)).some((participant) => participant.identity.startsWith(`receiver-${pairing.revision}-`));
  } catch (error) { if (error.code === 'not_found' || error.status === 404) return false; throw error; }
}
export function ownerPairing(pairing, ownerId) {
  return { ownerId, code: pairing.code, room: pairing.code, password: decryptPassword(pairing), revision: pairing.revision,
    expires: Math.floor(new Date(pairing.expires_at).getTime() / 1000), state: pairing.state,
    origin: process.env.APP_ORIGIN || 'https://campoc.onrender.com', transport: 'livekit', version: 3 };
}
