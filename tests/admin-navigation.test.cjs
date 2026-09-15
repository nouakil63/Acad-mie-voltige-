const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Exécute le contrôleur réel avec un DOM minimal : aucun appel réseau et
// aucun accès aux remboursements. Les assertions portent sur le parcours.
function application(hash = '#demandes', realPlanning = false, deployment = {stripeActif:true}) {
  const ids = new Map(), callbacks = {}, frames = [], tabs = [];
  const calls = [];
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.hidden = false;
      this.textContent = ''; this.value = ''; this.style = {}; this.className = '';
      this.classList = {add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)), toggle: (n,on) => on ? this.classes.add(n) : this.classes.delete(n)};
      this.classes = new Set(); this.events = {};
    }
    appendChild(child) { return this.insertBefore(child,null); }
    insertBefore(child, next) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child),1);
      const index = next ? this.children.indexOf(next) : this.children.length;
      this.children.splice(index < 0 ? this.children.length : index,0,child); child.parentNode = this; return child;
    }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this)+1] || null; }
    set innerHTML(value) { this.children.forEach(c => c.parentNode = null); this.children = []; this.textContent = value; }
    get innerHTML() { return this.textContent; }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] || null; }
    removeAttribute(name) { delete this.attrs[name]; }
    focus() { document.activeElement = this; }
    contains(item) { return item === this || this.children.some(c => c.contains(item)); }
    querySelectorAll(selector) {
      const matches = element => selector === 'button' ? element.tagName === 'BUTTON'
        : selector === 'h3' ? element.tagName === 'H3'
        : selector === '[data-record-open]' ? !!element.getAttribute('data-record-open')
        : selector.startsWith('.') ? element.className.split(' ').includes(selector.slice(1)) : false;
      return this.children.flatMap(child => [...(matches(child) ? [child] : []),...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  function el(id) { if (!ids.has(id)) { const n = new Element(); n.id=id; ids.set(id,n); } return ids.get(id); }
  document = {body:new Element('body'),activeElement:null,title:'',createElement:tag=>new Element(tag),
    getElementById:id=>id.includes(':') ? ids.get(id) || null : el(id), addEventListener(){},querySelector:selector=>selector === '.onglets' ? el('navigation') : null,
    querySelectorAll:selector=>selector.startsWith('.onglets') ? tabs : document.body.querySelectorAll(selector)};
  ['accueil','demandes','familles','reservations','paiements'].forEach(tab => {
    const b = new Element('button'); b.setAttribute('data-onglet',tab); tabs.push(b); document.body.appendChild(el('o-'+tab));
  });
  ['crm-detail','crm-page-title','crm-back'].forEach(id=>document.body.appendChild(el(id)));
  el('crm-detail').appendChild(el('crm-detail-title')); el('crm-detail').appendChild(el('crm-detail-body'));
  el('o-paiements').appendChild(el('crm-refunds')); el('crm-refunds').appendChild(el('crm-refunds-body'));
  el('o-reservations').appendChild(el('p-inscrits'));
  const location = {hash};
  const entries = [{state:null,hash}], history = {index:0,scrollRestoration:'auto',
    get state() { return entries[this.index].state; },
    replaceState(state, _, nextHash) { entries[this.index]={state,hash:nextHash}; location.hash=nextHash; },
    pushState(state, _, nextHash) { entries.splice(++this.index); entries.push({state,hash:nextHash}); location.hash=nextHash; },
    back() { if (this.index) { this.index--; location.hash=entries[this.index].hash; callbacks.popstate(); } },
    forward() { if (this.index<entries.length-1) { this.index++; location.hash=entries[this.index].hash; callbacks.popstate(); } }
  };
  const ui={notices:[],toast(text){this.notices.push(text);},setPage(){},closeDialog(){const result=this.dialog; this.dialog=false; return !!result;}};
  const window={AVNuage:{configure:()=>false,
    sessionValide:async()=>{calls.push('session'); return {jeton:'test-only'};},
    requeteAuth:async()=>{calls.push('database'); throw new Error('Unexpected database access');}},AVCrmCore:{},AVCrmUI:ui,scrollY:0,
    addEventListener:(name,fn)=>callbacks[name]=fn, requestAnimationFrame:fn=>frames.push(fn), scrollTo:({top})=>window.scrollY=top};
  // Les parcours Stripe du harnais optent explicitement pour l'activation.
  // Passer {} reproduit la production, où ce flag n'est jamais défini.
  if (Object.hasOwn(deployment,'stripeActif')) { window.AV_CRM_STRIPE_ACTIF=deployment.stripeActif; }
  const fetch=async(_,options)=>{calls.push(JSON.parse(options.body).type); return {ok:true,text:async()=> 'ok relance;parent@example.test'};};
  const context = {window,document,location,history,Intl,Set,Map,AbortController,console,setTimeout,clearTimeout,fetch};
  vm.createContext(context);
  const source=fs.readFileSync(require.resolve('../assets/js/admin.js'),'utf8').replace("  if (!nuage.configure())", `
    window.testNavigation = {initialiserNavigation,ouvrirOnglet,ouvrirDetail,retourNavigation,
      routeDepuisHash,hashDeRoute,sauvegarderPosition,preparerRemboursement,
      stripe:{appelService,chargerResumeRemboursements,verifierStripe,rapprocherStripe,
        ouvrirRemboursements,chargerVueRemboursements,executerRemboursement},
      manual:{annulerDemande,retablirDemande},
      setPatch:function (patch) { patchDemande=patch; },
      setRefundRead:function (read) { lireRemboursements=read; },
      setup:function (realPlanning) {
        demandes=realPlanning ? [] : [{id:42,enfant:'Camille'}];
        core.scheduleKey=function (d) { return d.cours_date + '|' + d.cours_heure; };
        core.time=function (time) { return time; };
        carteDemande=function () { return elementFiche('tr',''); };
        lignePaiement=function () { return elementFiche('tr',''); };
        if (!realPlanning) { afficherPlanning=function () { var titre=elementFiche('h3','','Cours du samedi'); el('p-inscrits').innerHTML=''; el('p-inscrits').appendChild(titre); }; }
        chargerVueRemboursements=function (d) { dossierRemboursement=d; window.refundReads=(window.refundReads||0)+1; };
      },setPlanningData:function(liste) { demandes=liste; afficherPlanning(); },
      getNavigation:function(){return navigation;},getRefundVersion:function(){return versionRemboursement;}};
  if (!nuage.configure())`);
  vm.runInContext(source,context);
  const app=window.testNavigation; app.setup(realPlanning);
  const flush=()=>{while(frames.length) frames.shift()();};
  app.initialiserNavigation(); flush();
  return {app,window,document,history,location,el,ui,flush,Element,calls};
}

test('ouvrir un dossier puis Retour conserve la rubrique, la position et le bouton source',()=>{
  const {app,window,document,el,Element,location,flush}=application();
  const open=new Element('button'); open.setAttribute('data-record-open','demande:42'); el('o-demandes').appendChild(open);
  open.focus(); window.scrollY=684;
  app.ouvrirDetail('demande',42); flush();
  assert.equal(location.hash,'#demandes/demande/42'); assert.equal(window.scrollY,0);
  assert.equal(el('o-demandes').hidden,true); assert.equal(el('crm-detail').hidden,false);
  app.retourNavigation(); flush();
  assert.equal(location.hash,'#demandes'); assert.equal(window.scrollY,684);
  assert.equal(document.activeElement,open); assert.equal(el('crm-detail').hidden,true);
});

test('chaque rubrique retrouve sa position ; la sélectionner à nouveau remonte au début',()=>{
  const {app,window,history,location,flush}=application();
  window.scrollY=525; app.ouvrirOnglet('paiements'); flush(); assert.equal(window.scrollY,0);
  window.scrollY=240; app.ouvrirOnglet('demandes'); flush(); assert.equal(window.scrollY,525);
  app.ouvrirOnglet('demandes'); flush(); assert.equal(window.scrollY,0);
  history.back(); flush(); assert.equal(location.hash,'#paiements'); assert.equal(window.scrollY,240);
});

test('un remboursement ouvert depuis Demandes revient au dossier et invalide sa consultation en cours',()=>{
  const {app,el,window,location,history,flush}=application();
  const parent=el('crm-refunds').parentNode;
  app.ouvrirDetail('demande',42); flush(); window.scrollY=322;
  app.ouvrirDetail('remboursement',42); flush();
  const version=app.getRefundVersion();
  assert.equal(location.hash,'#demandes/remboursement/42'); assert.equal(window.refundReads,1);
  assert.equal(el('crm-refunds').parentNode,el('crm-detail-body'));
  history.back(); flush();
  assert.equal(location.hash,'#demandes/demande/42'); assert.equal(window.scrollY,322);
  assert.equal(el('crm-refunds').parentNode,parent); assert.equal(el('crm-refunds').hidden,true);
  assert.ok(app.getRefundVersion()>version);
  history.forward(); flush(); assert.equal(window.refundReads,2);
});

test('le planning ouvre ses inscrits en écran dédié puis restaure la grille',()=>{
  const {app,el,window,location,flush}=application('#reservations');
  window.scrollY=193; app.ouvrirDetail('cours','2026-09-19|10:00'); flush();
  assert.equal(location.hash,'#reservations/cours/2026-09-19%7C10%3A00');
  assert.equal(el('p-inscrits').parentNode,el('crm-detail-body')); assert.equal(window.scrollY,0);
  app.retourNavigation(); flush(); assert.equal(window.scrollY,193);
  assert.equal(el('p-inscrits').parentNode,el('o-reservations'));
});

test('recharger directement un cours attend les données puis retrouve ses inscrits et ses actions',()=>{
  const {app,el,flush}=application('#reservations/cours/2099-09-19%7C10%3A00',true);
  assert.equal(el('p-inscrits').querySelector('h3'),null);
  app.setPlanningData([{id:42,enfant:'Camille',type:'cours',statut:'validée',cours_date:'2099-09-19',cours_heure:'10:00'}]);
  flush();
  assert.match(el('p-inscrits').querySelector('h3').textContent,/19 septembre/);
  assert.ok(el('p-inscrits').querySelectorAll('button').some(button=>button.textContent==='Feuille de présence'));
  assert.equal(el('p-inscrits').parentNode,el('crm-detail-body'));
  app.retourNavigation(); flush(); assert.equal(el('p-inscrits').parentNode,el('o-reservations'));
});

test('recharger directement un stage retrouve la bonne semaine après le chargement initial',()=>{
  const stage='Stage découverte / été (du 13 au 18 juillet 2099)';
  const {app,el,flush}=application('#reservations/stage/'+encodeURIComponent(stage),true);
  app.setPlanningData([{id:43,enfant:'Léon',type:'stage',statut:'validée',detail:stage}]);
  flush();
  assert.equal(el('crm-detail-title').textContent,stage);
  assert.ok(el('p-inscrits').querySelectorAll('button').some(button=>button.textContent==='Feuille de présence de la semaine'));
  assert.equal(el('p-inscrits').parentNode,el('crm-detail-body'));
});

test('un lien direct offre un retour interne et ignore un identifiant mal encodé',()=>{
  const {app,location,history,flush}=application('#familles/famille/id%2Favec%20espace');
  assert.equal(app.getNavigation().detail.id,'id/avec espace');
  app.retourNavigation(); flush(); assert.equal(location.hash,'#familles'); assert.equal(history.index,0);
  assert.equal(app.routeDepuisHash('#demandes/demande/%E0%A4%A').detail,null);
  assert.equal(app.routeDepuisHash('#inconnu').onglet,'accueil');
});

test('Retour ferme d’abord le formulaire ; un changement de rubrique annule aussi le formulaire',()=>{
  const {app,ui,location,flush}=application();
  app.ouvrirDetail('demande',42); flush(); ui.dialog=true;
  app.retourNavigation(); flush(); assert.equal(location.hash,'#demandes/demande/42'); assert.equal(ui.dialog,false);
  ui.dialog=true; app.ouvrirOnglet('familles'); flush(); assert.equal(location.hash,'#familles'); assert.equal(ui.dialog,false);
});

test('des navigations rapprochées ne restaurent pas le focus d’un écran devenu invisible',()=>{
  const {app,document,el,flush}=application();
  app.ouvrirDetail('demande',42); app.ouvrirOnglet('familles'); flush();
  assert.equal(document.activeElement,el('crm-page-title')); assert.equal(el('crm-detail').hidden,true);
});

test('quitter un remboursement pendant la vérification n’ouvre pas de formulaire et ne lance aucune opération',async()=>{
  const {app,window,ui,flush}=application();
  let finishRead, forms=0;
  app.setRefundRead(()=>new Promise(resolve=>finishRead=resolve));
  window.AVCrmCore.refundRecovery=()=>({});
  ui.form=async()=>{forms++; return null;};
  app.ouvrirDetail('remboursement',42); flush();
  const pending=app.preparerRemboursement({id:42},'cs_42');
  app.ouvrirOnglet('familles'); flush();
  finishRead({remboursements_actifs:true,paiements:[{session_id:'cs_42',disponible_centimes:2500}]});
  await pending;
  assert.equal(forms,0); assert.deepEqual(ui.notices,[]);
});

test('production : Stripe absent ou désactivé interdit tout appel réseau et formulaire financier',async()=>{
  for (const deployment of [{},{stripeActif:false},{stripeActif:'true'}]) {
    const {app,calls,el,location,ui}=application('#demandes',false,deployment);
    let forms=0;
    ui.form=async()=>{forms++; return null;};
    await app.stripe.chargerResumeRemboursements(0);
    await app.stripe.verifierStripe();
    app.stripe.rapprocherStripe({paiements:[{statut:'propose',session_id:'cs_test',demande_id:42}]});
    await app.stripe.chargerVueRemboursements({id:42});
    await app.preparerRemboursement({id:42},'cs_test');
    await app.stripe.executerRemboursement({id:42},{session_id:'cs_test'},{operation_id:'test'},false);
    for (const type of ['stripe','stripe-rapprocher','stripe-remboursements','stripe-rembourser']) {
      await assert.rejects(app.stripe.appelService({type},true),/en attente d’activation/);
    }
    app.stripe.ouvrirRemboursements({id:42});
    app.ouvrirDetail('remboursement',42);
    assert.equal(location.hash,'#demandes');
    assert.equal(el('b-stripe').disabled,true);
    assert.match(el('crm-stripe-description').textContent,/en attente d’activation/);
    assert.deepEqual(calls,[]);
    assert.equal(forms,0);
  }
});

test('production : un ancien lien de remboursement revient à sa rubrique sans consultation Stripe',()=>{
  const {app,calls,location,el}=application('#paiements/remboursement/42',false,{});
  assert.equal(location.hash,'#paiements');
  assert.equal(app.getNavigation().detail,null);
  assert.equal(el('crm-detail').hidden,true);
  assert.deepEqual(calls,[]);
});

test('le verrou Stripe conserve les appels de messagerie et l’activation explicite des essais',async()=>{
  const production=application('#demandes',false,{});
  assert.equal(await production.app.stripe.appelService({type:'relance'},false),'ok relance;parent@example.test');
  assert.deepEqual(production.calls,['session','relance']);
  const preview=application('#demandes',false,{stripeActif:true});
  assert.equal(preview.el('b-stripe').disabled,false);
  assert.match(preview.el('b-stripe').textContent,/Vérifier les paiements/);
  assert.ok(preview.app.routeDepuisHash('#paiements/remboursement/42').detail);
  await preview.app.stripe.appelService({type:'stripe'},false);
  assert.deepEqual(preview.calls,['session','stripe']);
});

test('sans Stripe, annuler reste une déclaration vérifiée et un remboursement déclaré empêche le rétablissement',async()=>{
  const {app,window,ui,calls}=application('#demandes',false,{});
  Object.assign(window.AVCrmCore,require('../assets/js/admin-core.js'));
  const patches=[],forms=[],confirmations=[];
  app.setPatch(async(_,patch)=>{patches.push(patch); return true;});
  ui.form=async options=>{forms.push(options); return {montant:'10'};};
  ui.confirm=async options=>{confirmations.push(options.description); return true;};
  const dossier={id:42,enfant:'Camille',type:'cours',tarif:'25 €',paye:true,paye_montant:'25 €',statut:'validée'};
  await app.manual.annulerDemande(dossier);
  assert.equal(patches[0].annule,true);
  assert.equal(patches[0].rembourse_montant,'10 €');
  assert.equal(forms[0].fields[0].max,25);
  assert.match(forms[0].description,/Stripe n’est pas synchronisé/);
  assert.doesNotMatch(forms[0].description,/depuis « Remboursements Stripe »/);
  await app.manual.retablirDemande({...dossier,annule:true,rembourse_montant:'10 €'});
  assert.equal(patches.length,1);
  assert.match(ui.notices.at(-1),/remboursement est déclaré/);
  await app.manual.retablirDemande({...dossier,annule:true,rembourse_montant:'0 €'});
  assert.equal(patches[1].annule,false);
  assert.match(confirmations[0],/Vérifiez qu’aucun remboursement bancaire n’a été effectué/);
  assert.deepEqual(calls,[]);
});
