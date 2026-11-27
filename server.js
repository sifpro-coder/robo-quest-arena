'use strict';
// CFI ARENA • live classrooms of up to 10 learners. No third-party dependencies.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const BANK=require('./questions.json');
const academyApi=require('./academy-api.js');
const snake=require('./snake-server.js');
const battle=require('./battle-server.js');
const challenge=require('./challenge-server.js');
const rewards=require('./rewards.js');
const PORT=Number(process.env.PORT||3000), W=1000,H=620,TICK=50,MAX=10;
const COLORS=['#FFD33D','#FF5A64','#34D8F6','#8AFF8A','#F398FF','#FF9F43','#A0B5FF','#F9EC6A','#64F0C8','#E8A96D'];
const WALLS=[{x:192,y:155,w:103,h:31},{x:705,y:155,w:103,h:31},{x:192,y:434,w:103,h:31},{x:705,y:434,w:103,h:31},{x:460,y:125,w:80,h:49},{x:460,y:447,w:80,h:49},{x:416,y:291,w:168,h:38}];
const SPAWNS=[[76,70],[925,545],[925,70],[76,545],[500,75],[500,545],[76,305],[925,305],[315,75],[687,545]];
const rooms=new Map(), sockets=new Set(), REJOIN_MS=Math.max(5,Math.min(180,Number(process.env.CFI_REJOIN_MINUTES)||30))*60*1000;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),rnd=(a,b)=>a+Math.random()*(b-a);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const circleRect=(x,y,r,w)=>{const cx=clamp(x,w.x,w.x+w.w),cy=clamp(y,w.y,w.y+w.h);return(x-cx)**2+(y-cy)**2<r*r};
const blocked=(x,y,r=19)=>x<r||x>W-r||y<r||y>H-r||WALLS.some(w=>circleRect(x,y,r,w));
const safeName=(s)=>String(s||'لاعب').replace(/[<>&\u0000-\u001f]/g,'').trim().slice(0,24)||'لاعب';
const shuffle=(a)=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
function pool(room){return BANK.filter(q=>q.topic===room.topic&&q.level===room.level)}
function quizQuestion(room,used){let set=pool(room);let candidates=set.filter(q=>!used.has(BANK.indexOf(q)));if(!candidates.length){used.clear();candidates=set}let q=candidates[crypto.randomInt(candidates.length)];used.add(BANK.indexOf(q));let order=shuffle([0,1,2,3]);return {q:q.q,options:order.map(i=>q.options[i]),correct:order.indexOf(q.answer),why:q.why}}
const newPlayer=(id,name,index)=>({id,token:crypto.randomBytes(24).toString('hex'),connected:true,offlineAt:0,name:safeName(name),color:COLORS[index%10],team:index%2===0?'A':'B',x:SPAWNS[index%MAX][0],y:SPAWNS[index%MAX][1],hp:100,score:0,kills:0,dx:0,dy:0,shoot:false,boost:false,boostAt:0,shotAt:0,invuln:0,respawnAt:0,dirX:1,dirY:0,quiz:null,quizStart:0,used:new Set()});
function send(c,obj){if(!c||!c.alive||c.socket.destroyed||c.socket.writableLength>512000)return;const payload=Buffer.from(JSON.stringify(obj));const len=payload.length;const h=len<126?Buffer.from([0x81,len]):len<65536?Buffer.from([0x81,126,len>>8,len&255]):null;if(h)try{c.socket.write(Buffer.concat([h,payload]))}catch(e){}}
function broadcast(r,obj){for(const p of r.players.values())send(p.conn,obj)}
function board(r){return [...r.players.values()].sort((a,b)=>b.score-a.score).map(p=>({id:p.id,name:p.name,score:p.score,color:p.color,kills:p.kills,team:p.team,connected:p.connected}))}
function lobby(r){return{type:'lobby',code:r.code,host:r.host,phase:r.phase,game:r.game,mode:r.mode,topic:r.topic,level:r.level,max:MAX,duration:r.duration,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,team:p.team,connected:p.connected}))}}
function codeGen(){let c;do{c=String(crypto.randomInt(100000,400000))}while(rooms.has(c)||challenge.rooms.has(c));return c}
function remove(c,hard=false){if(!c.room)return;const r=rooms.get(c.room);if(!r)return;const p=r.players.get(c.id);c.room=null;if(!p||p.conn!==c)return;
 if(hard){r.players.delete(c.id);if(r.host===c.id)r.host=[...r.players.values()].find(x=>x.connected)?.id||null;}
 else {p.connected=false;p.offlineAt=Date.now();p.conn=null;p.dx=0;p.dy=0;p.shoot=false;p.boost=false;if(r.host===c.id)r.host=[...r.players.values()].find(x=>x.connected)?.id||c.id;}
 r.lastActive=Date.now();if(!r.players.size){rooms.delete(r.code);return}broadcast(r,lobby(r));}
function syncQuestion(r,p){if(r.game==='quiz'){
 const q=r.quizRound;if(q?.phase==='asking'&&Date.now()<q.deadline)send(p.conn,{type:'challenge',number:r.quizCount,total:10,question:q.q,options:q.options,deadline:q.deadline,board:board(r),answered:q.answers.has(p.id)});
 else if(q?.phase==='reveal')send(p.conn,{type:'challengeResult',correct:q.correct,why:q.why,board:board(r),nextIn:Math.ceil((r.nextQuestionAt-Date.now())/1000)});
 }else if(p.quiz&&Date.now()-p.quizStart<21000)send(p.conn,{type:'arenaQuestion',question:p.quiz.q,options:p.quiz.options});}
function join(c,params){const make=params.type==='create';let r=make?null:rooms.get(String(params.code||'').trim());
 if(!make&&!r){send(c,{type:'error',message:'الغرفة موش موجودة أو انتهت'});return}
 const token=typeof params.token==='string'?params.token:'';let old=null;
 if(!make&&token.length===48)old=[...r.players.values()].find(p=>p.token===token)||null;
 if(old&&old.rankUser!==rewards.account(c)){send(c,{type:'error',message:'Reconnectez le même compte.'});return}
 const identity=rewards.playerIdentity(c,params.name,r,old);if(identity.error){send(c,{type:'error',message:identity.error});return}
 if(r&&!old&&r.players.size>=MAX){send(c,{type:'error',message:'الغرفة معمّرة (10 لاعبين)'});return}
 remove(c,true);
 if(make){const topic=['arduino','esp32','wokwi'].includes(params.topic)?params.topic:'arduino';const duration=Math.max(1,Math.min(5,Number.isInteger(Number(params.duration))?Number(params.duration):3));r={duration,code:codeGen(),players:new Map(),host:null,game:params.game==='quiz'?'quiz':'arena',mode:['versus','teams','coop'].includes(params.mode)?params.mode:'versus',topic,level:Number(params.level)===2?2:1,phase:'lobby',shots:[],pickups:[],enemies:[],seq:1,lastTick:Date.now(),started:0,ends:0,lastEnemy:0,lastPick:0,lastActive:Date.now(),quizRound:null,quizUsed:new Set(),quizCount:0};rooms.set(r.code,r)}
 const p=old||newPlayer(c.id,identity.name,r.players.size);
 if(old){if(p.conn&&p.conn!==c){p.conn.room=null;send(p.conn,{type:'error',message:'الحساب مفتوح في متصفح آخر'});p.conn.socket.end()}c.id=p.id;p.connected=true;p.offlineAt=0;p.invuln=Date.now()+2300;}
 else{p.rankUser=rewards.account(c);r.players.set(p.id,p)}
 p.conn=c;c.room=r.code;if(!r.host||!r.players.has(r.host)||!r.players.get(r.host).connected)r.host=p.id;
 r.lastActive=Date.now();send(c,{type:'joined',code:r.code,id:p.id,token:p.token,restored:!!old,phase:r.phase,game:r.game,topic:r.topic,level:r.level});broadcast(r,lobby(r));
 if(r.phase==='playing'){send(c,{type:'started',game:r.game,late:true});syncQuestion(r,p)}
 if(r.phase==='finished')send(c,{type:'finished',board:board(r)});
}
function freeSpot(r=24){for(let i=0;i<60;i++){const p={x:rnd(35,W-35),y:rnd(35,H-35)};if(!blocked(p.x,p.y,r))return p}return{x:350,y:240}}
function enemy(r){const p=freeSpot(25);r.enemies.push({id:r.seq++,...p,hp:40,hitAt:0})}
function pickup(r,forced){const p=freeSpot(25),type=forced||(['battery','battery','heal','quiz'][crypto.randomInt(4)]);r.pickups.push({id:r.seq++,...p,type})}
function move(o,vx,vy,r=18){const nx=clamp(o.x+vx,r,W-r),ny=clamp(o.y+vy,r,H-r);if(!blocked(nx,o.y,r))o.x=nx;if(!blocked(o.x,ny,r))o.y=ny}
function reset(r){rewards.start(r);r.phase='playing';r.started=Date.now();r.lastTick=r.started;r.quizUsed=new Set();r.quizCount=0;r.quizRound=null;
 let i=0;for(const p of r.players.values()){const n=i++,s=SPAWNS[n];Object.assign(p,{x:s[0],y:s[1],team:n%2===0?'A':'B',hp:100,score:0,kills:0,dx:0,dy:0,shoot:false,boost:false,boostAt:0,shotAt:0,invuln:0,respawnAt:0,quiz:null,quizStart:0,used:new Set()})}
 if(r.game==='quiz'){r.nextQuestionAt=r.started+1000;r.ends=r.started+r.duration*60000;broadcast(r,{type:'started',game:'quiz'});return}
 r.ends=r.started+r.duration*60000;r.lastEnemy=0;r.lastPick=0;r.shots=[];r.pickups=[];r.enemies=[];r.seq=1;for(let i=0;i<5;i++)enemy(r);for(let i=0;i<5;i++)pickup(r);pickup(r,'quiz');broadcast(r,{type:'started',game:'arena'});
}
function finish(r){rewards.finish(r,r.game,p=>p.score);r.phase='finished';broadcast(r,{type:'finished',board:board(r)});broadcast(r,lobby(r))}
function updateQuiz(r,now){if(r.phase!=='playing')return;if(now>=r.ends){finish(r);return}
 if(r.quizRound&&r.quizRound.phase==='asking'&&(now>=r.quizRound.deadline||r.quizRound.answers.size>=[...r.players.values()].filter(p=>p.connected).length)){
 const q=r.quizRound;r.quizRound.phase='reveal';r.nextQuestionAt=now+3200;
 broadcast(r,{type:'challengeResult',correct:q.correct,why:q.why,board:board(r),nextIn:3});
 }
 if((!r.quizRound||r.quizRound.phase==='reveal')&&now>=r.nextQuestionAt){if(now>=r.ends){finish(r);return}
 const q=quizQuestion(r,r.quizUsed);r.quizCount++;r.quizRound={...q,phase:'asking',deadline:now+18000,answers:new Set()};broadcast(r,{type:'challenge',number:r.quizCount,total:10,question:q.q,options:q.options,deadline:r.quizRound.deadline,board:board(r)});
 }
}
function shotTarget(r,p){let targets=r.mode==='versus'?[...r.players.values()].filter(x=>x.id!==p.id&&x.hp>0&&x.connected):r.mode==='teams'?[...r.players.values()].filter(x=>x.team!==p.team&&x.hp>0&&x.connected):[];targets=targets.concat(r.enemies.filter(e=>e.hp>0)).filter(t=>dist(t,p)<550).sort((a,b)=>dist(a,p)-dist(b,p));return targets[0]||null}
function updateArena(r,now){if(now>=r.ends){finish(r);return}const dt=clamp((now-r.lastTick)/TICK,.3,2);r.lastTick=now;
 if(now-r.lastEnemy>4800&&r.enemies.length<14){enemy(r);r.lastEnemy=now}if(now-r.lastPick>3400&&r.pickups.length<11){pickup(r);r.lastPick=now}
 for(const p of r.players.values()){
 if(!p.connected)continue;
 if(p.hp<=0){if(now<p.respawnAt)continue;const s=freeSpot(28);p.x=s.x;p.y=s.y;p.hp=100;p.invuln=now+1600}
 if(p.quiz)continue;let m=Math.hypot(p.dx,p.dy),vx=m>0?p.dx/m:0,vy=m>0?p.dy/m:0;const fast=p.boost&&now>p.boostAt?2:1;if(fast>1)p.boostAt=now+3900;move(p,vx*4.1*fast*dt,vy*4.1*fast*dt,20);if(m>.1){p.dirX=vx;p.dirY=vy}
 if(p.shoot&&now-p.shotAt>245){p.shotAt=now;const target=shotTarget(r,p);let x=p.dirX,y=p.dirY;if(target){const d=dist(p,target)||1;x=(target.x-p.x)/d;y=(target.y-p.y)/d}r.shots.push({id:r.seq++,x:p.x+x*27,y:p.y+y*27,vx:x*15,vy:y*15,owner:p.id,life:45})}
 for(let i=r.pickups.length-1;i>=0;i--){const item=r.pickups[i];if(dist(item,p)>=29)continue;r.pickups.splice(i,1);
  if(item.type==='battery'){p.score+=20;p.hp=Math.min(100,p.hp+5);send(p.conn,{type:'event',kind:'battery',text:'🔋 +20 XP'})}
  else if(item.type==='heal'){p.hp=Math.min(100,p.hp+33);send(p.conn,{type:'event',kind:'heal',text:'💚 +33 صحة'})}
  else if(!p.quiz){const q=quizQuestion(r,p.used);p.quiz=q;p.quizStart=now;send(p.conn,{type:'arenaQuestion',question:q.q,options:q.options})}
 }
 }
 for(const e of r.enemies){const players=[...r.players.values()].filter(p=>p.connected&&p.hp>0&&!p.quiz).sort((a,b)=>dist(a,e)-dist(b,e));if(!players.length)continue;const target=players[0],d=dist(target,e)||1;move(e,(target.x-e.x)/d*.87*dt,(target.y-e.y)/d*.87*dt,17);if(d<40&&now-e.hitAt>900&&target.invuln<now){target.hp=Math.max(0,target.hp-9);e.hitAt=now;if(!target.hp){target.respawnAt=now+1800;target.score=Math.max(0,target.score-20)}send(target.conn,{type:'event',kind:'hit',text:'💥 Drone ضربك'})}}
 for(let i=r.shots.length-1;i>=0;i--){const s=r.shots[i];s.x+=s.vx*dt;s.y+=s.vy*dt;s.life-=dt;let hit=s.life<=0||blocked(s.x,s.y,6);
 if(!hit){for(const e of r.enemies){if(dist(e,s)<23){e.hp-=24;hit=true;if(e.hp<=0){const owner=r.players.get(s.owner);if(owner){owner.score+=35;owner.kills++;send(owner.conn,{type:'event',kind:'kill',text:'⚡ Drone +35 XP'})}}break}}}
 if(!hit&&r.mode!=='coop'){for(const p of r.players.values()){const owner=r.players.get(s.owner);if(!p.connected||p.id===s.owner||p.hp<=0||p.invuln>now||r.mode==='teams'&&owner&&owner.team===p.team)continue;if(dist(p,s)<27){p.hp=Math.max(0,p.hp-23);hit=true;if(!p.hp){p.respawnAt=now+1900;p.score=Math.max(0,p.score-15);if(owner){owner.score+=100;owner.kills++;send(owner.conn,{type:'event',kind:'kill',text:'🏆 منافس +100 XP'})}}send(p.conn,{type:'event',kind:'hit',text:'💥 ليزر منافس'});break}}}
 if(hit)r.shots.splice(i,1)
 }
 r.enemies=r.enemies.filter(e=>e.hp>0);
 broadcast(r,{type:'state',remaining:Math.max(0,Math.ceil((r.ends-now)/1000)),code:r.code,game:r.game,mode:r.mode,players:[...r.players.values()].filter(p=>p.connected).map(p=>({id:p.id,name:p.name,team:p.team,color:p.color,x:Math.round(p.x),y:Math.round(p.y),hp:p.hp,score:p.score,kills:p.kills,quiz:!!p.quiz})),enemies:r.enemies.map(e=>({id:e.id,x:Math.round(e.x),y:Math.round(e.y),hp:e.hp})),shots:r.shots.map(s=>({x:Math.round(s.x),y:Math.round(s.y),owner:s.owner})),pickups:r.pickups,board:board(r)})
}
function handle(c,m){if(c.namespace==='challenge'){challenge.handle(c,m,rooms);return}if(c.namespace==='snake'){snake.handle(c,m);return}if(c.namespace==='battle'){battle.handle(c,m);return}if(!m||typeof m!=='object')return;if(m.type==='create'||m.type==='join'){join(c,m);return}if(m.type==='leave'){remove(c,true);return}const r=rooms.get(c.room),p=r?.players.get(c.id);if(!p)return;r.lastActive=Date.now();
 if(m.type==='start'&&r.host===c.id&&(r.phase==='lobby'||r.phase==='finished')){reset(r);return}
 if(m.type==='input'&&r.phase==='playing'&&r.game==='arena'){p.dx=clamp(Number(m.dx)||0,-1,1);p.dy=clamp(Number(m.dy)||0,-1,1);p.shoot=!!m.shoot;p.boost=!!m.boost;return}
 if(m.type==='answerArena'&&r.phase==='playing'&&p.quiz){const q=p.quiz;p.quiz=null;const correct=Date.now()-p.quizStart<=21000&&Number.isInteger(m.answer)&&m.answer===q.correct;if(correct){p.score+=10;p.hp=Math.min(100,p.hp+25);p.invuln=Date.now()+1000}send(c,{type:'arenaAnswer',correct,correctIndex:q.correct,why:q.why});return}
 if(m.type==='answerQuiz'&&r.phase==='playing'&&r.game==='quiz'&&r.quizRound?.phase==='asking'){const q=r.quizRound;if(q.answers.has(c.id))return;const n=Number(m.answer);if(!Number.isInteger(n)||n<0||n>3)return;q.answers.add(c.id);const correct=n===q.correct;const bonus=correct?10:0;if(correct)p.score+=bonus;send(c,{type:'answerRecorded',correct,points:bonus})}
}
function raw(c,opcode,payload){if(!c.alive||c.socket.destroyed)return;const n=payload.length,h=n<126?Buffer.from([0x80|opcode,n]):n<65536?Buffer.from([0x80|opcode,126,n>>8,n&255]):null;if(h)try{c.socket.write(Buffer.concat([h,payload]))}catch(e){}}
function parse(c,chunk){c.buffer=Buffer.concat([c.buffer,chunk]);if(c.buffer.length>65536){c.socket.destroy();return}while(c.buffer.length>=2){const d=c.buffer,opcode=d[0]&15,mask=!!(d[1]&128),fin=!!(d[0]&128);let n=d[1]&127,offset=2;if(!mask||!fin){c.socket.destroy();return}if(n===126){if(d.length<4)break;n=d.readUInt16BE(2);offset=4}else if(n===127){c.socket.destroy();return}if(n>8192){c.socket.destroy();return}if(d.length<offset+4+n)break;const key=d.subarray(offset,offset+4),buf=Buffer.alloc(n);for(let i=0;i<n;i++)buf[i]=d[offset+4+i]^key[i%4];c.buffer=d.subarray(offset+4+n);if(opcode===8){c.socket.end();return}if(opcode===9){raw(c,10,buf);continue}if(opcode!==1)continue;let m;try{m=JSON.parse(buf.toString('utf8'))}catch(e){continue}handle(c,m)}}
const server=http.createServer((req,res)=>{let u;try{u=new URL(req.url,'http://localhost')}catch(e){res.writeHead(400).end();return}
 if(u.pathname.startsWith('/api/academy/')){ academyApi.respond(req,res,u); return; }
 if(u.pathname==='/api/battle/status'){ battle.status(req,res).catch(()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Service Battle temporairement indisponible'}))}});return; }
 if(u.pathname==='/api/snake/lessons'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({lessons:snake.lessonCatalog()}));return}
 if(u.pathname==='/api/games/inventory'){(async()=>{const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};try{if(req.method!=='GET')return reply(405,{error:'method'});const u=await academyApi.viewer(req);if(!u||u.role!=='student'||u.must_change_password)return reply(401,{error:'login'});const items=await academyApi.db('cfi_battle_inventory','GET','?select=item_key&user_id=eq.'+encodeURIComponent(u.id)+'&limit=50');return reply(200,{items:items.map(x=>x.item_key)})}catch{return reply(503,{error:'unavailable'})}})();return;}
 if(u.pathname==='/api/games/rewards'){rewards.respond(req,res);return}
 if(u.pathname==='/api/games/join'){
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  if(req.method!=='GET')return reply(405,{error:'method'});
  const code=String(u.searchParams.get('code')||'');if(!/^\d{6}$/.test(code))return reply(400,{error:'invalid'});
  const found=[['/arena',rooms.get(code)],['/snake',snake.rooms.get(code)],['/battle',battle.rooms.get(code)],['/challenge',challenge.rooms.get(code)]].filter(x=>x[1]&&!x[1].solo);
  if(found.length!==1)return reply(found.length?409:404,{error:found.length?'conflict':'not_found'});
  const [page,room]=found[0];return reply(200,{path:page+'?room='+code+'&auto=1',game:page==='/arena'?(room.game==='quiz'?'quiz':'arena'):page==='/challenge'?room.game:page.slice(1)});
 }
 if(u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,rooms:rooms.size,maxPlayers:MAX,questionCount:BANK.length,snakeRooms:snake.rooms.size,battleRooms:battle.rooms.size,challengeRooms:challenge.rooms.size,version:'7.5.0'}));return}
 const files={'/':u.searchParams.has('room')?'index.html':'home.html','/index.html':'index.html','/arena':'index.html','/arena.html':'index.html','/home.html':'home.html','/academy':'academy.html','/academy.html':'academy.html','/global':'global.html','/global.html':'global.html','/questions.json':'questions.json','/logo-cfi.jpg':'logo-cfi.jpg','/snake':'snake.html','/snake.html':'snake.html','/battle':'battle.html','/battle.html':'battle.html','/challenge':'challenge.html','/player-name.js':'player-name.js'};const file=files[u.pathname];if(!file){res.writeHead(404).end('Not Found');return}
 fs.readFile(path.join(__dirname,file),(err,data)=>{if(err){res.writeHead(404).end('Not found');return}res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.json')?'application/json; charset=utf-8':file.endsWith('.jpg')?'image/jpeg':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)})});
server.on('upgrade',async(req,socket)=>{let u;try{u=new URL(req.url,'http://localhost')}catch(e){socket.destroy();return}if(!['/ws','/snake-ws','/battle-ws','/challenge-ws'].includes(u.pathname)||req.headers.upgrade?.toLowerCase()!=='websocket'||!req.headers['sec-websocket-key']){socket.destroy();return}let academyUser=null;if(req.headers.cookie){try{academyUser=await academyApi.viewer(req)}catch{academyUser=null}}if(socket.destroyed)return;const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');const c={id:crypto.randomUUID(),socket,room:null,namespace:u.pathname==='/snake-ws'?'snake':u.pathname==='/battle-ws'?'battle':u.pathname==='/challenge-ws'?'challenge':'arena',academyUser,buffer:Buffer.alloc(0),alive:true};sockets.add(c);socket.on('data',b=>parse(c,b));socket.on('close',()=>{c.alive=false;if(c.namespace==='snake')snake.detach(c);else if(c.namespace==='battle')battle.detach(c);else if(c.namespace==='challenge')challenge.detach(c);else remove(c,false);sockets.delete(c)});socket.on('error',()=>{});send(c,{type:'welcome',id:c.id});});
setInterval(()=>{const now=Date.now();snake.tick(now);battle.tick(now);challenge.tick(now);for(const [code,r] of rooms){for(const [id,p] of r.players){if(!p.connected&&now-p.offlineAt>REJOIN_MS){r.players.delete(id);if(r.host===id)r.host=[...r.players.values()].find(x=>x.connected)?.id||null;}}if(!r.players.size||now-r.lastActive>3600000){rooms.delete(code);continue}if(r.phase!=='playing')continue;if(r.game==='quiz')updateQuiz(r,now);else updateArena(r,now);for(const p of r.players.values())if(p.quiz&&now-p.quizStart>21000){const q=p.quiz;p.quiz=null;send(p.conn,{type:'arenaAnswer',correct:false,correctIndex:q.correct,why:'انتهى وقت السؤال. '+q.why})}}},TICK).unref();
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log('CFI ARENA listening at '+PORT));
module.exports={server,rooms,BANK,MAX,SPAWNS,blocked};
