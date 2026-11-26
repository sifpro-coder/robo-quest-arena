'use strict';
// CFI Electro Snake — authoritative multiplayer engine, Node.js only.
// Intentionally separate from academy/quiz persistence.
const crypto = require('crypto');
const BASE_QUESTIONS=require('./questions.json');
const ACADEMY_BANK=require('./academy-bank.json');
const ACADEMY_COURSES=require('./academy-content.json').modules.filter(x=>/^pro-\d+$/.test(x.id)).sort((a,b)=>Number(a.id.split('-')[1])-Number(b.id.split('-')[1]));
const REJOIN_MS=Math.max(5,Math.min(180,Number(process.env.CFI_REJOIN_MINUTES)||30))*60*1000;
const ALLOWED_TOPICS=new Set(['esp32academy','arduino','esp32','wokwi']);
function lessonCatalog(){
 // New pro-27, pro-28... are discovered at launch, without a change to the game code.
 // Show only lessons with questions, so hosts cannot select an empty pool.
 return ACADEMY_COURSES.filter(m=>Array.isArray(ACADEMY_BANK[m.id]) && ACADEMY_BANK[m.id].some(q=>q.options?.length===4&&Number.isInteger(q.answer)))
  .map((m,i)=>({number:i+1,id:m.id,title:m.shortTitle||m.title||m.id,part:m.part||null,questionCount:ACADEMY_BANK[m.id].length}));
}
function courseInfo(topic,level,from,to){
 if(topic==='esp32academy'){
  const count=lessonCatalog().length;
  if(!count)return null;
  const start=from===undefined?1:Number(from),end=to===undefined?count:Number(to);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>count)return null;
  return {topic:'esp32academy',level:null,from:start,to:end};
 }
 return {topic:ALLOWED_TOPICS.has(topic)?topic:'arduino',level:Number(level)===2?2:1,from:null,to:null};
}
function lessonPool(r){
 if(r.topic==='esp32academy'){
  const chosen=lessonCatalog().slice(r.from-1,r.to);
  const names=new Map(ACADEMY_COURSES.map(m=>[m.id,m.shortTitle||m.title||m.id]));
  return chosen.flatMap(c=>(ACADEMY_BANK[c.id]||[])
   .filter(q=>q.options?.length===4&&Number.isInteger(q.answer))
   .map(q=>({id:q.id||c.id,text:q.textAr||q.text||q.q,options:q.options,answer:q.answer,why:q.why,lesson:'Leçon '+c.number+' · '+names.get(c.id)})));
 }
 return BASE_QUESTIONS.filter(q=>q.topic===r.topic&&q.level===r.level).map(q=>({id:q.topic+'-'+q.level+'-'+q.q,text:q.q,options:q.options,answer:q.answer,why:q.why,lesson:q.topic.toUpperCase()+' · Niveau '+q.level}));
}
function quizDraw(r){let pool=lessonPool(r);if(!pool.length)return null;let available=pool.filter(q=>!r.asked.has(q.id));if(!available.length){r.asked.clear();available=pool}const q=available[crypto.randomInt(available.length)];r.asked.add(q.id);const order=[0,1,2,3];for(let i=3;i>0;i--){let j=crypto.randomInt(i+1);[order[i],order[j]]=[order[j],order[i]]}return {question:q.text,options:order.map(i=>q.options[i]),answer:order.indexOf(q.answer),why:q.why,lesson:q.lesson}}
const WORLD = {w:1280,h:800}, MAX_PLAYERS = 12, STEP_MS = 50;
const FOOD = [
  {kind:'led',label:'LED',icon:'💡',value:1},
  {kind:'resistor',label:'Résistance',icon:'🟤',value:1},
  {kind:'cable',label:'Câble',icon:'🔌',value:1},
  {kind:'arduino',label:'Arduino',icon:'🟦',value:1},
  {kind:'esp32',label:'ESP32',icon:'📟',value:1},
  {kind:'sensor',label:'Capteur',icon:'📡',value:1},
  {kind:'battery',label:'Batterie',icon:'🔋',value:1},
  {kind:'servo',label:'Servo',icon:'⚙️',value:1},
  {kind:'motor',label:'Moteur',icon:'🌀',value:1},
  {kind:'chip',label:'Circuit intégré',icon:'🧩',value:1}
];
const COLORS=['#74E4B7','#F6C75A','#67BCFF','#F48EAF','#AD92FF','#FF9A69','#6DE2E5','#E6DF70','#C1EB85','#FDA7EA','#B3B6F9','#FFB3A1'];
const rooms = new Map();
const sessionsByConn = new WeakMap();
function sanitize(s){return String(s||'Robot').replace(/[<>\x00-\x1F\x7F]/g,'').trim().slice(0,24)||'Robot'}
function code(){let s;do{s=String(crypto.randomInt(100000,999999))}while(rooms.has(s));return s}
function mod(x,m){return (x%m+m)%m}
function delta(a,b,span){let d=mod(a-b,span);return d>span/2?d-span:d}
function distance(a,b){return Math.hypot(delta(a.x,b.x,WORLD.w),delta(a.y,b.y,WORLD.h))}
function randomFood(){const d=FOOD[crypto.randomInt(FOOD.length)];return {...d,id:crypto.randomUUID().slice(0,8),x:Math.random()*WORLD.w,y:Math.random()*WORLD.h}}
function send(c,obj){if(!c||!c.alive||c.socket.destroyed||c.socket.writableLength>350000)return;const body=Buffer.from(JSON.stringify(obj));let head;if(body.length<126)head=Buffer.from([129,body.length]);else if(body.length<65536)head=Buffer.from([129,126,body.length>>8,body.length&255]);else return;try{c.socket.write(Buffer.concat([head,body]))}catch{}}
function online(r){return [...r.players.values()].filter(p=>p.connected)}
function announce(r,msg){for(const p of online(r))send(p.conn,msg)}
function roomInfo(r){return {type:'snakeLobby',code:r.code,phase:r.phase,host:r.host,topic:r.topic,level:r.level,from:r.from,to:r.to,duration:r.duration,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,color:p.color,connected:p.connected,mass:p.mass})),max:MAX_PLAYERS};}
function refresh(r){announce(r,roomInfo(r))}
function makeRoom(options={}){const opts=courseInfo(options.topic||'esp32academy',options.level,options.from,options.to);if(!opts)return null;const r={code:code(),phase:'lobby',host:null,topic:opts.topic,level:opts.level,from:opts.from,to:opts.to,duration:Math.max(1,Math.min(5,Number.isInteger(Number(options.duration))?Number(options.duration):3)),ends:0,asked:new Set(),players:new Map(),food:[],created:Date.now(),lastUsed:Date.now(),lastTick:Date.now()};rooms.set(r.code,r);return r}
function newPlayer(r,name,c){const p={id:crypto.randomUUID(),token:crypto.randomBytes(24).toString('hex'),name:sanitize(name),color:COLORS[r.players.size%COLORS.length],x:crypto.randomInt(120,1160),y:crypto.randomInt(120,680),vx:1,vy:0,dx:1,dy:0,mass:5,points:0,eaten:0,trail:[],connected:true,conn:c,offlineAt:0,quiz:null,respawnAt:0,shieldUntil:Date.now()+3000,joinedAt:Date.now()};p.trail=Array.from({length:65},(_,i)=>({x:p.x-i*3,y:p.y}));r.players.set(p.id,p);return p}
function detach(c){const ref=sessionsByConn.get(c);sessionsByConn.delete(c);if(!ref)return;const r=rooms.get(ref.code),p=r?.players.get(ref.id);if(!p||p.conn!==c)return;p.connected=false;p.conn=null;p.offlineAt=Date.now();p.dx=0;p.dy=0;r.lastUsed=Date.now();if(r.host===p.id){const next=online(r)[0];if(next)r.host=next.id}refresh(r)}
function join(c,m,create){const requested=String(m.code||'').replace(/[٠-٩]/g,x=>String(x.charCodeAt(0)-1632)).replace(/[۰-۹]/g,x=>String(x.charCodeAt(0)-1776)).replace(/[\s\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g,'');const r=create?makeRoom(m):rooms.get(requested);if(!r){if(!create)console.warn('[Snake] join miss code='+(/^\d{6}$/.test(requested)?requested:'invalid')+' rooms='+rooms.size+' pid='+process.pid);send(c,{type:'snakeError',reason:create?'invalid_lessons':'room_not_found',code:/^\d{6}$/.test(requested)?requested:null,message:create?'اختيار الدروس غير صحيح أو ما فيهاش أسئلة. راجع من وإلى.':'غرفة Snake '+(/^\d{6}$/.test(requested)?requested:'')+' غير موجودة أو انتهت. تأكّد من رابط الدعوة.'});return}
 let p=null;const token=typeof m.token==='string'?m.token:'';if(token.length===48){p=[...r.players.values()].find(x=>x.token===token)||null}
 if(!p&&r.players.size>=MAX_PLAYERS){send(c,{type:'snakeError',message:'الغرفة كاملة (12 لاعبين).'});return}
 detach(c);
 if(p){if(p.conn&&p.conn!==c){const former=p.conn;sessionsByConn.delete(former);send(former,{type:'snakeError',message:'تم فتح نفس الحساب في جهاز آخر.'})}p.connected=true;p.conn=c;p.offlineAt=0;p.shieldUntil=Math.max(p.shieldUntil,Date.now()+2300);}
 else p=newPlayer(r,m.name,c);
 if(!r.host||!r.players.has(r.host)||!r.players.get(r.host).connected)r.host=p.id;
 sessionsByConn.set(c,{code:r.code,id:p.id});r.lastUsed=Date.now();console.info('[Snake] '+(create?'create':'join')+' code='+r.code+' players='+r.players.size+' pid='+process.pid);
 send(c,{type:'snakeJoined',code:r.code,id:p.id,token:p.token,phase:r.phase,topic:r.topic,level:r.level,from:r.from,to:r.to,restored:!!token&&p.token===token,world:WORLD});
 refresh(r);
 if(r.phase==='playing'){send(c,{type:'snakeStarted',late:true});if(p.quiz&&p.quiz.deadline>Date.now())sendQuiz(c,p.quiz);}
}
function start(c,r){const ref=sessionsByConn.get(c);if(r.host!==ref.id)return;for(const p of r.players.values()){if(!p.connected)continue;p.mass=5;p.points=0;p.eaten=0;p.quiz=null;p.respawnAt=0;p.shieldUntil=Date.now()+2500;p.trail=Array.from({length:65},(_,i)=>({x:p.x-i*3,y:p.y}));}
 r.asked=new Set();r.food=Array.from({length:75},randomFood);r.food.push(...Array.from({length:7},quizFood));r.phase='playing';r.lastTick=Date.now();r.ends=r.lastTick+r.duration*60000;refresh(r);announce(r,{type:'snakeStarted',late:false});}
function quizFood(){return {kind:'quiz',label:'Quiz',icon:'❓',value:0,id:crypto.randomUUID().slice(0,8),x:Math.random()*WORLD.w,y:Math.random()*WORLD.h}}
function sendQuiz(c,q){send(c,{type:'snakeQuestion',question:q.question,options:q.options,lesson:q.lesson,deadline:q.deadline})}
function handle(c,m){if(!m||typeof m!=='object')return;const t=m.type;
 if(t==='snakeCreate'){join(c,m,true);return}
 if(t==='snakeJoin'){join(c,m,false);return}
 if(t==='snakeLeave'){detach(c);send(c,{type:'snakeLeft'});return}
 const ref=sessionsByConn.get(c);if(!ref)return;const r=rooms.get(ref.code),p=r?.players.get(ref.id);if(!r||!p||p.conn!==c)return;r.lastUsed=Date.now();
 if(t==='snakeStart'){if(r.phase==='lobby'||r.phase==='finished')start(c,r);return}
 if(t==='snakeDirection'&&r.phase==='playing'){const x=Number(m.x),y=Number(m.y);if(!Number.isFinite(x)||!Number.isFinite(y))return;const length=Math.hypot(x,y);if(length>.05){p.dx=x/length;p.dy=y/length}return}
 if(t==='snakeAnswer'&&r.phase==='playing'&&p.quiz){const q=p.quiz,n=Number(m.answer),now=Date.now();if(!Number.isInteger(n)||n<0||n>3)return;p.quiz=null;const correct=now<=q.deadline&&n===q.answer;if(correct){p.mass=Math.min(40,p.mass+1);p.points+=10}p.shieldUntil=Math.max(p.shieldUntil,now+1300);send(c,{type:'snakeAnswerResult',correct,why:q.why,answer:q.answer,bonus:correct?10:0});return}
 if(t==='snakeStop'&&r.host===p.id){r.phase='finished';refresh(r);announce(r,{type:'snakeFinished'});return}
}
function body(p){const result=[],gap=14,head=p.trail[0];if(!head)return[{x:mod(p.x,WORLD.w),y:mod(p.y,WORLD.h)}];result.push({x:mod(head.x,WORLD.w),y:mod(head.y,WORLD.h)});let next=gap,travel=0;
 for(let i=1;i<p.trail.length&&result.length<p.mass;i++){const prev=p.trail[i-1],cur=p.trail[i],d=Math.hypot(prev.x-cur.x,prev.y-cur.y);if(d<0.001)continue;while(travel+d>=next&&result.length<p.mass){let t=(next-travel)/d;result.push({x:mod(prev.x+(cur.x-prev.x)*t,WORLD.w),y:mod(prev.y+(cur.y-prev.y)*t,WORLD.h)});next+=gap}travel+=d}
 return result;
}
function eat(r,p,prey,now){if(p.mass<=prey.mass||!p.connected||!prey.connected||prey.respawnAt>now||prey.shieldUntil>now)return false;
 const xp=prey.mass*25;p.mass=Math.min(40,p.mass+1);p.points+=xp;p.eaten++;
 for(let j=0;j<Math.min(12,prey.mass);j++){const f=randomFood();const a=2*Math.PI*j/Math.min(12,prey.mass);f.x=mod(prey.x+Math.cos(a)*(16+j*3),WORLD.w);f.y=mod(prey.y+Math.sin(a)*(16+j*3),WORLD.h);r.food.push(f)}
 prey.mass=5;prey.respawnAt=now+1800;prey.shieldUntil=now+4300;prey.x=crypto.randomInt(100,1180);prey.y=crypto.randomInt(100,700);prey.trail=Array.from({length:65},(_,i)=>({x:prey.x-i*3,y:prey.y}));
 send(p.conn,{type:'snakeEvent',message:`🏆 كليت ${prey.name}! +${xp} XP`,kind:'eat'});
 send(prey.conn,{type:'snakeEvent',message:`🐍 ${p.name} كبر عليك وأكلك. ترجع تلعب توّا!`,kind:'eaten'});return true
}
function tick(now=Date.now()){
 for(const [id,r] of rooms){if(now-r.lastUsed>REJOIN_MS&&!online(r).length){rooms.delete(id);continue}
  for(const [pid,p] of r.players){if(!p.connected&&now-p.offlineAt>REJOIN_MS){r.players.delete(pid);if(r.host===pid){r.host=online(r)[0]?.id||null}}}
  if(!r.players.size){rooms.delete(id);continue}
  if(r.phase!=='playing')continue;if(now>=r.ends){r.phase='finished';refresh(r);announce(r,{type:'snakeFinished',board:[...r.players.values()].sort((a,b)=>b.mass-a.mass||b.points-a.points).map((p,i)=>({rank:i+1,name:p.name,mass:p.mass,points:p.points,color:p.color}))});continue}
  const dt=Math.min(2,Math.max(.35,(now-r.lastTick)/STEP_MS));r.lastTick=now;
  if(r.food.length<85)for(let i=r.food.length;i<85;i++)r.food.push(randomFood());if(r.food.filter(x=>x.kind==='quiz').length<7)r.food.push(quizFood());if(r.food.length>170)r.food.splice(0,r.food.length-170);
  for(const p of r.players.values()){
   if(!p.connected||p.respawnAt>now)continue;if(p.quiz){if(now>p.quiz.deadline){p.quiz=null;p.shieldUntil=now+1200;send(p.conn,{type:'snakeQuizExpired'})}else continue;}
   const dx=p.dx,dy=p.dy,km=Math.hypot(dx,dy);if(km>.05){p.vx=dx/km;p.vy=dy/km}
   const speed=(3.65-Math.min(.85,Math.max(0,p.mass-5)*.006))*dt;
   p.x+=p.vx*speed;p.y+=p.vy*speed;p.trail.unshift({x:p.x,y:p.y});p.trail.length=Math.min(p.trail.length,(p.mass*6)+30);
   for(let i=r.food.length-1;i>=0;i--){if(distance({x:mod(p.x,WORLD.w),y:mod(p.y,WORLD.h)},r.food[i])<20){const food=r.food[i];r.food.splice(i,1);if(food.kind==='quiz'){const q=quizDraw(r);if(q){p.quiz={...q,deadline:now+20000};p.shieldUntil=now+24000;sendQuiz(p.conn,p.quiz)}break}else{p.mass=Math.min(40,p.mass+1);p.points+=5;}}}
  }
  const players=online(r).filter(p=>p.respawnAt<=now&&!p.quiz).sort((a,b)=>b.mass-a.mass);
  const shape=new Map(players.map(p=>[p.id,body(p)]));
  for(const big of players){if(big.respawnAt>now)continue;const head={x:mod(big.x,WORLD.w),y:mod(big.y,WORLD.h)};
    for(const small of players){if(big===small||big.mass<=small.mass||small.respawnAt>now||small.shieldUntil>now)continue;
      if((shape.get(small.id)||[]).some(s=>distance(head,s)<20)){eat(r,big,small,now);break}
    }
  }
  const leaderboard=[...r.players.values()].sort((a,b)=>b.mass-a.mass||b.points-a.points).slice(0,12).map(p=>({id:p.id,name:p.name,mass:p.mass,points:p.points,color:p.color,connected:p.connected}));
  const state={type:'snakeState',code:r.code,phase:r.phase,remaining:Math.max(0,Math.ceil((r.ends-now)/1000)),players:[...r.players.values()].filter(p=>p.connected).map(p=>({id:p.id,name:p.name,color:p.color,mass:p.mass,points:p.points,eaten:p.eaten,body:p.respawnAt>now?[]:body(p),shield:p.shieldUntil>now})),food:r.food,board:leaderboard};
  // Send 10 frames/s. Movement is computed at 20Hz server-side.
  if(!r.nextFrame||now>=r.nextFrame){announce(r,state);r.nextFrame=now+100;}
 }
}
module.exports={handle,detach,tick,rooms,WORLD,MAX_PLAYERS,body,distance,mod,lessonCatalog,__test:{makeRoom,newPlayer,eat,randomFood,quizDraw,lessonPool,quizFood,sendQuiz}};
