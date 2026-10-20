export async function readJson(request) {
  if (!(request.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('invalid_request'), { status: 415 });
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw Object.assign(new Error('request_too_large'), { status: 413 });
    chunks.push(chunk);
  }
  try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(); return data; }
  catch { throw Object.assign(new Error('invalid_request'), { status: 400 }); }
}
export function requestIdentity(request) {
  // Trust forwarded addresses only behind an explicitly configured number of proxies.
  const hops = Math.max(0, Math.min(5, Number(process.env.TRUST_PROXY_HOPS) || 0));
  const chain = [...String(request.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean), request.socket?.remoteAddress || 'unknown'];
  return chain[Math.max(0, chain.length - 1 - hops)];
}
