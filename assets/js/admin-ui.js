/* Présentation du CRM, sans accès réseau ni stockage métier.
   AVCrmUI.form(options) -> Promise<object|null> : valeurs chaînes, null si annulé.
   Champs : name, label, type, value, required, options [{value,label}],
   min, max, step, placeholder, help. Types natifs + select et textarea.
   Options : onChange(name, value, controls) à chaque événement change natif ;
   controls associe chaque name à son contrôle DOM, modifiable sans événement induit.
   validate(values), synchrone, renvoie un message d'erreur ou '' si valide.
   AVCrmUI.confirm(options) -> Promise<boolean>.
   AVCrmUI.toast(texte, {error}) : succès temporaire, erreur persistante.
   AVCrmUI.setPage(onglet) : titre, description et état de navigation accessible. */
(function () {
  'use strict';

  var sequence = 0;
  var pending = Promise.resolve();
  var pageActive = '';
  var activeDialogCloser = null;
  var pages = {
    accueil: { title: 'Accueil', description: 'L’essentiel pour organiser la journée.' },
    demandes: { title: 'Demandes', description: 'Inscriptions et demandes à traiter.' },
    reservations: { title: 'Planning', description: 'Cours, stages et participants.' },
    paiements: { title: 'Paiements', description: 'Règlements, échéances et remboursements.' },
    familles: { title: 'Familles', description: 'Coordonnées et suivi des familles.' }
  };

  function el(id) { return document.getElementById(id); }
  function node(tag, className, text) {
    var item = document.createElement(tag);
    if (className) { item.className = className; }
    if (text != null) { item.textContent = String(text); }
    return item;
  }
  function announce(text, error) {
    var region = el(error ? 'crm-live-alert' : 'crm-live-status');
    if (!region) { return; }
    region.textContent = '';
    window.setTimeout(function () { region.textContent = String(text || ''); }, 30);
  }
  function setPage(key) {
    var page = pages[key];
    if (!page) { return; }
    if (el('crm-page-title')) { el('crm-page-title').textContent = page.title; }
    if (el('crm-page-description')) { el('crm-page-description').textContent = page.description; }
    if (el('crm-meta-description')) { el('crm-meta-description').content = page.description; }
    document.title = page.title + ' — Espace académie';
    document.querySelectorAll('.onglets [data-onglet]').forEach(function (button) {
      var active = button.getAttribute('data-onglet') === key;
      if (active) { button.setAttribute('aria-current', 'page'); }
      else { button.removeAttribute('aria-current'); }
      button.setAttribute('aria-controls', 'o-' + button.getAttribute('data-onglet'));
    });
    if (pageActive && pageActive !== key) { announce(page.title); }
    pageActive = key;
  }

  // Le body fixe évite que Safari fasse défiler la liste derrière le formulaire.
  // À la fermeture, la liste retrouve exactement sa position précédente.
  function lockPageScroll() {
    var body = document.body;
    var root = document.documentElement;
    var x = window.scrollX || 0, y = window.scrollY || 0;
    var properties = ['position', 'top', 'left', 'right', 'width', 'overflow', 'paddingRight'];
    var previous = {};
    properties.forEach(function (property) { previous[property] = body.style[property]; });
    var scrollbar = Math.max(0, window.innerWidth - root.clientWidth);
    if (scrollbar) {
      body.style.paddingRight = ((parseFloat(window.getComputedStyle(body).paddingRight) || 0) + scrollbar) + 'px';
    }
    body.style.position = 'fixed';
    body.style.top = -y + 'px';
    body.style.left = -x + 'px';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    body.classList.add('crm-dialog-open');
    return function () {
      properties.forEach(function (property) { body.style[property] = previous[property]; });
      body.classList.remove('crm-dialog-open');
      var behavior = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      window.scrollTo(x, y);
      root.style.scrollBehavior = behavior;
    };
  }

  function closeDialog() {
    if (!activeDialogCloser) { return false; }
    activeDialogCloser(null);
    return true;
  }

  function openForm(options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var previousFocus = document.activeElement;
      var prefix = 'crm-dialog-' + (++sequence);
      var dialog = node('dialog', 'crm-dialog' + (options.danger ? ' crm-dialog-danger' : ''));
      dialog.setAttribute('aria-labelledby', prefix + '-title');
      dialog.setAttribute('aria-modal', 'true');
      var form = node('form', 'crm-dialog-form');
      form.noValidate = true;
      var header = node('header', 'crm-dialog-header');
      var close = node('button', 'crm-dialog-back');
      close.type = 'button';
      close.setAttribute('aria-label', 'Retour et annuler');
      var backIcon = node('span', 'crm-dialog-back-icon', '←');
      backIcon.setAttribute('aria-hidden', 'true');
      close.appendChild(backIcon);
      close.appendChild(node('span', '', 'Retour'));
      header.appendChild(close);
      var title = node('h2', 'crm-dialog-title', options.title || 'Modifier');
      title.id = prefix + '-title';
      title.tabIndex = -1;
      header.appendChild(title);
      form.appendChild(header);
      var body = node('div', 'crm-dialog-body');
      if (options.description) {
        var description = node('p', 'crm-dialog-description', options.description);
        description.id = prefix + '-description';
        body.appendChild(description);
        dialog.setAttribute('aria-describedby', description.id);
      }
      var businessError = node('p', 'message souci');
      businessError.id = prefix + '-error';
      businessError.setAttribute('role', 'alert');
      businessError.setAttribute('aria-live', 'assertive');
      businessError.tabIndex = -1;
      businessError.hidden = true;
      body.appendChild(businessError);
      function clearBusinessError() {
        businessError.hidden = true;
        businessError.textContent = '';
      }
      function showBusinessError(message) {
        businessError.textContent = String(message);
        businessError.hidden = false;
        businessError.focus();
      }
      var fields = node('div', 'crm-dialog-fields');
      var controls = [];
      var controlsByName = Object.create(null);
      (options.fields || []).forEach(function (field, index) {
        var group = node('div', 'champ');
        var label = node('label', '', field.label || field.name);
        var id = prefix + '-field-' + index;
        label.htmlFor = id;
        if (field.required) {
          var required = node('span', 'crm-field-required', ' *');
          required.setAttribute('aria-hidden', 'true');
          label.appendChild(required);
          label.appendChild(node('span', 'sr-only', ' (obligatoire)'));
        }
        group.appendChild(label);
        var input;
        if (field.type === 'select') {
          input = node('select');
          if (field.placeholder) {
            var placeholder = node('option', '', field.placeholder);
            placeholder.value = '';
            input.appendChild(placeholder);
          }
          (field.options || []).forEach(function (choice) {
            var option = node('option', '', choice.label == null ? choice.value : choice.label);
            option.value = String(choice.value == null ? '' : choice.value);
            input.appendChild(option);
          });
        } else if (field.type === 'textarea') {
          input = node('textarea');
          input.rows = 4;
        } else {
          input = node('input');
          var types = ['text', 'email', 'number', 'date', 'time', 'datetime-local', 'tel', 'url', 'password'];
          input.type = types.indexOf(field.type) >= 0 ? field.type : 'text';
          if (input.type === 'number') { input.step = field.step == null ? 'any' : String(field.step); }
        }
        input.id = id;
        input.name = field.name || 'field' + index;
        input.required = !!field.required;
        if (field.value != null) { input.value = String(field.value); }
        if (field.placeholder && field.type !== 'select') { input.placeholder = String(field.placeholder); }
        ['min', 'max', 'step'].forEach(function (attribute) {
          if (field[attribute] != null) { input.setAttribute(attribute, String(field[attribute])); }
        });
        group.appendChild(input);
        if (field.help) {
          var help = node('p', 'crm-field-help', field.help);
          help.id = id + '-help';
          input.setAttribute('aria-describedby', help.id);
          group.appendChild(help);
        }
        input.addEventListener('input', function () {
          input.setCustomValidity('');
          input.removeAttribute('aria-invalid');
          clearBusinessError();
        });
        input.addEventListener('change', function () {
          input.setCustomValidity('');
          input.removeAttribute('aria-invalid');
          clearBusinessError();
          if (typeof options.onChange === 'function') {
            try { options.onChange(input.name, input.value, controlsByName); }
            catch (error) { showBusinessError(error.message || 'Cette modification n’a pas pu être appliquée. Vérifiez les champs.'); }
          }
        });
        fields.appendChild(group);
        controls.push(input);
        controlsByName[input.name] = input;
      });
      body.appendChild(fields);
      form.appendChild(body);
      var actions = node('footer', 'crm-dialog-actions');
      var cancel = node('button', 'btn btn-contour', 'Annuler');
      cancel.type = 'button';
      var submit = node('button', 'btn btn-rouge', options.submitLabel || 'Enregistrer');
      submit.type = 'submit';
      actions.appendChild(cancel);
      actions.appendChild(submit);
      form.appendChild(actions);
      dialog.appendChild(form);
      document.body.appendChild(dialog);
      var releaseScroll = lockPageScroll();
      var viewport = window.visualViewport;
      function resizeDialog() {
        dialog.style.setProperty('--crm-dialog-viewport-height', (viewport ? viewport.height : window.innerHeight) + 'px');
        dialog.style.setProperty('--crm-dialog-viewport-top', (viewport ? viewport.offsetTop : 0) + 'px');
        // Le clavier réduit uniquement le contenu défilant, les actions restent accessibles.
        var focused = document.activeElement;
        if (focused && body.contains(focused)) {
          var contentRect = body.getBoundingClientRect();
          var focusRect = focused.getBoundingClientRect();
          if (focusRect.bottom > contentRect.bottom - 20) { body.scrollTop += focusRect.bottom - contentRect.bottom + 20; }
          else if (focusRect.top < contentRect.top + 20) { body.scrollTop -= contentRect.top - focusRect.top + 20; }
        }
      }
      if (viewport) {
        viewport.addEventListener('resize', resizeDialog);
        viewport.addEventListener('scroll', resizeDialog);
      }
      window.addEventListener('resize', resizeDialog);
      resizeDialog();
      var settled = false;
      function finish(value, error) {
        if (settled) { return; }
        settled = true;
        activeDialogCloser = null;
        if (viewport) {
          viewport.removeEventListener('resize', resizeDialog);
          viewport.removeEventListener('scroll', resizeDialog);
        }
        window.removeEventListener('resize', resizeDialog);
        if (dialog.open) { dialog.close(); }
        dialog.remove();
        releaseScroll();
        if (previousFocus && previousFocus.isConnected && previousFocus.getClientRects().length && !previousFocus.disabled) {
          previousFocus.focus({ preventScroll: true });
        } else if (el('crm-page-title')) { el('crm-page-title').focus({ preventScroll: true }); }
        if (error) { reject(error); }
        else { resolve(value); }
      }
      activeDialogCloser = finish;
      close.addEventListener('click', function () { finish(null); });
      cancel.addEventListener('click', function () { finish(null); });
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); finish(null); });
      dialog.addEventListener('close', function () { if (!settled) { finish(null); } });
      dialog.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { event.preventDefault(); finish(null); return; }
        if (event.key !== 'Tab') { return; }
        var focusable = Array.prototype.filter.call(dialog.querySelectorAll('button,input,select,textarea,[tabindex="0"]'), function (control) {
          return !control.disabled && control.getClientRects().length;
        });
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === title || document.activeElement === businessError)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      });
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        clearBusinessError();
        var firstInvalid = null;
        controls.forEach(function (input) {
          input.setCustomValidity(input.required && !input.value.trim() ? 'Renseignez ce champ.' : '');
          if (!input.checkValidity()) {
            input.setAttribute('aria-invalid', 'true');
            if (!firstInvalid) { firstInvalid = input; }
          } else { input.removeAttribute('aria-invalid'); }
        });
        if (firstInvalid) { firstInvalid.focus(); firstInvalid.reportValidity(); return; }
        var result = {};
        controls.forEach(function (input) {
          Object.defineProperty(result, input.name, { value: input.value, enumerable: true, writable: true, configurable: true });
        });
        if (typeof options.validate === 'function') {
          var errorMessage;
          try { errorMessage = options.validate(result); }
          catch (error) { errorMessage = error.message || 'Le formulaire n’a pas pu être vérifié. Réessayez.'; }
          if (errorMessage) { showBusinessError(errorMessage); return; }
        }
        finish(result);
      });
      try { dialog.showModal(); }
      catch (error) {
        finish(null, error);
        return;
      }
      // L’ouverture d’un écran mobile ne doit pas déclencher le clavier à elle seule.
      var mobile = window.matchMedia('(max-width:860px)').matches;
      var initialFocus = mobile ? title : (controls[0] || (options.danger ? cancel : submit));
      initialFocus.focus({ preventScroll: true });
    });
  }

  function form(options) {
    var task = pending.then(function () { return openForm(options); });
    pending = task.catch(function () {});
    return task;
  }
  function confirm(options) {
    options = options || {};
    return form({ title: options.title || 'Confirmer', description: options.description,
      submitLabel: options.submitLabel || 'Confirmer', danger: options.danger, fields: []
    }).then(function (result) { return result !== null; });
  }
  function toast(text, options) {
    options = options || {};
    var container = el('crm-toasts');
    announce(text, !!options.error);
    if (!container) { return; }
    var item = node('div', 'crm-toast' + (options.error ? ' crm-toast-error' : ''));
    var content = node('p', '', text);
    var close = node('button', 'crm-toast-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Fermer la notification');
    item.appendChild(content);
    item.appendChild(close);
    container.appendChild(item);
    var timer;
    function remove() {
      window.clearTimeout(timer);
      var hadFocus = item.contains(document.activeElement);
      item.remove();
      if (hadFocus && el('crm-page-title')) { el('crm-page-title').focus({ preventScroll: true }); }
    }
    function schedule() {
      window.clearTimeout(timer);
      if (!options.error && !item.contains(document.activeElement)) { timer = window.setTimeout(remove, 8000); }
    }
    close.addEventListener('click', remove);
    item.addEventListener('mouseenter', function () { window.clearTimeout(timer); });
    item.addEventListener('mouseleave', schedule);
    item.addEventListener('focusin', function () { window.clearTimeout(timer); });
    item.addEventListener('focusout', schedule);
    schedule();
  }

  window.AVCrmUI = { form: form, confirm: confirm, toast: toast, setPage: setPage,
    closeDialog: closeDialog, isDialogOpen: function () { return !!activeDialogCloser; } };
  window.addEventListener('popstate', closeDialog);
  var nav = document.querySelector('.onglets');
  function syncNavigation() {
    var active = document.querySelector('.onglets .actif-onglet[data-onglet]');
    if (active) { setPage(active.getAttribute('data-onglet')); }
  }
  if (nav) {
    new MutationObserver(syncNavigation).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    syncNavigation();
  }
  var filters = el('a-filtres');
  function syncFilters() {
    if (!filters) { return; }
    filters.querySelectorAll('[data-filtre]').forEach(function (button) {
      button.setAttribute('aria-pressed', button.classList.contains('actif-filtre') ? 'true' : 'false');
    });
  }
  if (filters) {
    new MutationObserver(syncFilters).observe(filters, { subtree: true, attributes: true, attributeFilter: ['class'] });
    syncFilters();
  }

  var advancedFilters = document.querySelector('.crm-advanced-filters');
  if (advancedFilters) {
    var compactFilters = window.matchMedia('(max-width:860px)');
    function syncAdvancedLayout() { advancedFilters.open = !compactFilters.matches; }
    function syncAdvancedCount() {
      var count = [['f-type', 'tous'], ['f-suivi', 'tous'], ['f-tri', 'recent']].filter(function (field) {
        return el(field[0]) && el(field[0]).value !== field[1];
      }).length;
      if (el('crm-active-filters')) { el('crm-active-filters').textContent = count ? count + ' actif' + (count > 1 ? 's' : '') : ''; }
    }
    syncAdvancedLayout();
    syncAdvancedCount();
    compactFilters.addEventListener('change', syncAdvancedLayout);
    advancedFilters.addEventListener('change', syncAdvancedCount);
    // Les compteurs sont recalculés aussi lorsqu'un raccourci ouvre un dossier.
    if (el('resultats-demandes')) { new MutationObserver(syncAdvancedCount).observe(el('resultats-demandes'), { childList: true }); }
  }

  // Les cartes de synthèse pilotent une seule liste de paiements à la fois.
  // Des boutons natifs conservent l'accès clavier sans simuler un menu ARIA.
  var paymentViews = document.querySelector('.crm-payment-overview');
  if (paymentViews) {
    paymentViews.addEventListener('click', function (event) {
      var selected = event.target.closest('button[data-payment-view]');
      if (!selected || !paymentViews.contains(selected)) { return; }
      paymentViews.querySelectorAll('button[data-payment-view]').forEach(function (button) {
        var active = button === selected;
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', String(active));
        var panel = el(button.getAttribute('aria-controls'));
        if (panel) { panel.hidden = !active; }
      });
      var title = el('payment-title-' + selected.getAttribute('data-payment-view'));
      if (title) { announce(title.textContent); }
    });
  }
}());
