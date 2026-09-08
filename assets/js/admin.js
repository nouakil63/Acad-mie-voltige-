/* Espace académie — la page des demandes d'inscription.
   Réservée aux comptes de la liste « admins » (Supabase) : toutes les
   demandes s'affichent, et Valider / Refuser déclenche le même envoi
   de mail au parent que les boutons des mails de l'académie. */
(function () {
  'use strict';

  var nuage = window.AVNuage;
  if (!nuage) { return; }

  var SERVICE = window.AV_SERVICE_URL ||
    'https://script.google.com/macros/s/AKfycbwy3AdlqdFYKeCnOmMugR_KvsBHBbT7AOHvDsclWJoYJG0VpaW-U3GnD0WId-4FG4Kf/exec';

  var MOTIFS = { complet: 'Complet', age: 'Âge', gabarit: 'Gabarit', creneau: 'Créneau indisponible' };
  var VUES = ['a-attente', 'a-connexion', 'a-refuse', 'a-liste'];

  function el(id) { return document.getElementById(id); }
  function montrer(vue) {
    VUES.forEach(function (id) {
      var e = el(id);
      if (e) { e.classList.toggle('actif', id === vue); }
    });
  }
  function message(id, texte, bonne) {
    var m = el(id);
    if (!m) { return; }
    m.textContent = texte;
    m.className = 'message ' + (bonne ? 'bonne' : 'souci');
    m.hidden = false;
  }

  var demandes = [];
  var filtre = 'toutes';

  function classeStatut(statut) {
    if (statut === 'validée') { return 'validee'; }
    if (String(statut || '').indexOf('refusée') === 0) { return 'refusee'; }
    return 'attente';
  }

  function quandLisible(iso) {
    if (!iso) { return ''; }
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---- une carte par demande ---- */
  function carte(d) {
    var c = document.createElement('div');
    c.className = 'carte-demande';

    var entete = document.createElement('div');
    entete.className = 'entete';
    var type = document.createElement('span');
    type.className = 'pastille ' + (d.type === 'stage' ? 'type-stage' : 'type-cours');
    type.textContent = d.type === 'stage' ? 'Stage' : 'Cours';
    entete.appendChild(type);
    var nom = document.createElement('b');
    nom.textContent = d.enfant || 'Voltigeur';
    entete.appendChild(nom);
    var statut = document.createElement('span');
    statut.className = 'pastille ' + classeStatut(d.statut);
    statut.textContent = d.statut || 'en attente';
    entete.appendChild(statut);
    var quand = document.createElement('span');
    quand.className = 'quand';
    quand.textContent = quandLisible(d.cree);
    entete.appendChild(quand);
    c.appendChild(entete);

    var corps = document.createElement('div');
    corps.className = 'corps';
    corps.textContent = (d.parent_nom || 'Parent') + ' · ' + (d.parent_email || '') +
      (d.detail ? ' · ' + d.detail : '') + (d.tarif ? ' · ' + d.tarif : '');
    c.appendChild(corps);

    if (d.lignes) {
      var plus = document.createElement('details');
      var resume = document.createElement('summary');
      resume.textContent = 'Tout le dossier';
      plus.appendChild(resume);
      var pre = document.createElement('pre');
      pre.textContent = d.lignes;
      plus.appendChild(pre);
      c.appendChild(plus);
    }

    if (classeStatut(d.statut) === 'attente' && d.jeton_d && d.jeton_s) {
      var actions = document.createElement('div');
      actions.className = 'actions';

      var valider = document.createElement('button');
      valider.type = 'button';
      valider.className = 'btn btn-rouge';
      valider.innerHTML = '<span>✅ Valider</span>';
      valider.addEventListener('click', function () { decider(d, 'valider', null, c); });
      actions.appendChild(valider);

      var motif = document.createElement('select');
      motif.setAttribute('aria-label', 'Motif du refus');
      Object.keys(MOTIFS).forEach(function (cle) {
        var o = document.createElement('option');
        o.value = cle;
        o.textContent = 'Motif : ' + MOTIFS[cle];
        motif.appendChild(o);
      });
      actions.appendChild(motif);

      var refuser = document.createElement('button');
      refuser.type = 'button';
      refuser.className = 'btn btn-contour';
      refuser.innerHTML = '<span>❌ Refuser</span>';
      refuser.addEventListener('click', function () { decider(d, 'refuser', motif.value, c); });
      actions.appendChild(refuser);

      var etat = document.createElement('span');
      etat.className = 'quand';
      etat.style.marginLeft = '0';
      actions.appendChild(etat);
      c.appendChild(actions);
      c.etatAction = etat;
      c.boutons = [valider, refuser];
    }
    return c;
  }

  function afficher() {
    var conteneur = el('a-demandes');
    conteneur.innerHTML = '';
    var visibles = demandes.filter(function (d) {
      if (filtre === 'toutes') { return true; }
      if (filtre === 'en attente') { return classeStatut(d.statut) === 'attente'; }
      if (filtre === 'validée') { return classeStatut(d.statut) === 'validee'; }
      return classeStatut(d.statut) === 'refusee';
    });
    if (!visibles.length) {
      var vide = document.createElement('p');
      vide.className = 'aide';
      vide.textContent = demandes.length
        ? 'Aucune demande dans cette catégorie.'
        : 'Aucune demande pour l’instant. Elles apparaîtront ici dès qu’un parent enverra une inscription depuis le site.';
      conteneur.appendChild(vide);
      return;
    }
    visibles.forEach(function (d) { conteneur.appendChild(carte(d)); });
  }

  /* ---- valider ou refuser : même mécanique que les mails ---- */
  function decider(d, action, motifCle, carteEl) {
    var question = action === 'valider'
      ? 'Valider la demande de ' + (d.enfant || 'ce voltigeur') + ' ? Le parent reçoit aussitôt le mail avec le lien de paiement.'
      : 'Refuser la demande de ' + (d.enfant || 'ce voltigeur') + ' (motif : ' + (MOTIFS[motifCle] || motifCle) + ') ? Le parent reçoit un message courtois avec ce motif.';
    if (!confirm(question)) { return; }

    carteEl.boutons.forEach(function (b) { b.disabled = true; });
    carteEl.etatAction.textContent = 'Envoi en cours…';

    var corps = { type: 'decision', action: action, d: d.jeton_d, s: d.jeton_s };
    if (action === 'refuser') { corps.motif = motifCle; }

    fetch(SERVICE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corps)
    }).then(function (r) { return r.text(); }).then(function (t) {
      var morceaux = t.trim().split(';');
      if (morceaux[0] !== 'ok valide' && morceaux[0] !== 'ok refuse') {
        carteEl.boutons.forEach(function (b) { b.disabled = false; });
        carteEl.etatAction.textContent = 'Souci : « ' + t.trim().slice(0, 120) + ' ». Réessayez, ou utilisez les boutons du mail.';
        return;
      }
      var statut = morceaux[0] === 'ok valide'
        ? 'validée'
        : 'refusée (' + (MOTIFS[motifCle] || motifCle) + ')';
      d.statut = statut;
      d.decide = new Date().toISOString();
      /* le service note aussi le statut ; cette mise à jour rend la page exacte tout de suite */
      nuage.requeteAuth('/rest/v1/demandes?id=eq.' + encodeURIComponent(d.id), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ statut: statut, decide: d.decide })
      });
      afficher();
    }).catch(function () {
      carteEl.boutons.forEach(function (b) { b.disabled = false; });
      carteEl.etatAction.textContent = 'Le service n’a pas répondu. Vérifiez votre connexion et réessayez.';
    });
  }

  /* ---- chargement et accès ---- */
  function charger() {
    montrer('a-liste');
    message('m-liste', 'Chargement des demandes…', true);
    nuage.requeteAuth('/rest/v1/demandes?select=*&order=cree.desc&limit=200')
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (l) {
        if (!l) { message('m-liste', 'Impossible de charger les demandes. Rechargez la page dans un instant.'); return; }
        demandes = l;
        el('m-liste').hidden = true;
        afficher();
      })
      .catch(function () { message('m-liste', 'Impossible de charger les demandes. Rechargez la page dans un instant.'); });
  }

  function entrer() {
    montrer('a-attente');
    nuage.retrouverEmail().then(function (s) {
      if (!s) { montrer('a-connexion'); return; }
      nuage.requeteAuth('/rest/v1/admins?select=email&limit=1')
        .then(function (r) { return r && r.ok ? r.json() : []; })
        .then(function (l) {
          if (!l.length) { montrer('a-refuse'); return; }
          el('a-compte').textContent = s.email || '';
          charger();
        })
        .catch(function () { montrer('a-refuse'); });
    });
  }

  el('a-connexion').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = el('ad-email').value.trim(), mdp = el('ad-mdp').value;
    if (!/.+@.+\..+/.test(email) || !mdp) { message('m-admin', 'Indiquez votre e-mail et votre mot de passe.'); return; }
    message('m-admin', 'Connexion…', true);
    nuage.connexion(email, mdp).then(function (r) {
      if (r.erreur) { message('m-admin', r.erreur); return; }
      entrer();
    });
  });

  el('a-rafraichir').addEventListener('click', function (ev) {
    ev.preventDefault();
    charger();
  });

  el('a-filtres').addEventListener('click', function (ev) {
    var bouton = ev.target.closest('[data-filtre]');
    if (!bouton) { return; }
    filtre = bouton.getAttribute('data-filtre');
    el('a-filtres').querySelectorAll('[data-filtre]').forEach(function (b) {
      b.classList.toggle('actif-filtre', b === bouton);
    });
    afficher();
  });

  if (!nuage.configure()) { montrer('a-refuse'); return; }
  entrer();
})();
