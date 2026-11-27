'use strict';
const rewards=require('./rewards.js');
const crypto=require('crypto');
const rooms=new Map(),sessions=new WeakMap();
const games=['maze','debug','memory','circuit'];
const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const questions={debug:[
 ['pinMode(8, INPUT);\ndigitalWrite(8,HIGH);','LED : corriger la configuration.',['OUTPUT','INPUT','ADC','UART'],0],
 ['if (distance = 10) { stop(); }','Comparer distance à 10.',['==','=','+','/'],0],
 ['led = Pin(5, Pin.IN)\nled.on()','MicroPython : configurer la LED.',['Pin.OUT','Pin.IN','ADC','WLAN'],0],
 ['print(pot.read)','Lire la valeur du potentiomètre.',['print(pot.read())','print(pot)','pot = 5','print(ADC)'],0],
 ['servo = PWM(Pin(26), freq=1000)','Fréquence typique du servo SG90 ?',['50 Hz','1 kHz','0 Hz','1 MHz'],0],
 ['// Bouton pull-down\nif (digitalRead(2)==LOW) { open(); }','Ouvrir quand le bouton est pressé.',['HIGH','LOW','OUTPUT','PWM'],0],
 ['for(int i=0;i<5;i++){ move(); }','Nombre d’appels à move() ?',['5','4','6','0'],0],
 ['// LED clignotante\nled.on()\nled.off()','Rendre le clignotement visible.',['Ajouter une pause entre états','Supprimer off()','Ajouter Wi-Fi','Changer le nom'],0],
 ['b = Pin(18, Pin.OUT)','Lire un bouton ESP32 pull-down.',['Pin(18, Pin.IN, Pin.PULL_DOWN)','Pin(18, Pin.OUT)','PWM(Pin(18))','ADC(Pin(18))'],0],
 ['// LED câblée D7\nint led = 8;','Corriger le numéro de broche.',['7','8','0','34'],0]],circuit:[
 ['LED + GPIO','Composant en série avec une LED ?',['Résistance','Servo','Buzzer','Moteur'],0],
 ['Potentiomètre','Lire une tension variable ?',['ADC','PWM','UART','SPI'],0],
 ['Robot autonome','Mesurer la distance à un obstacle ?',['Ultrason','LED','Buzzer','Résistance'],0],
 ['Moteur DC','Piloter un moteur depuis un GPIO ?',['Driver moteur','GPIO directement','LED','Bouton seul'],0],
 ['Bouton Arduino UNO R3','Pull-down externe : résistance vers ?',['GND','5V','D13','RESET'],0],
 ['ESP32','Bouton avec pull-down : tension du signal pressé ?',['3.3 V','12 V','5 V','0 V'],0],
 ['I2C','Lignes de communication ?',['SDA + SCL','TX uniquement','PWM','VIN'],0],
 ['LED','Faire varier la luminosité ?',['PWM','RESET','GND seul','UART'],0],
 ['ESP32','Signal externe 5 V : que vérifier ?',['Adaptation de niveau','Brancher directement','Supprimer GND','Augmenter à 12 V'],0],
 ['Robot suiveur','Détecter un contraste au sol ?',['Capteur IR réflectif','Servo','Buzzer','Wi-Fi seul'],0]]};
const pairs=[['LED','Lumière'],['GND','Masse'],['ADC','Tension analogique'],['PWM','Rapport cyclique'],['Servo','Angle'],['Ultrason','Distance'],['DHT11','Humidité'],['L298N','Driver DC']];
function maze(){// generate a guaranteed connected 5x5 route by reserving a monotonic path
 let x=0,y=4,path=new Set([20]);while(x!==4||y!==0){if(x===4||(y>0&&crypto.randomInt(2)===0))y--;else x++;path.add(y*5+x)}return {walls:shuffle([...Array(25).keys()].filter(i=>!path.has(i))).slice(0,7),pos:20,goal:4};}
function next(r,p){p.round++;p.feedback='';if(r.game==='maze')p.task=maze();else if(r.game==='memory'){p.task={deck:shuffle(shuffle(pairs).slice(0,4).flatMap(([a,b],i)=>[{i,text:a},{i,text:b}])),matched:[],open:[],hideAt:0};}else{if(!p.deck.length)p.deck=shuffle(questions[r.game]);const q=p.deck.pop(),o=shuffle([0,1,2,3]);p.task={code:q[0],prompt:q[1],options:o.map(i=>q[2][i]),answer:o.indexOf(q[3])};}}
function publicTask(r,p){const t=p.task;if(!t)return null;if(r.game==='maze')return t;if(r.game==='memory')return{cards:t.deck.map((c,i)=>({text:t.open.includes(i)||t.matched.includes(i)?c.text:null,matched:t.matched.includes(i)})),busy:t.hideAt>0};return{code:t.code,prompt:t.prompt,options:t.options};}
function send(c,m){if(!c?.alive||c.socket.destroyed||c.socket.writableLength>350000)return;const b=Buffer.from(JSON.stringify(m));if(b.length>=65536)return;const h=b.length<126?Buffer.from([129,b.length]):Buffer.from([129,126,b.length>>8,b.length&255]);c.socket.write(Buffer.concat([h,b]));}
const board=r=>[...r.players.values()].sort((a,b)=>b.score-a.score).map(p=>({id:p.id,name:p.name,score:p.score,connected:!!p.conn}));
function state(r,p){send(p.conn,{type:'challengeState',code:r.code,game:r.game,phase:r.phase,host:r.host,id:p.id,board:board(r),duration:r.duration,remaining:r.phase==='playing'?Math.max(0,Math.ceil((r.ends-Date.now())/1000)):0,task:r.phase==='playing'?publicTask(r,p):null,round:p.round,feedback:p.feedback});}
function broadcast(r){for(const p of r.players.values())state(r,p)}
function detach(c){const s=sessions.get(c);sessions.delete(c);if(!s)return;const r=rooms.get(s.code),p=r?.players.get(s.id);if(!p||p.conn!==c)return;p.conn=null;p.offline=Date.now();if(r.host===p.id)r.host=[...r.players.values()].find(x=>x.conn)?.id||p.id;broadcast(r);}
function handle(c,m,arenaRooms){if(!m||typeof m!=='object')return;const err=message=>send(c,{type:'challengeError',message});if(m.type==='create'||m.type==='join'){let r=rooms.get(String(m.code||''));if(m.type==='create'){if(!games.includes(m.game)||!Number.isInteger(m.duration)||m.duration<1||m.duration>5||!Number.isInteger(m.max)||m.max<2||m.max>10)return err('Paramètres invalides');let code;do{code=String(crypto.randomInt(100000,400000))}while(rooms.has(code)||arenaRooms.has(code));r={code,game:m.game,duration:m.duration,max:m.max,players:new Map(),phase:'lobby',host:null,last:Date.now(),ends:0};rooms.set(code,r);}if(!r)return err('Code introuvable');let p=[...r.players.values()].find(x=>typeof m.token==='string'&&m.token===x.token);if(p&&p.rankUser!==rewards.account(c))return err('Reconnectez le même compte.');const identity=rewards.playerIdentity(c,m.name,r,p);if(identity.error){if(m.type==='create')rooms.delete(r.code);return err(identity.error);}if(!p&&r.phase!=='lobby')return err('Partie déjà commencée');if(!p&&r.players.size>=r.max)return err('Salle complète');detach(c);if(p){if(p.conn&&p.conn!==c){sessions.delete(p.conn);p.conn.socket.end();}p.conn=c;}else{p={id:crypto.randomUUID(),token:crypto.randomBytes(24).toString('hex'),name:identity.name,rankUser:rewards.account(c),score:0,round:0,task:null,deck:[],feedback:'',conn:c,lastAction:0};r.players.set(p.id,p);}if(!r.host||!r.players.get(r.host)?.conn)r.host=p.id;r.last=Date.now();sessions.set(c,{code:r.code,id:p.id});send(c,{type:'challengeJoined',code:r.code,token:p.token,id:p.id});broadcast(r);return;}
 const s=sessions.get(c),r=rooms.get(s?.code),p=r?.players.get(s?.id);if(!p||p.conn!==c)return;if(m.type==='leave'){detach(c);r.players.delete(p.id);broadcast(r);return;}if(m.type==='start'&&p.id===r.host&&r.phase==='lobby'){if([...r.players.values()].filter(p=>p.conn).length<2)return err('Minimum 2 joueurs');rewards.start(r);r.phase='playing';r.ends=Date.now()+r.duration*60000;for(const q of r.players.values())next(r,q);broadcast(r);return;}if(r.phase!=='playing'||Date.now()>=r.ends||m.round!==p.round||Date.now()-p.lastAction<120)return;p.lastAction=Date.now();const t=p.task;
 if(r.game==='maze'&&m.type==='move'){const d={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[m.dir];if(!Array.isArray(d))return;const x=t.pos%5+d[0],y=Math.floor(t.pos/5)+d[1],i=y*5+x;if(x<0||x>4||y<0||y>4||t.walls.includes(i))return;t.pos=i;if(i===t.goal){p.score+=50;next(r,p);p.feedback='+50 XP';}}
 else if(r.game==='memory'&&m.type==='flip'){const i=m.index;if(!Number.isInteger(i)||i<0||i>=t.deck.length||t.hideAt||t.open.includes(i)||t.matched.includes(i))return;t.open.push(i);if(t.open.length===2){const [a,b]=t.open;if(t.deck[a].i===t.deck[b].i){t.matched.push(a,b);t.open=[];p.score+=10;if(t.matched.length===t.deck.length){p.score+=20;next(r,p);p.feedback='Bravo! +20 XP';}}else t.hideAt=Date.now()+850;}}
 else if(['debug','circuit'].includes(r.game)&&m.type==='answer'){if(!Number.isInteger(m.index)||m.index<0||m.index>3)return;const ok=m.index===t.answer,answer=t.options[t.answer];if(ok)p.score+=10;next(r,p);p.feedback=ok?'Correct +10 XP':'Correction : '+answer;}
 else return;broadcast(r);}
function tick(now){for(const [code,r] of rooms){if(now-r.last>3600000){rooms.delete(code);continue;}for(const [id,p] of r.players)if(!p.conn&&now-p.offline>1800000)r.players.delete(id);if(!r.players.size){rooms.delete(code);continue;}if(r.phase==='playing'){if(now>=r.ends){rewards.finish(r,r.game,p=>p.score);r.phase='finished';broadcast(r);continue;}let changed=false;if(r.game==='memory')for(const p of r.players.values())if(p.task.hideAt&&now>=p.task.hideAt){p.task.hideAt=0;p.task.open=[];changed=true;}const sec=Math.ceil((r.ends-now)/1000);if(changed||sec!==r.sec){r.sec=sec;broadcast(r);}}}}
module.exports={rooms,handle,detach,tick};
