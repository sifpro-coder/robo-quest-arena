'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const W=1000, H=620, TICK=50;
const COLORS=['#22e6ff','#ff4fbc','#ffc857','#77ff83'];
const WALLS=[{x:193,y:159,w:106,h:30},{x:701,y:160,w:106,h:30},
 {x:193,y:426,w:106,h:30},{x:701,y:426,w:106,h:30},
 {x:461,y:120,w:78,h:52},{x:461,y:450,w:78,h:52},
 {x:415,y:290,w:170,h:40}];
const SPAWNS=[[85,85],[915,535],[915,85],[85,535]];
const QUIZ=[
 {q:'شنوّة وظيفة الحساس Ultrason؟',o:['يقيس المسافة','يشعل LED','يخزّن البرنامج'],a:0,why:'Ultrason يحسب المسافة باستعمال الموجات فوق الصوتية.'},
 {q:'شنوّة معنى GPIO في ESP32؟',o:['ذاكرة التخزين','مداخل ومخارج عامة','نوع بطارية'],a:1,why:'GPIO هي الأرجل اللي نتحكّموا بها في الإدخال والإخراج.'},
 {q:'أنهي أمر MicroPython يشعل LED مربوط بـ Pin؟',o:['led.off()','led.on()','led.sleep()'],a:1,why:'on() تفعّل الخرج الرقمي كي يكون LED مربوط بالطريقة المناسبة.'},
 {q:'شنوّة نستعملوا للتحكّم في سرعة موتور DC؟',o:['PWM','UART فقط','RTC'],a:0,why:'PWM يبدّل نسبة التشغيل للتحكّم في السرعة عبر دائرة قيادة مناسبة.'},
 {q:'شنوّة يعمل if في البرمجة؟',o:['يعيد الكود بلا توقف','يتثبت من شرط','يرسم صورة'],a:1,why:'if يختبر شرط وينفّذ تعليمات وقت يتحقق.'},
 {q:'كيفاش يعمل Robot suiveur de ligne؟',o:['بحساسات تتبع الخط','بـ GPS فقط','بميكروفون فقط'],a:0,why:'يتبع الخط باستعمال حساسات مثل IR ويصحّح اتجاه الموتورات.'},
 {q:'شنوّة هو Servo motor؟',o:['بطارية قابلة للشحن','موتور نجموا نتحكموا في الزاوية متاعو','حساس حرارة'],a:1,why:'الـ Servo يسمح عادة بالتحكم في موضع زاوي ضمن مداه.'},
 {q:'شنوّة تستعمل breadboard؟',o:['لتجربة الدوائر بلا لحام','لتخزين كود ESP32','كشاشة'],a:0,why:'Breadboard تركّب عليها مكونات إلكترونية للتجارب السريعة.'}
];
const rooms=new Map(); const sockets=new Set();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a,b)=>a+Math.random()*(b-a);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const circleRect=(x,y,r,w)=>{const cx=clamp(x,w.x,w.x+w.w),cy=clamp(y,w.y,w.y+w.h);return (x-cx)**2+(y-cy)**2<r*r};
const blocked=(x,y,r=19)=>x<r||x>W-r||y<r||y>H-r||WALLS.some(w=>circleRect(x,y,r,w));
function safeName(n){return String(n||'لاعب').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,16)||'لاعب'}
const newPlayer=(id,name,index)=>({id,name:safeName(name),color:COLORS[index],x:SPAWNS[index][0],y:SPAWNS[index][1],hp:100,score:0,kills:0,dirX:1,dirY:0,dx:0,dy:0,shoot:false,boost:false,boostAt:0,shotAt:0,invuln:0,respawnAt:0,quiz:null,quizStart:0,quizDone:0});
function send(c,obj){if(!c||!c.alive||c.socket.destroyed)return;const payload=Buffer.from(JSON.stringify(obj));const h=payload.length<126?Buffer.from([0x81,payload.length]):payload.length<65536?Buffer.from([0x81,126,payload.length>>8,payload.length&255]):null;if(h){try{c.socket.write(Buffer.concat([h,payload]));}catch(e){}}}
function broadcast(room,msg){for(const p of room.players.values())send(p.conn,msg)}
function leaderboard(room){return [...room.players.values()].sort((a,b)=>b.score-a.score).map(p=>({id:p.id,name:p.name,color:p.color,score:p.score,kills:p.kills}));}
function summary(room){return {type:'lobby',code:room.code,host:room.host,phase:room.phase,mode:room.mode,players:[...room.players.values()].map(p=>({id:p.id,name:p.name,color:p.color})),max:4};}
function codeGen(){let c;do{c=String(crypto.randomInt(100000,1000000))}while(rooms.has(c));return c}
function takePlayerOut(conn){if(!conn.room)return;const room=rooms.get(conn.room);conn.room=null;if(!room)return;
 room.players.delete(conn.id);if(room.host===conn.id){room.host=room.players.keys().next().value||null}if(room.players.size===0){rooms.delete(room.code);return;}broadcast(room,summary(room));}
function joinRoom(conn,code,name,make=false,mode='versus'){
 takePlayerOut(conn);
 let room=make?{code:codeGen(),players:new Map(),host:conn.id,mode:mode==='coop'?'coop':'versus',phase:'lobby',started:0,ends:0,enemies:[],shots:[],pickups:[],lastSpawn:0,lastPick:0,lastActive:Date.now(),lastTick:Date.now(),seq:1}:rooms.get(String(code||'').trim());
 if(!room){send(conn,{type:'error',message:'الكود غالط أو الغرفة تسكرت'});return}
 if(room.phase!=='lobby'){send(conn,{type:'error',message:'الماتش بدا. استنّى الجولة الجاية.'});return}
 if(room.players.size>=4){send(conn,{type:'error',message:'الغرفة معمّرة (4 لاعبين)'});return}
 if(make)rooms.set(room.code,room);
 const p=newPlayer(conn.id,name,room.players.size);p.conn=conn;
 room.players.set(conn.id,p);conn.room=room.code;room.lastActive=Date.now();
 send(conn,{type:'joined',code:room.code,id:conn.id});broadcast(room,summary(room));
}
function resetRound(room){room.phase='playing';room.started=Date.now();room.ends=room.started+120000;room.lastSpawn=0;room.lastPick=0;room.enemies=[];room.shots=[];room.pickups=[];room.seq=1;room.lastTick=Date.now();let i=0;
 for(const p of room.players.values()){let s=SPAWNS[i++];Object.assign(p,{x:s[0],y:s[1],hp:100,score:0,kills:0,dirX:i%2?1:-1,dirY:0,dx:0,dy:0,shoot:false,boost:false,boostAt:0,shotAt:0,invuln:0,respawnAt:0,quiz:null,quizDone:0});}
 for(let j=0;j<5;j++)spawnEnemy(room);
 for(let j=0;j<4;j++)spawnPickup(room);spawnPickup(room,'quiz');
 broadcast(room,{type:'started',mode:room.mode,remaining:120});
}
function freePosition(){for(let i=0;i<60;i++){const x=rnd(45,W-45),y=rnd(45,H-45);if(!blocked(x,y,30))return {x,y};}return{x:350,y:240}}
function spawnEnemy(room){const p=freePosition();room.enemies.push({id:room.seq++,x:p.x,y:p.y,hp:40,dir:0,attackAt:0})}
function spawnPickup(room,forcedType){const p=freePosition();const type=forcedType || (Math.random()<.22?'quiz':Math.random()<.48?'heal':'battery');room.pickups.push({id:room.seq++,x:p.x,y:p.y,type})}
function move(o,vx,vy,r=18){const nx=clamp(o.x+vx,r,W-r),ny=clamp(o.y+vy,r,H-r);if(!blocked(nx,o.y,r))o.x=nx;if(!blocked(o.x,ny,r))o.y=ny;}
function shotTarget(room,p){let targets=room.mode==='versus'?[...room.players.values()].filter(x=>x.id!==p.id&&x.hp>0):[];
 targets=targets.concat(room.enemies.filter(x=>x.hp>0));targets=targets.filter(t=>distance(t,p)<650);
 targets.sort((a,b)=>distance(a,p)-distance(b,p));return targets[0]||null;
}
function updateRoom(room,now){if(room.phase!=='playing')return;
 if(now>=room.ends){room.phase='finished';broadcast(room,{type:'finished',board:leaderboard(room)});broadcast(room,summary(room));return}
 const dt=clamp((now-room.lastTick)/TICK,0.3,2);room.lastTick=now;
 if(now-room.lastSpawn>5500 && room.enemies.length<15){spawnEnemy(room);room.lastSpawn=now}
 if(now-room.lastPick>4200 && room.pickups.length<9){spawnPickup(room);room.lastPick=now}
 for(const p of room.players.values()){
  if(p.hp<=0){if(now>=p.respawnAt){p.hp=100;p.invuln=now+1500;const where=freePosition();p.x=where.x;p.y=where.y;}else continue;}
  if(p.quiz)continue;
  let mag=Math.hypot(p.dx,p.dy),dx=mag>0?p.dx/mag:0,dy=mag>0?p.dy/mag:0;
  const dash=p.boost&&now>p.boostAt?2.15:1;
  if(dash>1)p.boostAt=now+4300;
  move(p,dx*4.1*dash*dt,dy*4.1*dash*dt,20);
  if(mag>.1){p.dirX=dx;p.dirY=dy}
  if(p.shoot&&now-p.shotAt>230){p.shotAt=now;let t=shotTarget(room,p);let vx=p.dirX,vy=p.dirY;if(t){const d=distance(t,p)||1;vx=(t.x-p.x)/d;vy=(t.y-p.y)/d;}
   room.shots.push({id:room.seq++,x:p.x+vx*29,y:p.y+vy*29,vx:vx*14,vy:vy*14,owner:p.id,life:48});
  }
  for(let i=room.pickups.length-1;i>=0;i--){const c=room.pickups[i];if(distance(p,c)<30){room.pickups.splice(i,1);
    if(c.type==='battery'){p.score+=20;p.hp=Math.min(100,p.hp+5);send(p.conn,{type:'event',kind:'battery',text:'🔋 +20 نقطة'})}
    if(c.type==='heal'){p.hp=Math.min(100,p.hp+35);send(p.conn,{type:'event',kind:'heal',text:'💚 +35 صحة'})}
    if(c.type==='quiz' && !p.quiz){const i=crypto.randomInt(QUIZ.length);p.quiz={i};p.quizStart=now;send(p.conn,{type:'question',question:QUIZ[i].q,options:QUIZ[i].o});}
  }}
 }
 for(const e of room.enemies){let targets=[...room.players.values()].filter(p=>p.hp>0&&!p.quiz);if(!targets.length)continue;targets.sort((a,b)=>distance(a,e)-distance(b,e));const p=targets[0],d=distance(e,p)||1;
   move(e,(p.x-e.x)/d*.92*dt,(p.y-e.y)/d*.92*dt,17);
   if(d<40&&now-e.attackAt>850&&p.invuln<now){p.hp=Math.max(0,p.hp-11);e.attackAt=now;if(p.hp<=0){p.respawnAt=now+2000;p.score=Math.max(0,p.score-20)}send(p.conn,{type:'event',kind:'hit',text:'💥 روبوت معادي ضربك'})}
 }
 for(let i=room.shots.length-1;i>=0;i--){const s=room.shots[i];s.x+=s.vx*dt;s.y+=s.vy*dt;s.life-=dt;let hit=false;
  if(s.life<=0||blocked(s.x,s.y,6))hit=true;
  if(!hit){for(const e of room.enemies){if(distance(e,s)<24){e.hp-=24;hit=true;if(e.hp<=0){const owner=room.players.get(s.owner);if(owner){owner.score+=35;owner.kills++;send(owner.conn,{type:'event',kind:'kill',text:'⚡ Drone +35'})}}break;}}}
  if(!hit&&room.mode==='versus'){for(const p of room.players.values()){if(p.id===s.owner||p.hp<=0||p.invuln>now)continue;if(distance(p,s)<27){p.hp=Math.max(0,p.hp-23);hit=true;
    if(p.hp<=0){p.respawnAt=now+2400;p.score=Math.max(0,p.score-15);const owner=room.players.get(s.owner);if(owner){owner.score+=100;owner.kills++;send(owner.conn,{type:'event',kind:'kill',text:'🏆 تفوّقت على منافس +100'})}}
    send(p.conn,{type:'event',kind:'hit',text:'💥 ليزر من منافس'});break;}}}
  if(hit)room.shots.splice(i,1);
 }
 room.enemies=room.enemies.filter(e=>e.hp>0);
 const remain=Math.max(0,Math.ceil((room.ends-now)/1000));const state={type:'state',phase:room.phase,code:room.code,mode:room.mode,remaining:remain,
  players:[...room.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,x:Math.round(p.x),y:Math.round(p.y),hp:p.hp,score:p.score,kills:p.kills,quiz:!!p.quiz,respawning:p.hp<=0})),
  enemies:room.enemies.map(e=>({id:e.id,x:Math.round(e.x),y:Math.round(e.y),hp:e.hp})),
  shots:room.shots.map(s=>({x:Math.round(s.x),y:Math.round(s.y),owner:s.owner})),pickups:room.pickups,board:leaderboard(room)};
 broadcast(room,state);
}
function handle(conn,msg){if(!msg||typeof msg!=='object')return;
 const room=conn.room?rooms.get(conn.room):null;const p=room?room.players.get(conn.id):null;
 if(msg.type==='create'){joinRoom(conn,null,msg.name,true,msg.mode);return}
 if(msg.type==='join'){joinRoom(conn,msg.code,msg.name,false);return}
 if(msg.type==='leave'){takePlayerOut(conn);return}
 if(!p)return;room.lastActive=Date.now();
 if(msg.type==='start' && room.host===conn.id && (room.phase==='lobby'||room.phase==='finished')){resetRound(room);return}
 if(msg.type==='input' && room.phase==='playing'){p.dx=clamp(Number(msg.dx)||0,-1,1);p.dy=clamp(Number(msg.dy)||0,-1,1);p.shoot=!!msg.shoot;p.boost=!!msg.boost;return}
 if(msg.type==='answer'&&p.quiz){const idx=p.quiz.i,q=QUIZ[idx],n=Number(msg.answer);if(Date.now()-p.quizStart>21000){p.quiz=null;send(conn,{type:'answerResult',correct:false,why:'انتهى الوقت. '+q.why});return}
  const good=Number.isInteger(n)&&n===q.a;p.quiz=null;p.quizDone++;
  if(good){p.score+=65;p.hp=Math.min(100,p.hp+25);p.invuln=Date.now()+1500;}
  send(conn,{type:'answerResult',correct:good,why:q.why,bonus:good?65:0});return;
 }
}
function onFrame(conn,opcode,data){if(opcode===8){conn.socket.end();return}if(opcode===9){frameRaw(conn,10,data);return}if(opcode!==1)return;
 let msg;try{msg=JSON.parse(data.toString('utf8'));}catch(e){return}handle(conn,msg)}
function frameRaw(conn,opcode,payload){if(!conn.alive||conn.socket.destroyed)return;const len=payload.length;const header=len<126?Buffer.from([0x80|opcode,len]):len<65536?Buffer.from([0x80|opcode,126,len>>8,len&255]):null;if(header)conn.socket.write(Buffer.concat([header,payload]));}
function parse(conn,chunk){conn.buffer=Buffer.concat([conn.buffer,chunk]);if(conn.buffer.length>65536){conn.socket.destroy();return}
 while(conn.buffer.length>=2){let d=conn.buffer;const fin=!!(d[0]&0x80),opcode=d[0]&0x0f,mask=!!(d[1]&0x80);let n=d[1]&127,off=2;
 if(!fin||!mask){conn.socket.destroy();return}
 if(n===126){if(d.length<4)break;n=d.readUInt16BE(2);off=4}else if(n===127){conn.socket.destroy();return}
 if(n>8192){conn.socket.destroy();return}
 if(d.length<off+4+n)break;
 const key=d.subarray(off,off+4),start=off+4,out=Buffer.alloc(n);for(let i=0;i<n;i++)out[i]=d[start+i]^key[i%4];conn.buffer=d.subarray(start+n);onFrame(conn,opcode,out);
 }
}
const server=http.createServer((req,res)=>{
 let u;try{u=new URL(req.url,'http://localhost')}catch(e){res.writeHead(400).end();return}
 if(u.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));return}
 if(u.pathname!=='/' && u.pathname!=='/index.html'){res.writeHead(404).end('Not found');return}
 const filepath=path.join(ROOT,'index.html');
 fs.readFile(filepath,(err,data)=>{if(err){res.writeHead(404).end('Not found');return}res.writeHead(200,{'Content-Type':filepath.endsWith('.html')?'text/html; charset=utf-8':filepath.endsWith('.js')?'application/javascript; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data)})
});
server.on('upgrade',(req,socket)=>{let u;try{u=new URL(req.url,'http://localhost')}catch(e){socket.destroy();return}
 if(u.pathname!=='/ws'||req.headers.upgrade?.toLowerCase()!=='websocket'||!req.headers['sec-websocket-key']){socket.destroy();return}
 const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
 const conn={id:crypto.randomUUID(),socket,room:null,buffer:Buffer.alloc(0),alive:true};sockets.add(conn);
 socket.on('data',b=>parse(conn,b));socket.on('close',()=>{conn.alive=false;takePlayerOut(conn);sockets.delete(conn)});socket.on('error',()=>{});
 send(conn,{type:'welcome',id:conn.id});
});
setInterval(()=>{const now=Date.now();for(const [code,room] of rooms){if(room.players.size===0||now-room.lastActive>3600000){rooms.delete(code);continue}updateRoom(room,now);for(const p of room.players.values()){if(p.quiz&&now-p.quizStart>22000){p.quiz=null;send(p.conn,{type:'answerResult',correct:false,why:'انتهى وقت السؤال'})}}}},TICK).unref();
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log('ROBO QUEST ARENA LIVE running on http://localhost:'+PORT));
module.exports={server,rooms,W,H,QUIZ};
