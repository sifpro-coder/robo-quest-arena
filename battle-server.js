'use strict';
// CFI Battle — server-authoritative matches; only valid Academy sessions earn permanent rewards.
const crypto=require('crypto');
const academy=require('./academy-api.js');
const snake=require('./snake-server.js');
const MAX=12, W=1280,H=800,REJOIN_MS=30*60*1000;
const COLORS=['#f9cc65','#69ddad','#7bbfff','#f38fa8','#b7a0ff','#ffb279','#80dddf','#e2de82','#eab2f1','#a5f1bd','#b9c0fb','#ff9990'];
const CATALOG=[
 {key:'laser',name:'Laser',icon:'⚡',description:'Arme laser de départ'},
 {key:'shield',name:'Bouclier',icon:'🛡️',description:'Protection du robot'},
 {key:'turbo',name:'Turbo',icon:'🚀',description:'Accélération'},
 {key:'plasma',name:'Plasma',icon:'💥',description:'Arme améliorée'},
 {key:'repair',name:'Réparation',icon:'🔧',description:'Restauration de la santé'},
 {key:'radar',name:'Radar',icon:'📡',description:'Scanner les adversaires'}
];
const rooms=new Map(), sessions=new WeakMap();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),rnd=(a,b)=>a+Math.random()*(b-a),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const nameClean=s=>String(s||'Robot').replace(/[<>\x00-\x1f\x7f]/g,'').trim().slice(0,22)||'Robot';
function send(c,m){if(!c?.alive||c.socket.destroyed||c.socket.writableLength>350000)return;const payload=Buffer.from(JSON.stringify(m));if(payload.length>=65536)return;const header=payload.length<126?Buffer.from([0x81,payload.length]):Buffer.from([0x81,126,payload.length>>8,payload.length&255]);try{c.socket.write(Buffer.concat([header,payload]))}catch{}}
function active(r){return [...r.players.values()].filter(p=>p.connected)}
function announce(r,m){for(const p of active(r))send(p.conn,m)}
function board(r){return [...r.players.values()].sort((a,b)=>b.score-a.score||a.joinedAt-b.joinedAt).map((p,i)=>({rank:i+1,id:p.id,name:p.name,color:p.color,score:p.score,connected:p.connected}))}
function lobby(r){return{type:'battleLobby',code:r.code,host:r.host,mode:r.mode,from:r.from,to:r.to,duration:r.duration,phase:r.phase,max:MAX,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,connected:p.connected}))}}
function roomCode(){let k;do{k=String(crypto.randomInt(700000,1000000))}while(rooms.has(k));return k}
function lessonCount(){return snake.lessonCatalog().length}
function validRange(from,to){return Number.isInteger(from)&&Number.isInteger(to)&&from>=1&&to>=from&&to<=lessonCount()}
function quizDraw(r){return snake.__test.quizDraw({topic:'esp32academy',from:r.from,to:r.to,asked:r.asked})}
function cookieUser(c){return c.academyUser&&c.academyUser.role==='student'&&academy.subscription(c.academyUser).valid&&!c.academyUser.must_change_password?c.academyUser:null}
async function getItems(userId){const arr=await academy.db('cfi_battle_inventory','GET',`?select=item_key&user_id=eq.${encodeURIComponent(userId)}&limit=50`);return arr.map(x=>x.item_key).filter(x=>CATALOG.some(i=>i.key===x))}
async function saveItem(userId,key){await academy.db('cfi_battle_inventory','POST','?on_conflict=user_id,item_key',[{user_id:userId,item_key:key}],'resolution=ignore-duplicates,return=minimal')}
async function status(req,res){let u;try{u=await academy.viewer(req)}catch{u=null}const premium=!!(u&&u.role==='student'&&academy.subscription(u).valid&&!u.must_change_password);let items=[];let storageOk=true;if(premium){try{items=await getItems(u.id)}catch(e){storageOk=false}}
 res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({premium:premium&&storageOk,items,catalog:CATALOG,lessons:snake.lessonCatalog()}))}
function player(c,r,name){const n=r.players.size;const p={id:crypto.randomUUID(),token:crypto.randomBytes(24).toString('hex'),name:nameClean(name),userId:cookieUser(c)?.id||null,connected:true,conn:c,offlineAt:0,joinedAt:Date.now(),color:COLORS[n%COLORS.length],x:rnd(80,W-80),y:rnd(80,H-80),dx:0,dy:0,angle:0,hp:100,score:0,shotsAt:0,shieldUntil:Date.now()+2300,quiz:null,items:[],respawnAt:0};r.players.set(p.id,p);return p}
function detach(c){const s=sessions.get(c);sessions.delete(c);if(!s)return;const r=rooms.get(s.code),p=r?.players.get(s.id);if(!p||p.conn!==c)return;p.conn=null;p.connected=false;p.offlineAt=Date.now();p.dx=p.dy=0;r.lastUsed=Date.now();if(r.host===p.id)r.host=active(r)[0]?.id||p.id;announce(r,lobby(r))}
async function join(c,m,create){const r=create?null:rooms.get(String(m.code||'').trim());if(!create&&!r)return send(c,{type:'battleError',message:'الغرفة موش موجودة أو انتهت.'});
 const mode=create?(m.mode==='premium'?'premium':'demo'):r.mode;
 if(mode==='premium'&&!cookieUser(c))return send(c,{type:'battleError',message:'الغرفة Premium تتطلب حساب تلميذ مفعّل.'});
 let newRoom=r;if(create){const from=Number(m.from),to=Number(m.to),duration=Number(m.duration);if(!validRange(from,to))return send(c,{type:'battleError',message:'اختار دروس عندها أسئلة.'});if(!Number.isInteger(duration)||duration<1||duration>5)return send(c,{type:'battleError',message:'اختار مدة بين دقيقة وخمس دقائق.'});newRoom={code:roomCode(),solo:m.solo===true,mode,from,to,duration,phase:'lobby',players:new Map(),asked:new Set(),host:null,lastUsed:Date.now(),started:0,ends:0,crates:[],shots:[]};rooms.set(newRoom.code,newRoom)}
 const token=String(m.token||'');const old=token.length===48?[...newRoom.players.values()].find(p=>p.token===token):null;
 if(old&&mode==='premium'&&old.userId!==cookieUser(c)?.id)return send(c,{type:'battleError',message:'استرجاع هذا اللاعب يتطلب نفس حساب التلميذ.'});
 if(!create&&newRoom.solo&&!old)return send(c,{type:'battleError',message:'Partie Solo privée.'});
 if(!old&&newRoom.players.size>=MAX)return send(c,{type:'battleError',message:'الغرفة كاملة (12 لاعب).'});
 let items=[];try{if(mode==='premium')items=await getItems(cookieUser(c).id)}catch{if(create)rooms.delete(newRoom.code);return send(c,{type:'battleError',message:'تعذّر قراءة المعدات من Supabase. راجع إعدادات Battle SQL.'})}
 detach(c);const p=old||player(c,newRoom,mode==='premium'?(cookieUser(c).display_name||m.name):m.name);
 if(old&&old.conn&&old.conn!==c){const prev=old.conn;sessions.delete(prev);send(prev,{type:'battleError',message:'تم الدخول من جهاز آخر.'});prev.socket.end()}
 p.conn=c;p.connected=true;p.offlineAt=0;if(mode==='premium'){p.userId=cookieUser(c).id;p.items=items}else if(!old){p.items=[]}
 sessions.set(c,{code:newRoom.code,id:p.id});if(!newRoom.host||!newRoom.players.get(newRoom.host)?.connected)newRoom.host=p.id;newRoom.lastUsed=Date.now();
 send(c,{type:'battleJoined',solo:newRoom.solo===true,code:newRoom.code,id:p.id,token:p.token,restored:!!old,phase:newRoom.phase,mode:newRoom.mode,catalog:CATALOG,items:p.items});announce(newRoom,lobby(newRoom));
 if(create&&newRoom.solo){start(c,newRoom);return}
 if(newRoom.phase==='playing'){send(c,{type:'battleStarted',late:true});if(p.quiz?.deadline>Date.now())send(c,{type:'battleQuestion',text:p.quiz.question,options:p.quiz.options,lesson:p.quiz.lesson,deadline:p.quiz.deadline})}
 if(newRoom.phase==='finished')send(c,{type:'battleFinished',board:board(newRoom)})}
function makeCrate(){return{id:crypto.randomUUID().slice(0,8),x:rnd(55,W-55),y:rnd(55,H-55),kind:['quiz','quiz','battery','repair'][crypto.randomInt(4)]}}
function start(c,r){const s=sessions.get(c);if(r.host!==s.id||!['lobby','finished'].includes(r.phase))return;r.phase='playing';r.started=Date.now();r.ends=r.started+r.duration*60000;r.lastTick=r.started;r.lastState=0;r.asked=new Set();r.shots=[];r.crates=Array.from({length:24},makeCrate);for(const p of r.players.values()){p.hp=100;p.score=0;p.quiz=null;p.respawnAt=0;p.shieldUntil=Date.now()+2200;p.x=rnd(70,W-70);p.y=rnd(70,H-70)}announce(r,{type:'battleStarted',late:false});announce(r,lobby(r))}
function finish(r){if(r.phase!=='playing')return;r.phase='finished';announce(r,{type:'battleFinished',board:board(r)});announce(r,lobby(r))}
function challenge(r,p,now){const q=quizDraw(r);if(!q)return;p.quiz={...q,deadline:now+18000};send(p.conn,{type:'battleQuestion',text:q.question,options:q.options,lesson:q.lesson,deadline:p.quiz.deadline})}
async function answer(c,r,p,m){const q=p.quiz;if(!q||r.phase!=='playing'||Date.now()>=r.ends)return;p.quiz=null;const index=Number(m.answer),correct=Date.now()<=q.deadline&&Number.isInteger(index)&&index===q.answer;if(correct)p.score+=10;let reward=null,saveError=false;
 if(correct){const next=CATALOG.find(x=>!p.items.includes(x.key));if(next){reward=next.key;if(r.mode==='premium'){try{await saveItem(p.userId,reward);p.items.push(reward)}catch(e){saveError=true;reward=null}}else p.items.push(reward)}}
 send(c,{type:'battleAnswerResult',correct,why:q.why,reward,items:p.items,saveError})}
function handle(c,m){if(!m||typeof m!=='object')return;if(m.type==='battleCreate')return void join(c,m,true).catch(()=>send(c,{type:'battleError',message:'Erreur serveur Battle.'}));if(m.type==='battleJoin')return void join(c,m,false).catch(()=>send(c,{type:'battleError',message:'Erreur serveur Battle.'}));
 const s=sessions.get(c),r=rooms.get(s?.code),p=r?.players.get(s?.id);if(!p||p.conn!==c)return;r.lastUsed=Date.now();
 if(m.type==='battleStart')return start(c,r);
 if(m.type==='battleInput'&&r.phase==='playing'){const dx=Number(m.dx),dy=Number(m.dy);if(!Number.isFinite(dx)||!Number.isFinite(dy))return;const mag=Math.hypot(dx,dy),s=Math.max(1,mag);p.dx=clamp(dx/s,-1,1);p.dy=clamp(dy/s,-1,1);p.fire=!!m.fire;return}
 if(m.type==='battleAnswer')return void answer(c,r,p,m).catch(()=>send(c,{type:'battleError',message:'Erreur de validation'}));}
function tick(now=Date.now()){
 for(const [code,r] of rooms){for(const [id,p] of r.players)if(!p.connected&&now-p.offlineAt>REJOIN_MS){r.players.delete(id);if(r.host===id)r.host=active(r)[0]?.id||null}if(!r.players.size||!active(r).length&&now-r.lastUsed>REJOIN_MS){rooms.delete(code);continue}if(r.phase!=='playing')continue;if(now>=r.ends){finish(r);continue}
 const dt=clamp((now-r.lastTick)/50,.5,2);r.lastTick=now;for(const p of active(r)){
 if(p.respawnAt>now)continue;if(p.hp<=0){p.hp=100;p.x=rnd(70,W-70);p.y=rnd(70,H-70);p.shieldUntil=now+1400}if(p.quiz){if(now>p.quiz.deadline){p.quiz=null;send(p.conn,{type:'battleQuizExpired'})}continue}
 const speed=p.items.includes('turbo')?4.65:3.9;p.x=clamp(p.x+p.dx*speed*dt,26,W-26);p.y=clamp(p.y+p.dy*speed*dt,26,H-26);if(p.items.includes('repair')&&now-(p.healAt||0)>3000){p.hp=clamp(p.hp+2,0,100);p.healAt=now}if(Math.hypot(p.dx,p.dy)>.1)p.angle=Math.atan2(p.dy,p.dx);
 if(p.fire&&now-p.shotsAt>(p.items.includes('laser')?220:300)){p.shotsAt=now;const a=p.angle;r.shots.push({x:p.x+Math.cos(a)*30,y:p.y+Math.sin(a)*30,dx:Math.cos(a)*12,dy:Math.sin(a)*12,owner:p.id,ttl:55})}
 for(let i=r.crates.length-1;i>=0;i--){const box=r.crates[i];if(distance(p,box)>28)continue;r.crates.splice(i,1);if(box.kind==='quiz')challenge(r,p,now);else if(box.kind==='repair')p.hp=clamp(p.hp+30,0,100);else p.score+=2;break}
 }
 if(r.crates.length<20)r.crates.push(makeCrate());
 for(const s of r.shots){s.x+=s.dx*dt;s.y+=s.dy*dt;s.ttl-=dt;if(s.x<0||s.y<0||s.x>W||s.y>H){s.ttl=0;continue}for(const p of active(r)){if(p.id===s.owner||p.shieldUntil>now||p.hp<=0||distance(p,s)>26)continue;const owner=r.players.get(s.owner);let damage=owner?.items.includes('plasma')?25:17;if(p.items.includes('shield'))damage=Math.ceil(damage*.65);p.hp=Math.max(0,p.hp-damage);s.ttl=0;if(!p.hp){p.respawnAt=now+1600;const owner=r.players.get(s.owner);if(owner)owner.score+=5}break}}r.shots=r.shots.filter(x=>x.ttl>0).slice(-90);
 if(now-r.lastState>100){r.lastState=now;announce(r,{type:'battleState',remaining:Math.ceil((r.ends-now)/1000),players:active(r).map(p=>({id:p.id,name:p.name,color:p.color,x:Math.round(p.x),y:Math.round(p.y),angle:p.angle,hp:p.hp,score:p.score,shield:p.shieldUntil>now})),crates:r.crates,shots:r.shots.map(s=>({x:s.x,y:s.y})),board:board(r)})}}
}
module.exports={status,handle,detach,tick,rooms,CATALOG,__test:{validRange,quizDraw,makeCrate}};
