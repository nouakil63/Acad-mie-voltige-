/* Espace académie — la plateforme d'administration (dossier /admin/).
   Réservée aux comptes de la liste « admins » (Supabase) :
   - Les demandes : toutes les demandes d'inscription, à valider ou
     refuser en un clic (même mécanique que les boutons des mails).
   - La base clients : tous les comptes familles avec leurs voltigeurs. */
(function () {
  'use strict';

  var nuage = window.AVNuage;
  if (!nuage) { return; }

  var SERVICE = window.AV_SERVICE_URL ||
    'https://script.google.com/macros/s/AKfycbwy3AdlqdFYKeCnOmMugR_KvsBHBbT7AOHvDsclWJoYJG0VpaW-U3GnD0WId-4FG4Kf/exec';

  var MOTIFS = { complet: 'Complet', age: 'Âge', gabarit: 'Gabarit', creneau: 'Créneau indisponible' };
  var VUES = ['p-attente', 'p-connexion', 'p-refuse', 'p-tableau'];

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
  var familles = [];
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

  function majCompteurs() {
    el('c-demandes').textContent = String(demandes.length);
    el('c-attente').textContent = String(demandes.filter(function (d) { return classeStatut(d.statut) === 'attente'; }).length);
    el('c-familles').textContent = String(familles.length);
  }

  /* ================= Les demandes ================= */
  function carteDemande(d) {
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

  function afficherDemandes() {
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
    visibles.forEach(function (d) { conteneur.appendChild(carteDemande(d)); });
    majCompteurs();
  }

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
      afficherDemandes();
    }).catch(function () {
      carteEl.boutons.forEach(function (b) { b.disabled = false; });
      carteEl.etatAction.textContent = 'Le service n’a pas répondu. Vérifiez votre connexion et réessayez.';
    });
  }

  function chargerDemandes() {
    message('m-liste', 'Chargement des demandes…', true);
    return nuage.requeteAuth('/rest/v1/demandes?select=*&order=cree.desc&limit=200')
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (l) {
        if (!l) { message('m-liste', 'Impossible de charger les demandes. Rechargez la page dans un instant.'); return; }
        demandes = l;
        el('m-liste').hidden = true;
        afficherDemandes();
      })
      .catch(function () { message('m-liste', 'Impossible de charger les demandes. Rechargez la page dans un instant.'); });
  }

  /* ================= La base clients ================= */
  function carteFamille(f) {
    var d = f.donnees || {};
    var r = d.responsable || {};
    var c = document.createElement('div');
    c.className = 'carte-famille';

    var entete = document.createElement('div');
    entete.className = 'entete';
    var nom = document.createElement('b');
    nom.textContent = r.nom || f.email || 'Famille';
    entete.appendChild(nom);
    if (r.qualite) {
      var q = document.createElement('span');
      q.className = 'pastille type-stage';
      q.textContent = r.qualite;
      entete.appendChild(q);
    }
    var quand = document.createElement('span');
    quand.className = 'quand';
    quand.textContent = f.maj ? 'mise à jour le ' + new Date(f.maj).toLocaleDateString('fr-FR') : '';
    entete.appendChild(quand);
    c.appendChild(entete);

    var corps = document.createElement('div');
    corps.className = 'corps';
    var contacts = [f.email, r.tel, [r.cp, r.ville].filter(Boolean).join(' ')].filter(Boolean);
    corps.textContent = contacts.join(' · ') || 'Aucune coordonnée renseignée.';
    c.appendChild(corps);

    var enfants = (d.enfants || []).filter(function (e) { return e && (e.prenom || e.nom); });
    if (enfants.length) {
      var ligne = document.createElement('div');
      enfants.forEach(function (e) {
        var puce = document.createElement('span');
        puce.className = 'enfant-ligne';
        var morceaux = ['🧒 ' + ((e.prenom + ' ' + (e.nom || '')).trim())];
        if (e.naissance) { morceaux.push('né(e) le ' + new Date(e.naissance).toLocaleDateString('fr-FR')); }
        if (e.gabarit) { morceaux.push(e.gabarit); }
        puce.textContent = morceaux.join(' · ');
        ligne.appendChild(puce);
      });
      c.appendChild(ligne);
    }

    var nbDemandes = (d.demandes || []).length;
    if (nbDemandes) {
      var note = document.createElement('div');
      note.className = 'corps';
      note.textContent = nbDemandes + (nbDemandes > 1 ? ' demandes envoyées' : ' demande envoyée') + ' depuis ce compte.';
      c.appendChild(note);
    }
    return c;
  }

  function afficherFamilles() {
    var conteneur = el('a-familles');
    conteneur.innerHTML = '';
    var mot = el('f-recherche').value.trim().toLowerCase();
    var visibles = familles.filter(function (f) {
      if (!mot) { return true; }
      return JSON.stringify(f).toLowerCase().indexOf(mot) !== -1;
    });
    if (!visibles.length) {
      var vide = document.createElement('p');
      vide.className = 'aide';
      vide.textContent = familles.length
        ? 'Aucune famille ne correspond à cette recherche.'
        : 'Aucun compte famille pour l’instant.';
      conteneur.appendChild(vide);
      return;
    }
    visibles.forEach(function (f) { conteneur.appendChild(carteFamille(f)); });
  }

  function chargerFamilles() {
    message('m-familles', 'Chargement de la base clients…', true);
    return nuage.requeteAuth('/rest/v1/familles?select=email,donnees,maj&order=maj.desc&limit=500')
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (l) {
        if (!l) { message('m-familles', 'Impossible de charger la base clients. Rechargez la page dans un instant.'); return; }
        familles = l;
        el('m-familles').hidden = true;
        afficherFamilles();
        majCompteurs();
      })
      .catch(function () { message('m-familles', 'Impossible de charger la base clients. Rechargez la page dans un instant.'); });
  }

  /* ================= Accès et navigation ================= */
  function entrer() {
    montrer('p-attente');
    nuage.retrouverEmail().then(function (s) {
      if (!s) { montrer('p-connexion'); return; }
      nuage.requeteAuth('/rest/v1/admins?select=email&limit=1')
        .then(function (r) {
          /* la table admins ne répond pas : l'installation SQL n'a pas été faite */
          if (!r || !r.ok) {
            montrer('p-refuse');
            el('p-refuse-detail').hidden = false;
            return null;
          }
          return r.json();
        })
        .then(function (l) {
          if (!l) { return; }
          if (!l.length) { montrer('p-refuse'); return; }
          el('p-compte').textContent = s.email || '';
          el('p-deconnexion').hidden = false;
          montrer('p-tableau');
          chargerDemandes();
          chargerFamilles();
        })
        .catch(function () { montrer('p-refuse'); });
    });
  }

  el('p-connexion').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = el('ad-email').value.trim(), mdp = el('ad-mdp').value;
    if (!/.+@.+\..+/.test(email) || !mdp) { message('m-admin', 'Indiquez votre e-mail et votre mot de passe.'); return; }
    message('m-admin', 'Connexion…', true);
    nuage.connexion(email, mdp).then(function (r) {
      if (r.erreur) { message('m-admin', r.erreur); return; }
      entrer();
    });
  });

  el('p-deconnexion').addEventListener('click', function (ev) {
    ev.preventDefault();
    nuage.deconnexion();
    el('p-compte').textContent = '';
    el('p-deconnexion').hidden = true;
    montrer('p-connexion');
  });

  document.querySelector('.onglets').addEventListener('click', function (ev) {
    var bouton = ev.target.closest('[data-onglet]');
    if (!bouton) { return; }
    var onglet = bouton.getAttribute('data-onglet');
    document.querySelectorAll('.onglets [data-onglet]').forEach(function (b) {
      b.classList.toggle('actif-onglet', b === bouton);
    });
    el('o-demandes').hidden = onglet !== 'demandes';
    el('o-familles').hidden = onglet !== 'familles';
  });

  el('a-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerDemandes(); });
  el('f-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerFamilles(); });
  el('f-recherche').addEventListener('input', afficherFamilles);

  el('a-filtres').addEventListener('click', function (ev) {
    var bouton = ev.target.closest('[data-filtre]');
    if (!bouton) { return; }
    filtre = bouton.getAttribute('data-filtre');
    el('a-filtres').querySelectorAll('[data-filtre]').forEach(function (b) {
      b.classList.toggle('actif-filtre', b === bouton);
    });
    afficherDemandes();
  });

  if (!nuage.configure()) { montrer('p-refuse'); return; }
  entrer();
})();
