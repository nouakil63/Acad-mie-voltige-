'use strict';

// PostgreSQL WASM réel, entièrement local. Installation hors dépôt :
// pnpm --dir ../tmp/academie-crm-test-tools add --ignore-scripts --save-exact @electric-sql/pglite@0.5.8
// node --test tests/sql.test.cjs
// PGLITE_MODULE_PATH peut désigner le dossier absolu du package PGlite.
// Sinon require standard, puis AV_SQL_TEST_TOOLS (dossier contenant node_modules).
// PGlite a une seule connexion : on vérifie les transactions/verrous/RLS,
// pas une course entre deux sessions PostgreSQL indépendantes.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const toolsDir = process.env.AV_SQL_TEST_TOOLS || path.resolve(__dirname, '../../tmp/academie-crm-test-tools');
let PGlite;
try {
  let modulePath = process.env.PGLITE_MODULE_PATH;
  if (!modulePath) {
    try { modulePath = require.resolve('@electric-sql/pglite'); }
    catch (_) { modulePath = path.join(toolsDir, 'node_modules/@electric-sql/pglite'); }
  }
  ({ PGlite } = require(modulePath));
}
catch (error) {
  throw new Error('Installer @electric-sql/pglite@0.5.8 dans ' + toolsDir + ' avant les tests SQL.', { cause: error });
}
const sql = name => fs.readFileSync(path.join(__dirname, '../service/migrations', name), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const P2 = '33333333-3333-4333-8333-333333333333';

// État antérieur minimal : fonctions JWT et rôles Supabase simulés,
// vraies tables/contraintes/RLS PostgreSQL. Aucun secret ou réseau.
const baseline = `
create role anon noinherit;
create role authenticated noinherit;
create role service_role noinherit bypassrls;
create schema auth;
grant usage on schema public, auth to anon, authenticated, service_role;
create table auth.users(id uuid primary key, email text);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb, '{}'::jsonb)
$$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
create table public.admins(email text primary key);
alter table public.admins enable row level security;
create policy "voir si je suis admin" on public.admins for select using (email = auth.jwt()->>'email');
create table public.familles(
  user_id uuid primary key references auth.users(id), email text,
  donnees jsonb not null default '{}', maj timestamptz not null default now(), note_admin text
);
alter table public.familles enable row level security;
create policy "lire sa famille" on public.familles for select using(user_id=auth.uid());
create policy "modifier sa famille" on public.familles for update using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "les admins lisent les familles" on public.familles for select using(
  exists(select 1 from public.admins where email=auth.jwt()->>'email'));
create policy "les admins annotent les familles" on public.familles for update using(
  exists(select 1 from public.admins where email=auth.jwt()->>'email'));
create table public.demandes(
  id uuid primary key default gen_random_uuid(), cree timestamptz not null default now(),
  type text, enfant text, parent_nom text, parent_email text, detail text, tarif text,
  lignes text, statut text not null default 'en attente', decide timestamptz,
  paye boolean not null default false, paye_le date, paye_montant text,
  acompte_paye boolean not null default false, acompte_le date,
  solde_paye boolean not null default false, solde_le date,
  annule boolean not null default false, annule_le date, rembourse_montant text,
  cours_date date, cours_heure text, infos_envoyees_le date
);
alter table public.demandes enable row level security;
create policy "admins demandes" on public.demandes for all using(
  exists(select 1 from public.admins where email=auth.jwt()->>'email'));
grant select on public.admins to authenticated;
grant select, insert, update, delete on public.familles, public.demandes to authenticated;
grant all on all tables in schema public to service_role;
insert into auth.users values ('${A}','admin@example.test'),('${P}','parent@example.test'),('${P2}','autre@example.test');
insert into public.admins values ('admin@example.test');
insert into public.familles(user_id,email,note_admin,maj) values
 ('${P}','parent@example.test','Note interne à préserver','2025-01-01'),
 ('${P2}','autre@example.test','Autre note privée','2025-02-01');
`;

async function database() { const db = new PGlite(); await db.exec(baseline); return db; }
async function as(db, role, identity, callback) {
  return db.transaction(async tx => {
    await tx.exec('set local role ' + role);
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, ...identity })]);
    return callback(tx);
  });
}
const admin = (db, fn) => as(db, 'authenticated', { sub: A, email: 'admin@example.test' }, fn);
const parent = (db, fn) => as(db, 'authenticated', { sub: P, email: 'parent@example.test' }, fn);
const service = (db, fn) => as(db, 'service_role', {}, fn);
const anon = (db, fn) => as(db, 'anon', {}, fn);

test('migration notes : confidentialité, reprise et réexécution PostgreSQL', async t => {
  const db = await database(); t.after(() => db.close());
  await db.exec(sql('20260911_notes_crm.sql'));
  await t.test('copie exacte avant suppression de la colonne exposée', async () => {
    const rows = (await db.query('select user_id,note,maj from notes_familles order by user_id')).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].note, 'Note interne à préserver');
    assert.equal((await db.query('select n.maj=f.maj as identique from notes_familles n join familles f using(user_id) where n.user_id=$1', [P])).rows[0].identique, true);
    assert.equal((await db.query("select count(*)::int as n from information_schema.columns where table_name='familles' and column_name='note_admin'")).rows[0].n, 0);
    const own = await parent(db, tx => tx.query('select * from familles'));
    assert.equal(own.rows.length, 1);
    assert.equal(Object.hasOwn(own.rows[0], 'note_admin'), false);
  });
  await t.test('un parent ne lit ni ne modifie les notes, même celle de sa famille', async () => {
    assert.equal((await parent(db, tx => tx.query('select * from notes_familles'))).rows.length, 0);
    assert.equal((await parent(db, tx => tx.query("update notes_familles set note='tentative' returning *"))).rows.length, 0);
    await assert.rejects(parent(db, tx => tx.query('insert into notes_familles(user_id,note) values($1,$2)', [P, 'tentative'])), error => error.code === '42501');
    await assert.rejects(anon(db, tx => tx.query('select * from notes_familles')), error => error.code === '42501');
  });
  await t.test('upsert admin et auteur imposé par le trigger', async () => {
    const result = await admin(db, tx => tx.query(`insert into notes_familles(user_id,note,auteur)
      values($1,$2,$3) on conflict(user_id) do update set note=excluded.note,auteur=excluded.auteur returning *`, [P, 'Suivi actualisé', P2]));
    assert.equal(result.rows[0].auteur, A);
    assert.equal(result.rows[0].note, 'Suivi actualisé');
    assert.equal((await admin(db, tx => tx.query('select * from notes_familles'))).rows.length, 2);
  });
  await t.test('réexécution préserve la dernière note et les données familiales', async () => {
    await db.exec(sql('20260911_notes_crm.sql'));
    assert.equal((await admin(db, tx => tx.query('select note from notes_familles where user_id=$1', [P]))).rows[0].note, 'Suivi actualisé');
    assert.equal((await db.query('select count(*)::int as n from familles')).rows[0].n, 2);
  });
});

async function demande(db, opts = {}) {
  const result = await db.query(`insert into demandes(type,enfant,parent_email,tarif,statut,cree)
    values($1,'Enfant test',$2,$3,'validée',now()-interval '3 days') returning id`,
  [opts.type || 'cours', opts.email || 'parent@example.test', opts.tarif || '25 €']);
  return result.rows[0].id;
}
async function paiement(db, id, cents, opts = {}) {
  await service(db, tx => tx.query(`insert into crm_paiements_stripe(session_id,email,montant_centimes,devise,recu_le)
    values($1,$2,$3,'eur',now()-($4::int*interval '1 day'))`, [id, opts.email || 'parent@example.test', cents, opts.days || 1]));
}
const apply = (tx, requestId, paymentId) => tx.query('select crm_appliquer_paiement_stripe($1,$2) as result', [requestId, paymentId]);

test('migration paiements : autorisations, registre et atomicité PostgreSQL', async t => {
  const db = await database(); t.after(() => db.close());
  await db.exec(sql('20260911_paiements_crm.sql'));
  const d = await demande(db), other = await demande(db);
  await paiement(db, 'cs_cours_1', 2500);
  await t.test('conversion de tarifs français entiers et décimaux en centimes', async () => {
    for (const [tarif, cents] of [['25 €', 2500], ['325,50 € / trimestre', 32550], ['1\u202f200,55 €', 120055], ['840 € / semaine', 84000]]) {
      assert.equal(Number((await db.query('select crm_montant_centimes($1) as cents', [tarif])).rows[0].cents), cents);
    }
  });
  await t.test('parent/anon refusés, admin lecture seule, service import seulement', async () => {
    assert.equal((await parent(db, tx => tx.query('select * from crm_paiements_stripe'))).rows.length, 0);
    await assert.rejects(parent(db, tx => apply(tx, d, 'cs_cours_1')), /acces_refuse/);
    await assert.rejects(anon(db, tx => apply(tx, d, 'cs_cours_1')), error => error.code === '42501');
    assert.equal((await admin(db, tx => tx.query('select * from crm_paiements_stripe'))).rows.length, 1);
    await assert.rejects(admin(db, tx => tx.query('update crm_paiements_stripe set montant_centimes=1')), error => error.code === '42501');
    await assert.rejects(service(db, tx => tx.query('update crm_paiements_stripe set montant_centimes=1')), error => error.code === '42501');
    await assert.rejects(parent(db, tx => tx.query('select * from crm_decisions')), error => error.code === '42501');
  });
  await t.test('RPC applique une fois et prend les deux verrous de lecture pour mise à jour', async () => {
    const result = await admin(db, async tx => {
      const r = await apply(tx, d, 'cs_cours_1');
      const locks = await tx.query(`select relation::regclass::text as name from pg_locks
        where pid=pg_backend_pid() and mode='RowShareLock' and granted`);
      assert.ok(locks.rows.some(x => x.name === 'demandes'));
      assert.ok(locks.rows.some(x => x.name === 'crm_paiements_stripe'));
      return r.rows[0].result;
    });
    assert.equal(result.ok, true);
    assert.equal(result.demande.paye, true);
    assert.equal(result.paiement.demande_id, d);
    assert.equal(result.paiement.rapproche_par, 'admin@example.test');
  });
  await t.test('répétition idempotente et session non réutilisable sur une autre demande', async () => {
    assert.equal((await admin(db, tx => apply(tx, d, 'cs_cours_1'))).rows[0].result.deja_rapproche, true);
    await assert.rejects(admin(db, tx => apply(tx, other, 'cs_cours_1')), /paiement_deja_affecte/);
    assert.equal((await db.query('select paye from demandes where id=$1', [other])).rows[0].paye, false);
    await assert.rejects(paiement(db, 'cs_cours_1', 2500), error => error.code === '23505');
  });
  await t.test('décocher payé ne permet pas un nouveau règlement pour la même demande', async () => {
    await db.query('update demandes set paye=false where id=$1', [d]);
    await paiement(db, 'cs_cours_2', 2500);
    await assert.rejects(service(db, tx => apply(tx, d, 'cs_cours_2')), /paiement_etat_registre_incompatible/);
    assert.equal((await db.query("select demande_id from crm_paiements_stripe where session_id='cs_cours_2'")).rows[0].demande_id, null);
  });
  await t.test('acompte puis solde exacts, sans consommation partielle lors d’une erreur', async () => {
    const stage = await demande(db, { type: 'stage', tarif: '840 € / semaine' });
    await paiement(db, 'cs_acompte', 30000); await paiement(db, 'cs_solde', 54000);
    const first = (await service(db, tx => apply(tx, stage, 'cs_acompte'))).rows[0].result;
    assert.equal(first.paiement.nature, 'acompte'); assert.equal(first.demande.paye, false);
    const last = (await service(db, tx => apply(tx, stage, 'cs_solde'))).rows[0].result;
    assert.equal(last.paiement.nature, 'solde'); assert.equal(last.demande.paye, true);
    assert.equal(last.demande.solde_paye, true);
  });
  await t.test('montant inexact, email différent et paiement antérieur refusés sans affectation', async () => {
    for (const [sid, cents, opts, message] of [
      ['cs_trop', 2600, {}, 'montant_ou_etat_incompatible'],
      ['cs_autre', 2500, { email: 'autre@example.test' }, 'email_incompatible'],
      ['cs_ancien', 2500, { days: 10 }, 'paiement_anterieur_demande']
    ]) {
      await paiement(db, sid, cents, opts);
      await assert.rejects(admin(db, tx => apply(tx, other, sid)), new RegExp(message));
      assert.equal((await db.query('select demande_id from crm_paiements_stripe where session_id=$1', [sid])).rows[0].demande_id, null);
    }
  });
  await t.test('réexécution conserve les affectations du registre', async () => {
    await db.exec(sql('20260911_paiements_crm.sql'));
    assert.equal((await db.query("select demande_id from crm_paiements_stripe where session_id='cs_cours_1'")).rows[0].demande_id, d);
  });
});

test('migration planning : dates, créneaux, quota et préservation de l’existant', async t => {
  const db = await database(); t.after(() => db.close());
  const old = (await db.query(`insert into demandes(type,statut,cours_date,cours_heure)
    values('cours','validée','2000-01-03','ancien horaire') returning *`)).rows[0];
  await db.exec(sql('20260911_planning_crm.sql'));
  const dates = (await db.query(`select to_char(current_date+((6-extract(dow from current_date)::int+7)%7)+7,'YYYY-MM-DD') as samedi,
    to_char(current_date+((6-extract(dow from current_date)::int+7)%7)+8,'YYYY-MM-DD') as dimanche`)).rows[0];
  const insert = (hour, opts = {}) => admin(db, tx => tx.query(`insert into demandes(type,statut,annule,cours_date,cours_heure)
    values($1,$2,$3,$4,$5) returning id,cours_heure`, [opts.type || 'cours', opts.status || 'validée', opts.cancelled || false, opts.date || dates.samedi, hour]));
  await t.test('installation sans toucher l’existant, éditions historiques non bloquées', async () => {
    assert.deepEqual((await db.query('select * from demandes where id=$1', [old.id])).rows[0], old);
    await admin(db, tx => tx.query('update demandes set paye=true,paye_le=current_date,infos_envoyees_le=current_date where id=$1', [old.id]));
    await admin(db, tx => tx.query("update demandes set statut='validée' where id=$1", [old.id]));
    assert.equal((await db.query('select paye from demandes where id=$1', [old.id])).rows[0].paye, true);
  });
  await t.test('nouveaux placements : date réelle, samedi à venir et heure valide', async () => {
    await assert.rejects(insert('10:00', { date: '2027-02-30' }), error => error.code === '22008');
    await assert.rejects(insert('10:00', { date: 'infinity' }), /cours_date_invalide/);
    await assert.rejects(insert('10:00', { date: '2000-01-01' }), /cours_date_passee/);
    await assert.rejects(insert('10:00', { date: dates.dimanche }), /cours_samedi_uniquement/);
    await assert.rejects(insert('25:00'), /cours_heure_invalide/);
    await assert.rejects(insert(null), /cours_heure_invalide/);
  });
  const ids = [];
  await t.test('les variantes d’heure partagent le même quota de huit', async () => {
    for (const hour of ['10h', '10:00', '10 h 0', '10H00', '10:0', '10h00', '10:00', '10h00']) {
      const r = await insert(hour); ids.push(r.rows[0].id); assert.equal(r.rows[0].cours_heure, '10:00');
    }
    await assert.rejects(insert('10h00'), /cours_complet/);
    assert.equal((await insert('11:00')).rows[0].cours_heure, '11:00');
  });
  await t.test('stages, attentes et annulations ne prennent pas de place', async () => {
    await insert('10:00', { type: 'stage' });
    await insert('10:00', { status: 'en attente' });
    await insert('10:00', { cancelled: true });
    await admin(db, tx => tx.query('update demandes set annule=true where id=$1', [ids[0]]));
    await insert('10:00');
    await assert.rejects(admin(db, tx => tx.query('update demandes set annule=false where id=$1', [ids[0]])), /cours_complet/);
  });
  await t.test('quota toujours appliqué au service et table de verrous protégée', async () => {
    await assert.rejects(service(db, tx => tx.query("insert into demandes(type,statut,cours_date,cours_heure) values('cours','validée',$1,'10:00')", [dates.samedi])), /cours_complet/);
    await assert.rejects(admin(db, tx => tx.query('select * from crm_verrous_creneaux')), error => error.code === '42501');
    assert.equal((await db.query('select revision from crm_verrous_creneaux where date=$1 and heure=$2', [dates.samedi, '10:00'])).rows[0].revision, 9);
  });
  await t.test('insertion multiple trop grande annulée entièrement et verrou transactionnel pris', async () => {
    await assert.rejects(admin(db, tx => tx.query(`insert into demandes(type,statut,cours_date,cours_heure)
      select 'cours','validée',$1::date,'12:00' from generate_series(1,9)`, [dates.samedi])), /cours_complet/);
    assert.equal((await db.query("select count(*)::int as n from demandes where cours_heure='12:00'")).rows[0].n, 0);
    await admin(db, async tx => {
      await tx.query("insert into demandes(type,statut,cours_date,cours_heure) values('cours','validée',$1,'12:00')", [dates.samedi]);
      const locks = await tx.query(`select relation::regclass::text as name from pg_locks
        where pid=pg_backend_pid() and mode='RowExclusiveLock' and granted`);
      assert.ok(locks.rows.some(x => x.name === 'crm_verrous_creneaux'));
    });
  });
  await t.test('réinstallation ne change ni placements ni marques de paiement', async () => {
    const before = (await db.query('select * from demandes order by id')).rows;
    await db.exec(sql('20260911_planning_crm.sql'));
    assert.deepEqual((await db.query('select * from demandes order by id')).rows, before);
  });
});

test('les trois migrations ensemble autorisent un paiement et un renvoi d’informations pour un ancien cours', async t => {
  const db = await database(); t.after(() => db.close());
  const id = await demande(db);
  await db.query("update demandes set cours_date='2000-01-03',cours_heure='ancienne notation' where id=$1", [id]);
  for (const name of ['20260911_notes_crm.sql', '20260911_paiements_crm.sql', '20260911_planning_crm.sql']) await db.exec(sql(name));
  await paiement(db, 'cs_ancien_cours', 2500);
  assert.equal((await admin(db, tx => apply(tx, id, 'cs_ancien_cours'))).rows[0].result.demande.paye, true);
  await admin(db, tx => tx.query('update demandes set infos_envoyees_le=current_date where id=$1', [id]));
  assert.equal((await db.query('select cours_heure from demandes where id=$1', [id])).rows[0].cours_heure, 'ancienne notation');
});
