/* Tests hors réseau : node --test tests/backend.test.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'service', 'Code.gs'), 'utf8');
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const SESSION = 'cs_live_reglement1';
function response(body, status = 200, headers = {}) {
  return { getResponseCode: () => status,
    getContentText: () => typeof body === 'string' ? body : JSON.stringify(body),
    getAllHeaders: () => headers };
}
function runtime(fetch) {
  const properties = new Map([
    ['SUPABASE_URL', 'https://base.invalid'], ['SUPABASE_CLE_SERVICE', 'test-service'], ['STRIPE_CLE', 'test-stripe']
  ]);
  const calls = [], mails = [];
  let lockAvailable = true;
  const ctx = vm.createContext({
    console, Date, Math, Object, Number, Array, JSON,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value)
    }) },
    LockService: { getScriptLock: () => ({ tryLock: () => lockAvailable,
      releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: data => Buffer.from(data).toString('base64url'),
      base64DecodeWebSafe: data => Buffer.from(data, 'base64url'),
      computeHmacSha256Signature: (data, secret) => crypto.createHmac('sha256', secret).update(data).digest(),
      newBlob: data => ({ getDataAsString: () => Buffer.from(data).toString('utf8') }),
      formatDate: date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
    },
    UrlFetchApp: { fetch(url, options) {
      calls.push({ url, options });
      if (!fetch) throw new Error('Unexpected network attempt blocked: ' + url);
      return fetch(url, options, calls.length);
    } },
    GmailApp: { sendEmail(...args) { mails.push(args); } },
    Logger: { log() {} },
    ContentService: { MimeType: { TEXT: 'text/plain' },
      createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(source, ctx, { filename: 'service/Code.gs' });
  return { ctx, calls, mails, properties, lock(value) { lockAvailable = value; } };
}
function session(overrides = {}) {
  return { id: SESSION, status: 'complete', payment_status: 'paid', livemode: true,
    mode: 'payment', currency: 'eur', amount_total: 2500,
    customer_details: { email: ' Parent@Example.fr ' },
    created: Date.parse('2026-09-10T23:30:00Z') / 1000, ...overrides };
}
function payment(overrides = {}) {
  return { session_id: SESSION, email: 'parent@example.fr', montant: 25,
    montant_centimes: 2500, devise: 'eur', recu_le: '2026-09-10T23:30:00.000Z', quand: '2026-09-11', ...overrides };
}
function demande(overrides = {}) {
  return { id: ID_A, enfant: 'Camille', type: 'cours', parent_email: 'parent@example.fr',
    tarif: '25 €', cree: '2026-09-01T10:00:00Z', statut: 'validée', annule: false,
    paye: false, acompte_paye: false, solde_paye: false, ...overrides };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('configuration : ScriptProperties prioritaires et valeurs historiques compatibles', () => {
  const r = runtime();
  assert.equal(r.ctx.cleStripe(), 'test-stripe');
  r.properties.delete('STRIPE_CLE'); r.ctx.STRIPE_CLE = 'ancienne-cle';
  assert.equal(r.ctx.cleStripe(), 'ancienne-cle');
});

test('Stripe : EUR en centimes exacts, email normalisé, date France', () => {
  const { ctx } = runtime();
  const p = ctx.paiementDepuisSession(session({ amount_total: 2555 }));
  assert.equal(p.montant, 25.55);
  assert.equal(p.montant_centimes, 2555);
  assert.equal(p.quand, '2026-09-11');
  assert.equal(p.email, 'parent@example.fr');
  for (const override of [{ livemode: false }, { currency: 'usd' }, { amount_total: 0 },
    { payment_status: 'unpaid' }, { status: 'open' }, { mode: 'subscription' }]) {
    assert.equal(ctx.paiementDepuisSession(session(override)), null);
  }
});

test('Stripe : toutes les pages sont lues et une même session est dédoublonnée', () => {
  const r = runtime((url, options, count) => {
    assert.equal(options.headers.Authorization, 'Bearer test-stripe');
    if (count === 1) return response({ data: [session()], has_more: true });
    assert.match(url, /starting_after=cs_live_reglement1/);
    return response({ data: [session(), session({ id: 'cs_live_reglement2' })], has_more: false });
  });
  assert.equal(r.ctx.paiementsStripe().length, 2);
  assert.equal(r.calls.length, 2);
});

test('Stripe : pagination cassée et erreur API ne produisent pas une liste partielle', () => {
  const broken = runtime(() => response({ data: [], has_more: true }));
  assert.throws(() => broken.ctx.paiementsStripe(), { code: 'stripe_pagination_incomplete' });
  const denied = runtime(() => response({ error: { message: 'private details' } }, 401));
  assert.throws(() => denied.ctx.paiementsStripe(), { code: 'stripe_http_401' });
  const malformed = runtime(() => response('<html>failed</html>', 500));
  assert.throws(() => malformed.ctx.paiementsStripe(), { code: 'stripe_reponse_invalide' });
});

test('Supabase : pagination suit Content-Range malgré une limite serveur de deux lignes', () => {
  const r = runtime((url, options, count) => {
    assert.match(url, /order=id.asc/);
    if (count === 1) {
      assert.equal(options.headers.Range, '0-499');
      return response([{ id: 1 }, { id: 2 }], 206, { 'Content-Range': '0-1/3' });
    }
    assert.equal(options.headers.Range, '2-501');
    return response([{ id: 3 }], 206, { 'content-range': '2-2/3' });
  });
  assert.equal(r.ctx.supabaseLireTout('demandes?select=id&order=id.asc').length, 3);
});

test('Supabase : erreurs de lecture et mises à jour vides sont explicites', () => {
  const denied = runtime(() => response({ message: 'permission denied for table demandes' }, 403));
  assert.throws(() => denied.ctx.supabaseLire('demandes'), { code: 'supabase_http_403' });
  const empty = runtime(() => response([]));
  assert.throws(() => empty.ctx.supabaseEcrire('demandes?id=eq.x', { paye: true }), { code: 'mise_a_jour_vide' });
});

test('Un règlement exact et un seul dossier : proposition avec identifiants', () => {
  const { ctx } = runtime();
  const liste = ctx.preparerRapprochements([payment()], [demande()], []);
  assert.equal(liste.propositions[0].demande_id, ID_A);
  assert.equal(liste.propositions[0].session_id, SESSION);
  assert.equal(liste.propositions[0].nature, 'total');
});

test('Fratrie : ne choisit jamais le premier enfant', () => {
  const { ctx } = runtime();
  const liste = ctx.preparerRapprochements([payment()], [demande(), demande({ id: ID_B, enfant: 'Lou' })], []);
  assert.equal(liste.propositions.length, 0);
  assert.equal(liste.paiements[0].statut, 'ambigu');
  assert.equal(liste.paiements[0].candidats.length, 2);
});

test('Deux paiements pour un dossier : aucune affectation automatique', () => {
  const { ctx } = runtime();
  const liste = ctx.preparerRapprochements([payment(), payment({ session_id: 'cs_live_autre' })], [demande()], []);
  assert.equal(liste.propositions.length, 0);
  assert.equal(liste.bilan.ambigus, 2);
});

test('Une session déjà au registre ne redevient pas disponible après remise à zéro du dossier', () => {
  const { ctx } = runtime();
  const liste = ctx.preparerRapprochements([payment()], [demande()], [{ session_id: SESSION, demande_id: ID_A, nature: 'total' }]);
  assert.equal(liste.propositions.length, 0);
  assert.equal(liste.paiements[0].statut, 'deja_rapproche');
});

test('Décocher un dossier ne permet pas de lui proposer un second règlement total', () => {
  const { ctx } = runtime();
  const liste = ctx.preparerRapprochements([payment()], [demande()], [{
    session_id: 'cs_live_deja_comptabilise', demande_id: ID_A, nature: 'total', montant_centimes: 2500
  }]);
  assert.equal(liste.propositions.length, 0);
});

test('Historique sans registre : un ancien dossier payé rend le règlement ambigu', () => {
  const { ctx } = runtime();
  const liste = ctx.preparerRapprochements([payment()], [demande(), demande({ id: ID_B, paye: true })], []);
  assert.equal(liste.propositions.length, 0);
  assert.equal(liste.bilan.ambigus, 1);
});

test('Les paiements antérieurs, surpayés, annulés ou sans validation ne sont pas candidats', () => {
  const { ctx } = runtime();
  for (const d of [demande({ annule: true }), demande({ statut: 'en attente' }),
    demande({ cree: '2026-09-12T10:00:00Z' }), demande({ tarif: '24 €' })]) {
    assert.equal(ctx.naturePaiement(d, payment()), '');
  }
  assert.equal(ctx.centimesDe('1\u202f200,55 €'), 120055);
});

test('Stage : acompte 300 puis solde exact ; totalité refusée après acompte', () => {
  const { ctx } = runtime();
  const d = demande({ type: 'stage', tarif: '840 €' });
  assert.equal(ctx.naturePaiement(d, payment({ montant_centimes: 30000 })), 'acompte');
  assert.equal(ctx.naturePaiement(d, payment({ montant_centimes: 54000 })), '');
  d.acompte_paye = true;
  assert.equal(ctx.naturePaiement(d, payment({ montant_centimes: 54000 })), 'solde');
  assert.equal(ctx.naturePaiement(d, payment({ montant_centimes: 84000 })), '');
});

test('Application : relit Stripe, importe les faits et appelle exclusivement la RPC atomique', () => {
  const r = runtime((url, options) => {
    if (url.startsWith('https://api.stripe.com/')) return response(session());
    if (url.includes('crm_paiements_stripe?')) {
      assert.equal(options.headers.Prefer, 'resolution=ignore-duplicates,return=minimal');
      assert.equal(JSON.parse(options.payload)[0].session_id, SESSION);
      return response('', 201);
    }
    assert.match(url, /rpc\/crm_appliquer_paiement_stripe$/);
    assert.equal(options.method, 'post');
    assert.deepEqual(JSON.parse(options.payload), { p_demande_id: ID_A, p_session_id: SESSION, p_acteur: 'admin@example.fr' });
    return response({ ok: true, deja_rapproche: false, demande: demande({ paye: true }),
      paiement: { session_id: SESSION, demande_id: ID_A, nature: 'total' } });
  });
  assert.equal(r.ctx.appliquerPaiementStripe(ID_A, SESSION, 'admin@example.fr').ok, true);
  assert.equal(r.calls.some(c => c.options.method === 'patch'), false);
});

test('Conflit RPC : ne transforme pas un double emploi en succès', () => {
  const r = runtime((url) => {
    if (url.startsWith('https://api.stripe.com/')) return response(session());
    if (url.includes('crm_paiements_stripe?')) return response('', 201);
    return response({ message: 'paiement_deja_affecte' }, 400);
  });
  assert.throws(() => r.ctx.appliquerPaiementStripe(ID_B, SESSION, 'admin@example.fr'), { code: 'paiement_deja_affecte' });
});

test('Confirmation : admin obligatoire et une proposition périmée est refusée sans mutation', () => {
  const r = runtime();
  r.ctx.adminDepuisJeton = () => null;
  assert.equal(JSON.parse(r.ctx.traiterRapprochementStripe({ jeton: 'x' }).text).code, 'acces_refuse');
  r.ctx.adminDepuisJeton = () => 'admin@example.fr';
  r.ctx.chargerRapprochementsStripe = () => ({ paiements: [{ ...payment(), statut: 'ambigu' }] });
  const result = JSON.parse(r.ctx.traiterRapprochementStripe({ jeton: 'x', demande_id: ID_A, session_id: SESSION }).text);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'rapprochement_ambigu');
  assert.equal(r.calls.length, 0);
});

test('Routine : applique seulement les propositions ; même chemin serveur que le CRM', () => {
  const { ctx } = runtime();
  ctx.chargerRapprochementsStripe = () => ({ propositions: [{ ...payment(), demande_id: ID_A }], paiements: [],
    bilan: { ambigus: 2, sans_correspondance: 1 } });
  const calls = [];
  ctx.appliquerPaiementStripe = (...args) => { calls.push(args); return { deja_rapproche: false }; };
  assert.deepEqual(plain(ctx.rapprocherStripeAuto()), { appliques: 1, ambigus: 2, sans_correspondance: 1, demandes_a_verifier: [] });
  assert.deepEqual(calls, [[ID_A, SESSION, 'routine']]);
});

test('Routine : erreur de synchronisation bloque les relances', () => {
  const { ctx } = runtime();
  ctx.rapprocherStripeAuto = () => { throw new Error('Stripe indisponible'); };
  let relances = 0;
  ctx.relancesAuto = () => { relances++; };
  assert.throws(() => ctx.routineQuotidienne(), /Stripe indisponible/);
  assert.equal(relances, 0);
});

test('Routine : aucune relance automatique pour un dossier avec paiement ambigu', () => {
  const r = runtime();
  r.ctx.supabaseLireTout = () => [demande({ type: 'stage', tarif: '840 €', cree: '2025-01-01T10:00:00Z' })];
  r.ctx.relancesAuto([ID_A]);
  assert.equal(r.mails.length, 0);
  assert.equal(r.calls.length, 0);
});

test('Jetons : nonce distinct sans invalider les signatures historiques', () => {
  const { ctx } = runtime();
  const info = { enfant: 'Camille', parentEmail: 'parent@example.fr', type: 'cours' };
  const a = ctx.fabriquerJeton(info), b = ctx.fabriquerJeton(info);
  assert.notEqual(a.d, b.d);
  const oldD = ctx.Utilities.base64EncodeWebSafe(JSON.stringify(info));
  const oldS = ctx.Utilities.base64EncodeWebSafe(ctx.Utilities.computeHmacSha256Signature(oldD, ctx.secret()));
  assert.equal(ctx.verifierJeton(oldD, oldS).enfant, 'Camille');
  assert.equal(ctx.verifierJeton(oldD, 'faux'), null);
});

test('Décision rejouée : aucun second e-mail et aucun changement de statut', () => {
  const r = runtime(() => response([{ etat: 'termine', statut_cible: 'validée' }]));
  const jeton = r.ctx.fabriquerJeton({ type: 'cours', parentEmail: 'parent@example.fr', enfant: 'Camille' });
  assert.equal(r.ctx.executerDecision('refuser', 'complet', jeton.d, jeton.s).code, 'decision deja traitee');
  assert.equal(r.mails.length, 0);
  assert.equal(r.calls.length, 1);
});

test('Décision simultanée : verrou indisponible ne réserve ni envoie rien', () => {
  const r = runtime(); r.lock(false);
  const jeton = r.ctx.fabriquerJeton({ type: 'cours' });
  assert.equal(r.ctx.executerDecision('valider', '', jeton.d, jeton.s).code, 'decision en cours');
  assert.equal(r.calls.length, 0);
  assert.equal(r.mails.length, 0);
});

test('Décision : une annulation concurrente empêche l’envoi', () => {
  const r = runtime((url, options) => {
    if (url.includes('crm_decisions?jeton_signature=')) return response([]);
    if (url.includes('demandes?select=')) return response([{ id: ID_A, statut: 'en attente', annule: false }]);
    if (url.includes('crm_decisions?on_conflict=')) return response([{ etat: 'reserve' }], 201);
    assert.match(url, /statut=eq.en%20attente/);
    assert.equal(options.method, 'patch');
    return response([]); // statut changé par l'autre onglet
  });
  const jeton = r.ctx.fabriquerJeton({ type: 'cours', enfant: 'Camille' });
  assert.equal(r.ctx.executerDecision('valider', '', jeton.d, jeton.s).code, 'erreur decision');
  assert.equal(r.mails.length, 0);
});

test('Décision interrompue autour de Gmail : une réservation existante interdit un renvoi aveugle', () => {
  const r = runtime(() => response([{ etat: 'reserve', statut_cible: 'validée' }]));
  const jeton = r.ctx.fabriquerJeton({ type: 'cours' });
  assert.equal(r.ctx.executerDecision('valider', '', jeton.d, jeton.s).code, 'decision a verifier');
  assert.equal(r.mails.length, 0);
});

test('Décision : réserve, compare l’état, envoie puis confirme exactement une fois', () => {
  const etapes = [];
  const r = runtime((url, options) => {
    if (options.method === 'get' && url.includes('crm_decisions?')) return response([]);
    if (options.method === 'get' && url.includes('demandes?')) return response([{ id: ID_A, statut: 'en attente', annule: false }]);
    if (url.includes('crm_decisions?on_conflict=')) { etapes.push('reserve'); return response([{ etat: 'reserve' }], 201); }
    const payload = JSON.parse(options.payload);
    if (url.includes('demandes?')) { etapes.push('statut'); return response([{ id: ID_A, ...payload }]); }
    etapes.push(payload.etat);
    assert.equal(r.mails.length, 1, 'Gmail doit précéder la confirmation du journal');
    return response([{ ...payload }]);
  });
  const jeton = r.ctx.fabriquerJeton({ type: 'cours', enfant: 'Camille', parentEmail: 'parent@example.fr', detail: 'Voltige', parentNom: 'Parent' });
  const result = r.ctx.executerDecision('valider', '', jeton.d, jeton.s);
  assert.equal(result.code, 'ok valide');
  assert.deepEqual(etapes, ['reserve', 'statut', 'envoye', 'termine']);
  assert.equal(r.mails.length, 1);
});
