/* Aperçu isolé du CRM avec données fictives, sans dépendance et sans accès production.
   node tests/preview-server.cjs ; http://127.0.0.1:8765/admin/ */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const port=Number(process.env.CRM_PREVIEW_PORT || 8765);
let uid=100;
function id(n){return '00000000-0000-0000-0000-'+String(n).padStart(12,'0');}
const now=new Date();
const localDay=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today=localDay(now);
const next=new Date(now);next.setDate(next.getDate()+(6-next.getDay()+7)%7);
const saturday=localDay(next);
const requests=[
 {id:id(10),type:'cours',enfant:'Éloïse Martin',parent_nom:'Camille Martin',parent_email:'camille@example.test',detail:'Cours au trimestre',tarif:'325 €',statut:'en attente',cree:today+'T09:20:00Z',jeton_d:'fixture',jeton_s:'fixture'},
 {id:id(11),type:'stage',enfant:'Gabriel Laurent',parent_nom:'Alex Laurent',parent_email:'alex@example.test',detail:'Stage de la Toussaint (Du 19 au 24 octobre 2026)',tarif:'840 €',statut:'validée',cree:'2026-09-01T14:00:00Z',acompte_paye:true,acompte_le:'2026-08-28',solde_paye:false},
 {id:id(12),type:'cours',enfant:'Louise Moreau',parent_nom:'Sacha Moreau',parent_email:'sacha@example.test',detail:'Cours à l’unité',tarif:'25 €',statut:'validée',cree:'2026-09-10T11:00:00Z'},
 {id:id(13),type:'cours',enfant:'Arthur Petit',parent_nom:'Charlie Petit',parent_email:'charlie@example.test',detail:'Cours à l’unité',tarif:'25 €',statut:'validée',cours_date:saturday,cours_heure:'10h00',paye:true,paye_montant:'25 €',paye_le:today,cree:'2026-09-08T11:00:00Z'},
 {id:id(14),type:'cours',enfant:'Emma Bernard',parent_nom:'Lou Bernard',parent_email:'lou@example.test',detail:'Cours au trimestre',tarif:'325 €',statut:'validée',cours_date:saturday,cours_heure:'14:00',cree:'2026-09-07T15:00:00Z'},
 {id:id(15),type:'stage',enfant:'Léon Dubois',parent_nom:'Morgan Dubois',parent_email:'morgan@example.test',detail:'Stage de la Toussaint (Du 26 au 31 octobre 2026)',tarif:'840 €',statut:'validée',acompte_paye:true,acompte_le:'2026-08-20',solde_paye:true,solde_le:today,cree:'2026-08-18T10:00:00Z'},
 {id:id(16),type:'cours',enfant:'Jade Leroy',parent_nom:'Alix Leroy',parent_email:'alix@example.test',detail:'Cours à l’unité',tarif:'25 €',statut:'refusée (Complet)',cree:'2026-09-06T10:00:00Z'},
 {id:id(17),type:'cours',enfant:'Malo Roux',parent_nom:'Noa Roux',parent_email:'noa@example.test',detail:'Cours à l’unité',tarif:'25 €',statut:'validée',paye:true,paye_montant:'25 €',paye_le:'2026-09-03',annule:true,rembourse_montant:'25 €',cree:'2026-09-02T10:00:00Z'}
];
let families=requests.slice(0,6).map((r,i)=>({user_id:id(i+20),email:r.parent_email,maj:today+'T08:00:00Z',donnees:{responsable:{nom:r.parent_nom,email:r.parent_email,tel:'',ville:'Auberville'},enfants:[{prenom:r.enfant.split(' ')[0],nom:r.enfant.split(' ')[1],naissance:'2016-05-12'}],demandes:[]}}));
let notes=[{user_id:id(20),note:'Famille intéressée par les cours du samedi matin.',maj:today+'T08:00:00Z'}];
const calls=[];
let failure=false;
function json(res,data,status=200,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>1000000)throw new Error('too large');}return text?JSON.parse(text):{};}
function list(res,rows,url){const offset=Number(url.searchParams.get('offset')||0),limit=Math.min(Number(url.searchParams.get('limit')||1000),3);const selection=rows.slice(offset,offset+limit);json(res,selection,200,{'Content-Range':offset+'-'+(offset+selection.length-1)+'/'+rows.length});}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/__crm/calls'){json(res,calls);return;}
  if(url.pathname==='/__crm/fail'){failure=url.searchParams.get('on')==='1';json(res,{failure});return;}
  if(url.pathname.startsWith('/__crm/')){
   calls.push({path:url.pathname,method:req.method});
   if(failure){json(res,{message:'Simulated failure'},503);return;}
   if(url.pathname.endsWith('/admins')){json(res,[{email:'equipe@example.test'}]);return;}
   let rows=url.pathname.endsWith('/demandes')?requests:url.pathname.endsWith('/familles')?families:url.pathname.endsWith('/notes_familles')?notes:null;
   if(rows){
    if(req.method==='GET'){list(res,rows,url);return;}
    const key=rows===requests?'id':'user_id';
    if(req.method==='POST'){
     const data=await body(req);let row=rows.find(x=>x[key]===data[key]);
     if(row){Object.assign(row,data);}else{row={id:id(uid++),cree:new Date().toISOString(),...data};rows.unshift(row);}
     json(res,[row]);return;
    }
    const target=(url.searchParams.get(key)||'').replace(/^eq\./,'');
    const row=rows.find(x=>x[key]===target);
    if(!row){json(res,[]);return;}
    if(req.method==='PATCH'){Object.assign(row,await body(req));json(res,[row]);return;}
    if(req.method==='DELETE'){rows.splice(rows.indexOf(row),1);json(res,[row]);return;}
   }
   if(url.pathname==='/__crm/service'){
    const data=await body(req);
    if(data.type==='stripe'){
     const payment={session_id:'cs_fixture_1',email:'sacha@example.test',montant:25,montant_centimes:2500,quand:today,statut:'propose',demande_id:id(12),nature:'cours',candidats:[{demande_id:id(12),enfant:'Louise Moreau'}]};
     json(res,{ok:true,version:22,paiements:[payment],propositions:[payment],bilan:{proposes:1}});return;
    }
    if(data.type==='stripe-rapprocher'){let row=requests.find(x=>x.id===data.demande_id);Object.assign(row,{paye:true,paye_le:today,paye_montant:'25 €'});json(res,{ok:true,demande:row,paiement:{session_id:data.session_id},deja_rapproche:false});return;}
    let result=data.type==='infos-cours'?'ok infos':'ok relance;parent@example.test';
    if(data.type==='decision'){
     const row=requests.find(x=>x.jeton_d===data.d && x.jeton_s===data.s);
     if(!row){result='lien invalide';}
     else if(row.statut!=='en attente'){result='decision deja traitee';}
     else{row.statut=data.action==='refuser'?'refusée (Complet)':'validée';row.decide=new Date().toISOString();result=data.action==='refuser'?'ok refuse':'ok valide';}
    }
    res.writeHead(200,{'Content-Type':'text/plain'});res.end(result);return;
   }
   json(res,{message:'No fixture route'},404);return;
  }
  let file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return;}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
  if(!fs.existsSync(file)){res.writeHead(404).end();return;}
  let data=fs.readFileSync(file);
  if(file===path.join(root,'admin','index.html')){
   data=data.toString().replace(/<script src="\.\.\/assets\/js\/(compte-config|nuage)\.js[^\"]*"><\/script>/g,'').replace(/<script src="\.\.\/assets\/js\/admin-core/, '<script src="../tests/crm-fixture.js"></script>\n<script src="../assets/js/admin-core');
  }
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 }catch(error){json(res,{message:error.message},500);}
});
server.listen(port,'127.0.0.1',()=>process.stdout.write('CRM preview fixture: http://127.0.0.1:'+port+'/admin/\n'));
