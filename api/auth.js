import crypto from 'node:crypto';
import { configuration, cookieName, readCookie, setCookie, sameOrigin, json, redirect, googleClient, currentUser, randomToken } from '../lib/auth.js';
import { getStore } from '../lib/database.js';
import { rateLimit } from '../lib/cache.js';
import { requestIdentity } from '../lib/http.js';

export function createAuthHandler({ store = getStore, client = googleClient } = {}) {
  return async function handler(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const route = url.searchParams.get('route') || 'me';
    try {
      const config = configuration();
      if (route === 'me' && request.method === 'GET') {
        if (!config.configured) return json(response, 200, { configured: false, user: null });
        return json(response, 200, { configured: true, user: await currentUser(request, store()) });
      }
      if (!config.configured) return json(response, 503, { error: 'google_login_not_configured' });
      if (route === 'logout' && request.method === 'POST') {
        if (!sameOrigin(request)) return json(response, 403, { error: 'origin_denied' });
        await store().deleteLogin(readCookie(request, cookieName('login')));
        setCookie(response, 'login', '', 0);
        return json(response, 200, { ok: true });
      }
      if (route === 'login' && request.method === 'GET') {
        if (!await rateLimit(store(), 'oauth-login', requestIdentity(request), 60)) return redirect(response, '/login?error=too_many_attempts');
        const state = randomToken(), nonce = randomToken();
        const oauth = client();
        const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
        const returnPath = url.searchParams.get('transport') === 'usb' ? '/?transport=usb' : '/?transport=cloud';
        await store().saveState(state, codeVerifier, nonce, returnPath);
        setCookie(response, 'oauth', state, 600);
        return redirect(response, oauth.generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, nonce,
          code_challenge: codeChallenge, code_challenge_method: 'S256', prompt: 'select_account' }));
      }
      if (route === 'callback' && request.method === 'GET') {
        setCookie(response, 'oauth', '', 0);
        const state = url.searchParams.get('state') || '';
        const cookie = readCookie(request, cookieName('oauth'));
        if (!/^[\w-]{43}$/.test(state) || cookie.length !== state.length ||
          !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return redirect(response, '/login?error=failed');
        const pending = await store().consumeState(state);
        if (!pending || url.searchParams.has('error')) return redirect(response, '/login?error=failed');
        const code = url.searchParams.get('code');
        if (!code || code.length > 4096) return redirect(response, '/login?error=failed');
        const oauth = client();
        const { tokens } = await oauth.getToken({ code, codeVerifier: pending.verifier });
        const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
        const profile = ticket.getPayload();
        if (!profile?.sub || !profile.email || profile.email_verified !== true || profile.nonce !== pending.nonce ||
          !['accounts.google.com', 'https://accounts.google.com'].includes(profile.iss)) return redirect(response, '/login?error=failed');
        const user = await store().upsertUser(profile);
        // Rotate an existing browser session when switching Google accounts.
        await store().deleteLogin(readCookie(request, cookieName('login')));
        setCookie(response, 'login', await store().createLogin(user.id), 30 * 24 * 60 * 60);
        return redirect(response, pending.return_path);
      }
      return json(response, 405, { error: 'method_not_allowed' });
    } catch {
      if (route === 'callback' || route === 'login') return redirect(response, '/login?error=failed');
      return json(response, 503, { error: 'account_service_unavailable' });
    }
  };
}

export default createAuthHandler();
