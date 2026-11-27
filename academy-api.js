'use strict';
// CFI Academy: server-side auth, role checks, auto-grading and persistent submissions.
// Requires Supabase REST service_role ONLY in Render environment, never in browser or GitHub.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const content = JSON.parse(fs.readFileSync(path.join(__dirname,'academy-content.json'),'utf8')).modules;
const bank = JSON.parse(fs.readFileSync(path.join(__dirname,'academy-bank.json'),'utf8'));
// V5.4 : nouveau cursus ESP32 PRO seul. Les 22 cours historiques restent archivés dans les fichiers.
const proLessons=content.filter(c=>c.track==='esp32-pro');
const baseIds=proLessons.map(c=>c.id);
const beginnerTracks=['arduino-basic','esp32-basic','project-traffic','project-home'];
const activeLessons=content.filter(c=>c.track==='esp32-pro'||beginnerTracks.includes(c.track));
const activeIds=new Set(activeLessons.map(c=>c.id));
function beginnerProgress(rows,track){const map=new Map(rows.map(r=>[r.lesson_id,r]));const lessons=activeLessons.filter(c=>c.track===track);const required=lessons.map((c,i)=>{const score=Number(map.get(c.id)?.best_score||0);return {id:c.id,index:i+1,score,passed:score>=12,mastered:score===20,unlocked:i===0||Number(map.get(lessons[i-1].id)?.best_score||0)>=12}});return {required,total:required.length,passed:required.filter(x=>x.passed).length,done:required.filter(x=>x.mastered).length,unlocked:required.filter(x=>x.unlocked).map(x=>x.id)};}
function allBeginnerProgress(rows){return Object.fromEntries(beginnerTracks.map(t=>[t,beginnerProgress(rows,t)]));}
const byId = new Map(content.map(x=>[x.id,x]));
const SESS_NAME = 'cfi_academy_session';
const SIGN_KEY = process.env.SESSION_SECRET || '';
const DB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_USER = (process.env.ADMIN_USERNAME || 'cfi-admin').trim().toLowerCase();
const ADMIN_PASS = process.env.ADMIN_PASSWORD || '';
const configured = () => Boolean(process.env.SUPABASE_URL?.startsWith('https://') && DB_KEY && SIGN_KEY.length>=32 && ADMIN_PASS.length>=12);
const failures = new Map();
function apiError(message,status=400){const e=new Error(message);e.status=status;return e;}
function send(res,status,obj,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(obj));}
function subscription(u){const until=u?.access_expires_at||null;return {expiresAt:until,valid:!!(u&&u.active&&u.role==='student'&&until&&new Date(until).getTime()>Date.now()),source:u?.access_source||null};}
// V7 permanent ownership is independent from monthly access.
function ownership(u){return {arduino:u?.lifetime_arduino===true,esp32:u?.lifetime_esp32===true,traffic:u?.lifetime_traffic===true,home:u?.lifetime_home===true};}
function accessRule(lesson){const track=lesson.track;const product=['arduino-basic','project-traffic'].includes(track)?'arduino':['esp32-basic','project-home','esp32-pro'].includes(track)?'esp32':null;const index=activeLessons.filter(x=>x.track===track).findIndex(x=>x.id===lesson.id);const free=index>=0&&((['arduino-basic','esp32-basic'].includes(track)&&index<5)||(['project-traffic','project-home'].includes(track)&&index<2));return {product,free,project:track==='project-traffic'?'traffic':track==='project-home'?'home':null};}
function hasCourseAccess(u,lesson){if(!u?.active)return false;if(u.role==='admin')return true;if(u.role!=='student'||!activeIds.has(lesson.id))return false;const rule=accessRule(lesson);return rule.free||subscription(u).valid||Boolean(rule.product&&ownership(u)[rule.product])||Boolean(rule.project&&ownership(u)[rule.project]);}
const productKeys={arduino:'lifetime_arduino_millimes',esp32:'lifetime_esp32_millimes',pack:'lifetime_pack_millimes',traffic:'lifetime_traffic_millimes',home:'lifetime_home_millimes'};
const productDefaults={arduino:49000,esp32:59000,pack:89000,traffic:9000,home:19000};
async function storePrices(){const rows=await db('cfi_settings','GET','?select=key,value_int');return Object.fromEntries(Object.entries(productKeys).map(([k,v])=>[k,rows.find(x=>x.key===v)?.value_int??productDefaults[k]]));}
function cleanUser(u){return {id:u.id,username:u.username,name:u.display_name,role:u.role,mustChangePassword:!!u.must_change_password,email:u.email||null,subscription:subscription(u),ownership:ownership(u),playerName:u.player_name||null};}
function randPass(){return crypto.randomBytes(13).toString('base64url');}
function hash(p){const salt=crypto.randomBytes(16).toString('hex');return `scrypt$${salt}$${crypto.scryptSync(p,salt,64).toString('hex')}`;}
function check(p,stored){try{const [algo,salt,key]=String(stored||'').split('$');if(algo!=='scrypt'||!salt||!key)return false;const actual=crypto.scryptSync(p,salt,64),expected=Buffer.from(key,'hex');return actual.length===expected.length && crypto.timingSafeEqual(actual,expected);}catch{return false;}}
function b64(d){return Buffer.from(JSON.stringify(d)).toString('base64url');}
function sign(data){if(SIGN_KEY.length<32)throw apiError('SESSION_SECRET يلزمها 32 حرف على الأقل',503);const payload=b64(data),mac=crypto.createHmac('sha256',SIGN_KEY).update(payload).digest('base64url');return `${payload}.${mac}`;}
function verify(token){try{const [part,mac]=String(token||'').split('.');if(!part||!mac||part.length>5000)return null;const real=crypto.createHmac('sha256',SIGN_KEY).update(part).digest('base64url');if(!crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(real)))return null;const o=JSON.parse(Buffer.from(part,'base64url').toString('utf8'));return o && o.exp>Date.now()?o:null;}catch{return null;}}
function sessionCookie(req,token){const secure=process.env.RENDER==='true'||req.headers['x-forwarded-proto']==='https';return `${SESS_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60*60*24*7}${secure?'; Secure':''}`;}
function clearCookie(req){return sessionCookie(req,'').replace(/Max-Age=\d+/,'Max-Age=0')}
function getCookie(req){const raw=req.headers.cookie||'';const m=raw.match(new RegExp('(?:^|;\\s*)'+SESS_NAME+'=([^;]*)'));return m?.[1]||'';}
function normalUsername(x){return String(x||'').trim().toLowerCase();}
function validUsername(x){return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(x);}
function str(x,max){return String(x??'').trim().slice(0,max);}
function validEmail(x){return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(x||'')) && String(x||'').length<=180;}
function normEmail(x){return String(x||'').trim().toLowerCase();}
function emailReady(){return Boolean((process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL) || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.SMTP_FROM));}
function payReady(){return Boolean(process.env.KONNECT_API_KEY && process.env.KONNECT_WALLET_ID);}
async function amountMillimes(){const data=await getOne('cfi_settings','&key=eq.monthly_price_millimes');const n=Number(data?.value_int??10000);if(!Number.isInteger(n)||n<1000||n>1000000)throw apiError('سعر الاشتراك غير صحيح في قاعدة البيانات.',503);return n;}
function addOneMonth(date){const d=new Date(date);const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d;}
async function extendTeacherMonth(u){const start=u.access_expires_at&&new Date(u.access_expires_at)>new Date()?new Date(u.access_expires_at):new Date();const expiry=addOneMonth(start).toISOString();await db('cfi_users','PATCH','?id=eq.'+encodeURIComponent(u.id),{active:true,activation_status:'active',access_expires_at:expiry,access_source:'prof'});return expiry;}
function requireCourseAccess(u,lesson,subs){
 if(u.role==='admin')return;
 if(!activeIds.has(lesson.id))throw apiError('المسار هذا مؤرشف.',403);
 if(!hasCourseAccess(u,lesson))throw apiError('الدرس مدفوع: يلزم امتلاك المسار أو اشتراك Premium نشيط.',402);
 const pr=beginnerTracks.includes(lesson.track)?beginnerProgress(subs,lesson.track):progress(subs);
 if(!pr.unlocked.includes(lesson.id))throw apiError('🔒 يلزم تجيب 12/20 على الأقل في الدرس السابق باش يتفتح هذا.',403);
}

const mailAttempts=new Map();
function guardSignUp(req){const ip=requestIp(req),now=Date.now();let obj=mailAttempts.get(ip)||{count:0,expire:now+60*60*1000};if(now>obj.expire)obj={count:0,expire:now+60*60*1000};obj.count++;mailAttempts.set(ip,obj);if(obj.count>5)throw apiError('برشا محاولات تسجيل. عاود بعد ساعة.',429);if(mailAttempts.size>3000)mailAttempts.clear();}
function publicOrigin(req){const configuredOrigin=process.env.CFI_PUBLIC_URL||'';let u;try{u=new URL(configuredOrigin)}catch{throw apiError('يلزم إعداد CFI_PUBLIC_URL في Render برابط HTTPS متاع الموقع.',503)}if(u.protocol!=='https:'||!u.hostname||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw apiError('CFI_PUBLIC_URL يلزمها رابط HTTPS متاع الموقع، بلا /academy.',503);return u.origin;}
async function deliverMail(to,subject,link){
 if(!emailReady())throw apiError('إرسال البريد موش مفعّل: حضّر Brevo API ومُرسِل مؤكّد على Render.',503);
 const text=`مرحبا!\n\nباش تثبّت عنوان البريد وتكمل تسجيل CFI Academy، افتح الرابط هذا في غضون 24 ساعة:\n${link}\n\nإذا ما طلبتش التسجيل، تجاهل الرسالة.\nCFI Academy`;
 const html=`<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.9"><h2>CFI Academy</h2><p>مرحبا، ثبّت عنوان البريد باش تكمل تسجيلك:</p><p><a href="${link.replaceAll('&','&amp;')}">تأكيد البريد الإلكتروني</a></p><p>الرابط صالح 24 ساعة.</p><p>إذا ما طلبتش التسجيل، تجاهل الرسالة.</p></div>`;
 // Render Free blocks outbound SMTP ports 25/465/587. Use an HTTPS transactional email API instead.
 if(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL){
  let reply;
  try{reply=await fetch('https://api.brevo.com/v3/smtp/email',{
   method:'POST',headers:{'api-key':process.env.BREVO_API_KEY,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({sender:{email:process.env.BREVO_SENDER_EMAIL,name:process.env.BREVO_SENDER_NAME||'CFI Academy'},to:[{email:to}],subject,textContent:text,htmlContent:html}),signal:AbortSignal.timeout(12000)
  });}catch(e){console.error('CFI Brevo API connection error:',e?.name||'NETWORK_ERROR');throw apiError('تعذّر الاتصال بخدمة إرسال البريد. عاود بعد شوية.',503)}
  if(!reply.ok){console.error('CFI Brevo API rejected email:',reply.status);throw apiError('خدمة البريد رفضت الرسالة. ثبّت API Key وعنوان المرسل المؤكّد.',503)}
  return;
 }
 // SMTP fallback for paid hosting only. Not usable on Render Free.
 const nodemailer=require('nodemailer');const port=Number(process.env.SMTP_PORT||587);
 const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port,secure:port===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}});
 await transport.sendMail({from:process.env.SMTP_FROM,to,subject,text,html});
}
function tokenDigest(raw){return crypto.createHash('sha256').update(raw).digest('hex');}
async function sendVerification(req,u){
 const raw=crypto.randomBytes(32).toString('hex');const token_hash=tokenDigest(raw);
 await db('cfi_email_tokens','POST','',[{user_id:u.id,token_hash,expires_at:new Date(Date.now()+24*3600*1000).toISOString()}]);
 const link=publicOrigin(req)+'/academy?email_token='+encodeURIComponent(raw);
 try{await deliverMail(u.email,'CFI Academy — تأكيد البريد الإلكتروني',link)}catch(e){
  await db('cfi_email_tokens','DELETE','?token_hash=eq.'+token_hash,null,'return=minimal').catch(()=>{});
  console.error('CFI verification delivery failed:',e?.code||'MAIL_ERROR');throw apiError('ما نجّمناش نبعثوا Email التفعيل. راجع إعدادات البريد أو عاود بعد شوية.',503);
 }
}
function konnectRoot(){return process.env.KONNECT_MODE==='live'?'https://api.konnect.network/api/v2':'https://api.sandbox.konnect.network/api/v2';}
async function konnect(path,method='GET',body=null){
 if(!payReady())throw apiError('خيار الدفع موش مفعّل بعد. الأستاذ لازم يربط Konnect ويحدّد السعر.',503);
 let res;try{res=await fetch(konnectRoot()+path,{method,headers:{'x-api-key':process.env.KONNECT_API_KEY,'Content-Type':'application/json','Accept':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});}catch{throw apiError('ما نجّمش نتصل بخدمة الدفع. عاود بعد شوية.',503)}
 let data;try{data=await res.json()}catch{data={}};if(!res.ok)throw apiError('خدمة الدفع رفضت الطلب. راجع إعدادات Konnect.',503);return data;
}
async function confirmKonnect(ref){
 const found=await getOne('cfi_payments','&payment_ref=eq.'+encodeURIComponent(ref));
 if(!found)throw apiError('مرجع الدفع موش مسجّل في CFI',404);
 if(found.status==='paid')return {paid:true};
 const user=await getUserById(found.user_id);
 if(!user||user.role!=='student'||!user.email_verified)throw apiError('تسجيل الطالب مازال ما تأكّدش عبر Email',403);
 const data=await konnect('/payments/'+encodeURIComponent(ref));const p=data.payment||{};
 // Only a verified, matching provider payment can extend access. Never trust the browser callback.
 const ok=p.id===ref && p.status==='completed' && p.token==='TND' && Number(p.reachedAmount)>=found.amount_millimes && String(p.orderId||'')===String(found.user_id);
 if(!ok)return {paid:false};
 // Atomic, idempotent DB function prevents duplicate extensions from concurrent webhooks/checks.
 await db('rpc/cfi_apply_verified_payment','POST','',{p_ref:ref});
 return {paid:true};
}
async function db(table,op='GET',query='',body=null,prefer='return=representation'){
 const root=process.env.SUPABASE_URL?.replace(/\/+$/,'');
 if(!root)throw apiError('Supabase موش مهيّأ',503);
 const url=`${root}/rest/v1/${table}${query}`;
 const headers={apikey:DB_KEY,Accept:'application/json','Content-Type':'application/json',Prefer:prefer};
 // Supabase new sb_secret_* keys must NOT be passed as JWT in Authorization.
 // Old JWT service_role keys can still be used with a Bearer header.
 if(!DB_KEY.startsWith('sb_secret_'))headers.Authorization=`Bearer ${DB_KEY}`;
 let r;
 try{r=await fetch(url,{method:op,headers,body:body===null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});}catch(e){throw apiError('ما نجّمش نتّصل بقاعدة البيانات. تثبّت من Supabase.',503);}
 const txt=await r.text();let data;try{data=txt?JSON.parse(txt):[]}catch{data=[]}
 if(!r.ok){const hint=data?.message||'';console.error('CFI DB error',r.status,String(hint).slice(0,180));throw apiError(r.status===404||hint.includes('does not exist')?'القاعدة مازالت موش مجهّزة. شغّل schema.sql في Supabase.':'قاعدة البيانات رفضت الطلب. راجع الإعدادات.',503);}
 return data;
}
async function getOne(table,filters){const rows=await db(table,'GET','?select=*'+filters+'&limit=1');return rows[0]||null;}
async function getUserByUsername(name){return getOne('cfi_users','&username=eq.'+encodeURIComponent(name));}
async function getUserById(id){return getOne('cfi_users','&id=eq.'+encodeURIComponent(id));}
let bootstrapPromise;
async function ensureAdmin(){if(!configured())throw apiError('يلزم تجهّز Supabase وSecrets في Render قبل إنشاء الحسابات الحقيقية.',503);
 if(!bootstrapPromise)bootstrapPromise=(async()=>{
    if(!validUsername(ADMIN_USER))throw apiError('ADMIN_USERNAME لازم أحرف لاتينية صغيرة وأرقام، من 3 إلى 32.',503);
    let existing=await getUserByUsername(ADMIN_USER);
    if(!existing){const admins=await db('cfi_users','GET','?select=id,username&role=eq.admin&limit=1');if(admins.length)throw apiError('توجد إدارة سابقة. لا يمكن إنشاء Admin ثان. استعمل اسم الأستاذ الأصلي.',503);try{await db('cfi_users','POST','',[{username:ADMIN_USER,display_name:'CFI Administrator',password_hash:hash(ADMIN_PASS),role:'admin',must_change_password:false,active:true}]);}catch(e){existing=await getUserByUsername(ADMIN_USER);if(!existing)throw e;}}
    else if(existing.role!=='admin')throw apiError('اسم حساب المدير موجود مسبقًا في قاعدة البيانات. اختر اسمًا آخر.',503);
 })().catch(e=>{bootstrapPromise=null;throw e});
 return bootstrapPromise;
}
async function viewer(req){const tk=verify(getCookie(req));if(!tk?.id||tk.type!=='session')return null;const u=await getUserById(tk.id);if(!u||!u.active||tk.sv!==(u.session_version||1))return null;return u;}
function requireRole(u,roles){if(!u)throw apiError('لازم تدخل بحسابك.',401);if(!roles.includes(u.role))throw apiError('ما عندكش صلاحية للعملية هاذي.',403);}
function requireReady(){if(!configured())throw apiError('الحسابات الحقيقية موش مفعّلة بعد. لازم Supabase وSecrets على Render.',503);}
async function body(req){const contentType=req.headers['content-type']||'';if(!contentType.startsWith('application/json'))throw apiError('Content-Type لازم يكون application/json',415);
 const origin=req.headers.origin;
 if(origin){let u;try{u=new URL(origin)}catch{throw apiError('Origin غير صحيح',403)};if(u.host!==req.headers.host)throw apiError('طلب غير مسموح من موقع آخر',403);}
 let n=0,parts=[];for await(const chunk of req){n+=chunk.length;if(n>45000)throw apiError('المحتوى كبير برشا',413);parts.push(chunk)}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8')||'{}')}catch{throw apiError('JSON غير صحيح')}
}
function publicInfo(m){return {id:m.id,title:m.arTitle,originalTitle:m.shortTitle,type:m.type,subject:m.subject,level:Number(m.level),week:Number(m.week),term:m.terms,track:m.track||"classic",part:m.part||null,access:accessRule(m)};}
async function allLessons(){const extras=await db('cfi_extra_lessons','GET','?select=*&order=created_at.asc');return [...content,...extras.map(x=>({id:x.id,type:x.type||'lesson',subject:x.subject||'ESP32',level:'1',week:x.week||23,shortTitle:x.title,arTitle:x.title,arIntro:x.intro,terms:x.terms,arTask:x.task,body:'',source:'درس جديد من الأستاذ',custom:true}))];}
async function courseById(id){return byId.get(id)|| (await allLessons()).find(x=>x.id===id);}
async function questionsFor(id){if(bank[id])return bank[id];const rows=await db('cfi_extra_lessons','GET',`?select=id,quiz&id=eq.${encodeURIComponent(id)}&limit=1`);return rows[0]?.quiz||[];}
function shuffle(xs){const a=xs.slice();for(let i=a.length-1;i>0;i--){let j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function optionToken(nonce,qid,index){return crypto.createHmac('sha256',SIGN_KEY).update(nonce+'|'+qid+'|'+index).digest('base64url').slice(0,22);}
function ticketQuiz(user,id,qset){const selection=shuffle(qset).slice(0,Math.min(12,qset.length)),nonce=crypto.randomBytes(16).toString('hex');const qt=selection.map(q=>({id:q.id,textAr:q.textAr,term:q.term,visual:beginnerTracks.includes(byId.get(id)?.track)?(q.visual||null):null,choices:(beginnerTracks.includes(byId.get(id)?.track)?(xs=>xs):shuffle)(q.options.map((label,index)=>({value:optionToken(nonce,q.id,index),label})))}));
 const ticket=sign({type:'quiz',id,userId:user.id,qids:qt.map(q=>q.id),nonce,exp:Date.now()+30*60*1000});return {questions:qt,ticket};}
async function mySubmissions(u){return db('cfi_submissions','GET',`?select=*&user_id=eq.${encodeURIComponent(u.id)}&order=updated_at.desc`);}
function progress(rows){
 const map=new Map(rows.map(r=>[r.lesson_id,r]));
 const required=baseIds.map((id,index)=>{
  const r=map.get(id),score=Number(r?.best_score||0);
  return {id,index:index+1,score,passed:score>=12,mastered:score===20,unlocked:index===0||Number(map.get(baseIds[index-1])?.best_score||0)>=12};
 });
 const done=required.filter(x=>x.mastered).length;
 const passed=required.filter(x=>x.passed).length;
 return {done,total:required.length,passed,mastered:done,required,unlocked:required.filter(x=>x.unlocked).map(x=>x.id),
  pending:required.filter(x=>x.passed&&!x.mastered).map(x=>x.id),certificateReady:required.length>0&&done===required.length,
  level2Unlocked:required.length>7&&required[7].unlocked,level1Done:required.slice(0,7).filter(x=>x.mastered).length,level1Total:7,
  level2Done:required.slice(7).filter(x=>x.mastered).length,level2Total:required.length-7};
}
function studyDay(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Tunis',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function robotParts(pr){const parts=['🧠 Puce ESP32','💡 LED','🔌 GPIO','🎛️ ADC','🔊 DAC','🌈 PWM','📟 Interface','🛰️ I2C','⚡ SPI','📡 UART','🧩 Bus','👆 Touch','🌙 RTC','🔐 Boot','🔋 Power','⏻ Enable','🛡️ Sécurité','🔘 Bouton','🌡️ Capteur','🦾 Servo','🖥️ OLED','⚙️ Moteur','📶 Wi-Fi','🏅 Révision','🛞 Robot','🤖 Robot complet'];return parts.filter((_,i)=>pr.required[i]?.mastered);}
async function attemptsByUser(u){return db('cfi_quiz_attempts','GET','?select=user_id,lesson_id,score,study_day,created_at&user_id=eq.'+encodeURIComponent(u.id)+'&order=created_at.asc&limit=2000');}
function myAttemptSummary(rows,pr){
 const proRows=rows.filter(x=>baseIds.includes(x.lesson_id));const perLesson={};for(const a of proRows)perLesson[a.lesson_id]=(perLesson[a.lesson_id]||0)+1;
 const daySet=[...new Set(proRows.map(x=>x.study_day))];
 const firstTry=pr.required.filter(x=>x.mastered&&proRows.findIndex(a=>a.lesson_id===x.id&&a.score===20)>=0&&proRows.filter(a=>a.lesson_id===x.id).findIndex(a=>a.score===20)===0).length;
 return {totalAttempts:proRows.length,byLesson:perLesson,activeDays:daySet.length,firstTry,parts:robotParts(pr)};
}
async function issueCertificate(u,subs){
 const pr=progress(subs);if(!pr.certificateReady)return null;
 const existing=await getOne('cfi_certificates','&user_id=eq.'+encodeURIComponent(u.id));
 if(existing){if(existing.session!=='ESP32 MicroPython · Parcours numérique V5.4')return null;return existing;}
 try{const r=await db('cfi_certificates','POST','',[{user_id:u.id,code:certificateCode(),session:'ESP32 MicroPython · Parcours numérique V5.4'}]);return r[0];}
 catch(e){const retry=await getOne('cfi_certificates','&user_id=eq.'+encodeURIComponent(u.id));if(retry?.session==='ESP32 MicroPython · Parcours numérique V5.4')return retry;throw e;}
}
function verificationUrl(code){
 let origin='https://cfi-robot.onrender.com';
 try{const u=new URL(process.env.CFI_PUBLIC_URL||origin);if(u.protocol==='https:'&&u.hostname&&!u.username&&!u.password)origin=u.origin;}catch{}
 return origin+'/academy?verify='+encodeURIComponent(code);
}
function certificateQR(code){
 // Local SVG from an MIT-licensed QR engine shipped by qrcode-terminal; no external third-party QR service.
 try{
  const QRCode=require('qrcode-terminal/vendor/QRCode');
  const level=require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
  const qr=new QRCode(-1,level.M);qr.addData(verificationUrl(code));qr.make();
  const n=qr.getModuleCount(),size=n+8;
  let path='';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.isDark(y,x))path+=`M${x+4} ${y+4}h1v1h-1z`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="220" height="220" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${path}" fill="#121212"/></svg>`;
  return 'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
 }catch(e){console.warn('CFI QR non disponible:',e?.code||'QR_FAILED');return null;}
}
function pseudonym(id){return 'Robot-'+crypto.createHmac('sha256',SIGN_KEY).update(id).digest('hex').slice(0,5).toUpperCase();}
async function getRanking(u){
 // Serve only pseudonyms; no email/real name. Individual activity != classroom attendance.
 const [users,allSub,allAttempts]=await Promise.all([
  db('cfi_users','GET','?select=id,role,active&role=eq.student&active=eq.true&limit=500'),
  db('cfi_submissions','GET','?select=user_id,lesson_id,best_score&limit=10000'),
  db('cfi_quiz_attempts','GET','?select=user_id,lesson_id,score,study_day,created_at&order=created_at.desc&limit=10000')]);
 const cutoff=Date.now()-7*24*3600*1000;
 const result=users.map(t=>{
  const rows=allSub.filter(x=>x.user_id===t.id&&baseIds.includes(x.lesson_id));
  const mastered=rows.filter(x=>Number(x.best_score)===20).length;
  const attempts=allAttempts.filter(a=>a.user_id===t.id&&baseIds.includes(a.lesson_id));
  const daily=[...new Set(attempts.filter(a=>new Date(a.created_at).getTime()>=cutoff).map(a=>a.study_day))].length;
  const triesToFirstPerfect=id=>{const ordered=attempts.filter(a=>a.lesson_id===id).slice().reverse();const i=ordered.findIndex(a=>Number(a.score)===20);return i<0?Infinity:i+1;};
  const firstTry=rows.filter(x=>Number(x.best_score)===20&&triesToFirstPerfect(x.lesson_id)===1).length;
  // A learner can practice after mastering without losing their first-success efficiency points.
  const efficiency=mastered?rows.filter(x=>Number(x.best_score)===20).reduce((z,x)=>z+1/triesToFirstPerfect(x.lesson_id),0)/mastered:0;
  const points=Math.round(100*(.25*Math.min(1,daily/7)+.35*efficiency+.40*mastered/baseIds.length));
  return {alias:pseudonym(t.id),points,activeDays7:daily,mastered,firstTry,isMe:t.id===u.id,participated:attempts.length>0};
 }).filter(x=>x.participated).sort((a,b)=>b.points-a.points||b.mastered-a.mastered||b.firstTry-a.firstTry||a.alias.localeCompare(b.alias));
 return result.slice(0,100).map((x,i)=>({...x,rank:i+1}));
}

function requestIp(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim().slice(0,64);}
function limitLogin(req,username){const ip=requestIp(req)+'|'+username,now=Date.now();let entry=failures.get(ip)||{count:0,until:now+15*60*1000};if(now>entry.until)entry={count:0,until:now+15*60*1000};if(entry.count>=12)throw apiError('محاولات برشا. عاود بعد ربع ساعة.',429);failures.set(ip,entry);return()=>{entry.count++;failures.set(ip,entry)};}
function unlock(req,username){failures.delete(requestIp(req)+'|'+username);}
function certificateCode(){return 'CFI-'+crypto.randomBytes(6).toString('hex').toUpperCase();}
async function respond(req,res,url){
 const method=req.method;const route=url.pathname;
 if(!route.startsWith('/api/academy/'))return false;
 try{
  if(method==='GET'&&route==='/api/academy/status'){let price=10000;if(configured())price=await amountMillimes();return send(res,200,{configured:configured(),registrationConfigured:configured()&&emailReady(),paymentConfigured:configured()&&emailReady()&&payReady(),priceMillimes:price,subscription:'monthly',period:'one calendar month',courses:activeLessons.length,version:'7.1',mode:'email-approval-or-verified-payment'}),true;}
  if(method==='GET'&&route==='/api/academy/catalog'){
   const bases=activeLessons.map(publicInfo);let extras=[];if(configured())try{extras=(await db('cfi_extra_lessons','GET','?select=id,title,type,subject,week,terms')).map(x=>({id:x.id,title:x.title,originalTitle:x.title,type:x.type||'lesson',subject:x.subject||'ESP32',week:x.week,term:x.terms}))}catch{}return send(res,200,{courses:bases}),true;
  }
  requireReady();
  if(method==='GET'&&route==='/api/academy/store')return send(res,200,{prices:await storePrices(),monthlyPriceMillimes:await amountMillimes(),freeLessons:5,freeProjectStages:2,lifetimePayment:'manual'}),true;
  // Registration is public but cannot grant an active role: professor approval or verified payment required.
  if(method==='POST'&&route==='/api/academy/register'){
   if(!emailReady())throw apiError('التسجيل بالبريد موش مفعّل. لازم تهيئة SMTP في Render.',503);
   guardSignUp(req);
   const b=await body(req),username=normalUsername(b.username),email=normEmail(b.email),name=str(b.name,80),password=String(b.password||''),methodChosen=b.method;
   if(!validUsername(username)||name.length<2||!validEmail(email)||password.length<12||password.length>128||!['prof','payment'].includes(methodChosen)||b.guardianConsent!==true)throw apiError('عمّر الاسم وEmail صحيح، كلمة سرّ 12 حرف، وموافقة الولي وطريقة التفعيل.');
   if(await getUserByUsername(username))throw apiError('Username مستعمل من قبل. اختار اسم آخر.');
   if((await db('cfi_users','GET','?select=id&email=eq.'+encodeURIComponent(email)+'&limit=1')).length)throw apiError('Email مستعمل. ادخل بالحساب السابق أو اتصل بالأستاذ.');
   let rows;
   try{rows=await db('cfi_users','POST','',[{username,display_name:name,email,password_hash:hash(password),role:'student',active:false,email_verified:false,approval_method:methodChosen,activation_status:'pending_email',must_change_password:false}]);}
   catch(e){throw apiError('التسجيل ما نجحش. تثبّت من Email أو Username. طبّق migration V4 في Supabase.',409)}
   await sendVerification(req,rows[0]);
   return send(res,201,{ok:true,message:'بعثنالك Email تأكيد. لازم تثبت البريد، وبعدها يستنى الحساب موافقة الأستاذ أو تأكيد الدفع.'}),true;
  }
  if(method==='POST'&&route==='/api/academy/confirm-email'){
   const b=await body(req),raw=String(b.token||'');if(!/^[a-f0-9]{64}$/.test(raw))throw apiError('رابط تأكيد غير صحيح.');
   const t=await getOne('cfi_email_tokens','&token_hash=eq.'+tokenDigest(raw));
   if(!t||t.used_at||new Date(t.expires_at).getTime()<Date.now())throw apiError('رابط التأكيد منتهي أو مستعمل.',400);
   const u=await getUserById(t.user_id);if(!u)throw apiError('الحساب غير موجود',404);
   await db('cfi_email_tokens','PATCH','?id=eq.'+t.id,{used_at:new Date().toISOString()});
   await db('cfi_users','PATCH','?id=eq.'+u.id,{email_verified:true,activation_status:u.approval_method==='payment'?'pending_payment':'pending_prof'});
   return send(res,200,{ok:true,method:u.approval_method,message:u.approval_method==='payment'?'Email تأكّد. تنجم تكمل الدفع باش يتفعّل حسابك.':'Email تأكّد. توّا تستنّى موافقة الأستاذ باش تدخل للدروس.'}),true;
  }
  if(method==='POST'&&route==='/api/academy/resend-email'){
   if(!emailReady())throw apiError('إرسال البريد موش مفعّل',503);guardSignUp(req);
   const b=await body(req),username=normalUsername(b.username),pass=String(b.password||'');
   const u=validUsername(username)?await getUserByUsername(username):null;
   if(!u||u.role!=='student'||u.email_verified||!check(pass,u.password_hash))throw apiError('الحساب أو كلمة السرّ غير صحيحة، أو البريد متأكد من قبل.',400);
   await sendVerification(req,u);return send(res,200,{ok:true,message:'بعثنالك رابط تأكيد جديد.'}),true;
  }
  if(method==='POST'&&route==='/api/academy/pay/start'){
   const b=await body(req),username=normalUsername(b.username),pass=String(b.password||'');
   const fail=limitLogin(req,username),u=validUsername(username)?await getUserByUsername(username):null;
   if(!u||u.role!=='student'||!check(pass,u.password_hash)){fail();throw apiError('بيانات الدخول غير صحيحة.',401)}unlock(req,username);
   if(u.role!=='student'||!u.email_verified)throw apiError('لازم تثبّت Email قبل الاشتراك.',403);
   if(subscription(u).valid)throw apiError('عندك اشتراك نشيط. تنجم تجدّد كي يوفى الشهر.',400);
   if(!payReady())throw apiError('الدفع مازال موش مفعّل. الأستاذ لازم يربط Konnect.',503);
   const amount=await amountMillimes();const webhook=publicOrigin(req)+'/api/academy/pay/webhook';
   const data=await konnect('/payments/init-payment','POST',{receiverWalletId:process.env.KONNECT_WALLET_ID,amount,token:'TND',type:'immediate',description:'CFI Academy — اشتراك شهري',acceptedPaymentMethods:['wallet','bank_card','e-DINAR'],lifespan:30,checkoutForm:true,orderId:u.id,email:u.email,webhook,theme:'light'});
   if(!data.paymentRef||!data.payUrl)throw apiError('Konnect ما رجّعش رابط دفع صحيح.',503);
   const addr=new URL(data.payUrl);if(addr.protocol!=='https:'||!(addr.hostname==='konnect.network'||addr.hostname.endsWith('.konnect.network')))throw apiError('رابط دفع غير موثوق.',503);
   await db('cfi_payments','POST','',[{user_id:u.id,payment_ref:String(data.paymentRef),amount_millimes:amount,status:'pending',gateway:'konnect'}]);
   return send(res,200,{payUrl:data.payUrl,amountMillimes:amount}),true;
  }
  if(method==='GET'&&route==='/api/academy/pay/webhook'){
   const ref=str(url.searchParams.get('payment_ref'),100);if(!/^[a-zA-Z0-9_-]{6,100}$/.test(ref))throw apiError('Référence غير صحيحة');
   const result=await confirmKonnect(ref);return send(res,200,{ok:true,paid:result.paid}),true;
  }
  if(method==='POST'&&route==='/api/academy/pay/check'){
   const b=await body(req),username=normalUsername(b.username),pass=String(b.password||'');
   const fail=limitLogin(req,username),u=validUsername(username)?await getUserByUsername(username):null;if(!u||!check(pass,u.password_hash)){fail();throw apiError('بيانات الدخول غير صحيحة',401)}unlock(req,username);
   const pays=await db('cfi_payments','GET','?select=*&user_id=eq.'+encodeURIComponent(u.id)+'&order=created_at.desc&limit=1');
   if(!pays.length)return send(res,200,{paid:false,message:'ما فماش عملية دفع مسجّلة.'}),true;
   const result=await confirmKonnect(pays[0].payment_ref);
   return send(res,200,{paid:result.paid,message:result.paid?'تمّ تأكيد الدفع وتفعيل اشتراك شهر. تنجم تدخل.':'الدفع مازال ما تأكّدش من Konnect.'}),true;
  }
  if(method==='POST'&&route==='/api/academy/login'){
   await ensureAdmin();const b=await body(req),username=normalUsername(b.username),password=String(b.password||'');const fail=limitLogin(req,username);
   if(!validUsername(username)||password.length>256)throw apiError('المعطيات موش صحيحة',401);
   let u=await getUserByUsername(username);
   if(!u||!check(password,u.password_hash)){fail();throw apiError('الاسم ولا كلمة السرّ موش صحيحة',401)}
   if(!u.active)throw apiError(!u.email_verified?'لازم تثبّت البريد الإلكتروني أولًا.':u.approval_method==='payment'?'الحساب يستنى تأكيد الدفع.':'الحساب يستنّى موافقة الأستاذ.',403);
   unlock(req,username);const tk=sign({type:'session',id:u.id,sv:u.session_version||1,exp:Date.now()+7*24*3600*1000});return send(res,200,{user:cleanUser(u)},{'Set-Cookie':sessionCookie(req,tk)}),true;
  }
  if(method==='POST'&&route==='/api/academy/logout'){await body(req);return send(res,200,{ok:true},{'Set-Cookie':clearCookie(req)}),true;}
  const u=await viewer(req);
  if(method==='GET'&&route==='/api/academy/me'){if(!u)throw apiError('يلزم تدخل بحسابك',401);return send(res,200,{user:cleanUser(u)}),true;}
  if(method==='POST'&&route==='/api/academy/player-name'){
   requireRole(u,['student']);if(u.must_change_password)throw apiError('Changez d’abord votre mot de passe.',403);
   const b=await body(req),name=String(b.name||'').trim();
   if(!/^[A-Za-z0-9_]{3,18}$/.test(name)||/^guest_/i.test(name))throw apiError('Pseudo: 3–18 lettres A-Z, chiffres ou _.',400);
   const result=await db('rpc/cfi_claim_player_name_v75','POST','',{p_user:u.id,p_name:name});
   if(result==='taken')throw apiError('Ce pseudo est déjà utilisé. Choisissez un autre.',409);
   if(!['ok','already'].includes(result))throw apiError('Pseudo non enregistré.',400);
   const saved=await getUserById(u.id);return send(res,200,{user:cleanUser(saved)}),true;
  }
  if(method==='POST'&&route==='/api/academy/password'){
   requireRole(u,['admin','student']);const b=await body(req),old=String(b.oldPassword||''),fresh=String(b.newPassword||'');if(!check(old,u.password_hash))throw apiError('كلمة السر القديمة موش صحيحة',403);if(fresh.length<12||fresh.length>128)throw apiError('كلمة السرّ الجديدة لازم 12 حرف على الأقل');
   const sv=(u.session_version||1)+1;await db('cfi_users','PATCH',`?id=eq.${u.id}`,{password_hash:hash(fresh),must_change_password:false,session_version:sv});const tk=sign({type:'session',id:u.id,sv,exp:Date.now()+7*24*3600*1000});return send(res,200,{ok:true},{'Set-Cookie':sessionCookie(req,tk)}),true;
  }
  if(method==='GET'&&route==='/api/academy/lesson'){
   requireRole(u,['student','admin']);if(u.must_change_password)throw apiError('بدّل كلمة السرّ المؤقّتة قبل ما تبدأ',403);const id=str(url.searchParams.get('id'),80),m=await courseById(id);if(!m)throw apiError('الدرس موش موجود',404);if(u.role==='student')requireCourseAccess(u,m,await mySubmissions(u));
   const out={...publicInfo(m),intro:m.arIntro,task:m.arTask,body:m.body||'',source:m.source||'',materials:m.materials||'',need:m.need||'',expected:m.expected||''};
   if(u.role==='admin')out.solution=(byId.has(id)?JSON.parse(fs.readFileSync(path.join(__dirname,'academy-solutions.json'),'utf8'))[id]||'':'');
   return send(res,200,{lesson:out}),true;
  }
  if(method==='GET'&&route==='/api/academy/quiz'){
   requireRole(u,['student','admin']);if(u.must_change_password)throw apiError('بدّل كلمة السرّ المؤقّتة قبل ما تبدأ',403);
   const id=str(url.searchParams.get('id'),80),lesson=await courseById(id);if(!lesson)throw apiError('الدرس موش موجود',404);if(u.role==='student')requireCourseAccess(u,lesson,await mySubmissions(u));
   const qs=await questionsFor(id);if(!qs.length)throw apiError('الدرس هذا مازال ما عندوش QCM');return send(res,200,ticketQuiz(u,id,qs)),true;
  }
  if(method==='GET'&&route==='/api/academy/mine'){
   requireRole(u,['student']);const subs=await mySubmissions(u);const prog=progress(subs);const cert=prog.certificateReady?await issueCertificate(u,subs):null;const attempts=await attemptsByUser(u);return send(res,200,{submissions:subs.filter(x=>activeIds.has(x.lesson_id)),progress:prog,beginnerProgress:allBeginnerProgress(subs),beginnerAttempts:Object.fromEntries(beginnerTracks.map(t=>[t,attempts.filter(x=>byId.get(x.lesson_id)?.track===t).length])),attempts:myAttemptSummary(attempts,prog),subscription:subscription(u),ownership:ownership(u),certificate:cert?{code:cert.code,issuedAt:cert.issued_at,session:cert.session}:null}),true;
  }
  if(method==='POST'&&route==='/api/academy/submit'){
   requireRole(u,['student']);if(u.must_change_password)throw apiError('بدّل كلمة السرّ المؤقّتة قبل ما تبدأ',403);
   const b=await body(req),p=verify(b.ticket);if(!p||p.type!=='quiz'||p.userId!==u.id||!Array.isArray(p.qids)||p.qids.length>12)throw apiError('اختبار منتهي أو غير صحيح. جدّد الاختبار.',400);
   const lesson=await courseById(p.id);if(!lesson)throw apiError('الدرس موش موجود',404);requireCourseAccess(u,lesson,await mySubmissions(u));let qBank=await questionsFor(p.id);if(p.qids.length!==qBank.length)throw apiError('الاختبار لازم يشمل الأسئلة الكل. جدّد الاختبار.',400);
   const answers=b.answers||{},used=new Set();let correct=0,details=[];
   for(const qid of p.qids){if(used.has(qid))throw apiError('سؤال مكرّر');used.add(qid);const q=qBank.find(x=>x.id===qid);if(!q)throw apiError('سؤال غير موجود');const answerToken=String(answers[qid]||'');const chosen=q.options.findIndex((_,i)=>optionToken(p.nonce,qid,i)===answerToken);if(!Object.prototype.hasOwnProperty.call(answers,qid)||chosen<0)throw apiError('جاوب على كل الأسئلة');if(chosen===q.answer)correct++;details.push({id:qid,chosen,correct:q.answer,why:q.why,question:q.textAr,goodAnswer:q.options[q.answer],isCorrect:chosen===q.answer});}
   const score=beginnerTracks.includes(lesson.track)?Math.floor(correct*20/p.qids.length):Math.round(correct*20/p.qids.length);const code=str(b.code,8000),notes=str(b.notes,4000);
   // Prevent duplicate scoring of the same signed quiz ticket, and retain every attempt for ranking.
   const ticketHash=crypto.createHash('sha256').update(String(b.ticket)).digest('hex');
   const existing=await getOne('cfi_submissions',`&user_id=eq.${u.id}&lesson_id=eq.${encodeURIComponent(p.id)}`);
   const best=Math.max(score,existing?.best_score||0);
   const row={user_id:u.id,lesson_id:p.id,code:code||existing?.code||'',notes:notes||existing?.notes||'',score,best_score:best,correct,total:p.qids.length,quiz_details:details,updated_at:new Date().toISOString()};
   const duplicate=await getOne('cfi_quiz_attempts','&user_id=eq.'+encodeURIComponent(u.id)+'&ticket_hash=eq.'+ticketHash);
   if(duplicate)throw apiError('الاختبار هذا تسلّم قبل. ابدأ محاولة جديدة.',409);
   await db('cfi_quiz_attempts','POST','',[{user_id:u.id,lesson_id:p.id,ticket_hash:ticketHash,score,correct,total:p.qids.length,study_day:studyDay()}]);
   const updated=await db('cfi_submissions','POST','?on_conflict=user_id,lesson_id',[row],'resolution=merge-duplicates,return=representation');
   const newSubs=await mySubmissions(u),pr=progress(newSubs),certificate=lesson.track==='esp32-pro'&&pr.certificateReady?await issueCertificate(u,newSubs):null;
   const atts=await attemptsByUser(u);
   return send(res,200,{score,bestScore:best,correct,total:p.qids.length,feedback:details,submission:updated[0]||row,
    mastery:best===20,canContinue:best>=12,attemptCount:atts.filter(x=>x.lesson_id===p.id).length,
    progress:pr,beginnerProgress:allBeginnerProgress(newSubs),certificate:certificate?{code:certificate.code,issuedAt:certificate.issued_at,session:certificate.session}:null}),true;
  }
  if(method==='POST'&&route==='/api/academy/certificate'){
   requireRole(u,['student']);if(u.must_change_password)throw apiError('بدّل كلمة السرّ المؤقّتة.',403);
   const subs=await mySubmissions(u),pr=progress(subs);if(!pr.certificateReady)throw apiError(`مازال يلزم 20/20 في ${pr.total-pr.done} درس قبل الشهادة.`,400);
   const cert=await issueCertificate(u,subs);if(!cert)throw apiError('شهادة قديمة موجودة. يلزم ترحيلها بطريقة آمنة.',409);
   return send(res,200,{certificate:{code:cert.code,issuedAt:cert.issued_at,studentName:u.display_name,session:cert.session,verificationUrl:verificationUrl(cert.code),qrCode:certificateQR(cert.code)}}),true;
  }
  if(method==='GET'&&route==='/api/academy/ranking'){
   requireRole(u,['student','admin']);return send(res,200,{ranking:await getRanking(u),weights:{presence:25,efficiency:35,mastery:40},
    note:'Présence = journées avec quiz sur la plateforme, pas présence physique. Classement pseudonyme.'}),true;
  }
  if(method==='GET'&&route==='/api/academy/verify'){
   const code=str(url.searchParams.get('code'),30);if(!/^CFI-[A-F0-9]{12}$/.test(code))throw apiError('رقم شهادة غير صحيح',404);
   const cert=await getOne('cfi_certificates','&code=eq.'+code);return send(res,200,{valid:!!cert,session:cert?.session||null,issuedAt:cert?.issued_at||null}),true;
  }
  // Admin-only account provisioning and private student grades.
  if(method==='GET'&&route==='/api/academy/admin/overview'){
   requireRole(u,['admin']);const users=await db('cfi_users','GET','?select=id,username,display_name,email,email_verified,approval_method,activation_status,role,active,access_expires_at,access_source,must_change_password,lifetime_arduino,lifetime_esp32,lifetime_traffic,lifetime_home&role=eq.student&order=created_at.desc');const submissions=await db('cfi_submissions','GET','?select=user_id,lesson_id,score,best_score,code,notes,updated_at,review_status&order=updated_at.desc&limit=2000');
   return send(res,200,{students:users,submissions,monthlyPriceMillimes:await amountMillimes(),storePrices:await storePrices()}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/students'){
   requireRole(u,['admin']);const b=await body(req),username=normalUsername(b.username),name=str(b.name,80);
   const password=String(b.password||''),confirmPassword=String(b.confirmPassword||'');
   if(!validUsername(username)||name.length<2)throw apiError('اكتب اسم تلميذ صحيح وUsername لاتيني 3–32 حرف');
   if(password.length<12||password.length>128)throw apiError('كلمة السرّ يلزمها من 12 إلى 128 حرف.');
   if(password!==confirmPassword)throw apiError('كلمتا السرّ موش متطابقتين.');
   if(password.toLowerCase()===username||/^(.{1,4})\1{2,}$/.test(password))throw apiError('اختار كلمة سرّ أقوى وما تكونش كيف Username.');
   if(await getUserByUsername(username))throw apiError('Username مستعمل من قبل');
   const saved=await db('cfi_users','POST','',[{username,display_name:name,password_hash:hash(password),role:'student',active:true,must_change_password:b.forcePasswordChange===true||b.forcePasswordChange==='true',access_expires_at:b.plan==='premium'?addOneMonth(new Date()).toISOString():null,access_source:b.plan==='premium'?'prof':null}]);
   return send(res,201,{student:cleanUser(saved[0]),passwordSetByAdmin:true}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/reset-password'){
   requireRole(u,['admin']);const b=await body(req),id=str(b.id,64),target=await getUserById(id);if(!target||target.role!=='student')throw apiError('حساب تلميذ موش موجود',404);
   const password=String(b.password||''),confirmPassword=String(b.confirmPassword||'');
   if(password.length<12||password.length>128)throw apiError('كلمة السرّ الجديدة يلزمها من 12 إلى 128 حرف.');
   if(password!==confirmPassword)throw apiError('كلمتا السرّ موش متطابقتين.');
   if(password.toLowerCase()===target.username||/^(.{1,4})\1{2,}$/.test(password))throw apiError('اختار كلمة سرّ أقوى.');
   await db('cfi_users','PATCH',`?id=eq.${encodeURIComponent(id)}`,{password_hash:hash(password),must_change_password:b.forcePasswordChange===true||b.forcePasswordChange==='true',session_version:(target.session_version||1)+1});
   return send(res,200,{username:target.username,passwordChanged:true}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/approve'){
   requireRole(u,['admin']);const b=await body(req),target=await getUserById(str(b.id,64));
   if(!target||target.role!=='student')throw apiError('تلميذ غير موجود',404);
   if(target.email&&!target.email_verified)throw apiError('يلزم التلميذ يؤكّد Email قبل الموافقة.',403);
   await db('cfi_users','PATCH',`?id=eq.${target.id}`,{active:true,activation_status:'active'});
   return send(res,200,{ok:true}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/enable'){
   requireRole(u,['admin']);const b=await body(req),target=await getUserById(str(b.id,64));if(!target||target.role!=='student')throw apiError('تلميذ غير موجود',404);if(!!b.active&&target.email&&!target.email_verified)throw apiError('ما تنجمش تفعّل حساب قبل تأكيد Email',403);await db('cfi_users','PATCH',`?id=eq.${target.id}`,{active:!!b.active,activation_status:b.active?'active':'suspended'});return send(res,200,{ok:true}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/review'){
   requireRole(u,['admin']);const b=await body(req),studentId=str(b.studentId,64),lessonId=str(b.lessonId,80),status=['reviewed','needs_changes'].includes(b.status)?b.status:null;if(!status)throw apiError('وضعية مراجعة غير صحيحة');
   const sb=await getOne('cfi_submissions',`&user_id=eq.${encodeURIComponent(studentId)}&lesson_id=eq.${encodeURIComponent(lessonId)}`);if(!sb)throw apiError('الواجب موش موجود',404);
   await db('cfi_submissions','PATCH',`?user_id=eq.${encodeURIComponent(studentId)}&lesson_id=eq.${encodeURIComponent(lessonId)}`,{review_status:status,review_note:str(b.note,1000)});return send(res,200,{ok:true}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/renew'){
   requireRole(u,['admin']);const b=await body(req),target=await getUserById(str(b.id,64));
   if(!target||target.role!=='student')throw apiError('تلميذ غير موجود',404);
   if(target.email&&!target.email_verified)throw apiError('يلزم تأكيد البريد أولًا',403);
   const expiresAt=await extendTeacherMonth(target);return send(res,200,{ok:true,expiresAt}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/grant'){
   requireRole(u,['admin']);const b=await body(req),target=await getUserById(str(b.id,64));
   if(!target||target.role!=='student')throw apiError('تلميذ غير موجود',404);
   if(!Object.hasOwn(productKeys,b.product))throw apiError('منتج غير صحيح');
   if(target.email&&!target.email_verified)throw apiError('يلزم تأكيد البريد أولاً.',403);
   const patch={};if(['arduino','pack'].includes(b.product))patch.lifetime_arduino=true;if(['esp32','pack'].includes(b.product))patch.lifetime_esp32=true;if(b.product==='traffic')patch.lifetime_traffic=true;if(b.product==='home')patch.lifetime_home=true;
   await db('cfi_users','PATCH',`?id=eq.${encodeURIComponent(target.id)}`,patch);return send(res,200,{ok:true}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/store-price'){
   requireRole(u,['admin']);const b=await body(req);if(!Object.hasOwn(productKeys,b.product))throw apiError('منتج غير صحيح');
   const dt=Number(b.priceDT),millimes=Math.round(dt*1000);if(!Number.isFinite(dt)||millimes<1000||millimes>1000000||Math.abs(dt*1000-millimes)>1e-6)throw apiError('السعر غير صحيح');
   await db('cfi_settings','POST','?on_conflict=key',[{key:productKeys[b.product],value_int:millimes,updated_at:new Date().toISOString()}],'resolution=merge-duplicates,return=representation');return send(res,200,{ok:true}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/price'){
   requireRole(u,['admin']);const b=await body(req),dt=Number(b.priceDT),millimes=Math.round(dt*1000);
   if(!Number.isFinite(dt)||millimes<1000||millimes>1000000||Math.abs(dt*1000-millimes)>1e-6)throw apiError('السعر يلزم يكون بين 1 و1000 دينار، بدقّة المليم.',400);
   await db('cfi_settings','POST','?on_conflict=key',[{key:'monthly_price_millimes',value_int:millimes,updated_at:new Date().toISOString()}],'resolution=merge-duplicates,return=representation');
   return send(res,200,{ok:true,priceMillimes:millimes}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/lesson'){
   requireRole(u,['admin']);const b=await body(req),title=str(b.title,110),intro=str(b.intro,5000),task=str(b.task,3000),terms=str(b.terms,300),subject=['ESP32','Arduino'].includes(b.subject)?b.subject:'ESP32';
   if(title.length<5||intro.length<15)throw apiError('عنوان وشرح الدرس ضروريين.');let qs=b.quiz;
   if(!Array.isArray(qs)||qs.length<2||qs.length>10)throw apiError('لازم على الأقل زوز أسئلة QCM للدرس الجديد');
   qs=qs.map((q,i)=>({id:'custom-q'+i,textAr:str(q.textAr,280),term:str(q.term,120),options:Array.isArray(q.options)?q.options.map(x=>str(x,130)):[],answer:Number(q.answer),why:str(q.why,280)}));
   if(qs.some(q=>q.textAr.length<8||q.options.length!==4||q.options.some(o=>!o)||!Number.isInteger(q.answer)||q.answer<0||q.answer>3))throw apiError('كل سؤال لازم فيه 4 إجابات وجواب صحيح واحد');
   const row={title,intro,task,terms,subject,type:'lesson',week:content.length+1,quiz:qs};const saved=await db('cfi_extra_lessons','POST','',[row]);return send(res,201,{lesson:{id:saved[0].id,title}}),true;
  }
  throw apiError('المسار هذا موش موجود',404);
 }catch(e){const status=e.status||500;if(status>=500)console.error('CFI Academy server:',e.message);send(res,status,{error:e.message||'خطأ في السيرفر'});return true;}
}
module.exports={respond,configured,hash,check,sign,verify,progress,baseIds,viewer,subscription,db,beginnerProgress,ownership,accessRule,hasCourseAccess,requireCourseAccess};
