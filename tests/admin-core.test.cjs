const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/js/admin-core.js');

test('montants français, centimes et valeur négative restent explicites', () => {
  assert.equal(core.money('1 250,50 €'), 1250.5);
  assert.equal(core.money('1\u202f250,50 € / trimestre'), 1250.5);
  assert.equal(core.money('-30 €'), -30);
  assert.equal(core.money('inconnu'), 0);
});
test('acompte et solde de stage sont ventilés dans leurs mois respectifs', () => {
  const d = {type:'stage',tarif:'840 €',statut:'validée',acompte_paye:true,acompte_le:'2026-08-20',solde_paye:true,solde_le:'2026-09-11'};
  assert.equal(core.receivedInMonth(d,'2026-08'),300);
  assert.equal(core.receivedInMonth(d,'2026-09'),540);
  assert.equal(core.paid(d),840);
  assert.equal(core.due(d),0);
  assert.equal(core.due({...d,solde_paye:false}),540);
  assert.equal(core.due({...d,solde_paye:false,annule:true}),0);
});
test('un stage au tarif réduit ne compte pas un acompte supérieur à son tarif', () => {
  assert.equal(core.paid({type:'stage',tarif:'250 €',acompte_paye:true}),250);
});

test('modifier un tarif ne doit pas inventer un encaissement ni descendre sous le reçu', () => {
  const stage = {type:'stage',tarif:'840 €',acompte_paye:true,solde_paye:true};
  assert.match(core.validateTariff(stage,'1000 €'),/modifierait un encaissement/);
  assert.match(core.validateTariff(stage,800),/inférieur/);
  assert.equal(core.validateTariff(stage,'840,00 €'),'');
  const acompte = {...stage,solde_paye:false};
  assert.equal(core.validateTariff(acompte,1000),'');
  assert.match(core.validateTariff(acompte,250),/inférieur/);
  const ancienCours = {type:'cours',tarif:'25 €',paye:true};
  assert.match(core.validateTariff(ancienCours,30),/modifierait un encaissement/);
  assert.equal(core.validateTariff({...ancienCours,paye_montant:'25 €'},30),'');
  assert.equal(core.validateTariff({...ancienCours,paye:false},30),'');
  assert.match(core.validateTariff(ancienCours,'invalide'),/supérieur à zéro/);
});

test('solder un stage conserve les dates des versements déjà enregistrés', () => {
  const stage = {type:'stage',tarif:'840 €',statut:'validée',acompte_paye:true,acompte_le:'2026-08-20',solde_paye:false,paye:false};
  const patch = core.totalPaymentPatch(stage,'2026-09-11');
  assert.equal(patch.acompte_le,'2026-08-20');
  assert.equal(patch.solde_le,'2026-09-11');
  assert.equal(patch.paye_le,'2026-09-11');
  const regle = {...stage,...patch};
  assert.equal(core.receivedInMonth(regle,'2026-08'),300);
  assert.equal(core.receivedInMonth(regle,'2026-09'),540);
  assert.equal(core.paid(regle),840);
  assert.equal(core.due(regle),0);
  assert.equal(stage.solde_paye,false);
  assert.equal(core.totalPaymentPatch(regle,'2026-10-01').solde_le,'2026-09-11');
  assert.equal(core.totalPaymentPatch(regle,'2026-10-01').paye_le,'2026-09-11');
  assert.equal(core.totalPaymentPatch({...stage,acompte_le:null},'2026-09-11').acompte_le,null);
});

test('rétablir un dossier remboursé est bloqué sans effacer son historique', () => {
  const annule = {annule:true,rembourse_montant:'840 €'};
  assert.match(core.restoreError(annule),/nouvelle demande/);
  assert.equal(annule.rembourse_montant,'840 €');
  assert.equal(core.restoreError({...annule,rembourse_montant:'0 €'}),'');
  assert.equal(core.restoreError({...annule,rembourse_montant:null}),'');
  assert.match(core.restoreError({...annule,rembourse_montant:'0,01 €'}),/remboursement/);
});

test('les encaissés bruts restent dans leur mois après annulation avec ou sans remboursement', () => {
  const stage = {type:'stage',tarif:'840 €',statut:'validée',annule:true,acompte_paye:true,acompte_le:'2026-08-20',solde_paye:true,solde_le:'2026-09-11'};
  const cours = {type:'cours',tarif:'25 €',statut:'validée',annule:true,paye:true,paye_montant:'25 €',paye_le:'2026-09-11'};
  for (const remboursement of [null,'0 €','840 €']) {
    assert.equal(core.receivedInMonth({...stage,rembourse_montant:remboursement},'2026-08'),300);
    assert.equal(core.receivedInMonth({...stage,rembourse_montant:remboursement},'2026-09'),540);
    assert.equal(core.due({...stage,rembourse_montant:remboursement}),0);
  }
  for (const remboursement of [null,'0 €','25 €']) {
    assert.equal(core.receivedInMonth({...cours,rembourse_montant:remboursement},'2026-09'),25);
    assert.equal(core.due({...cours,rembourse_montant:remboursement}),0);
  }
});
test('recherche multiterme sans accents et suivi actif sans modifier la liste source', () => {
  const rows=[{id:'1',enfant:'Éloïse Martin',type:'cours',statut:'validée',tarif:'25 €',cree:'2026-08-01'},
    {id:'2',enfant:'Éloïse Martin',type:'stage',statut:'validée',tarif:'840 €',cree:'2026-09-01'},
    {id:'3',enfant:'Éloïse Martin',type:'cours',statut:'validée',annule:true,cree:'2026-09-02'}];
  assert.deepEqual(core.filterRequests(rows,{query:'martin eloise',type:'cours',followup:'a-appeler'}).map(d=>d.id),['1']);
  assert.deepEqual(rows.map(d=>d.id),['1','2','3']);
});
test('un créneau est identifié par sa date ET son heure normalisée', () => {
  assert.equal(core.scheduleKey({cours_date:'2026-09-12',cours_heure:'10h00'}),core.scheduleKey({cours_date:'2026-09-12',cours_heure:'10:00'}));
  assert.notEqual(core.scheduleKey({cours_date:'2026-09-12',cours_heure:'10h'}),core.scheduleKey({cours_date:'2026-09-12',cours_heure:'14h'}));
  assert.equal(core.validateSchedule('2026-09-12','10:00','2026-09-11'),'');
  assert.match(core.validateSchedule('2026-09-11','10:00','2026-09-11'),/samedi/);
  assert.match(core.validateSchedule('2026-02-31','10:00','2026-01-01'),/existe/);
  assert.match(core.validateSchedule('2026-09-12','25:00','2026-09-11'),/heure/);
});
function response(data,count){return {ok:true,headers:{get:()=>count===undefined?null:'0-0/'+count},json:async()=>data};}
test('pagination traverse une limite serveur inférieure à la taille demandée', async () => {
  let calls=[];
  const rows=await core.loadAll(async path=>{calls.push(path);const offset=Number(path.match(/offset=(\d+)/)[1]);return response(Array.from({length:Math.min(2,5-offset)},(_,i)=>({id:offset+i})),5);},'/rest/v1/demandes?order=cree.desc,id.desc','id');
  assert.equal(rows.length,5);
  assert.deepEqual(calls.map(p=>Number(p.match(/offset=(\d+)/)[1])),[0,2,4]);
});
test('sans total exposé, seule une page vide termine le chargement', async () => {
  let count=0;const rows=await core.loadAll(async()=>response(count++<2?[{id:count}]:[]),'/data','id');
  assert.equal(count,3);assert.equal(rows.length,2);
});
test('erreur d’une page, doublon ou changement de total ne donnent jamais de faux succès partiel', async () => {
  let calls=0;
  await assert.rejects(core.loadAll(async()=>++calls===1?response([{id:1}],2):{ok:false,status:500},'/data','id'),/interrompu/);
  await assert.rejects(core.loadAll(async()=>response([{id:1}],2),'/data','id'),/changé/);
  calls=0;await assert.rejects(core.loadAll(async()=>response([{id:++calls}],calls===1?2:3),'/data','id'),/changé/);
});
