// Local UI QA only: isolated MongoDB, synthetic identity/video and stub media transport.
// This file is not served or imported by the production server.
import { readFileSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../server.js';
import { getStore } from '../lib/database.js';
import { createSessionHandler } from '../api/session.js';
import { configuration, setCookie, redirect, json } from '../lib/auth.js';
import crypto from 'node:crypto';

process.env.MONGOMS_DOWNLOAD_DIR ||= '/private/tmp/camstudio-mongo';
const mongo=await MongoMemoryServer.create();
Object.assign(process.env,{MONGODB_URI:mongo.getUri(),MONGODB_DATABASE:'preview',GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',
  APP_ORIGIN:'http://localhost:4190',ROOM_SECRET_KEY:crypto.randomBytes(32).toString('hex'),LIVEKIT_URL:'wss://preview.livekit.cloud',LIVEKIT_API_KEY:'test-key',LIVEKIT_API_SECRET:'test-secret-not-used-outside-qa'});
const store=getStore();const user=await store.upsertUser({sub:'local-ui-test',email:'preview@example.test',name:'Preview'});
const token=await store.createLogin(user.id);
const server=createApp({session:createSessionHandler({present:async()=>false,remove:async()=>{}})});
const original=server.listeners('request')[0];server.removeAllListeners('request');
const mockMedia=`
const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;const ctx=canvas.getContext('2d');
function pattern(){const g=ctx.createLinearGradient(0,0,1080,1920);g.addColorStop(0,'#403265');g.addColorStop(1,'#152c33');ctx.fillStyle=g;ctx.fillRect(0,0,1080,1920);ctx.strokeStyle='#ffffff14';for(let n=0;n<1920;n+=120){ctx.strokeRect(0,n,1080,120);}ctx.fillStyle='#e8def8';ctx.textAlign='center';ctx.font='700 62px system-ui';ctx.fillText('CAM STUDIO',540,860);ctx.font='32px system-ui';ctx.fillText('Nguồn kiểm thử · video giả lập',540,940);ctx.fillText(new Date().toLocaleTimeString(),540,1005);}pattern();setInterval(pattern,1000);
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>canvas.captureStream(30),enumerateDevices:async()=>[]}});
window.LivekitClient={RoomEvent:{ParticipantConnected:'participant',Reconnecting:'reconnecting',Reconnected:'reconnected',Disconnected:'disconnected'},Track:{Source:{Camera:'camera',Microphone:'microphone'}},Room:class{constructor(){this.localParticipant={publishTrack:async()=>{}};}on(){}async connect(){}async disconnect(){}}};
`;
server.on('request',async(req,res)=>{
  const url=new URL(req.url,configuration().origin);
  if(url.pathname==='/api/auth'&&url.searchParams.get('route')==='login'){
    setCookie(res,'login',token,3600);return redirect(res,'/?transport=cloud');
  }
  if(url.pathname==='/app.js'){
    res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(mockMedia+'\n'+readFileSync(new URL('../app.js',import.meta.url),'utf8'));return;
  }
  if(url.pathname==='/__qa/connect'&&req.method==='POST'){
    const room=await store.pairing(user.id);if(room)await store.claimPairing(room.code,room.revision,'synthetic-device','synthetic-lease');if(room)await store.markConnected(user.id,room.revision);
    return json(res,200,{ok:true});
  }
  if(url.pathname==='/'||url.pathname==='/index.html'){
    // Let the real server session gate run; only the transport is stubbed above.
  }
  return original(req,res);
});
server.listen(4190,'127.0.0.1',()=>console.log('Isolated UI preview ready on http://localhost:4190/login (synthetic Google/media only)'));
process.on('SIGINT',async()=>{server.close();await mongo.stop();process.exit(0);});
