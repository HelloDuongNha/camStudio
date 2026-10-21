import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../studio-runtime.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const user={id:'test-user',email:'user@example.test'};
const room=(revision='revision-one')=>({ownerId:user.id,code:'ABCDEF',room:'ABCDEF',password:'ABCDEFGHJK',transport:'livekit',revision,expires:Math.floor(Date.now()/1000)+3600,state:'waiting'});
const ok=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
function source() {
  const tracks=[{kind:'video'},{kind:'audio'}].map((track)=>({...track,readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended';},addEventListener(){},getSettings:()=>({width:1920,height:1080,frameRate:30,deviceId:''})}));
  return {tracks,getTracks:()=>tracks,getVideoTracks:()=>tracks.filter(t=>t.kind==='video'),getAudioTracks:()=>tracks.filter(t=>t.kind==='audio')};
}
function fixture({acquire,existing,connected=false,intercept,transport='cloud',cameraPermission}={}) {
  const nodes=new Map(), classes=new Map(), events=new Map(), timers=new Map(), calls=[], redirects=[], streams=[], rooms=[];
  let nextTimer=0, saved=existing;
  for(const match of html.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const attrs=Object.fromEntries([...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map(item=>[item[1],item[2]]));
    const set=new Set((attrs.class||'').split(/\s+/));
    const node={id:attrs.id||'',attrs,events:new Map(),style:{setProperty(name,value){this[name]=value;}},hidden:match[2].includes(' hidden'),value:'',textContent:'',innerHTML:'',open:false,disabled:false,
      classList:{toggle(name,on){if(on??!set.has(name))set.add(name);else set.delete(name);}},
      addEventListener(name,fn){this.events.set(name,fn);},setAttribute(name,value){attrs[name]=value;},getAttribute(name){return attrs[name];},
      showModal(){this.open=true;},close(){this.open=false;},getBoundingClientRect(){return {left:0,top:0,right:1000,bottom:1000};},
      replaceChildren(){},add(){},pause(){},async play(){},videoWidth:1920,videoHeight:1080,
      getContext:()=>({setTransform(){},clearRect(){},fillRect(){},drawImage(){}}),captureStream:()=>source(),toBlob(cb){cb(new Blob(['test-frame']));},
    };
    if(attrs.id)nodes.set(attrs.id,node); for(const name of set)if(name)classes.set(name,node);
  }
  nodes.get('outputResolution').value='portrait-source';
  const local=new Map(), sessionStorage=new Map();
  const storage=(map)=>({getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)});
  const location=new URL(`https://studio.test/?transport=${transport}`);location.replace=(value)=>redirects.push(value);location.reload=()=>redirects.push('reload');
  const context=vm.createContext({URL,URLSearchParams,AbortController,performance,Blob,btoa,crypto:webcrypto,location,Option:function(text,value){this.textContent=text;this.value=value;},
    document:{documentElement:{dataset:{}},querySelector(selector){return selector.startsWith('#')?nodes.get(selector.slice(1)):classes.get(selector.slice(1));},getElementById:id=>nodes.get(id)},
    localStorage:storage(local),sessionStorage:storage(sessionStorage),history:{replaceState(_a,_b,url){location.href=String(url);}},
    navigator:{permissions:cameraPermission?{query:async()=>({state:cameraPermission})}:undefined,mediaDevices:{getUserMedia:async(constraints)=>{const value=acquire?await acquire(constraints):source();streams.push(value);return value;},enumerateDevices:async()=>[]},clipboard:{writeText:async()=>{}},sendBeacon(){}},
    setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},
    setInterval(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearInterval(id){timers.delete(id);},requestAnimationFrame(fn){const id=++nextTimer;timers.set(id,{fn,ms:16});return id;},cancelAnimationFrame(id){timers.delete(id);},
    addEventListener:(name,fn)=>events.set(name,fn),qrcode:()=>({addData(value){this.value=value;},make(){},createSvgTag(){return '<svg>test QR</svg>';}}),
    LivekitClient:{RoomEvent:{ParticipantConnected:'participant',Reconnecting:'reconnecting',Reconnected:'reconnected',Disconnected:'disconnected'},Track:{Source:{Camera:'camera',Microphone:'microphone'}},
      Room:class{constructor(){this.handlers=new Map();this.published=[];this.replacements=[];this.localParticipant={publishTrack:async(track,options)=>{this.published.push(track);this.publishOptions||=[];this.publishOptions.push(options);return {track:{replaceTrack:async next=>{this.replacements.push({kind:track.kind,next});}}};}};rooms.push(this);}on(name,fn){this.handlers.set(name,fn);}async connect(){this.connected=true;}async disconnect(stopTracks=true){this.connected=false;this.stopTracks=stopTracks;}}
    },
    fetch:async(url,init={})=>{
      const data=init.body&&typeof init.body==='string'?JSON.parse(init.body):undefined;calls.push({url,method:init.method||'GET',data});
      const replacement=intercept?.(url,init,data);if(replacement)return await replacement;
      if(url==='http://127.0.0.1:4173/api/info')return ok({transport:'lan-jpeg-v1'});
      if(url==='http://127.0.0.1:4173/api/sessions')return ok({pairCode:'ABCD-EFGH'});
      if(url.includes('/frame?'))return ok({});
      if(url.startsWith('/api/auth?route=me'))return ok({configured:true,user});
      if(url.includes('route=logout'))return ok({ok:true});
      if(url.includes('action=status'))return ok({revision:saved?.revision,connected});
      if(url==='/api/session'){
        if(init.method==='DELETE'||data?.action==='cancel'){if(connected)return ok({kept:true});saved=undefined;return ok({removed:true});}
        if(data?.action==='publisher')return ok({livekitUrl:'wss://test.livekit.cloud',token:'test-token'});
        if(init.method==='POST'){saved=room(data?.action==='replace'?'revision-two':'revision-one');return ok(saved,201);}
        return saved?ok(saved):ok({},404);
      }
      throw new Error('unexpected request');
    },
  });context.window=context;
  vm.runInContext(runtime,context);vm.runInContext(app,context);
  return {run:code=>vm.runInContext(code,context),context,nodes,calls,streams,rooms,redirects,events,settle:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('create pairing starts camera and publishes automatically without a second action',async()=>{
  const f=fixture();await f.settle();assert.equal(await f.run('openPairing()'),true);
  assert.equal(f.streams.length,1);assert.equal(f.rooms[0].published.length,2);assert.equal(f.nodes.get('pairingDialog').open,true);
  assert.equal(f.nodes.get('pairingCode').textContent,'ABCDEF');assert.equal(f.nodes.get('pairingPassword').textContent,'ABCDEFGHJK');
  assert.ok(f.run('invitation(session)').startsWith('camvirtual://connect?'));assert.equal(f.run('invitation(session)').includes('token='),false);
});
test('rapid duplicate create requests do not duplicate capture or create rooms twice',async()=>{
  let resolve;const pending=new Promise(yes=>{resolve=yes;});const f=fixture({acquire:()=>pending});await f.settle();
  const opening=f.run('openPairing()');assert.equal(await f.run('openPairing()'),false);resolve(source());await opening;
  assert.equal(f.streams.length,1);assert.equal(f.calls.filter(c=>c.data?.action==='create').length,1);
});
test('closing unused modal revokes room while retaining independent preview',async()=>{
  const f=fixture();await f.settle();await f.run('openPairing()');await f.run('closePairing()');
  assert.equal(f.nodes.get('pairingDialog').open,false);assert.equal(f.run('session'),undefined);
  assert.ok(f.streams[0].tracks.every(track=>track.readyState==='live'));
  assert.equal(f.rooms[0].stopTracks,false);
  assert.equal(f.calls.find(c=>c.method==='DELETE').data.revision,'revision-one');
});
test('closing a connected modal keeps media and the room running',async()=>{
  const f=fixture({connected:true});await f.settle();await f.run('openPairing()');await f.run('closePairing()');
  assert.equal(f.nodes.get('pairingDialog').open,false);assert.equal(f.run('session.connected'),true);
  assert.ok(f.streams[0].tracks.every(track=>track.readyState==='live'));
});
test('new code is prominent action that replaces revision and publishes the new room',async()=>{
  const f=fixture();await f.settle();await f.run('openPairing()');await f.run('openPairing(true)');
  assert.equal(f.run('session.revision'),'revision-two');assert.equal(f.streams.length,1);assert.equal(f.rooms.length,2);
  assert.equal(f.calls.find(c=>c.data?.action==='replace').data.revision,'revision-one');
});
test('closing while camera permission is pending disposes a late stream and creates no room',async()=>{
  let resolve;const pending=new Promise(yes=>{resolve=yes;});const f=fixture({acquire:()=>pending});await f.settle();
  const opening=f.run('openPairing()');await f.run('closePairing()');const media=source();resolve(media);await opening;
  assert.ok(media.tracks.every(track=>track.readyState==='ended'));assert.equal(f.calls.some(c=>c.data?.action==='create'),false);
});
test('a room response arriving after modal close is cancelled rather than published',async()=>{
  let resolve,signal;const pending=new Promise(yes=>{resolve=yes;});const started=new Promise(yes=>{signal=yes;});
  const f=fixture({intercept(_url,_init,data){if(data?.action==='create'){signal();return pending;}}});await f.settle();
  const opening=f.run('openPairing()');await started;await f.run('closePairing()');resolve(ok(room(),201));await opening;
  assert.equal(f.rooms.length,0);assert.equal(f.calls.some(c=>c.method==='DELETE'&&c.data.revision==='revision-one'),true);
});
test('restoring saved pairing never opens the source before user action',async()=>{
  const f=fixture({existing:room()});await f.settle();assert.equal(f.streams.length,0);assert.equal(f.run('session.code'),'ABCDEF');
});
test('logout closes media and sends the user to login',async()=>{
  const f=fixture();await f.settle();await f.run('openPairing()');await f.nodes.get('logoutButton').events.get('click')();
  assert.ok(f.streams[0].tracks.every(track=>track.readyState==='ended'));assert.equal(f.redirects.at(-1),'/login');
});

test('preview opens before pairing and never creates or publishes a room',async()=>{
  const f=fixture();await f.settle();assert.equal(await f.run('startPreview()'),true);
  assert.equal(f.streams.length,1);assert.equal(f.rooms.length,0);assert.equal(f.nodes.get('pairingDialog').open,false);
  assert.equal(f.calls.some(c=>c.data?.action==='create'),false);
  await f.run('openPairing()');assert.equal(f.streams.length,1);
});
test('previously granted camera permission automatically opens preview without pairing',async()=>{
  const f=fixture({cameraPermission:'granted'});await f.settle();await f.settle();
  assert.equal(f.streams.length,1);assert.equal(f.rooms.length,0);assert.equal(f.nodes.get('pairingDialog').open,false);
});
test('USB startup connects directly without QR or modal',async()=>{
  const f=fixture({transport:'usb'});await f.settle();await f.settle();
  assert.equal(f.streams.length,1);assert.equal(f.nodes.get('pairingDialog').open,false);
  assert.equal(f.nodes.get('qrCode').innerHTML,'');assert.equal(f.calls.filter(c=>c.url.endsWith('/api/sessions')).length,1);
});
test('Cloud publishes one full resolution encoding without an application FPS ceiling',async()=>{
  const f=fixture();await f.settle();await f.run('openPairing()');
  const options=f.rooms[0].publishOptions[0];assert.equal(options.simulcast,false);assert.equal(options.videoCodec,'h264');
  assert.ok(options.videoEncoding.maxBitrate>=6000000);assert.equal(options.videoEncoding.maxFramerate,undefined);
});
test('USB restores the same session after a relay restart without opening a modal',async()=>{
  let firstFrame=true;
  const f=fixture({transport:'usb',intercept(url){if(url.includes('/frame?')&&firstFrame){firstFrame=false;return ok({},404);}}});
  await f.settle();await f.settle();
  const registrations=f.calls.filter(c=>c.url.endsWith('/api/sessions'));
  assert.equal(registrations.length,2);assert.equal(registrations[0].data.room,registrations[1].data.room);
  assert.equal(registrations[0].data.token,registrations[1].data.token);assert.equal(f.nodes.get('pairingDialog').open,false);
});

test('quality dropdowns apply automatically without reopening capture or changing the room',async()=>{
  const f=fixture({connected:true});await f.settle();await f.run('openPairing()');await f.run('closePairing()');
  const revision=f.run('session?.revision');
  f.nodes.get('outputResolution').value='landscape-1080';
  f.nodes.get('outputResolution').events.get('change')();
  await f.run('applySettings()');
  assert.equal(f.nodes.get('relayCanvas').width,1920);assert.equal(f.nodes.get('relayCanvas').height,1080);
  assert.equal(f.streams.length,1);assert.equal(f.run('session?.revision'),revision);assert.equal(f.rooms.length,1);
  assert.equal(f.nodes.get('pairingDialog').open,false);assert.equal(f.nodes.get('settingsStatus').textContent,'Đã áp dụng');
});

test('rapid source selections discard late camera and apply the newest device',async()=>{
  let resolve, count=0;const pending=new Promise(yes=>{resolve=yes;});
  const f=fixture({acquire:async()=>++count===2?pending:source()});await f.settle();await f.run('startPreview()');
  f.nodes.get('videoDevice').value='camera-b';f.nodes.get('videoDevice').events.get('change')();
  const changing=f.run('applySettings()');
  f.nodes.get('videoDevice').value='camera-c';f.nodes.get('videoDevice').events.get('change')();
  const stale=source();resolve(stale);await changing;
  assert.ok(stale.tracks.every(track=>track.readyState==='ended'));
  await f.run('applySettings()');
  assert.equal(f.run('appliedDevices.video'),'camera-c');assert.equal(f.streams.length,3);
  assert.ok(f.streams[0].tracks.every(track=>track.readyState==='ended'));
});

test('camera failure retains the working preview and offers retry',async()=>{
  let count=0;const f=fixture({acquire:async()=>{if(++count>1)throw Object.assign(Error(),{name:'NotReadableError'});return source();}});
  await f.settle();await f.run('startPreview()');
  f.nodes.get('videoDevice').value='unavailable';f.nodes.get('videoDevice').events.get('change')();await f.run('applySettings()');
  assert.ok(f.streams[0].tracks.every(track=>track.readyState==='live'));
  assert.equal(f.nodes.get('restartSource').hidden,false);
});

test('camera and microphone change replaces published audio without recreating Cloud room',async()=>{
  const f=fixture({connected:true});await f.settle();await f.run('openPairing()');await f.run('closePairing()');
  const revision=f.run('session.revision');
  f.nodes.get('videoDevice').value='camera-b';f.nodes.get('audioDevice').value='microphone-b';
  f.nodes.get('videoDevice').events.get('change')();await f.run('applySettings()');
  assert.equal(f.rooms.length,1);assert.equal(f.run('session.revision'),revision);
  assert.equal(f.rooms[0].replacements.length,1);assert.equal(f.rooms[0].replacements[0].kind,'audio');
  assert.ok(f.streams[0].tracks.every(track=>track.readyState==='ended'));
  assert.ok(f.streams[1].tracks.every(track=>track.readyState==='live'));
  assert.equal(f.nodes.get('pairingDialog').open,false);
});

test('source received after stop is disposed and cannot resurrect preview',async()=>{
  let resolve,count=0;const pending=new Promise(yes=>{resolve=yes;});
  const f=fixture({acquire:async()=>++count===2?pending:source()});await f.settle();await f.run('startPreview()');
  f.nodes.get('videoDevice').value='camera-b';f.nodes.get('videoDevice').events.get('change')();const changing=f.run('applySettings()');
  f.run('stopSource()');const stale=source();resolve(stale);await changing;
  assert.ok(stale.tracks.every(track=>track.readyState==='ended'));assert.equal(f.nodes.get('sourcePreview').srcObject,null);
});

test('camera choice changed during permission wait survives device enumeration',async()=>{
  let resolve,count=0;const pending=new Promise(yes=>{resolve=yes;});
  const f=fixture({acquire:async()=>++count===1?pending:source()});await f.settle();
  const starting=f.run('startPreview()');f.nodes.get('videoDevice').value='newest-camera';
  f.nodes.get('videoDevice').events.get('change')();resolve(source());await starting;
  assert.equal(f.nodes.get('videoDevice').value,'newest-camera');await f.run('applySettings()');
  assert.equal(f.run('appliedDevices.video'),'newest-camera');
});

test('source maximum capability is requested and every arriving frame is rendered without FPS ceiling',async()=>{
  const media=source(),constraints=[];
  media.getVideoTracks()[0].getCapabilities=()=>({frameRate:{min:1,max:120}});
  media.getVideoTracks()[0].applyConstraints=async value=>constraints.push(value);
  const f=fixture({acquire:async()=>media});await f.settle();
  let callback;
  f.nodes.get('sourcePreview').requestVideoFrameCallback=fn=>{callback=fn;return 1;};
  f.nodes.get('sourcePreview').cancelVideoFrameCallback=()=>{};
  await f.run('startPreview()');
  assert.equal(constraints[0].frameRate.ideal,120);
  const initial=f.run('drawSequence');
  for(let n=1;n<=120;n++) callback(n*1000/120,{presentedFrames:n});
  assert.equal(f.run('drawSequence')-initial,120);
  assert.equal(f.nodes.has('outputFps'),false);
  f.run('stopSource()');
});
