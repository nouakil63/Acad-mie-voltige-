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
      manual:{annulerDemande,retablirDemande,ajouterDemande,ajouterInscritCours,ajouterInscritStage,
        modifierDemande,dossierDepuisLignes,identiteFiche},
      setPatch:function (patch) { patchDemande=patch; },
      setRefresh:function (refresh) { rafraichirAffichage=refresh; },
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

// Les mutations restent les vraies fonctions du contrôleur : seule la réponse
// Supabase et le rendu global sont simulés, sans accès à une base ni aux mails.
function manualApplication(seed) {
  const harness=application('#demandes',false,{});
  const requests=[], forms=[];
  Object.assign(harness.window.AVCrmCore,require('../assets/js/admin-core.js'));
  harness.app.setRefresh(()=>{});
  harness.window.AVNuage.requeteAuth=async(path,options)=>{
    const body=JSON.parse(options.body);
    requests.push({path,method:options.method,body});
    return {ok:true,json:async()=>[{id:71,...seed,...body}]};
  };
  harness.ui.confirm=async()=>false;
  function answer(values) {
    harness.ui.form=async options=>{
      forms.push(options);
      assert.equal(options.validate(values),'');
      return values;
    };
  }
  return {...harness,requests,forms,answer};
}
const manualValues={type:'cours',enfant:'Camille Martin',age:'10',parent_nom:'Alex Martin',parent_email:'',detail:'Cours à l’unité',tarif:'25',statut:'en attente'};

test('ajouter un cours conserve l’âge dans le dossier enregistré et imprimable sans inventer une naissance',async()=>{
  const {app,requests,forms,answer,location,calls}=manualApplication();
  answer({...manualValues});
  await app.manual.ajouterDemande();
  assert.equal(requests.length,1);
  const request=requests[0];
  assert.equal(request.method,'POST');
  assert.equal(request.path,'/rest/v1/demandes');
  assert.equal(request.body.lignes,'Ajoutée à la main depuis l’espace académie.\nÂge : 10 ans');
  assert.equal(request.body.detail,manualValues.detail);
  assert.equal(request.body.enfant,manualValues.enfant);
  assert.equal(Object.hasOwn(request.body,'age'),false);
  assert.equal(Object.hasOwn(request.body,'enfantNaissance'),false);
  assert.equal(forms[0].fields.find(field=>field.name==='age').required,undefined);
  const print=app.manual.dossierDepuisLignes(request.body);
  assert.equal(print.enfantAge,'10');
  assert.equal(print.enfantNaissance,'');
  const identity=app.manual.identiteFiche(request.body,false,true);
  assert.ok(identity.querySelectorAll('.crm-record-meta').some(node=>node.textContent==='10 ans à l’inscription'));
  assert.equal(location.hash,'#demandes/demande/71');
  assert.deepEqual(calls,[]);
});

test('un stage ajouté depuis Demandes ou son planning conserve le même âge et la semaine choisie',async()=>{
  const stage='Stage découverte (du 13 au 18 juillet 2099)';
  for (const fromPlanning of [false,true]) {
    const {app,requests,forms,answer,calls}=manualApplication();
    answer({...manualValues,type:'stage',age:'12',detail:stage,tarif:'840'});
    if (fromPlanning) { await app.manual.ajouterInscritStage(stage); }
    else { await app.manual.ajouterDemande(); }
    assert.equal(requests.length,1);
    assert.equal(requests[0].body.type,'stage');
    assert.equal(requests[0].body.detail,stage);
    assert.match(requests[0].body.lignes,/^Âge : 12 ans$/m);
    if (fromPlanning) {
      assert.equal(forms[0].fields.find(field=>field.name==='type').value,'stage');
      assert.equal(forms[0].fields.find(field=>field.name==='detail').value,stage);
    }
    assert.deepEqual(calls,[]);
  }
});

test('ajouter au planning enregistre aussi l’âge tout en conservant le créneau et la validation',async()=>{
  const {app,requests,forms,answer,calls}=manualApplication();
  const saturday=new Date('2099-09-01T12:00:00');
  saturday.setDate(saturday.getDate()+(6-saturday.getDay()+7)%7);
  const date=saturday.toISOString().slice(0,10);
  answer({enfant:'Camille Martin',age:'8',email:'',heure:'10:00'});
  await app.manual.ajouterInscritCours(date,'10:00');
  assert.equal(requests.length,1);
  assert.match(requests[0].body.lignes,/^Âge : 8 ans$/m);
  assert.equal(requests[0].body.cours_date,date);
  assert.equal(requests[0].body.cours_heure,'10:00');
  assert.equal(requests[0].body.statut,'validée');
  assert.ok(requests[0].body.decide);
  assert.equal(forms[0].fields.find(field=>field.name==='age').type,'number');
  assert.deepEqual(calls,[]);
});

test('corriger un âge préremplit sa valeur et préserve la naissance et toutes les autres lignes du dossier',async()=>{
  const otherLines='Voltigeur : Camille Martin\r\nDate de naissance : 2016-02-29\r\nTéléphone : 0102030405\r\nSanté / remarques : Rien à signaler\r\n';
  const dossier={id:71,...manualValues,lignes:otherLines+'Âge : 9 ans\r\nSigné en ligne : 2026-09-15'};
  const {app,requests,forms,answer}=manualApplication(dossier);
  answer({...manualValues,age:'10'});
  await app.manual.modifierDemande(dossier);
  assert.equal(forms[0].fields.find(field=>field.name==='age').value,'9');
  assert.equal(requests[0].method,'PATCH');
  assert.equal(requests[0].path,'/rest/v1/demandes?id=eq.71');
  const expected=otherLines+'Signé en ligne : 2026-09-15\nÂge : 10 ans';
  assert.equal(requests[0].body.lignes,expected);
  assert.equal(dossier.lignes,expected);
  const print=app.manual.dossierDepuisLignes(dossier);
  assert.equal(print.enfantAge,'10');
  assert.equal(print.enfantNaissance,'2016-02-29');
  assert.equal(print.parentTel,'0102030405');
  assert.equal(print.signeLe,'2026-09-15');
});

test('modifier sans changer l’âge évite de réécrire le dossier ; l’effacer conserve les autres informations',async()=>{
  const original='Texte libre historique\r\nDate de naissance : 2016-02-29\r\nÂge : 10 ans\r\nSanté / remarques : —';
  const dossier={id:71,...manualValues,lignes:original};
  const {app,requests,answer}=manualApplication(dossier);
  answer({...manualValues,age:'010',parent_nom:'Alex Modifié'});
  await app.manual.modifierDemande(dossier);
  assert.equal(Object.hasOwn(requests[0].body,'lignes'),false);
  assert.equal(dossier.lignes,original);
  answer({...manualValues,age:''});
  await app.manual.modifierDemande(dossier);
  assert.equal(requests[1].body.lignes,'Texte libre historique\r\nDate de naissance : 2016-02-29\r\nSanté / remarques : —');
  assert.equal(app.manual.dossierDepuisLignes(dossier).enfantAge,'');
  assert.equal(app.manual.dossierDepuisLignes(dossier).enfantNaissance,'2016-02-29');
});

test('l’âge reste facultatif, y compris pour une ancienne demande sans date de naissance',async()=>{
  const {app,requests,answer}=manualApplication();
  answer({...manualValues,age:''});
  await app.manual.ajouterDemande();
  assert.equal(requests[0].body.lignes,'Ajoutée à la main depuis l’espace académie.');
  const dossier={id:71,...manualValues,lignes:'Ancienne inscription prise par téléphone.'};
  answer({...manualValues,age:'0'});
  await app.manual.modifierDemande(dossier);
  assert.equal(requests[1].body.lignes,'Ancienne inscription prise par téléphone.\nÂge : 0 an');
  assert.equal(app.manual.dossierDepuisLignes(dossier).enfantAge,'0');
});

test('tous les formulaires contrôlent les âges entiers et gardent les validations de tarif et de créneau',async()=>{
  const {app,ui,requests}=manualApplication();
  const forms=[];
  ui.form=async options=>{forms.push(options);return null;};
  await app.manual.ajouterDemande();
  await app.manual.ajouterInscritStage('Stage — semaine test');
  await app.manual.modifierDemande({id:71,...manualValues,tarif:'25 €',paye:true,paye_montant:'25 €'});
  const saturday=new Date('2099-09-01T12:00:00');
  saturday.setDate(saturday.getDate()+(6-saturday.getDay()+7)%7);
  await app.manual.ajouterInscritCours(saturday.toISOString().slice(0,10),'10:00');
  for (const form of forms) {
    for (const age of ['',undefined,'0','1','10','120']) {
      assert.equal(form.validate({...manualValues,age,heure:'10:00'}),'');
    }
    for (const age of ['-1','121','10.5','dix','Infinity']) {
      assert.match(form.validate({...manualValues,age,heure:'10:00'}),/âge entier entre 0 et 120/);
    }
  }
  assert.match(forms[2].validate({...manualValues,age:'10',tarif:'20'}),/inférieur/);
  assert.match(forms[3].validate({...manualValues,age:'10',heure:'25:00'}),/heure/);
  assert.deepEqual(requests,[]);
});
