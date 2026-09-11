/* Simulation locale de Stripe : aucune clé et aucun appel réseau externe. */
'use strict';

module.exports = function refundFixture(requests, id) {
  const stamp = () => new Date().toISOString();
  const payments = [
    {demande_id:id(11),session_id:'cs_fixture_gabriel',nature:'acompte',montant_centimes:30000},
    {demande_id:id(13),session_id:'cs_fixture_arthur',nature:'total',montant_centimes:2500},
    {demande_id:id(15),session_id:'cs_fixture_leon_acompte',nature:'acompte',montant_centimes:30000},
    {demande_id:id(15),session_id:'cs_fixture_leon_solde',nature:'solde',montant_centimes:54000},
    {demande_id:id(17),session_id:'cs_fixture_malo',nature:'total',montant_centimes:2500}
  ].map(p=>({...p,payment_intent_id:'pi_'+p.session_id.slice(3),conteste:false,remboursements:[]}));
  payments[2].remboursements.push({id:'re_fixture_externe',montant_centimes:5000,statut:'succeeded',cree_le:stamp(),motif:'requested_by_customer'});
  payments[3].remboursements.push({id:'re_fixture_attente',montant_centimes:2000,statut:'pending',cree_le:stamp(),motif:'requested_by_customer'});
  payments[4].remboursements.push({id:'re_fixture_malo',montant_centimes:2500,statut:'succeeded',cree_le:stamp(),motif:'requested_by_customer'});
  const operations = new Map();
  let sequence = 0, mode = {statut:'succeeded',timeout:false};
  const error = (code,message,status=200) => ({status,data:{ok:false,code,message}});

  function current(p) {
    const refunds = p.remboursements;
    const succeeded = refunds.filter(r=>r.statut==='succeeded').reduce((n,r)=>n+r.montant_centimes,0);
    const pending = refunds.filter(r=>['pending','requires_action'].includes(r.statut)).reduce((n,r)=>n+r.montant_centimes,0);
    return {...p,rembourse_centimes:succeeded,en_attente_centimes:pending,
      disponible_centimes:p.conteste || pending ? 0 : p.montant_centimes-succeeded,
      verifie_le:stamp(),operation_en_cours:null};
  }
  function dossier(demandeId) {
    if (requests.find(d=>d.id===id(12))?.paye && !payments.some(p=>p.session_id==='cs_fixture_1')) {
      payments.push({demande_id:id(12),session_id:'cs_fixture_1',nature:'total',montant_centimes:2500,
        payment_intent_id:'pi_fixture_1',conteste:false,remboursements:[]});
    }
    const items = payments.filter(p=>p.demande_id===demandeId).map(current);
    return {ok:true,version:24,remboursements_actifs:true,paiements:items,
      resume:{rembourse_centimes:items.reduce((n,p)=>n+p.rembourse_centimes,0),en_attente_centimes:items.reduce((n,p)=>n+p.en_attente_centimes,0)}};
  }
  return {
    dossier,
    etats: () => payments.map(current),
    operations: () => Array.from(operations.values()).map(op=>({...op,statut:op.remboursement.statut,cree_le:op.remboursement.cree_le})),
    configure(url) {
      const status = url.searchParams.get('statut');
      if (['succeeded','pending','failed','requires_action','canceled'].includes(status)) mode.statut=status;
      mode.timeout=url.searchParams.get('timeout')==='1';
      return {...mode};
    },
    handle(data) {
      if (!requests.some(d=>d.id===data.demande_id)) return error('demande_introuvable','Dossier fictif introuvable.');
      if (data.type==='stripe-remboursements') return {status:200,data:dossier(data.demande_id)};
      if (!/^[0-9a-f-]{36}$/i.test(data.operation_id || '')) return error('operation_invalide','Identifiant de remboursement manquant.');
      const previous=operations.get(data.operation_id);
      if (previous) {
        if (['demande_id','session_id','montant_centimes','motif'].some(k=>previous[k]!==data[k])) return error('operation_incompatible','Cette opération possède déjà un autre montant ou paiement.');
        return {status:200,data:{...dossier(data.demande_id),operation_id:data.operation_id,remboursement:previous.remboursement}};
      }
      const p=payments.find(p=>p.session_id===data.session_id && p.demande_id===data.demande_id);
      if (!p) return error('paiement_introuvable','Aucun règlement Stripe associé à ce dossier.');
      if (!Number.isSafeInteger(data.montant_centimes) || data.montant_centimes<=0 || data.montant_centimes>current(p).disponible_centimes) return error('montant_invalide','Le montant dépasse le disponible de ce paiement.');
      if (!['requested_by_customer','duplicate','fraudulent'].includes(data.motif)) return error('motif_invalide','Choisissez un motif.');
      const refund={id:'re_fixture_'+(++sequence),montant_centimes:data.montant_centimes,statut:mode.statut,
        cree_le:stamp(),motif:data.motif,operation_id:data.operation_id};
      p.remboursements.push(refund);
      operations.set(data.operation_id,{...data,remboursement:refund});
      if (mode.timeout) { mode.timeout=false; return error('service_indisponible','Réponse interrompue après création du remboursement fictif. Actualisez son historique.',504); }
      return {status:200,data:{...dossier(data.demande_id),operation_id:data.operation_id,remboursement:refund}};
    }
  };
};
