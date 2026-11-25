const fs=require('fs'),vm=require('vm');
const all=JSON.parse(fs.readFileSync('academy-content.json','utf8')).modules;
const bank=JSON.parse(fs.readFileSync('academy-bank.json','utf8'));
const els=new Map(); const el=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',value:'',classList:{toggle(){}},scrollIntoView(){},onclick:null,style:{}});return els.get(id)};
const api=(path)=>{
 if(path==='/status')return{configured:true,priceMillimes:10000};
 if(path==='/catalog')return{courses:all.map(m=>({id:m.id,title:m.arTitle,originalTitle:m.shortTitle,subject:m.subject,type:m.type,level:m.level,week:m.week,term:m.terms,track:m.track,part:m.part}))};
 if(path==='/me')return{user:{id:'test-student',role:'student',name:'CFI Student',subscription:{valid:true},mustChangePassword:false}};
 if(path==='/mine')return{submissions:[],progress:{done:0,total:22},subscription:{valid:true}};
 if(path.startsWith('/lesson?id=')){const m=all.find(x=>x.id===decodeURIComponent(path.split('=')[1]));return{lesson:{id:m.id,title:m.arTitle,originalTitle:m.shortTitle,intro:m.arIntro,task:m.arTask,body:m.body,term:m.terms,week:m.week,type:m.type,track:m.track}}}
 if(path.startsWith('/quiz?id=')){const id=decodeURIComponent(path.split('=')[1]);return {ticket:'signed-test',questions:bank[id].map(q=>({id:q.id,textAr:q.textAr,term:q.term,choices:q.options.map((label,i)=>({label,value:'token'+i}))}))};}
 throw Error('Unexpected route '+path);
};
const doc={documentElement:{dataset:{theme:'light'}},querySelector:q=>el(q),querySelectorAll:()=>[]};
const win={scrollTo(){}};
const context={document:doc,window:win,location:{search:''},URLSearchParams,localStorage:{getItem:()=>null,setItem(){}},fetch:async url=>({ok:true,json:async()=>api(url.replace('/api/academy',''))}),console,alert:()=>{},confirm:()=>true};
let script=fs.readFileSync('academy.html','utf8').split('<script>')[1].split('</script>')[0];
script=script.replace(/\binit\(\);\s*\}\)\(\);\s*$/,'window.__cfiTest={openLesson,home,loadQuiz};init();})();');
vm.runInNewContext(script,context);
setTimeout(async()=>{const h=el('#app').innerHTML;
 if(!h.includes('pro-catalog')||!h.includes('Communication')||!h.includes('5 · Évaluation'))throw Error('Home missing PRO section');
 console.log('PASS home rendered', (h.match(/class="esp-module"/g)||[]).length,'ESP32 PRO cards');
 await win.__cfiTest.openLesson('pro-03');const l=el('#app').innerHTML;
 if(!l.includes('esp-full-course')||!l.includes('MicroPython')||!l.includes('GPIO5'))throw Error('Bilingual pro lesson missing');
 console.log('PASS integrated PRO lesson with bilingual body and MicroPython');
 await win.__cfiTest.loadQuiz();const q=el('#quizHolder').innerHTML;
 if(!q.includes('quizForm')||(q.match(/qcard/g)||[]).length!==5)throw Error('Quiz not rendered');
 console.log('PASS quiz loads server-provided items');
},25);
