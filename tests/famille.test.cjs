'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const UID_A = '11111111-1111-4111-8111-111111111111';
const UID_B = '22222222-2222-4222-8222-222222222222';
const session = (id = UID_A) => ({ user_id: id, email: id + '@example.test', jeton: 'token-' + id, expire: Date.now() + 3600000 });
const carnet = (nom = 'Famille A') => ({ responsable: { nom }, enfants: [] });
const response = (body, ok = true) => ({ ok, json: async () => body });
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

class Element {
  constructor(doc, tag = 'div') {
    this.doc = doc; this.tagName = tag; this.children = []; this.listeners = {};
    this.value = ''; this.checked = false; this.hidden = false; this.style = {};
    this.attrs = {}; this.parts = {};
    const classes = new Set();
    this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
      toggle: (x, on) => { if (on) classes.add(x); else classes.delete(x); } };
  }
  set id(value) { this._id = value; this.doc.elements.set(value, this); }
  get id() { return this._id; }
  set innerHTML(value) { this._html = value; this.children = []; }
  get innerHTML() { return this._html || ''; }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  get childNodes() { return this.children; }
  insertBefore(child) { return this.appendChild(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type, detail = {}) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this, preventDefault() {}, ...detail }); }
  dispatchEvent(ev) { this.emit(ev.type, ev); }
  querySelector(selector) { return this.parts[selector] ||= new Element(this.doc); }
  querySelectorAll(selector) {
    if (selector === '.carte-enfant') return this.children.filter(c => c.className === 'carte-enfant');
    return [];
  }
  reset() { for (const el of this.doc.elements.values()) if (el.tagName === 'input') el.value = ''; }
}

function environment({ current = session(), fetcher = async () => response([]), form = false, account = false } = {}) {
  const storage = new Map();
  if (current) storage.set('av:session', JSON.stringify(current));
  const doc = { elements: new Map(), listeners: {},
    getElementById(id) { return this.elements.get(id) || null; },
    createElement(tag) { return new Element(this, tag); },
    createTextNode(text) { return { textContent: text }; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    emit(type, detail) { for (const fn of this.listeners[type] || []) fn({ type, detail }); }
  };
  const add = (id, tag = 'div', value = '') => { const el = new Element(doc, tag); el.id = id; el.value = value; return el; };
  if (form) {
    add('form-cours', 'form');
    for (const id of ['parent-nom', 'parent-email', 'parent-adresse', 'parent-cp', 'parent-ville', 'parent-tel', 'enfant-prenom', 'enfant-nom', 'enfant-naissance', 'enfant-gabarit', 'recommandations']) add(id, 'input');
    doc.elements.get('parent-nom').value = 'Parent invité';
    doc.elements.get('enfant-prenom').value = 'Camille';
    doc.elements.get('enfant-nom').value = 'Invité';
  }
  if (account) {
    // Éléments statiques réellement utilisés par le script de la page compte.
    for (const id of ['v-attente','v-indisponible','f-connexion','f-creation','f-oubli','f-nouveau','v-famille',
      'liste-enfants','liste-demandes','fa-ajouter','fa-deconnexion','fa-compte','m-connexion','m-creation','m-famille','m-oubli','m-nouveau','bloc-trimestre',
      'c-qualite','c-nom','c-adresse','c-cp','c-ville','c-tel','c-tel2','c-courriel','c-secu-caisse','c-secu-numero']) add(id);
  }
  const calls = [], confirmations = [], windowListeners = {};
  const context = vm.createContext({
    window: { AV_NUAGE: { url: 'https://supabase.example.test', cle: 'public-test-key' },
      addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); } },
    document: doc,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    fetch: async (url, options) => { calls.push({ url, options }); return fetcher(url, options); },
    location: { hash: '', pathname: '/compte.html' }, history: { replaceState() {} },
    confirm: text => { confirmations.push(text); return false; },
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    Date, Promise, JSON, Array, Object, String, Number, encodeURIComponent, decodeURIComponent
  });
  const run = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js', file), 'utf8'), context, { filename: file });
  run('nuage.js');
  return { api: context.window.AVNuage, storage, doc, calls, confirmations, context, run,
    switchAccount(id) { storage.set('av:session', JSON.stringify(session(id))); },
    emitStorage(key = 'av:session') { for (const fn of windowListeners.storage || []) fn({ key }); } };
}

test('chargerFamille filtre le UUID même pour un compte admin', async () => {
  const e = environment({ fetcher: async () => response([{ user_id: UID_A, donnees: carnet() }]) });
  assert.equal((await e.api.chargerFamille()).responsable.nom, 'Famille A');
  assert.match(e.calls[0].url, new RegExp('user_id=eq\\.' + UID_A));
  assert.match(e.calls[0].url, /select=user_id,donnees/);
});

test('seule une liste vide reçue avec succès signifie aucun carnet', async t => {
  assert.equal(await environment().api.chargerFamille(), null);
  for (const [name, fetcher] of [
    ['HTTP refusé', async () => response([], false)],
    ['réseau interrompu', async () => { throw new Error('offline'); }],
    ['JSON inattendu', async () => response({})],
    ['autre famille', async () => response([{ user_id: UID_B, donnees: carnet('B') }])],
    ['données corrompues', async () => response([{ user_id: UID_A, donnees: null }])]
  ]) await t.test(name, async () => assert.rejects(environment({ fetcher }).api.chargerFamille()));
});

test('une ancienne session avec email mais sans UUID vérifie son identité', async () => {
  const old = session(); delete old.user_id;
  const e = environment({ current: old, fetcher: async url => url.endsWith('/auth/v1/user')
    ? response({ id: UID_A, email: 'parent@example.test' }) : response([]) });
  await e.api.chargerFamille();
  assert.match(e.calls[0].url, /\/auth\/v1\/user$/);
  assert.match(e.calls[1].url, new RegExp('user_id=eq\\.' + UID_A));
});

test('un résultat arrivé après changement de compte ne peut remplir le carnet', async () => {
  let deliver;
  const e = environment({ fetcher: () => new Promise(resolve => { deliver = resolve; }) });
  const loading = e.api.chargerFamille();
  await flush();
  e.switchAccount(UID_B);
  deliver(response([{ user_id: UID_A, donnees: carnet() }]));
  await assert.rejects(loading, /compte a changé/);
});

test('un renouvellement en retard ne restaure pas le compte déconnecté ou remplacé', async () => {
  let deliver;
  const expired = { ...session(), expire: 0, rafraichir: 'refresh-A' };
  const e = environment({ current: expired, fetcher: () => new Promise(resolve => { deliver = resolve; }) });
  const refreshing = e.api.sessionValide(); await flush();
  e.switchAccount(UID_B);
  deliver(response({ access_token: 'renewed-A', expires_in: 3600, user: { id: UID_A, email: 'a@example.test' } }));
  assert.equal(await refreshing, null);
  assert.equal(e.api.lireSession().user_id, UID_B);
});

test('une sauvegarde est liée au UUID attendu et ne passe pas sur un autre compte', async () => {
  const e = environment({ fetcher: async () => response(null) });
  assert.equal(await e.api.enregistrerFamille(carnet(), UID_A), true);
  assert.equal(JSON.parse(e.calls[0].options.body).user_id, UID_A);
  e.switchAccount(UID_B);
  assert.equal(await e.api.enregistrerFamille(carnet(), UID_A), false);
  assert.equal(e.calls.length, 1);
});

test('le cache exclut les autres comptes, les invités et les anciennes données sans propriétaire', () => {
  const e = environment();
  e.storage.set('av:famille', JSON.stringify(carnet('ancien')));
  assert.equal(e.api.lireFamilleLocale(session()), null);
  assert.equal(e.api.lireFamilleLocale(null), null);
  e.api.ecrireFamilleLocale(carnet(), session());
  assert.equal(e.api.lireFamilleLocale(session()).responsable.nom, 'Famille A');
  assert.equal(e.api.lireFamilleLocale(session(UID_B)), null);
  assert.equal(e.api.lireFamilleLocale(null), null);
  e.api.ecrireFamilleLocale(carnet('invité'), null);
  assert.equal(e.api.lireFamilleLocale(session()), null);
  assert.equal(e.api.lireFamilleLocale(null).responsable.nom, 'invité');
});

test('la déconnexion efface par défaut et la conservation explicite reste liée au compte', () => {
  const e = environment();
  e.api.ecrireFamilleLocale(carnet(), session());
  e.storage.set('av:dossier-inscription', 'dossier sensible');
  e.api.deconnexion({ conserverFamille: true });
  assert.equal(e.storage.has('av:session'), false);
  assert.equal(e.storage.has('av:dossier-inscription'), false);
  assert.equal(e.api.lireFamilleLocale(null), null);
  assert.equal(e.api.lireFamilleLocale(session()).responsable.nom, 'Famille A');
  e.api.deconnexion();
  assert.equal(e.storage.has('av:famille'), false);
});

test('une inscription invitée ne conserve rien sans accord et attend la validation du formulaire', () => {
  const e = environment({ current: null, form: true });
  e.run('famille.js');
  assert.equal(e.doc.getElementById('retenir-famille').checked, false);
  e.doc.emit('av:demande-envoyee', { type: 'cours' });
  assert.equal(e.storage.has('av:famille'), false);
  e.doc.getElementById('retenir-famille').checked = true;
  e.doc.getElementById('form-cours').emit('submit');
  assert.equal(e.storage.has('av:famille'), false);
  e.doc.emit('av:demande-envoyee', { type: 'cours', enfantPrenom: 'Camille', enfantNom: 'Invité' });
  assert.equal(e.api.lireFamilleLocale(null).enfants[0].prenom, 'Camille');
  assert.equal(e.api.lireFamilleLocale(null).demandes.length, 1);
  assert.equal(e.calls.length, 0);
});

test('un échec de chargement n’écrase jamais le carnet depuis le formulaire', async () => {
  const e = environment({ form: true, fetcher: async () => { throw new Error('offline'); } });
  e.api.ecrireFamilleLocale(carnet('cache existant'), session());
  e.run('famille.js');
  await flush();
  e.doc.emit('av:demande-envoyee', { type: 'cours' });
  await flush();
  assert.equal(e.api.lireFamilleLocale(session()).responsable.nom, 'cache existant');
  assert.ok(e.calls.every(call => !call.options.method));
  assert.match(e.doc.getElementById('message-carnet').textContent, /ne sera pas modifié/);
});

test('le formulaire fusionne uniquement après chargement du carnet du même compte', async () => {
  const cloud = { responsable: { nom: 'Parent A', secuNumero: 'conservé' }, enfants: [{ prenom: 'Aîné', nom: 'A' }] };
  const e = environment({ form: true, fetcher: async (url, options) => options.method === 'POST'
    ? response(null) : response([{ user_id: UID_A, donnees: cloud }]) });
  e.run('famille.js');
  await flush();
  e.doc.emit('av:demande-envoyee', { type: 'cours' });
  await flush();
  const post = e.calls.find(call => call.options.method === 'POST');
  assert.ok(post);
  const data = JSON.parse(post.options.body);
  assert.equal(data.user_id, UID_A);
  assert.equal(data.donnees.enfants.length, 2);
  assert.equal(data.donnees.responsable.secuNumero, 'conservé');
});

test('changer de compte dans un autre onglet vide le formulaire et bloque la synchronisation', async () => {
  const e = environment({ form: true, fetcher: async () => response([{ user_id: UID_A, donnees: carnet() }]) });
  e.run('famille.js'); await flush();
  assert.equal(e.doc.getElementById('parent-nom').value, 'Famille A');
  e.switchAccount(UID_B); e.emitStorage();
  assert.equal(e.doc.getElementById('parent-nom').value, '');
  e.doc.emit('av:demande-envoyee', { type: 'cours' }); await flush();
  assert.equal(e.calls.filter(call => call.options.method === 'POST').length, 0);
});

test('la page compte n’adopte jamais un carnet invité lors d’une panne', async () => {
  const e = environment({ account: true, fetcher: async () => response([], false) });
  e.api.ecrireFamilleLocale(carnet('invité'), null);
  e.run('compte.js'); await flush();
  assert.equal(e.confirmations.length, 0);
  assert.equal(e.calls.filter(call => call.options.method === 'POST').length, 0);
  assert.equal(e.api.lireFamilleLocale(null).responsable.nom, 'invité');
  assert.match(e.doc.getElementById('m-connexion').textContent, /Aucune information n’a été remplacée/);
});

test('un compte vide ne récupère pas le cache d’un autre compte', async () => {
  const e = environment({ current: session(UID_B), account: true });
  e.api.ecrireFamilleLocale(carnet('Autre famille'), session());
  e.run('compte.js'); await flush();
  assert.equal(e.confirmations.length, 0);
  assert.equal(e.calls.filter(call => call.options.method === 'POST').length, 0);
  assert.equal(e.doc.getElementById('c-nom').value, '');
});

test('un carnet invité nécessite un accord avant adoption par un compte vide', async () => {
  const e = environment({ account: true });
  e.api.ecrireFamilleLocale(carnet('invité'), null);
  e.run('compte.js'); await flush();
  assert.equal(e.confirmations.length, 1);
  assert.match(e.confirmations[0], /uniquement s’il s’agit de votre famille/);
  assert.equal(e.calls.filter(call => call.options.method === 'POST').length, 0);
});

test('un accord explicite importe le carnet invité dans le bon compte', async () => {
  const e = environment({ account: true });
  e.context.confirm = () => true;
  e.api.ecrireFamilleLocale(carnet('invité accepté'), null);
  e.run('compte.js'); await flush();
  const post = e.calls.find(call => call.options.method === 'POST');
  assert.equal(JSON.parse(post.options.body).user_id, UID_A);
  assert.equal(e.doc.getElementById('c-nom').value, 'invité accepté');
  assert.equal(e.doc.getElementById('v-famille').classList.contains('actif'), true);
  assert.equal(e.api.lireFamilleLocale(null), null);
  assert.equal(e.api.lireFamilleLocale(session()).responsable.nom, 'invité accepté');
});
