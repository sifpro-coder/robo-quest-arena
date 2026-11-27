(()=>{'use strict';
const valid=n=>/^[A-Za-z0-9_]{3,18}$/.test(n)&&!/^guest_/i.test(n);
const field=()=>document.getElementById('playerName')||document.getElementById('name');
let cachedUser,loaded=false,busy=false,replay=false;
async function who(){if(loaded)return cachedUser;const r=await fetch('/api/academy/me',{credentials:'same-origin',cache:'no-store'});if(r.status===401){loaded=true;return cachedUser=null}if(!r.ok)throw Error('Connexion indisponible');cachedUser=(await r.json()).user;loaded=true;return cachedUser;}
window.cfiPrepareName=async function(){const f=field();const u=await who();let n='';if(u?.role==='student'){
 if(u.mustChangePassword)throw Error('Changez votre mot de passe dans Mon espace.');
 n=u.playerName;if(!n){n=prompt('Choisissez votre pseudo unique (3–18 lettres A-Z, chiffres ou _). Pas de nom complet.','');if(n===null)return null;n=n.trim();if(!valid(n))throw Error('Pseudo invalide.');const r=await fetch('/api/academy/player-name',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})});const d=await r.json();if(!r.ok)throw Error(d.error||'Pseudo indisponible');cachedUser=d.user;n=d.user.playerName;}
 }else{n=f?.value.trim()||'';if(!n){n=prompt('Votre pseudo pour cette partie (3–18 lettres A-Z, chiffres ou _).','');if(n===null)return null;n=n.trim();}if(!valid(n))throw Error('Pseudo invalide.');try{localStorage.setItem('cfi_guest_nick_v75',n)}catch{}}
 if(f){f.value=n;if(u?.role==='student')f.readOnly=true;}return n;};
window.cfiNameError=e=>{const f=field();if(f&&f.getClientRects().length){f.setCustomValidity(e.message||'Pseudo indisponible');f.reportValidity();f.addEventListener('input',()=>f.setCustomValidity(''),{once:true});}else alert(e.message||'Pseudo indisponible')};
window.cfiBindNameButtons=ids=>{const f=field();if(f){f.value='';f.maxLength=18;f.placeholder='Pseudo unique';try{f.value=localStorage.getItem('cfi_guest_nick_v75')||''}catch{}}for(const id of ids){const b=document.getElementById(id);if(!b)continue;b.addEventListener('click',async e=>{if(replay)return;e.preventDefault();e.stopImmediatePropagation();if(busy)return;busy=true;try{if(f)f.setCustomValidity('');const n=await window.cfiPrepareName();if(n){replay=true;try{b.click()}finally{replay=false}}}catch(err){window.cfiNameError(err)}finally{busy=false}},true)}};
})();