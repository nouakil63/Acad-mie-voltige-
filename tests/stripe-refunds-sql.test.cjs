'use strict';

// PostgreSQL réel local (PGlite 0.5.8), sans compte Stripe/Supabase ni réseau.
// node --test tests/stripe-refunds-sql.test.cjs
// Même résolution PGLITE_MODULE_PATH / AV_SQL_TEST_TOOLS que sql.test.cjs.
// Une connexion PGlite : atomicité et verrous exécutés, pas de course multisession.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
let modulePath = process.env.PGLITE_MODULE_PATH;
if (!modulePath) {
  try { modulePath = require.resolve('@electric-sql/pglite'); }
  catch (_) { modulePath = path.join(process.env.AV_SQL_TEST_TOOLS || path.resolve(__dirname, '../../tmp/academie-crm-test-tools'), 'node_modules/@electric-sql/pglite'); }
}
const { PGlite } = require(modulePath);
const sql = name => fs.readFileSync(path.join(__dirname, '../service/migrations', name), 'utf8');
const migration = () => sql('20260912_remboursements_stripe.sql');
const baseline = `
create role anon noinherit;
create role authenticated noinherit;
create role service_role noinherit bypassrls;
create schema auth;
grant usage on schema public,auth to anon,authenticated,service_role;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create table admins(email text primary key);
alter table admins enable row level security;
create policy admin_self on admins for select using(email=auth.jwt()->>'email');
grant select on admins to authenticated;
insert into admins values('admin@example.test');
create table demandes(
 id uuid primary key default gen_random_uuid(),cree timestamptz default now()-interval '3 days',
 type text default 'cours',enfant text default 'Enfant test',parent_email text default 'parent@example.test',tarif text default '25 €',
 statut text default 'validée',decide timestamptz,paye boolean default false,paye_le date,paye_montant text,
 acompte_paye boolean default false,acompte_le date,solde_paye boolean default false,solde_le date,
 annule boolean default false,annule_le date,rembourse_montant text
);
alter table demandes enable row level security;
create policy admin_demandes on demandes for all using(exists(select 1 from admins where email=auth.jwt()->>'email'));
grant all on demandes to authenticated,service_role;
`;
async function as(db, role, email, fn) {
  return db.transaction(async tx => {
    await tx.exec('set local role ' + role);
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, email })]);
    return fn(tx);
  });
}
const service = (db, fn) => as(db, 'service_role', 'service@example.test', fn);
const admin = (db, fn) => as(db, 'authenticated', 'admin@example.test', fn);
const parent = (db, fn) => as(db, 'authenticated', 'parent@example.test', fn);
const anon = (db, fn) => as(db, 'anon', '', fn);
async function rpc(db, name, params) {
  return service(db, async tx => (await tx.query(`select ${name}(${params.map((_, i) => '$' + (i + 1)).join(',')}) as result`, params)).rows[0].result);
}
const snap = (db, f, data) => rpc(db, 'crm_enregistrer_snapshot_stripe', [f.session, JSON.stringify(data)]);
const reserve = (db, f, amount = 1000, operation = randomUUID(), reason = 'requested_by_customer') =>
  rpc(db, 'crm_reserver_remboursement_stripe', [operation, f.demande, f.session, amount, reason, 'admin@example.test']);
const finish = (db, op, refund) => rpc(db, 'crm_terminer_remboursement_stripe', [op, JSON.stringify(refund)]);
let serial = 0;
// Horloges strictement ordonnées sans délai de test, maximum quelques ms en avance.
let time = Date.now();
const stamp = () => new Date(time = Math.max(Date.now(), time + 1)).toISOString();
function snapshot(f, refunds = [], extra = {}) {
  return { payment_intent_id: f.pi, charge_id: f.charge, devise: 'eur', livemode: true,
    montant_centimes: 2500, rembourse_centimes: refunds.filter(r => r.statut === 'succeeded').reduce((n, r) => n + r.montant_centimes, 0),
    en_attente_centimes: refunds.filter(r => ['pending', 'requires_action'].includes(r.statut)).reduce((n, r) => n + r.montant_centimes, 0),
    conteste: false, verifie_le: stamp(), remboursements: refunds, ...extra };
}
function refund(f, amount = 1000, status = 'succeeded', operation, extra = {}) {
  return { id: 're_test_' + ++serial, montant_centimes: amount, statut: status,
    cree_le: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(), motif: 'requested_by_customer',
    payment_intent_id: f.pi, charge_id: f.charge, ...(operation ? { operation_id: operation } : {}), ...extra };
}
async function fixture(db, options = {}) {
  const n = ++serial;
  const f = { session: 'cs_test_' + n, pi: 'pi_test_' + n, charge: 'ch_test_' + n };
  f.demande = (await db.query("insert into demandes(paye,paye_montant,annule,rembourse_montant) values(true,'25',true,'5') returning id")).rows[0].id;
  // Affectation existante avant v24 : l'installation ne doit pas modifier l'historique.
  await db.query(`insert into crm_paiements_stripe(session_id,email,montant_centimes,devise,recu_le,demande_id,nature,rapproche_le)
    values($1,'parent@example.test',2500,'eur',now()-interval '1 day',$2,$3,$4)`,
  [f.session, options.unassigned ? null : f.demande, options.unassigned ? null : 'total', options.unassigned ? null : new Date().toISOString()]);
  if (!options.noSnapshot) await snap(db, f, snapshot(f));
  return f;
}
const denies = (promise, message) => assert.rejects(promise, e => message ? e.message.includes(message) : e.code === '42501');

test('Stripe remboursements : PostgreSQL local, droits, état et réservations durables', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(baseline);
  await db.exec(sql('20260911_paiements_crm.sql'));
  await db.exec(migration());
  await t.test('RLS admin lecture seule, parents/anon sans données, RPC service seulement', async () => {
    const f = await fixture(db);
    const op = await reserve(db, f);
    await finish(db, op.operation.operation_id, { ...refund(f, 1000, 'succeeded', op.operation.operation_id), verifie_le: stamp() });
    for (const table of ['crm_etats_stripe', 'crm_operations_remboursement_stripe', 'crm_remboursements_stripe']) {
      assert.equal((await parent(db, tx => tx.query('select * from ' + table))).rows.length, 0);
      assert.ok((await admin(db, tx => tx.query('select * from ' + table))).rows.length > 0);
      await denies(anon(db, tx => tx.query('select * from ' + table)));
      for (const role of [admin, parent, service]) {
        await denies(role(db, tx => tx.query('delete from ' + table)));
        await denies(role(db, tx => tx.query('update ' + table + ' set session_id=session_id')));
        await denies(role(db, tx => tx.query('insert into ' + table + ' select * from ' + table + ' limit 1')));
      }
    }
    for (const role of [admin, parent, anon]) {
      await denies(role(db, tx => tx.query('select crm_enregistrer_snapshot_stripe($1,$2)', [f.session, snapshot(f)])));
      await denies(role(db, tx => tx.query('select crm_reserver_remboursement_stripe($1,$2,$3,1,$4)', [randomUUID(), f.demande, f.session, 'duplicate'])));
      await denies(role(db, tx => tx.query('select crm_terminer_remboursement_stripe($1,$2)', [op.operation.operation_id, { statut: 'incertain' }])));
    }
    await denies(service(db, tx => tx.query('select crm_resume_remboursements_stripe($1)', [f.session])));
  });
  await t.test('snapshot pré-rapprochement permis ; remboursement demande non liée interdit', async () => {
    const f = await fixture(db, { unassigned: true });
    await denies(reserve(db, f), 'paiement_non_affecte_demande');
    assert.equal((await db.query('select demande_id from crm_etats_stripe where session_id=$1', [f.session])).rows[0].demande_id, null);
    const other = await fixture(db);
    await denies(reserve(db, { ...other, demande: f.demande }), 'paiement_non_affecte_demande');
  });
  await t.test('PaymentIntent et Charge ne peuvent donner un second plafond via autre session', async () => {
    const a = await fixture(db), b = await fixture(db, { noSnapshot: true });
    await assert.rejects(snap(db, b, snapshot(b, [], { payment_intent_id: a.pi })), e => e.code === '23505');
    await assert.rejects(snap(db, b, snapshot(b, [], { charge_id: a.charge })), e => e.code === '23505');
    assert.equal((await db.query('select * from crm_etats_stripe where session_id=$1', [b.session])).rows.length, 0);
  });
  await t.test('snapshot périmé, ordre ambigu, mauvaise devise/live/identité ou montant rejetés', async () => {
    const f = await fixture(db), s = snapshot(f);
    await snap(db, f, s);
    assert.equal((await snap(db, f, s)).ok, true);
    await denies(snap(db, f, { ...s, conteste: true }), 'snapshot_ordre_ambigu');
    await denies(snap(db, f, { ...s, verifie_le: '2025-01-01' }), 'snapshot_perime');
    await denies(snap(db, f, snapshot(f, [], { payment_intent_id: 'pi_changed' })), 'identite_paiement_modifiee');
    for (const patch of [{ devise: 'usd' }, { livemode: false }, { montant_centimes: 3000 }, { conteste: null }, { remboursements: null }, { verifie_le: 'infinity' }, { verifie_le: new Date(Date.now() + 120000).toISOString() }]) {
      await assert.rejects(snap(db, f, snapshot(f, [], patch)));
    }
    assert.equal((await db.query('select verifie_le from crm_etats_stripe where session_id=$1', [f.session])).rows[0].verifie_le.toISOString(), s.verifie_le);
  });
  await t.test('statuts inconnus, sommes incohérentes et liste tronquée refusés atomiquement', async () => {
    const f = await fixture(db), r = refund(f, 500);
    await denies(snap(db, f, snapshot(f, [{ ...r, statut: 'unknown' }])), 'remboursement_invalide');
    await denies(snap(db, f, snapshot(f, [r, r])), 'remboursement_invalide');
    await denies(snap(db, f, snapshot(f, [r], { rembourse_centimes: 0 })), 'snapshot_totaux_incoherents');
    assert.equal((await db.query('select * from crm_remboursements_stripe where session_id=$1', [f.session])).rows.length, 0);
    await snap(db, f, snapshot(f, [r]));
    await denies(snap(db, f, snapshot(f)), 'snapshot_remboursements_incomplet');
    await denies(snap(db, f, snapshot(f, [{ ...r, montant_centimes: 600 }])), 'remboursement_identite_modifiee');
    const after = await snap(db, f, snapshot(f, [r]));
    assert.equal(after.etat.rembourse_centimes, 500);
  });
  await t.test('réservation persistante, même UUID idempotent, second onglet et sur-remboursement bloqués', async () => {
    const f = await fixture(db), id = randomUUID();
    const first = await reserve(db, f, 2000, id);
    assert.equal(first.execution_autorisee, true); assert.equal(first.disponible_centimes, 500);
    const replay = await reserve(db, f, 2000, id);
    assert.equal(replay.reprise, true); assert.equal(replay.execution_autorisee, true);
    assert.equal(replay.operations.length, 1);
    await denies(reserve(db, f, 1000, id), 'operation_id_reutilise');
    await denies(reserve(db, f, 2000, id, 'duplicate'), 'operation_id_reutilise');
    await denies(reserve(db, f, 100), 'operation_incertitude_a_resoudre');
    const clean = await fixture(db);
    await denies(reserve(db, clean, 2501), 'montant_superieur_disponible');
    assert.equal((await reserve(db, clean, 2500)).disponible_centimes, 0);
    const locked = await fixture(db);
    await service(db, async tx => {
      await tx.query('select crm_reserver_remboursement_stripe($1,$2,$3,100,$4)', [randomUUID(), locked.demande, locked.session, 'duplicate']);
      const locks = (await tx.query(`select relation::regclass::text as name,mode from pg_locks
        where pid=pg_backend_pid() and granted`)).rows;
      assert.ok(locks.some(l => l.name === 'crm_paiements_stripe' && l.mode === 'RowShareLock'));
      assert.ok(locks.some(l => l.name === 'crm_operations_remboursement_stripe' && l.mode === 'RowExclusiveLock'));
    });
  });
  await t.test('timeout conserve plafond ; après 23 h aucune nouvelle tentative automatique', async () => {
    const f = await fixture(db), id = randomUUID();
    await reserve(db, f, 1000, id);
    const uncertain = await finish(db, id, { statut: 'incertain' });
    assert.equal(uncertain.operation.statut, 'incertain'); assert.equal(uncertain.reserve_centimes, 1000);
    assert.equal((await reserve(db, f, 1000, id)).execution_autorisee, true);
    await db.query("update crm_operations_remboursement_stripe set cree_le=now()-interval '23 hours' where operation_id=$1", [id]);
    const old = await reserve(db, f, 1000, id);
    assert.equal(old.execution_autorisee, false); assert.equal(old.verification_manuelle, true);
    assert.equal(old.reserve_centimes, 1000);
    await denies(reserve(db, f, 500), 'operation_incertitude_a_resoudre');
    // Une recherche Stripe complète retrouve metadata après crash, même après TTL.
    const r = refund(f, 1000, 'succeeded', id);
    const resolved = await snap(db, f, snapshot(f, [r]));
    assert.equal(resolved.reserve_centimes, 0); assert.equal(resolved.etat.rembourse_centimes, 1000);
    assert.equal((await reserve(db, f, 1000, id)).execution_autorisee, false);
    assert.equal((await reserve(db, f, 1000, id)).verification_manuelle, false);
  });
  await t.test('pending et requires_action bloquent nouvelle opération puis succès libère seulement le reste', async () => {
    const f = await fixture(db), id = randomUUID(); await reserve(db, f, 1000, id);
    const r = refund(f, 1000, 'pending', id);
    let result = await finish(db, id, { ...r, verifie_le: stamp() });
    assert.equal(result.etat.en_attente_centimes, 1000); assert.equal(result.reserve_centimes, 0);
    assert.equal(result.disponible_centimes, 1500);
    await denies(reserve(db, f, 500), 'remboursement_en_attente');
    result = await snap(db, f, snapshot(f, [{ ...r, statut: 'requires_action' }]));
    assert.equal(result.operations[0].statut, 'requires_action');
    result = await snap(db, f, snapshot(f, [{ ...r, statut: 'succeeded' }]));
    assert.equal(result.etat.en_attente_centimes, 0); assert.equal(result.etat.rembourse_centimes, 1000);
    assert.equal((await reserve(db, f, 1500)).disponible_centimes, 0);
  });
  await t.test('failed/canceled vérifiés libèrent réserve ; une erreur sans refund Stripe ne la libère pas', async () => {
    for (const status of ['failed', 'canceled']) {
      const f = await fixture(db), id = randomUUID(); await reserve(db, f, 1000, id);
      await denies(finish(db, id, { statut: status }), 'retour_stripe_invalide');
      const r = refund(f, 1000, status, id);
      const result = await finish(db, id, { ...r, verifie_le: stamp() });
      assert.equal(result.operation.statut, status); assert.equal(result.disponible_centimes, 2500);
      assert.equal((await finish(db, id, { statut: 'incertain' })).operation.statut, status);
      assert.equal((await reserve(db, f, 1000, id)).execution_autorisee, false);
      await denies(snap(db, f, snapshot(f, [{ ...r, statut: 'pending' }])), 'remboursement_transition_invalide');
      await reserve(db, f, 2500);
    }
  });
  await t.test('metadata incohérente ou deux refunds pour une opération ne consomment jamais deux plafonds', async () => {
    const f = await fixture(db), id = randomUUID(); await reserve(db, f, 1000, id);
    const r = refund(f, 1000, 'succeeded', id);
    await denies(snap(db, f, snapshot(f, [{ ...r, operation_id: randomUUID() }])), 'operation_metadata_inconnue');
    await denies(snap(db, f, snapshot(f, [{ ...r, montant_centimes: 900 }])), 'operation_metadata_incoherente');
    await denies(snap(db, f, snapshot(f, [{ ...r, motif: 'duplicate' }])), 'operation_metadata_incoherente');
    await denies(snap(db, f, snapshot(f, [r, { ...r, id: 're_second_for_operation' }])), 'operation_metadata_incoherente');
    assert.equal((await reserve(db, f, 1000, id)).operation.statut, 'reserve');
    assert.equal((await db.query('select * from crm_remboursements_stripe where session_id=$1', [f.session])).rows.length, 0);
  });
  await t.test('réponse POST ancienne ne rétrograde pas snapshot ; replay et timeout après succès stables', async () => {
    const f = await fixture(db), id = randomUUID(); await reserve(db, f, 1000, id);
    const oldTime = stamp(), r = refund(f, 1000, 'succeeded', id);
    await snap(db, f, snapshot(f, [r]));
    await denies(finish(db, id, { ...r, statut: 'pending', verifie_le: oldTime }), 'snapshot_perime');
    assert.equal((await finish(db, id, { ...r, verifie_le: oldTime })).operation.statut, 'succeeded');
    assert.equal((await finish(db, id, { statut: 'incertain' })).operation.statut, 'succeeded');
    assert.equal((await reserve(db, f, 1000, id)).execution_autorisee, false);
  });
  await t.test('litige, snapshot ancien et changement externe ferment nouvelle tentative', async () => {
    const f = await fixture(db);
    await snap(db, f, snapshot(f, [], { conteste: true }));
    await denies(reserve(db, f), 'paiement_conteste');
    const old = await fixture(db, { noSnapshot: true });
    await snap(db, old, snapshot(old, [], { verifie_le: new Date(Date.now() - 360000).toISOString() }));
    await denies(reserve(db, old), 'snapshot_perime');
    const uncertain = await fixture(db), id = randomUUID(); await reserve(db, uncertain, 2000, id);
    const r = refund(uncertain, 1000);
    const updated = await snap(db, uncertain, snapshot(uncertain, [r]));
    assert.equal(updated.disponible_centimes, 0); assert.equal(updated.reserve_centimes, 2000);
    assert.equal((await reserve(db, uncertain, 2000, id)).execution_autorisee, false);
  });
  await t.test('historique paiement/annulation inchangé ; session remboursée jamais réaffectée', async () => {
    const f = await fixture(db), before = (await db.query('select to_jsonb(d) as d from demandes d where id=$1', [f.demande])).rows[0].d;
    const id = randomUUID(); await reserve(db, f, 2500, id);
    await finish(db, id, { ...refund(f, 2500, 'succeeded', id), verifie_le: stamp() });
    const after = (await db.query('select to_jsonb(d) as d from demandes d where id=$1', [f.demande])).rows[0].d;
    assert.deepEqual(after, before);
    const other = await fixture(db);
    await denies(rpc(db, 'crm_appliquer_paiement_stripe', [other.demande, f.session]), 'paiement_deja_affecte');
    assert.equal((await rpc(db, 'crm_appliquer_paiement_stripe', [f.demande, f.session])).deja_rapproche, true);
  });
  await t.test('nouveaux rapprochements imposent Stripe récent et propre, atomiquement même admin', async () => {
    const f = await fixture(db, { unassigned: true, noSnapshot: true });
    await db.query('update demandes set paye=false,annule=false,paye_montant=null where id=$1', [f.demande]);
    const applyAdmin = () => admin(db, tx => tx.query('select crm_appliquer_paiement_stripe($1,$2)', [f.demande, f.session]));
    await denies(applyAdmin(), 'snapshot_requis_rapprochement');
    assert.equal((await db.query('select paye from demandes where id=$1', [f.demande])).rows[0].paye, false);
    await snap(db, f, snapshot(f, [], { conteste: true }));
    await denies(applyAdmin(), 'paiement_rembourse_ou_conteste');
    await snap(db, f, snapshot(f));
    await applyAdmin();
    assert.equal((await db.query('select demande_id from crm_etats_stripe where session_id=$1', [f.session])).rows[0].demande_id, f.demande);
    for (const status of ['succeeded', 'pending', 'requires_action']) {
      const bad = await fixture(db, { unassigned: true });
      await db.query('update demandes set paye=false,annule=false,paye_montant=null where id=$1', [bad.demande]);
      await snap(db, bad, snapshot(bad, [refund(bad, 500, status)]));
      await denies(rpc(db, 'crm_appliquer_paiement_stripe', [bad.demande, bad.session]), 'paiement_rembourse_ou_conteste');
    }
  });
  await t.test('réexécuter v24 et v22 préserve données, droits et trigger nouveaux rapprochements', async () => {
    const before = (await db.query('select count(*)::int n from crm_operations_remboursement_stripe')).rows[0].n;
    await db.exec(migration());
    await db.exec(sql('20260911_paiements_crm.sql'));
    assert.equal((await db.query('select count(*)::int n from crm_operations_remboursement_stripe')).rows[0].n, before);
    const f = await fixture(db, { unassigned: true, noSnapshot: true });
    await db.query('update demandes set paye=false,annule=false,paye_montant=null where id=$1', [f.demande]);
    await denies(rpc(db, 'crm_appliquer_paiement_stripe', [f.demande, f.session]), 'snapshot_requis_rapprochement');
    await denies(admin(db, tx => tx.query('delete from crm_etats_stripe')));
  });
  await t.test('contrat réel Code.gs : lecture Stripe simulée → RPC SQL → présentation CRM', async () => {
    const f = await fixture(db, { noSnapshot: true });
    const ctx = vm.createContext({ Date, JSON, Number, Object, Array, Math,
      PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'STRIPE_REMBOURSEMENTS_ACTIFS' ? 'true' : null }) },
      UrlFetchApp: { fetch() { throw new Error('Tout appel réseau externe est interdit dans ce test.'); } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../service/Code.gs'), 'utf8'), ctx);
    const stripeRefunds = [];
    const stripeSession = { id: f.session, livemode: true, mode: 'payment', status: 'complete', payment_status: 'paid',
      currency: 'eur', amount_total: 2500, payment_intent: f.pi };
    ctx.stripeRequete = route => { assert.equal(route, '/' + f.session); return stripeSession; };
    ctx.stripeApi = route => {
      if (route === '/payment_intents/' + f.pi) return { id: f.pi, livemode: true, currency: 'eur', status: 'succeeded', amount: 2500, amount_received: 2500, latest_charge: f.charge };
      if (route === '/charges/' + f.charge) return { id: f.charge, payment_intent: f.pi, livemode: true, currency: 'eur', paid: true,
        captured: true, status: 'succeeded', amount: 2500, amount_captured: 2500,
        amount_refunded: stripeRefunds.reduce((n, r) => n + r.amount, 0), disputed: false };
      if (route === '/refunds?charge=' + f.charge + '&limit=100') return { data: stripeRefunds, has_more: false };
      throw new Error('Route Stripe simulée inattendue : ' + route);
    };
    const payment = { session_id: f.session, demande_id: f.demande, montant_centimes: 2500, nature: 'total' };
    const actual = ctx.lireSnapshotStripe(payment);
    assert.equal((await snap(db, f, actual)).disponible_centimes, 2500);
    const id = randomUUID(), reserved = await reserve(db, f, 750, id);
    assert.equal(reserved.operation.operation_id, id);
    stripeRefunds.push({ id: 're_contract_' + ++serial, charge: f.charge, payment_intent: f.pi, currency: 'eur',
      amount: 750, status: 'succeeded', created: Math.floor(Date.now() / 1000), reason: 'requested_by_customer',
      metadata: { crm_operation_id: id, crm_session_id: f.session } });
    const normalized = ctx.normaliserRemboursementStripe(stripeRefunds[0], f.session, f.pi, f.charge);
    normalized.verifie_le = new Date().toISOString();
    const completed = await finish(db, id, normalized);
    assert.equal(completed.operation.statut, 'succeeded');
    const refreshed = ctx.lireSnapshotStripe(payment);
    const result = await snap(db, f, refreshed);
    const presentation = ctx.presenterPaiementStripe(payment, { snapshot: refreshed, resultat: result });
    assert.equal(presentation.rembourse_centimes, 750);
    assert.equal(presentation.disponible_centimes, 1750);
    assert.equal(presentation.remboursements[0].id, stripeRefunds[0].id);
    assert.equal(presentation.operation_en_cours, undefined);
  });
});
