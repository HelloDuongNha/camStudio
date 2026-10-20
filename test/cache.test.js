import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { rateLimit, cachedPresence, closeCache } from '../lib/cache.js';

test('Redis accelerates presence and rate limits; outage falls back without authorizing stale state',async(t)=>{
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const redis=spawn('redis-server',['--port',String(port),'--bind','127.0.0.1','--save','','--appendonly','no'],{stdio:['ignore','pipe','pipe']});
  let ready;
  try { await new Promise((resolve,reject)=>{redis.once('error',reject);redis.stdout.on('data',data=>{if(data.toString().includes('Ready to accept connections'))resolve();});redis.once('exit',code=>reject(new Error(`Redis exited: ${code}`)));});ready=true; }
  catch(error){if(error.code==='ENOENT'){t.skip('redis-server not installed');return;}throw error;}
  const previous=process.env.REDIS_URL;process.env.REDIS_URL=`redis://127.0.0.1:${port}`;
  t.after(async()=>{closeCache();if(previous===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=previous;if(ready&&redis.exitCode===null){redis.kill('SIGTERM');await once(redis,'exit');}});
  let storeCalls=0;
  const store={allowRequest:async()=>{storeCalls++;return true;}};
  assert.equal(await rateLimit(store,'test','same-account',2),true);assert.equal(await rateLimit(store,'test','same-account',2),true);
  assert.equal(await rateLimit(store,'test','same-account',2),false);assert.equal(storeCalls,2);
  let presence=0;
  assert.equal(await cachedPresence('test-room',async()=>{presence++;return false;}),false);
  assert.equal(await cachedPresence('test-room',async()=>{presence++;return true;}),false);assert.equal(presence,1);
  assert.equal(await cachedPresence('test-room',async()=>{presence++;return true;},true),true);assert.equal(presence,2);
  redis.kill('SIGTERM');await once(redis,'exit');ready=false;
  assert.equal(await rateLimit(store,'test','after-outage',2),true);assert.equal(storeCalls,3);
  assert.equal(await cachedPresence('different-room',async()=>false),false);
});
