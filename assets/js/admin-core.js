/* Règles partagées du CRM, indépendantes du DOM et testables sans service distant. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.AVCrmCore = api; }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function money(value) {
    if (typeof value === 'number') { return Number.isFinite(value) ? value : 0; }
    var text = String(value || '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    var match = text.match(/-?\d+(?:\.\d+)?/);
    return match ? Math.round(Number(match[0]) * 100) / 100 : 0;
  }
  function total(d) { return money(d.tarif) || (d.type === 'stage' ? 840 : 0); }
  function deposit(d) { return Math.min(300, Math.max(0, total(d))); }
  function paid(d) {
    if (d.type === 'stage') {
      return (d.acompte_paye ? deposit(d) : 0) + (d.solde_paye ? Math.max(total(d) - deposit(d), 0) : 0);
    }
    return d.paye ? Math.max(0, money(d.paye_montant || d.tarif)) : 0;
  }
  function due(d) {
    if (d.annule || d.statut !== 'validée') { return 0; }
    return Math.max(0, Math.round((total(d) - paid(d)) * 100) / 100);
  }
  function validateTariff(d, tarif) {
    var montant = money(tarif);
    if (montant <= 0) { return 'Indiquez un tarif supérieur à zéro.'; }
    if (montant < paid(d)) {
      return 'Le tarif ne peut pas être inférieur au montant déjà encaissé. Corrigez d’abord le suivi du règlement.';
    }
    if (Math.round(paid(Object.assign({}, d, { tarif: tarif })) * 100) !== Math.round(paid(d) * 100)) {
      return 'Ce changement de tarif modifierait un encaissement déjà enregistré. Conservez ce tarif et vérifiez d’abord les règlements du dossier.';
    }
    return '';
  }
  function totalPaymentPatch(d, day) {
    return {
      acompte_paye: true,
      acompte_le: d.acompte_paye ? d.acompte_le || null : day,
      solde_paye: true,
      solde_le: d.solde_paye ? d.solde_le || null : day,
      paye: true,
      paye_le: d.paye ? d.paye_le || null : day,
      paye_montant: d.tarif || ''
    };
  }
  function restoreError(d) {
    return money(d.rembourse_montant) > 0
      ? 'Un remboursement est déclaré sur cette inscription. Créez une nouvelle demande pour préserver son historique.' : '';
  }
  function receivedInMonth(d, month) {
    // Encaissements bruts : une annulation ne supprime pas les versements reçus.
    // Les remboursements déclarés sont présentés séparément dans le CRM.
    function during(day) { return String(day || '').slice(0, 7) === month; }
    if (d.type === 'stage') {
      return (d.acompte_paye && during(d.acompte_le) ? deposit(d) : 0) +
        (d.solde_paye && during(d.solde_le) ? Math.max(total(d) - deposit(d), 0) : 0);
    }
    return during(d.paye_le) ? paid(d) : 0;
  }
  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function matches(d, query) {
    var haystack = normalize([d.enfant, d.parent_nom, d.parent_email, d.detail, d.tarif, d.statut].join(' '));
    return normalize(query).split(/\s+/).every(function (word) { return haystack.indexOf(word) !== -1; });
  }
  function filterRequests(rows, options) {
    options = options || {};
    var filtered = rows.filter(function (d) {
      if (!matches(d, options.query)) { return false; }
      if (options.type && options.type !== 'tous' && d.type !== options.type) { return false; }
      if (options.status && options.status !== 'toutes' && String(d.statut).indexOf(options.status) !== 0) { return false; }
      var course = d.type !== 'stage' && d.statut === 'validée' && !d.annule;
      if (options.followup === 'a-appeler' && (!course || d.cours_date)) { return false; }
      if (options.followup === 'planifies' && (!course || !d.cours_date)) { return false; }
      if (options.followup === 'a-encaisser' && due(d) <= 0) { return false; }
      return true;
    });
    return filtered.sort(function (a, b) {
      if (options.sort === 'enfant') { return String(a.enfant || '').localeCompare(String(b.enfant || ''), 'fr'); }
      var order = String(a.cree || '').localeCompare(String(b.cree || '')) || String(a.id || '').localeCompare(String(b.id || ''));
      return options.sort === 'ancien' ? order : -order;
    });
  }
  function time(value) {
    var match = String(value || '').trim().match(/^(\d{1,2})\s*[:h]\s*(\d{0,2})$/i);
    if (!match || Number(match[1]) > 23 || Number(match[2] || 0) > 59) { return ''; }
    return String(Number(match[1])).padStart(2, '0') + ':' + String(Number(match[2] || 0)).padStart(2, '0');
  }
  function scheduleKey(d) { return d.cours_date + '|' + (time(d.cours_heure) || String(d.cours_heure || '').trim()); }
  function validateSchedule(day, hour, today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) { return 'Choisissez une date de cours.'; }
    var date = new Date(day + 'T12:00:00');
    if (isNaN(date.getTime()) || date.getFullYear() !== Number(day.slice(0, 4)) || date.getMonth() + 1 !== Number(day.slice(5, 7)) || date.getDate() !== Number(day.slice(8, 10))) {
      return 'Cette date n’existe pas.';
    }
    if (today && day < today) { return 'Choisissez aujourd’hui ou une date à venir.'; }
    if (date.getDay() !== 6) { return 'Les cours ont lieu le samedi. Choisissez un samedi.'; }
    if (!time(hour)) { return 'Indiquez une heure valide, par exemple 10:00.'; }
    return '';
  }

  // On ne conclut jamais qu'une liste est complète parce qu'une page est courte :
  // le projet Supabase peut imposer une limite inférieure à celle demandée.
  async function loadAll(request, path, key) {
    var rows = [], seen = new Set(), offset = 0, expected = null;
    for (var page = 0; page < 1000; page++) {
      var response = await request(path + (path.indexOf('?') === -1 ? '?' : '&') + 'limit=500&offset=' + offset,
        { headers: { Prefer: 'count=exact' } });
      if (!response || !response.ok) {
        throw new Error(response && (response.status === 401 || response.status === 403)
          ? 'Votre session ne permet plus cet accès. Reconnectez-vous.' : 'Chargement interrompu. Vérifiez votre connexion et réessayez.');
      }
      var data = await response.json();
      if (!Array.isArray(data)) { throw new Error('Le service a renvoyé une liste invalide.'); }
      var range = response.headers && response.headers.get('Content-Range');
      var match = range && range.match(/\/(\d+)$/);
      var count = match ? Number(match[1]) : null;
      if (expected !== null && count !== null && count !== expected) { throw new Error('Les données ont changé pendant le chargement. Actualisez pour obtenir une liste complète.'); }
      if (count !== null) { expected = count; }
      data.forEach(function (row) {
        if (key && row[key] != null) {
          if (seen.has(row[key])) { throw new Error('Les données ont changé pendant le chargement. Actualisez la liste.'); }
          seen.add(row[key]);
        }
        rows.push(row);
      });
      offset += data.length;
      if (expected !== null && offset >= expected) { return rows; }
      if (!data.length) {
        if (expected !== null && offset < expected) { throw new Error('La liste reçue est incomplète. Actualisez pour réessayer.'); }
        return rows;
      }
    }
    throw new Error('La liste est trop volumineuse pour être chargée intégralement. Aucun total partiel n’a été appliqué.');
  }
  return { money: money, total: total, deposit: deposit, paid: paid, due: due, receivedInMonth: receivedInMonth,
    validateTariff: validateTariff, totalPaymentPatch: totalPaymentPatch, restoreError: restoreError,
    normalize: normalize, matches: matches, filterRequests: filterRequests, time: time, scheduleKey: scheduleKey,
    validateSchedule: validateSchedule, loadAll: loadAll };
}));
