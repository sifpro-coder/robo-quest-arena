'use strict';
// CFI Academy: server-side auth, role checks, auto-grading and persistent submissions.
// Requires Supabase REST service_role ONLY in Render environment, never in browser or GitHub.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const content = JSON.parse(fs.readFileSync(path.join(__dirname,'academy-content.json'),'utf8')).modules;
const bank = JSON.parse(fs.readFileSync(path.join(__dirname,'academy-bank.json'),'utf8'));
const baseIds = content.map(c=>c.id);
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
function cleanUser(u){return {id:u.id,username:u.username,name:u.display_name,role:u.role,mustChangePassword:!!u.must_change_password};}
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
function publicInfo(m){return {id:m.id,title:m.arTitle,originalTitle:m.shortTitle,type:m.type,subject:m.subject,level:Number(m.level),week:Number(m.week),term:m.terms};}
async function allLessons(){const extras=await db('cfi_extra_lessons','GET','?select=*&order=created_at.asc');return [...content,...extras.map(x=>({id:x.id,type:x.type||'lesson',subject:x.subject||'ESP32',level:'1',week:x.week||23,shortTitle:x.title,arTitle:x.title,arIntro:x.intro,terms:x.terms,arTask:x.task,body:'',source:'درس جديد من الأستاذ',custom:true}))];}
async function courseById(id){return byId.get(id)|| (await allLessons()).find(x=>x.id===id);}
async function questionsFor(id){if(bank[id])return bank[id];const rows=await db('cfi_extra_lessons','GET',`?select=id,quiz&id=eq.${encodeURIComponent(id)}&limit=1`);return rows[0]?.quiz||[];}
function shuffle(xs){const a=xs.slice();for(let i=a.length-1;i>0;i--){let j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function optionToken(nonce,qid,index){return crypto.createHmac('sha256',SIGN_KEY).update(nonce+'|'+qid+'|'+index).digest('base64url').slice(0,22);}
function ticketQuiz(user,id,qset){const selection=shuffle(qset).slice(0,Math.min(5,qset.length)),nonce=crypto.randomBytes(16).toString('hex');const qt=selection.map(q=>({id:q.id,textAr:q.textAr,term:q.term,choices:shuffle(q.options.map((label,index)=>({value:optionToken(nonce,q.id,index),label})))}));
 const ticket=sign({type:'quiz',id,userId:user.id,qids:qt.map(q=>q.id),nonce,exp:Date.now()+30*60*1000});return {questions:qt,ticket};}
async function mySubmissions(u){return db('cfi_submissions','GET',`?select=*&user_id=eq.${encodeURIComponent(u.id)}&order=updated_at.desc`);}
function progress(rows){const map=new Map(rows.map(r=>[r.lesson_id,r]));const required=baseIds.map(id=>{const r=map.get(id);const x=byId.get(id);return{id,passed:!!r&&r.best_score>=12&& (x.type!=='tp'||str(r.code,8000).length>=15)}});return{done:required.filter(x=>x.passed).length,total:required.length,required};}
function requestIp(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].trim().slice(0,64);}
function limitLogin(req,username){const ip=requestIp(req)+'|'+username,now=Date.now();let entry=failures.get(ip)||{count:0,until:now+15*60*1000};if(now>entry.until)entry={count:0,until:now+15*60*1000};if(entry.count>=12)throw apiError('محاولات برشا. عاود بعد ربع ساعة.',429);failures.set(ip,entry);return()=>{entry.count++;failures.set(ip,entry)};}
function unlock(req,username){failures.delete(requestIp(req)+'|'+username);}
function certificateCode(){return 'CFI-'+crypto.randomBytes(6).toString('hex').toUpperCase();}
async function respond(req,res,url){
 const method=req.method;const route=url.pathname;
 if(!route.startsWith('/api/academy/'))return false;
 try{
  if(method==='GET'&&route==='/api/academy/status')return send(res,200,{configured:configured(),courses:baseIds.length,mode:'real-accounts-require-setup'}),true;
  if(method==='GET'&&route==='/api/academy/catalog'){
   const bases=content.map(publicInfo);let extras=[];if(configured())try{extras=(await db('cfi_extra_lessons','GET','?select=id,title,type,subject,week,terms')).map(x=>({id:x.id,title:x.title,originalTitle:x.title,type:x.type||'lesson',subject:x.subject||'ESP32',week:x.week,term:x.terms}))}catch{}return send(res,200,{courses:[...bases,...extras]}),true;
  }
  requireReady();
  if(method==='POST'&&route==='/api/academy/login'){
   await ensureAdmin();const b=await body(req),username=normalUsername(b.username),password=String(b.password||'');const fail=limitLogin(req,username);
   if(!validUsername(username)||password.length>256)throw apiError('المعطيات موش صحيحة',401);
   let u=await getUserByUsername(username);
   if(!u||!u.active||!check(password,u.password_hash)){fail();throw apiError('الاسم ولا كلمة السرّ موش صحيحة',401)}
   unlock(req,username);const tk=sign({type:'session',id:u.id,sv:u.session_version||1,exp:Date.now()+7*24*3600*1000});return send(res,200,{user:cleanUser(u)},{'Set-Cookie':sessionCookie(req,tk)}),true;
  }
  if(method==='POST'&&route==='/api/academy/logout'){await body(req);return send(res,200,{ok:true},{'Set-Cookie':clearCookie(req)}),true;}
  const u=await viewer(req);
  if(method==='GET'&&route==='/api/academy/me'){if(!u)throw apiError('يلزم تدخل بحسابك',401);return send(res,200,{user:cleanUser(u)}),true;}
  if(method==='POST'&&route==='/api/academy/password'){
   requireRole(u,['admin','student']);const b=await body(req),old=String(b.oldPassword||''),fresh=String(b.newPassword||'');if(!check(old,u.password_hash))throw apiError('كلمة السر القديمة موش صحيحة',403);if(fresh.length<12||fresh.length>128)throw apiError('كلمة السرّ الجديدة لازم 12 حرف على الأقل');
   const sv=(u.session_version||1)+1;await db('cfi_users','PATCH',`?id=eq.${u.id}`,{password_hash:hash(fresh),must_change_password:false,session_version:sv});const tk=sign({type:'session',id:u.id,sv,exp:Date.now()+7*24*3600*1000});return send(res,200,{ok:true},{'Set-Cookie':sessionCookie(req,tk)}),true;
  }
  if(method==='GET'&&route==='/api/academy/lesson'){
   requireRole(u,['student','admin']);const id=str(url.searchParams.get('id'),80),m=await courseById(id);if(!m)throw apiError('الدرس موش موجود',404);
   const out={...publicInfo(m),intro:m.arIntro,task:m.arTask,body:m.body||'',source:m.source||'',materials:m.materials||'',need:m.need||'',expected:m.expected||''};
   if(u.role==='admin')out.solution=(byId.has(id)?JSON.parse(fs.readFileSync(path.join(__dirname,'academy-solutions.json'),'utf8'))[id]||'':'');
   return send(res,200,{lesson:out}),true;
  }
  if(method==='GET'&&route==='/api/academy/quiz'){
   requireRole(u,['student','admin']);if(u.must_change_password)throw apiError('بدّل كلمة السرّ المؤقّتة قبل ما تبدأ',403);
   const id=str(url.searchParams.get('id'),80),lesson=await courseById(id);if(!lesson)throw apiError('الدرس موش موجود',404);
   const qs=await questionsFor(id);if(!qs.length)throw apiError('الدرس هذا مازال ما عندوش QCM');return send(res,200,ticketQuiz(u,id,qs)),true;
  }
  if(method==='GET'&&route==='/api/academy/mine'){
   requireRole(u,['student']);const subs=await mySubmissions(u);const prog=progress(subs);const cert=await getOne('cfi_certificates','&user_id=eq.'+u.id);return send(res,200,{submissions:subs,progress:prog,certificate:cert?{code:cert.code,issuedAt:cert.issued_at}:null}),true;
  }
  if(method==='POST'&&route==='/api/academy/submit'){
   requireRole(u,['student']);if(u.must_change_password)throw apiError('بدّل كلمة السرّ المؤقّتة قبل ما تبدأ',403);
   const b=await body(req),p=verify(b.ticket);if(!p||p.type!=='quiz'||p.userId!==u.id||!Array.isArray(p.qids)||p.qids.length>8)throw apiError('اختبار منتهي أو غير صحيح. جدّد الاختبار.',400);
   const lesson=await courseById(p.id);if(!lesson)throw apiError('الدرس موش موجود',404);let qBank=await questionsFor(p.id);
   const answers=b.answers||{},used=new Set();let correct=0,details=[];
   for(const qid of p.qids){if(used.has(qid))throw apiError('سؤال مكرّر');used.add(qid);const q=qBank.find(x=>x.id===qid);if(!q)throw apiError('سؤال غير موجود');const answerToken=String(answers[qid]||'');const chosen=q.options.findIndex((_,i)=>optionToken(p.nonce,qid,i)===answerToken);if(!Object.prototype.hasOwnProperty.call(answers,qid)||chosen<0)throw apiError('جاوب على كل الأسئلة');if(chosen===q.answer)correct++;details.push({id:qid,chosen,correct:q.answer,why:q.why,question:q.textAr,goodAnswer:q.options[q.answer],isCorrect:chosen===q.answer});}
   const score=Math.round(correct*20/p.qids.length);const code=str(b.code,8000),notes=str(b.notes,4000);
   const existing=await getOne('cfi_submissions',`&user_id=eq.${u.id}&lesson_id=eq.${encodeURIComponent(p.id)}`);
   const best=Math.max(score,existing?.best_score||0),row={user_id:u.id,lesson_id:p.id,code,notes,score,best_score:best,correct,total:p.qids.length,quiz_details:details,updated_at:new Date().toISOString()};
   const updated=await db('cfi_submissions','POST','?on_conflict=user_id,lesson_id',[row],'resolution=merge-duplicates,return=representation');
   return send(res,200,{score,bestScore:best,correct,total:p.qids.length,feedback:details,submission:updated[0]||row}),true;
  }
  if(method==='POST'&&route==='/api/academy/certificate'){
   requireRole(u,['student']);const subs=await mySubmissions(u),prog=progress(subs);if(prog.done!==prog.total)throw apiError(`مازال عندك ${prog.total-prog.done} وحدة ناقصة قبل الشهادة.`,400);
   let cert=await getOne('cfi_certificates','&user_id=eq.'+u.id);if(!cert){let rows=await db('cfi_certificates','POST','',[{user_id:u.id,code:certificateCode(),session:'ESP32 · Smart Home Mini'}]);cert=rows[0]}
   return send(res,200,{certificate:{code:cert.code,issuedAt:cert.issued_at,studentName:u.display_name,session:cert.session}}),true;
  }
  if(method==='GET'&&route==='/api/academy/verify'){
   const code=str(url.searchParams.get('code'),30);if(!/^CFI-[A-F0-9]{12}$/.test(code))throw apiError('رقم شهادة غير صحيح',404);
   const cert=await getOne('cfi_certificates','&code=eq.'+code);return send(res,200,{valid:!!cert,session:cert?.session||null,issuedAt:cert?.issued_at||null}),true;
  }
  // Admin-only account provisioning and private student grades.
  if(method==='GET'&&route==='/api/academy/admin/overview'){
   requireRole(u,['admin']);const users=await db('cfi_users','GET','?select=id,username,display_name,role,active,must_change_password&role=eq.student&order=created_at.desc');const submissions=await db('cfi_submissions','GET','?select=user_id,lesson_id,score,best_score,code,notes,updated_at,review_status&order=updated_at.desc&limit=2000');
   return send(res,200,{students:users,submissions}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/students'){
   requireRole(u,['admin']);const b=await body(req),username=normalUsername(b.username),name=str(b.name,80);if(!validUsername(username)||name.length<2)throw apiError('اكتب اسم تلميذ صحيح وUsername لاتيني 3–32 حرف');if(await getUserByUsername(username))throw apiError('Username مستعمل من قبل');const password=randPass();const saved=await db('cfi_users','POST','',[{username,display_name:name,password_hash:hash(password),role:'student',active:true,must_change_password:true}]);return send(res,201,{student:cleanUser(saved[0]),temporaryPassword:password}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/reset-password'){
   requireRole(u,['admin']);const b=await body(req),id=str(b.id,64),target=await getUserById(id);if(!target||target.role!=='student')throw apiError('حساب تلميذ موش موجود',404);
   const password=randPass();await db('cfi_users','PATCH',`?id=eq.${encodeURIComponent(id)}`,{password_hash:hash(password),must_change_password:true,session_version:(target.session_version||1)+1});return send(res,200,{username:target.username,temporaryPassword:password}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/enable'){
   requireRole(u,['admin']);const b=await body(req),target=await getUserById(str(b.id,64));if(!target||target.role!=='student')throw apiError('تلميذ غير موجود',404);await db('cfi_users','PATCH',`?id=eq.${target.id}`,{active:!!b.active});return send(res,200,{ok:true}),true;
  }
  if(method==='POST'&&route==='/api/academy/admin/review'){
   requireRole(u,['admin']);const b=await body(req),studentId=str(b.studentId,64),lessonId=str(b.lessonId,80),status=['reviewed','needs_changes'].includes(b.status)?b.status:null;if(!status)throw apiError('وضعية مراجعة غير صحيحة');
   const sb=await getOne('cfi_submissions',`&user_id=eq.${encodeURIComponent(studentId)}&lesson_id=eq.${encodeURIComponent(lessonId)}`);if(!sb)throw apiError('الواجب موش موجود',404);
   await db('cfi_submissions','PATCH',`?user_id=eq.${encodeURIComponent(studentId)}&lesson_id=eq.${encodeURIComponent(lessonId)}`,{review_status:status,review_note:str(b.note,1000)});return send(res,200,{ok:true}),true;
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
module.exports={respond,configured,hash,check,sign,verify,progress,baseIds};
