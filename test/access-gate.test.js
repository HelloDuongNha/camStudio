import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('Studio is gated by server session; login/signup remain public',async(t)=>{
  const names=['MONGODB_URI','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET'];const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  process.env.MONGODB_URI='mongodb://localhost/test';process.env.GOOGLE_CLIENT_ID='test';process.env.GOOGLE_CLIENT_SECRET='test';
  const server=createApp({account:async(req)=>req.headers.cookie==='test=authorized'?{id:'user'}:null});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}});
  for(const path of ['/','/index.html','/studio','/?transport=usb']){
    const response=await fetch(origin+path,{redirect:'manual'});assert.equal(response.status,303);assert.ok(response.headers.get('location').startsWith('/login'));await response.text();
  }
  for(const path of ['/login','/signup']){const response=await fetch(origin+path);assert.equal(response.status,200);assert.ok((await response.text()).includes('googleSignIn'));}
  const inside=await fetch(origin+'/',{headers:{cookie:'test=authorized'}});assert.equal(inside.status,200);assert.ok((await inside.text()).includes('logoutButton'));
  const login=await fetch(origin+'/login',{headers:{cookie:'test=authorized'},redirect:'manual'});assert.equal(login.status,303);assert.equal(login.headers.get('location'),'/?transport=cloud');
});
