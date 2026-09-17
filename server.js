import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import sessionHandler from './api/session.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number.parseInt(process.env.PORT || '4173', 10);
const publicFiles = new Set([
  '/app.js',
  '/index.html',
  '/styles.css',
  '/sw.js',
  '/vendor/livekit-client.umd.js',
  '/vendor/qrcode.js',
]);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function json(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function serveFile(response, requestPath) {
  const publicPath = requestPath === '/' ? '/index.html' : normalize(requestPath);
  if (!publicFiles.has(publicPath)) return false;
  const filePath = join(root, publicPath.slice(1));
  let size;
  try {
    size = statSync(filePath).size;
  } catch {
    return false;
  }
  response.writeHead(200, {
    'Cache-Control': publicPath === '/index.html' || publicPath === '/sw.js' ? 'no-store' : 'public, max-age=3600',
    'Content-Length': size,
    'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(filePath).pipe(response);
  return true;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (request.method === 'GET' && url.pathname === '/healthz') {
    return json(response, 200, { status: 'ok' });
  }
  if (request.method === 'GET' && url.pathname === '/api/info') {
    return json(response, 200, { transport: 'livekit-v2' });
  }
  if (url.pathname === '/api/session') {
    response.status = (status) => {
      response.statusCode = status;
      return response;
    };
    return sessionHandler(request, response);
  }
  if ((request.method === 'GET' || request.method === 'HEAD') && serveFile(response, url.pathname)) {
    return;
  }
  return json(response, 404, { error: 'not_found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Cam Studio listening on port ${port}`);
});
