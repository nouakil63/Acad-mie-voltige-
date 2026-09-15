'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };

function events(target) {
  const listeners = new Map();
  target.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  };
  target.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  target.emit = (type, detail = {}) => {
    const event = { target, preventDefault() { this.defaultPrevented = true; }, ...detail };
    for (const fn of [...(listeners.get(type) || [])]) fn(event);
    return event;
  };
  target.listenerCount = type => listeners.get(type)?.size || 0;
  return target;
}

function environment({ mobile = true, scrollY = 1360 } = {}) {
  const document = { elements: new Map(), title: '', querySelector: () => null, querySelectorAll: () => [] };
  const settings = { failShow: false };
  class Element {
    constructor(tag) {
      events(this);
      this.tagName = tag;
      this.children = [];
      this.attrs = {};
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.value = '';
      this.scrollTop = 0;
      this.rect = { top: 0, bottom: 100 };
      const classes = new Set();
      this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
    }
    set id(id) { this._id = id; document.elements.set(id, this); }
    get id() { return this._id; }
    get isConnected() { return this === document.body || !!this.parent?.isConnected; }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
    contains(other) { return other === this || this.children.some(child => child.contains(other)); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name]; }
    removeAttribute(name) { delete this.attrs[name]; }
    focus() { document.activeElement = this; }
    getClientRects() { return this.isConnected && !this.hidden ? [this.rect] : []; }
    getBoundingClientRect() { return this.rect; }
    setCustomValidity(value) { this.validityMessage = value; }
    checkValidity() { return !this.validityMessage; }
    reportValidity() { return this.checkValidity(); }
    showModal() { if (settings.failShow) throw new Error('Cannot open dialog'); this.open = true; }
    close() { this.open = false; this.emit('close'); }
    querySelectorAll() { return descendants(this).filter(child => ['button', 'input', 'select', 'textarea'].includes(child.tagName) || child.tabIndex === 0); }
  }
  function descendants(parent) { return parent.children.flatMap(child => [child, ...descendants(child)]); }
  document.createElement = tag => new Element(tag);
  document.getElementById = id => document.elements.get(id) || null;
  document.body = new Element('body');
  document.documentElement = new Element('html');
  document.documentElement.clientWidth = mobile ? 390 : 1260;
  const trigger = new Element('button');
  document.body.appendChild(trigger);
  document.activeElement = trigger;
  const title = new Element('h1'); title.id = 'crm-page-title'; document.body.appendChild(title);
  const scrolls = [];
  const viewport = events({ height: 844, offsetTop: 0 });
  const window = events({ scrollX: 0, scrollY, innerWidth: mobile ? 390 : 1280, innerHeight: 844,
    visualViewport: viewport, setTimeout, clearTimeout, getComputedStyle: () => ({ paddingRight: '8px' }),
    scrollTo(x, y) { scrolls.push([x, y]); this.scrollX = x; this.scrollY = y; },
    matchMedia: () => ({ matches: mobile, addEventListener() {} })
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/admin-ui.js'), 'utf8'), {
    document, window, MutationObserver: class { observe() {} }, Promise, Array, Object, String, Number, Math, parseFloat
  }, { filename: 'admin-ui.js' });
  return { ui: window.AVCrmUI, document, window, viewport, scrolls, trigger, settings,
    dialog: () => document.body.children.find(child => child.tagName === 'dialog'),
    find: (className, within = document.body) => descendants(within).find(child => child.className?.split(' ').includes(className)),
    inputs: () => descendants(document.body).filter(child => ['input', 'textarea', 'select'].includes(child.tagName))
  };
}

test('mobile : Retour ferme le formulaire et retrouve la liste sans ouvrir le clavier au départ', async () => {
  const e = environment();
  e.document.body.style.position = 'relative';
  const result = e.ui.form({ title: 'Modifier le cours', fields: [{ name: 'date', type: 'date' }] });
  await flush();
  assert.equal(e.ui.isDialogOpen(), true);
  assert.equal(e.document.activeElement, e.find('crm-dialog-title'));
  assert.equal(e.document.body.style.position, 'fixed');
  assert.equal(e.document.body.style.top, '-1360px');
  assert.equal(e.dialog().attrs['aria-labelledby'], e.find('crm-dialog-title').id);
  e.find('crm-dialog-back').emit('click');
  assert.equal(await result, null);
  assert.equal(e.ui.isDialogOpen(), false);
  assert.equal(e.document.body.style.position, 'relative');
  assert.deepEqual(e.scrolls, [[0, 1360]]);
  assert.equal(e.document.activeElement, e.trigger);
  assert.equal(e.viewport.listenerCount('resize'), 0);
  assert.equal(e.viewport.listenerCount('scroll'), 0);
  assert.equal(e.window.listenerCount('resize'), 0);
});

test('clavier : la hauteur utile suit le viewport et le champ reste dans le contenu défilant', async () => {
  const e = environment();
  const result = e.ui.form({ fields: [{ name: 'note', type: 'textarea' }] });
  await flush();
  const content = e.find('crm-dialog-body');
  const input = e.inputs()[0];
  content.rect = { top: 100, bottom: 300 };
  input.rect = { top: 290, bottom: 340 };
  input.focus();
  e.viewport.height = 400;
  e.viewport.offsetTop = 25;
  e.viewport.emit('resize');
  assert.equal(e.dialog().style['--crm-dialog-viewport-height'], '400px');
  assert.equal(e.dialog().style['--crm-dialog-viewport-top'], '25px');
  assert.equal(content.scrollTop, 60);
  assert.deepEqual(e.scrolls, []);
  e.ui.closeDialog();
  await result;
});

test('validation et modification liée conservent le formulaire ouvert avant un enregistrement valide', async () => {
  const e = environment({ mobile: false });
  const result = e.ui.form({ title: 'Modifier le cours',
    fields: [{ name: 'date', value: '2026-09-20' }, { name: 'heure', value: '' }],
    onChange(name, value, controls) { if (name === 'date') controls.heure.value = '10:00'; },
    validate(values) { return values.heure ? '' : 'Choisissez une heure.'; }
  });
  await flush();
  const [date, heure] = e.inputs();
  assert.equal(e.document.activeElement, date);
  e.find('crm-dialog-form').emit('submit');
  assert.equal(e.ui.isDialogOpen(), true);
  assert.equal(e.document.activeElement.textContent, 'Choisissez une heure.');
  date.emit('change');
  assert.equal(heure.value, '10:00');
  e.find('crm-dialog-form').emit('submit');
  assert.deepEqual(JSON.parse(JSON.stringify(await result)), { date: '2026-09-20', heure: '10:00' });
  assert.equal(e.document.body.style.paddingRight, undefined);
});

test('les dialogues restent séquentiels ; retour navigateur et Échap annulent chacun une seule fois', async () => {
  const e = environment();
  const first = e.ui.confirm({ title: 'Première confirmation' });
  const second = e.ui.confirm({ title: 'Deuxième confirmation' });
  await flush();
  assert.equal(e.find('crm-dialog-title').textContent, 'Première confirmation');
  e.window.emit('popstate');
  assert.equal(await first, false);
  await flush();
  assert.equal(e.find('crm-dialog-title').textContent, 'Deuxième confirmation');
  assert.equal(e.document.body.children.filter(child => child.tagName === 'dialog').length, 1);
  e.dialog().emit('keydown', { key: 'Escape' });
  assert.equal(await second, false);
  assert.equal(e.ui.closeDialog(), false);
  assert.equal(e.scrolls.length, 2);
});

test('un échec d’ouverture libère le défilement et ne bloque pas le dialogue suivant', async () => {
  const e = environment();
  e.settings.failShow = true;
  await assert.rejects(e.ui.confirm({ title: 'Confirmer' }), /Cannot open dialog/);
  assert.equal(e.ui.isDialogOpen(), false);
  assert.equal(e.document.body.classList.contains('crm-dialog-open'), false);
  assert.equal(e.viewport.listenerCount('resize'), 0);
  assert.equal(e.dialog(), undefined);
  e.settings.failShow = false;
  const next = e.ui.confirm({ title: 'Réessayer' });
  await flush();
  e.find('crm-dialog-form').emit('submit');
  assert.equal(await next, true);
});
