'use strict';

// Aucun réseau : vrais points d'entrée Apps Script dans une VM ; Stripe et
// Supabase sont simulés. Les RPC PostgreSQL ont leur propre suite PGlite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../service/Code.gs'), 'utf8');
const DEMANDE = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';
const OP = '33333333-3333-4333-8333-333333333333';
const OP2 = '44444444-4444-4444-8444-444444444444';
const SESSION = 'cs_live_testfixture';
const PI = 'pi_testfixture';
const CHARGE = 'ch_testfixture';
const NOW = Date.parse('2026-09-12T12:00:00Z');
const copy = obj => JSON.parse(JSON.stringify(obj));
const response = (body, status = 200, headers = {}) => ({ getResponseCode: () => status,
  getContentText: () => typeof body === 'string' ? body : JSON.stringify(body), getAllHeaders: () => headers });
function rawRefund(overrides = {}) {
  return { id: 're_external', amount: 200, status: 'succeeded', created: NOW / 1000 - 3600,
    currency: 'eur', charge: CHARGE, payment_intent: PI, metadata: {}, reason: null, ...overrides };
}
function request(overrides = {}) {
  return { type: 'stripe-rembourser', jeton: 'admin-session', demande_id: DEMANDE,
    session_id: SESSION, operation_id: OP, montant_centimes: 500, motif: 'requested_by_customer', ...overrides };
}

function harness(options = {}) {
  let tick = 0;
  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW + tick++])); }
    static now() { return NOW + tick++; }
  }
  const state = {
    calls: [], posts: [], snapshots: [], operations: new Map(), refunds: (options.refunds || []).map(copy),
    idempotency: new Map(), locked: false, throwsLeft: options.failAfterPost || options.failBeforePost ? 1 : 0,
    registry: [{ session_id: SESSION, demande_id: DEMANDE, nature: 'total', montant_centimes: 2500,
      email: 'archive@example.test', devise: 'eur', recu_le: '2025-01-01T10:00:00Z' }]
  };
  if (options.operation) state.operations.set(options.operation.operation_id, copy(options.operation));
  const props = new Map([['SUPABASE_URL', 'https://db.invalid'], ['SUPABASE_CLE_SERVICE', 'fake-service'],
    ['STRIPE_CLE', 'fake-stripe'], ['STRIPE_REMBOURSEMENTS_ACTIFS', options.gate === false ? 'false' : 'true']]);
  const session = { id: SESSION, status: 'complete', payment_status: 'paid', mode: 'payment',
    livemode: true, currency: 'eur', amount_total: 2500, payment_intent: PI,
    created: NOW / 1000 - 400 * 86400, customer_email: 'different-email@example.test', ...(options.session || {}) };
  const intent = { id: PI, status: 'succeeded', livemode: true, currency: 'eur',
    amount: 2500, amount_received: 2500, latest_charge: CHARGE, ...(options.intent || {}) };
  function charge() {
    return { id: CHARGE, payment_intent: PI, livemode: true, currency: 'eur', paid: true,
      captured: true, status: 'succeeded', amount: 2500, amount_captured: 2500,
      disputed: false, amount_refunded: state.refunds.filter(r => ['succeeded', 'pending', 'requires_action'].includes(r.status))
        .reduce((sum, r) => sum + r.amount, 0), ...(options.charge || {}) };
  }
  let snapshot;
  function summary() {
    const ops = [...state.operations.values()];
    const reserve = ops.filter(o => ['reserve', 'incertain'].includes(o.statut)).reduce((sum, o) => sum + o.montant_centimes, 0);
    return { ok: true, etat: snapshot, remboursements: (snapshot?.remboursements || []).map(r => ({ ...r, refund_id: r.id })),
      operations: ops, reserve_centimes: reserve,
      disponible_centimes: snapshot?.conteste ? 0 : Math.max(0, 2500 - (snapshot?.rembourse_centimes || 0) - (snapshot?.en_attente_centimes || 0) - reserve) };
  }
  function fetch(url, opt = {}) {
    state.calls.push({ url, options: copy(opt) });
    const u = new URL(url);
    if (u.host === 'api.stripe.com') {
      assert.equal(opt.headers.Authorization, 'Bearer fake-stripe');
      if (options.apiError && u.pathname.includes(options.apiError)) return response({ error: { message: 'sensitive details' } }, 403);
      if (opt.method === 'post') {
        assert.equal(u.pathname, '/v1/refunds', 'Seul endpoint Stripe autorisé en écriture');
        const p = Object.fromEntries(new URLSearchParams(opt.payload));
        state.posts.push({ ...p, key: opt.headers['Idempotency-Key'], body: opt.payload });
        assert.equal(p.charge, CHARGE);
        assert.equal(p['metadata[crm_session_id]'], SESSION);
        assert.equal(opt.headers['Idempotency-Key'], 'av-crm-refund-' + p['metadata[crm_operation_id]']);
        if (options.failBeforePost && state.throwsLeft--) throw new Error('network connection reset');
        let refund = state.idempotency.get(opt.headers['Idempotency-Key']);
        if (!refund) {
          refund = rawRefund({ id: 're_generated_' + state.idempotency.size,
            amount: Number(p.amount), status: options.refundStatus || 'succeeded', created: NOW / 1000,
            reason: p.reason, metadata: { crm_operation_id: p['metadata[crm_operation_id]'], crm_session_id: p['metadata[crm_session_id]'] } });
          state.refunds.push(refund); state.idempotency.set(opt.headers['Idempotency-Key'], refund);
        }
        if (options.failAfterPost && state.throwsLeft--) throw new Error('response lost after Stripe processed it');
        if (options.badPostResponse) return response({ ...refund, charge: 'ch_wrong' });
        return response(refund);
      }
      if (u.pathname === '/v1/checkout/sessions/' + SESSION) return response(session);
      if (u.pathname === '/v1/payment_intents/' + PI) return response(intent);
      if (u.pathname === '/v1/charges/' + CHARGE) return response(charge());
      if (u.pathname === '/v1/refunds') {
        assert.equal(u.searchParams.get('charge'), CHARGE);
        const after = u.searchParams.get('starting_after');
        const start = after ? state.refunds.findIndex(r => r.id === after) + 1 : 0;
        const size = options.pageSize || 100;
        return response({ data: state.refunds.slice(start, start + size), has_more: start + size < state.refunds.length });
      }
      throw new Error('Unexpected Stripe endpoint: ' + u.pathname);
    }
    assert.equal(u.host, 'db.invalid');
    if (u.pathname === '/auth/v1/user') return options.denied ? response({}, 401) : response({ email: 'admin@example.test' });
    if (u.pathname === '/rest/v1/admins') return response(options.nonAdmin ? [] : [{ email: 'admin@example.test' }]);
    if (u.pathname === '/rest/v1/crm_paiements_stripe') {
      const id = u.searchParams.get('demande_id');
      const cursor = u.searchParams.get('session_id');
      let rows = state.registry.filter(r => !id || id === 'not.is.null' || id === 'eq.' + r.demande_id);
      if (cursor?.startsWith('gt.')) rows = rows.filter(r => r.session_id > cursor.slice(3));
      return response(rows, 200, { 'Content-Range': rows.length ? '0-' + (rows.length - 1) + '/' + rows.length : '*/0' });
    }
    const p = JSON.parse(opt.payload || '{}');
    if (u.pathname === '/rest/v1/rpc/crm_enregistrer_snapshot_stripe') {
      assert.equal(p.p_session_id, SESSION);
      snapshot = p.p_snapshot; state.snapshots.push(copy(snapshot));
      snapshot.remboursements.forEach(r => {
        if (r.operation_id && state.operations.has(r.operation_id)) {
          Object.assign(state.operations.get(r.operation_id), { statut: r.statut, stripe_refund_id: r.id });
        }
      });
      return response(summary());
    }
    if (u.pathname === '/rest/v1/rpc/crm_reserver_remboursement_stripe') {
      let op = state.operations.get(p.p_operation_id);
      if (op) {
        if (op.session_id !== p.p_session_id || op.demande_id !== p.p_demande_id ||
            op.montant_centimes !== p.p_montant_centimes || op.motif !== p.p_motif) return response({ message: 'operation_id_reutilise' }, 400);
      } else {
        if ([...state.operations.values()].some(o => ['reserve', 'incertain'].includes(o.statut))) return response({ message: 'operation_non_resolue' }, 400);
        if (snapshot.conteste || snapshot.en_attente_centimes > 0) return response({ message: 'paiement_bloque' }, 400);
        if (p.p_montant_centimes > summary().disponible_centimes) return response({ message: 'montant_superieur_disponible' }, 400);
        op = { operation_id: p.p_operation_id, demande_id: p.p_demande_id, session_id: p.p_session_id,
          montant_centimes: p.p_montant_centimes, motif: p.p_motif, statut: 'reserve', cree_le: new MockDate().toISOString(), stripe_refund_id: null };
        state.operations.set(op.operation_id, op);
      }
      return response({ ...summary(), operation: op,
        execution_autorisee: ['reserve', 'incertain'].includes(op.statut) && NOW - Date.parse(op.cree_le) < 23 * 3600000 });
    }
    if (u.pathname === '/rest/v1/rpc/crm_terminer_remboursement_stripe') {
      const op = state.operations.get(p.p_operation_id), r = p.p_refund;
      if (r.statut === 'incertain') {
        if (['reserve', 'incertain'].includes(op.statut)) op.statut = 'incertain';
      } else {
        if (options.finalizeError) return response({ message: 'base_indisponible' }, 503);
        assert.equal(r.payment_intent_id, PI); assert.equal(r.charge_id, CHARGE);
        Object.assign(op, { statut: r.statut, stripe_refund_id: r.id });
      }
      return response({ ...summary(), operation: op });
    }
    throw new Error('Unexpected Supabase call: ' + u.pathname);
  }
  const ctx = vm.createContext({ Date: MockDate, Number, Object, Array, Math, JSON,
    UrlFetchApp: { fetch },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) || null,
      setProperty: (k, v) => props.set(k, v) }) },
    Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
    LockService: { getScriptLock: () => ({ tryLock: () => {
      if (options.lockUnavailable || state.locked) return false; state.locked = true; return true;
    }, releaseLock: () => { state.locked = false; } }) },
    ContentService: { MimeType: { TEXT: 'text/plain' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    Logger: { log() {} }
  });
  vm.runInContext(SOURCE, ctx, { filename: 'service/Code.gs' });
  return { ctx, state, props, post: body => JSON.parse(ctx.traiterRemboursementStripe(request(body)).text),
    list: () => JSON.parse(ctx.traiterEtatRemboursementsStripe({ jeton: 'admin-session', demande_id: DEMANDE }).text) };
}

test('consultation : live Stripe par relation session/PI/charge, e-mail ignoré, anciens règlements inclus', () => {
  const h = harness({ gate: false, refunds: [rawRefund()] });
  const result = h.list();
  assert.equal(result.ok, true); assert.equal(result.version, 24); assert.equal(result.remboursements_actifs, false);
  assert.equal(result.paiements[0].rembourse_centimes, 200);
  assert.equal(result.paiements[0].disponible_centimes, 2300);
  assert.equal(h.state.posts.length, 0);
  assert.equal(h.state.snapshots[0].livemode, true);
});

test('pagination : tous remboursements externes et pending sont comptés exactement', () => {
  const h = harness({ pageSize: 1, refunds: [rawRefund(), rawRefund({ id: 're_pending', amount: 300, status: 'pending' }),
    rawRefund({ id: 're_failed', amount: 100, status: 'failed' })] });
  const result = h.list();
  assert.equal(result.ok, true); assert.equal(result.paiements[0].remboursements.length, 3);
  assert.equal(result.resume.rembourse_centimes, 200); assert.equal(result.resume.en_attente_centimes, 300);
  assert.equal(result.paiements[0].disponible_centimes, 2000);
  assert.equal(h.state.calls.filter(c => c.url.includes('/v1/refunds?')).length, 3);
});

test('pagination : un refund répété avec un état contradictoire bloque la lecture', () => {
  const h = harness();
  const pages = [{ data: [rawRefund({ status: 'pending' })], has_more: true },
    { data: [rawRefund({ status: 'succeeded' })], has_more: false }];
  h.ctx.stripeApi = () => pages.shift();
  assert.throws(() => h.ctx.remboursementsDeChargeStripe(CHARGE), { code: 'stripe_remboursement_modifie' });
  assert.equal(h.state.posts.length, 0);
});

test('remboursement partiel : montant en centimes, clé stable et seules metadata techniques', () => {
  const h = harness(); const result = h.post();
  assert.equal(result.ok, true); assert.equal(result.remboursement.statut, 'succeeded');
  assert.equal(result.remboursement.montant_centimes, 500);
  assert.equal(result.resume.rembourse_centimes, 500);
  assert.equal(h.state.posts.length, 1);
  assert.deepEqual(Object.keys(h.state.posts[0]).sort(), ['amount', 'body', 'charge', 'key', 'metadata[crm_operation_id]', 'metadata[crm_session_id]', 'reason'].sort());
  assert.equal(h.state.posts[0].key, 'av-crm-refund-' + OP);
  assert.equal(h.state.locked, false);
});

test('remboursement total restant après remboursement externe : plafond frais', () => {
  const h = harness({ refunds: [rawRefund({ amount: 1000 })] });
  assert.equal(h.post({ montant_centimes: 1500 }).ok, true);
  assert.equal(h.list().paiements[0].disponible_centimes, 0);
});

test('montant supérieur au solde externe : aucune écriture Stripe', () => {
  const h = harness({ refunds: [rawRefund({ amount: 2300 })] });
  assert.equal(h.post().ok, false); assert.equal(h.state.posts.length, 0);
});

test('double clic même UUID : un seul remboursement, résultat retrouvé par metadata', () => {
  const h = harness(); const a = h.post(), b = h.post();
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(a.remboursement.id, b.remboursement.id); assert.equal(h.state.posts.length, 1);
});

test('réponse perdue après création Stripe : réserve incertaine puis résolution sans second POST', () => {
  const h = harness({ failAfterPost: true }); const a = h.post();
  assert.equal(a.ok, false); assert.equal(a.code, 'remboursement_incertain'); assert.equal(a.operation_id, OP);
  assert.equal(h.state.operations.get(OP).statut, 'incertain');
  assert.equal(h.post().ok, true); assert.equal(h.state.posts.length, 1);
});

test('connexion perdue avant Stripe : reprise même UUID/même corps avant 23 h', () => {
  const h = harness({ failBeforePost: true });
  assert.equal(h.post().code, 'remboursement_incertain');
  assert.equal(h.post().ok, true);
  assert.equal(h.state.posts.length, 2);
  assert.equal(h.state.posts[0].body, h.state.posts[1].body);
  assert.equal(h.state.posts[0].key, h.state.posts[1].key);
});

test('réponse SQL perdue après Stripe : aucun succès mensonger ni nouvelle UUID', () => {
  const h = harness({ finalizeError: true });
  const r = h.post(); assert.equal(r.ok, false); assert.equal(r.operation_reservee, true);
  assert.equal(r.code, 'remboursement_incertain'); assert.equal(h.state.posts.length, 1);
  assert.equal(h.post().ok, true); assert.equal(h.state.posts.length, 1);
});

test('réservation non résolue bloque une autre UUID', () => {
  const h = harness({ failBeforePost: true }); h.post();
  const r = h.post({ operation_id: OP2 });
  assert.equal(r.ok, false); assert.equal(h.state.posts.length, 1);
});

test('UUID de plus de 23 h sans remboursement connu : jamais de POST aveugle', () => {
  const h = harness({ operation: { operation_id: OP, demande_id: DEMANDE, session_id: SESSION,
    montant_centimes: 500, motif: 'requested_by_customer', statut: 'incertain', cree_le: new Date(NOW - 24 * 3600000).toISOString(), stripe_refund_id: null } });
  const r = h.post(); assert.equal(r.ok, false); assert.equal(r.code, 'remboursement_verification_manuelle');
  assert.equal(h.list().paiements[0].operation_en_cours.reprise_possible, false); assert.equal(h.state.posts.length, 0);
});

test('UUID ancienne avec refund identifié : retrouve le résultat, aucune écriture', () => {
  const h = harness({ operation: { operation_id: OP, demande_id: DEMANDE, session_id: SESSION,
    montant_centimes: 500, motif: 'requested_by_customer', statut: 'incertain', cree_le: new Date(NOW - 48 * 3600000).toISOString(), stripe_refund_id: null },
    refunds: [rawRefund({ amount: 500, reason: 'requested_by_customer', metadata: { crm_operation_id: OP, crm_session_id: SESSION } })] });
  assert.equal(h.post().ok, true); assert.equal(h.state.posts.length, 0);
});

test('même UUID avec montant modifié est refusée', () => {
  const h = harness({ failBeforePost: true }); h.post();
  assert.equal(h.post({ montant_centimes: 600 }).ok, false); assert.equal(h.state.posts.length, 1);
});

for (const status of ['pending', 'requires_action', 'failed', 'canceled']) {
  test('statut Stripe ' + status + ' : jamais annoncé réussi', () => {
    const h = harness({ refundStatus: status }); const result = h.post();
    assert.equal(result.ok, false); assert.equal(result.remboursement.statut, status);
    assert.equal(result.operation_statut, status);
    assert.equal(h.state.posts.length, 1);
  });
}

test('litige ou remboursement en attente : aucun nouveau POST même si solde disponible', () => {
  for (const opt of [{ charge: { disputed: true } }, { refunds: [rawRefund({ amount: 100, status: 'pending' })] }]) {
    const h = harness(opt); assert.equal(h.post().ok, false); assert.equal(h.state.posts.length, 0);
  }
});

test('autorisation administrateur, gate fermé et mauvais dossier : zéro mutation Stripe', () => {
  for (const opt of [{ denied: true }, { nonAdmin: true }, { gate: false }, { lockUnavailable: true }]) {
    const h = harness(opt); assert.equal(h.post().ok, false); assert.equal(h.state.posts.length, 0);
  }
  const h = harness(); assert.equal(h.post({ demande_id: AUTRE }).code, 'paiement_non_associe'); assert.equal(h.state.posts.length, 0);
});

test('erreurs/modes test/mauvais PI ou charge ou montant : aucun remboursement', () => {
  for (const opt of [{ session: { livemode: false } }, { intent: { livemode: false } }, { charge: { livemode: false } },
    { charge: { payment_intent: 'pi_other' } }, { charge: { amount_captured: 2400 } },
    { session: { amount_total: 2000 } }, { apiError: 'payment_intents' }, { refunds: [rawRefund({ charge: 'ch_wrong' })] }]) {
    const h = harness(opt); assert.equal(h.post().ok, false); assert.equal(h.state.posts.length, 0);
  }
});

test('réponse POST incohérente : garde une réserve incertaine', () => {
  const h = harness({ badPostResponse: true });
  assert.equal(h.post().code, 'remboursement_incertain'); assert.equal(h.state.operations.get(OP).statut, 'incertain');
});

test('rafraîchissement horaire inclut paiements associés anciens et ne crée jamais de remboursement', () => {
  const h = harness({ gate: true });
  assert.equal(h.ctx.synchroniserStripe().synchronises, 1);
  assert.equal(h.state.snapshots.length, 1); assert.equal(h.state.posts.length, 0);
  assert.equal(h.props.get('STRIPE_SYNC_CURSOR'), '');
});

test('nouveau rapprochement : un paiement remboursé est rejeté avant RPC d’affectation', () => {
  const h = harness({ refunds: [rawRefund()] });
  h.ctx.importerPaiementsStripe = () => {};
  assert.throws(() => h.ctx.appliquerPaiementStripe(DEMANDE, SESSION, 'admin@example.test'), { code: 'paiement_rembourse_ou_conteste' });
  assert.equal(h.state.calls.some(c => c.url.includes('/rpc/crm_appliquer_paiement_stripe')), false);
});
