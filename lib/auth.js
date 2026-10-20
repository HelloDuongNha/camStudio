import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { getStore } from './database.js';

export function configuration() {
  const origin = new URL(process.env.APP_ORIGIN || 'https://campoc.onrender.com');
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('invalid_app_origin');
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('invalid_app_origin');
  const configured = Boolean(process.env.DATABASE_URL && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return { origin: origin.origin, secure: origin.protocol === 'https:', configured };
}

export function cookieName(kind) {
  return `${configuration().secure ? '__Host-' : ''}camstudio-${kind}`;
}

export function readCookie(request, name) {
  return (request.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

export function setCookie(response, kind, value, seconds) {
  const config = configuration();
  const cookie = `${cookieName(kind)}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax${config.secure ? '; Secure' : ''}`;
  const existing = response.getHeader('Set-Cookie') || [];
  response.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), cookie]);
}

export function sameOrigin(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  return request.headers.origin === configuration().origin;
}

export function json(response, status, body) {
  response.statusCode = status;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

export function redirect(response, location) {
  response.statusCode = 303;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Location', location);
  response.end();
}

export function googleClient() {
  return new OAuth2Client({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: `${configuration().origin}/api/auth?route=callback` });
}

export async function currentUser(request, store = getStore()) {
  return store.userForToken(readCookie(request, cookieName('login')));
}

export const randomToken = () => crypto.randomBytes(32).toString('base64url');
