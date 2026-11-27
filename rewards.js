'use strict';
// XP awards come only from completed, server-authoritative matches.
const crypto=require('crypto');
const academy=require('./academy-api.js');
const account=c=>c?.academyUser?.role==='student'&&!c.academyUser.must_change_password?c.academyUser.id:null;
function start(r){r.xpMatch=crypto.randomUUID();r.xpStarted=Date.now();r.xpSaved=false;for(const p of r.players.values())p.xpEligible=!!(p.rankUser&&p.conn&&(p.connected!==false));}
async function persist(body){for(let i=0;i<3;i++){try{await academy.db('rpc/cfi_record_game_v75','POST','',body);return true}catch(e){if(i<2)await new Promise(resolve=>setTimeout(resolve,500*(i+1)));}}console.warn('[CFI XP] Unable to persist match result');return false;}
function finish(r,game,score,compare){if(!r.xpMatch||r.xpSaved)return Promise.resolve([]);r.xpSaved=true;const ranked=[...r.players.values()].filter(p=>p.xpEligible||p.conn).sort(compare||((a,b)=>score(b)-score(a)));const byUser=new Map();ranked.forEach((p,i)=>{if(!p.xpEligible||!p.rankUser||byUser.has(p.rankUser))return;byUser.set(p.rankUser,{p_user:p.rankUser,p_match:r.xpMatch,p_game:game,p_score:Math.min(1000000,Math.max(0,Math.floor(score(p)||0))),p_rank:i+1,p_duration:r.duration,p_players:ranked.length});});return Promise.all([...byUser.values()].map(persist));}
async function respond(req,res){const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};try{if(req.method!=='GET')return reply(405,{error:'method'});const u=await academy.viewer(req);if(!account({academyUser:u}))return reply(401,{error:'login'});const data=await academy.db('rpc/cfi_rewards_v75','POST','',{p_user:u.id});return reply(200,data);}catch{return reply(503,{error:'unavailable'});}}
function playerIdentity(c,raw,room,old){
 const user=c?.academyUser;
 let name;
 if(user?.role==='student'){
  if(user.must_change_password||!user.player_name)return {error:'Choisissez votre pseudo dans Mon espace CFI avant de jouer.'};
  name=user.player_name;
 }else{
  const clean=String(raw||'').trim().replace(/^Guest_/i,'');
  if(!/^[A-Za-z0-9_]{3,18}$/.test(clean))return {error:'Entrez un pseudo: 3–18 lettres A-Z, chiffres ou _.'};
  name='Guest_'+clean;
 }
 if(old)return {name:old.name};
 const duplicate=[...(room?.players?.values()||[])].some(p=>p.name.toLowerCase()===name.toLowerCase()||(account(c)&&p.rankUser===account(c)));
 return duplicate?{error:'Ce pseudo est déjà dans la partie. Choisissez un autre ou reconnectez-vous.'}:{name};
}
module.exports={account,start,finish,respond,playerIdentity};
