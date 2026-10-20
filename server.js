import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sessionHandler from './api/session.js';
import authHandler from './api/auth.js';
import pairHandler from './api/pair.js';
import { configuration, currentUser, redirect, json } from './lib/auth.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicFiles = new Set(['/app.js', '/studio-runtime.js', '/index.html', '/styles.css', '/sw.js', '/login.html', '/login.js',
  '/privacy.html', '/camera-check.html', '/camera-check.js', '/camera-metrics.js', '/camera-pattern.html', '/vendor/livekit-client.umd.js', '/vendor/qrcode.js']);
const types = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function serveFile(request, response, path) {
  if (!publicFiles.has(path)) return false;
  const file = join(root, path.slice(1));
  let size;
  try { size = statSync(file).size; } catch { return false; }
  response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Length': size, 'Content-Type': types[extname(file)],
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  if (request.method === 'HEAD') response.end(); else createReadStream(file).pipe(response);
  return true;
}
export function createApp({ account = currentUser, auth = authHandler, session = sessionHandler, pair = pairHandler } = {}) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/healthz') return json(response, 200, { status: 'ok' });
      if (url.pathname === '/api/auth') return await auth(request, response);
      if (url.pathname === '/api/session') return await session(request, response);
      if (url.pathname === '/api/pair') return await pair(request, response);
      if (request.method === 'GET' && url.pathname === '/api/info') return json(response, 200, { transport: 'livekit-v3' });
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'method_not_allowed' });
      const protectedPath = ['/', '/index.html', '/studio'].includes(url.pathname);
      const isLogin = ['/login', '/signup', '/login.html'].includes(url.pathname);
      if (url.pathname === '/privacy') return serveFile(request, response, '/privacy.html');
      if (protectedPath || isLogin) {
        const user = configuration().configured ? await account(request) : null;
        const transport = url.searchParams.get('transport') === 'usb' ? 'usb' : 'cloud';
        if (protectedPath && !user) return redirect(response, `/login?transport=${transport}`);
        if (isLogin && user) return redirect(response, `/?transport=${transport}`);
        if (isLogin) return serveFile(request, response, '/login.html');
        return serveFile(request, response, '/index.html');
      }
      if (serveFile(request, response, url.pathname)) return;
      return json(response, 404, { error: 'not_found' });
    } catch {
      return json(response, 503, { error: 'service_unavailable' });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(Number.parseInt(process.env.PORT || '4173', 10), process.env.HOST || '0.0.0.0', () => console.log('Cam Studio server ready'));
}
