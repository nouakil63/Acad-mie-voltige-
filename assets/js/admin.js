/* Espace académie — la plateforme d'administration (dossier /admin/).
   Réservée aux comptes de la liste « admins » (Supabase) :
   - Les demandes : valider ou refuser en un clic, télécharger le
     dossier d'inscription rempli.
   - Le planning des cours : les réservations des abonnés au trimestre.
   - La base clients : les comptes familles, et l'activation d'un
     trimestre après paiement. */
(function () {
  'use strict';

  var nuage = window.AVNuage;
  if (!nuage) { return; }

  var SERVICE = window.AV_SERVICE_URL ||
    'https://script.google.com/macros/s/AKfycbwy3AdlqdFYKeCnOmMugR_KvsBHBbT7AOHvDsclWJoYJG0VpaW-U3GnD0WId-4FG4Kf/exec';

  var MOTIFS = { complet: 'Complet', age: 'Âge', gabarit: 'Gabarit', creneau: 'Créneau indisponible' };
  var VUES = ['p-attente', 'p-connexion', 'p-refuse', 'p-tableau'];
  var DUREE_TRIMESTRE = 90; /* jours : 13 semaines de cours */

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
  var reservations = [];
  var abonnements = [];
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

  function jourLisible(iso) {
    var m = String(iso).split('-');
    return new Date(Number(m[0]), Number(m[1]) - 1, Number(m[2]), 12)
      .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function isoLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function majCompteurs() {
    el('c-demandes').textContent = String(demandes.length);
    el('c-attente').textContent = String(demandes.filter(function (d) { return classeStatut(d.statut) === 'attente'; }).length);
    el('c-familles').textContent = String(familles.length);
    var aujourdHui = isoLocal(new Date());
    el('c-resa').textContent = String(reservations.filter(function (r) { return r.date >= aujourdHui; }).length);
  }

  /* ================= Le dossier d'inscription rempli =================
     Chaque demande garde le texte de son dossier ; on le retraduit en
     fiche imprimable (la même que celle des parents), sans signature. */
  function dossierDepuisLignes(d) {
    var champs = {};
    String(d.lignes || '').split('\n').forEach(function (l) {
      var i = l.indexOf(' : ');
      if (i > 0) {
        var valeur = l.slice(i + 3).trim();
        champs[l.slice(0, i).trim()] = valeur === '—' ? '' : valeur;
      }
    });
    var morceauxNom = String(champs['Voltigeur'] || d.enfant || '').trim().split(/\s+/);
    var cpVille = String(champs['Code postal / ville'] || '').trim().split(/\s+/);
    return {
      type: d.type,
      annee: '2026/2027',
      formule: champs['Formule'] || champs['Stage'] || '',
      creneau: champs['Créneau'] || champs['Dates'] || '',
      tarif: champs['Tarif'] || d.tarif || '',
      enfantPrenom: morceauxNom.shift() || '',
      enfantNom: morceauxNom.join(' '),
      enfantNaissance: champs['Date de naissance'] || '',
      enfantLieu: champs['Né(e) à'] || '',
      nationalite: champs['Nationalité'] || '',
      sexe: champs['Sexe'] || '',
      gabarit: champs['Gabarit'] || '',
      niveau: champs['Niveau'] || '',
      qualite: champs['Qualité'] || '',
      parentNom: champs['Parent'] || d.parent_nom || '',
      adresse: champs['Adresse'] || '',
      cp: cpVille.shift() || '',
      ville: cpVille.join(' '),
      parentTel: champs['Téléphone'] || '',
      telDomicile: champs['Tél. domicile'] || '',
      parentEmail: champs['E-mail'] || d.parent_email || '',
      secuCaisse: champs['Sécurité sociale (caisse)'] || '',
      secuNumero: champs['N° couvrant l’enfant'] || champs["N° couvrant l'enfant"] || '',
      licence: champs['Licence FFE'] || '',
      recommandations: champs['Recommandations (allergies…)'] || champs['Santé / remarques'] || '',
      faitA: '',
      signeLe: champs['Signé en ligne'] || '',
      signature: ''
    };
  }

  function ouvrirDossier(d) {
    try { localStorage.setItem('av:dossier-admin', JSON.stringify(dossierDepuisLignes(d))); }
    catch (e) { return; }
    window.open('../dossier-rempli.html?apercu=admin', '_blank', 'noopener');
  }

  /* ================= Les demandes ================= */
  function carteDemande(d) {
    var c = document.createElement('div');
    c.className = 'carte-demande st-' + classeStatut(d.statut);

    var entete = document.createElement('div');
    entete.className = 'entete';
    var type = document.createElement('span');
    type.className = 'pastille ' + (d.type === 'stage' ? 'type-stage' : 'type-cours');
    type.textContent = d.type === 'stage' ? 'Stage' : 'Cours';
    entete.appendChild(type);
    var nom = document.createElement('span');
    nom.className = 'nom';
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

    var actions = document.createElement('div');
    actions.className = 'actions';

    if (classeStatut(d.statut) === 'attente' && d.jeton_d && d.jeton_s) {
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
      c.etatAction = etat;
      c.boutons = [valider, refuser];
    }

    var dossier = document.createElement('button');
    dossier.type = 'button';
    dossier.className = 'lien-doux';
    dossier.textContent = '📄 Dossier d’inscription rempli (imprimer / PDF)';
    dossier.addEventListener('click', function () { ouvrirDossier(d); });
    actions.appendChild(dossier);

    c.appendChild(actions);
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

  /* ================= Le planning des cours réservés ================= */
  function afficherReservations() {
    var conteneur = el('a-reservations');
    conteneur.innerHTML = '';
    var aujourdHui = isoLocal(new Date());
    var aVenir = reservations.filter(function (r) { return r.date >= aujourdHui; });
    if (!aVenir.length) {
      var vide = document.createElement('p');
      vide.className = 'aide';
      vide.textContent = 'Aucun cours réservé pour l’instant. Les réservations des abonnés au trimestre apparaîtront ici.';
      conteneur.appendChild(vide);
      return;
    }
    var parJour = {};
    aVenir.forEach(function (r) {
      (parJour[r.date] = parJour[r.date] || []).push(r);
    });
    Object.keys(parJour).sort().forEach(function (date) {
      var carte = document.createElement('div');
      carte.className = 'carte-jour';
      var titre = document.createElement('h3');
      titre.textContent = jourLisible(date) + ' · ' + parJour[date].length +
        (parJour[date].length > 1 ? ' voltigeurs' : ' voltigeur');
      carte.appendChild(titre);
      var liste = document.createElement('ul');
      parJour[date].forEach(function (r) {
        var li = document.createElement('li');
        li.textContent = '🧒 ' + (r.enfant || 'Voltigeur') + (r.email ? ' · ' + r.email : '');
        liste.appendChild(li);
      });
      carte.appendChild(liste);
      conteneur.appendChild(carte);
    });
  }

  function chargerReservations() {
    return nuage.requeteAuth('/rest/v1/reservations?select=*&order=date&limit=500')
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (l) {
        if (!l) { message('m-resa', 'Impossible de charger les réservations. Le SQL le plus récent a-t-il été joué dans Supabase ?'); return; }
        reservations = l;
        el('m-resa').hidden = true;
        afficherReservations();
        majCompteurs();
      })
      .catch(function () { message('m-resa', 'Impossible de charger les réservations. Rechargez la page dans un instant.'); });
  }

  /* ================= La base clients ================= */
  function abonnementDe(userId) {
    var aujourdHui = isoLocal(new Date());
    var courant = null;
    abonnements.forEach(function (a) {
      if (a.user_id !== userId) { return; }
      if (a.fin >= aujourdHui && (!courant || a.fin < courant.fin)) { courant = a; }
    });
    return courant;
  }

  function activerTrimestre(f) {
    var enfants = ((f.donnees || {}).enfants || []).filter(function (e) { return e && (e.prenom || e.nom); });
    var suggestion = enfants.length ? ((enfants[0].prenom + ' ' + (enfants[0].nom || '')).trim()) : '';
    var enfant = prompt('Le trimestre est pour quel voltigeur ?', suggestion);
    if (enfant === null) { return; }
    var debut = prompt('Premier jour du trimestre (AAAA-MM-JJ) :', isoLocal(new Date()));
    if (debut === null) { return; }
    debut = debut.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debut)) { alert('Date non comprise : écrivez-la comme 2026-09-14.'); return; }
    var m = debut.split('-');
    var finDate = new Date(Number(m[0]), Number(m[1]) - 1, Number(m[2]) + DUREE_TRIMESTRE, 12);
    var fin = isoLocal(finDate);
    if (!confirm('Activer un trimestre pour ' + (enfant || 'ce voltigeur') + ', du ' + debut + ' au ' + fin +
      ' ? Le parent pourra réserver un cours par semaine depuis Mon compte.')) { return; }
    nuage.requeteAuth('/rest/v1/abonnements', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: f.user_id, email: f.email || '', enfant: enfant || '', debut: debut, fin: fin })
    }).then(function (r) {
      if (r && r.ok) { chargerFamilles(); return; }
      message('m-familles', 'L’activation n’a pas abouti (le SQL le plus récent a-t-il été joué dans Supabase ?).');
    }).catch(function () {
      message('m-familles', 'L’activation n’a pas abouti. Vérifiez votre connexion et réessayez.');
    });
  }

  function carteFamille(f) {
    var d = f.donnees || {};
    var r = d.responsable || {};
    var c = document.createElement('div');
    c.className = 'carte-famille';

    var entete = document.createElement('div');
    entete.className = 'entete';
    var nomComplet = r.nom || f.email || 'Famille';
    var initiales = document.createElement('span');
    initiales.className = 'initiales';
    initiales.textContent = nomComplet.trim().split(/\s+/).slice(0, 2).map(function (mot) { return (mot[0] || '').toUpperCase(); }).join('');
    entete.appendChild(initiales);
    var nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = nomComplet;
    entete.appendChild(nom);
    if (r.qualite) {
      var q = document.createElement('span');
      q.className = 'pastille type-stage';
      q.textContent = r.qualite;
      entete.appendChild(q);
    }
    var abo = f.user_id ? abonnementDe(f.user_id) : null;
    if (abo) {
      var pAbo = document.createElement('span');
      pAbo.className = 'pastille validee';
      pAbo.textContent = 'Trimestre en cours';
      entete.appendChild(pAbo);
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

    var pied = document.createElement('div');
    pied.className = 'corps';
    var morceauxPied = [];
    var nbDemandes = (d.demandes || []).length;
    if (nbDemandes) { morceauxPied.push(nbDemandes + (nbDemandes > 1 ? ' demandes envoyées' : ' demande envoyée')); }
    if (abo) { morceauxPied.push('trimestre' + (abo.enfant ? ' de ' + abo.enfant : '') + ' jusqu’au ' + new Date(abo.fin + 'T12:00:00').toLocaleDateString('fr-FR')); }
    pied.textContent = morceauxPied.join(' · ');
    if (morceauxPied.length) { c.appendChild(pied); }

    if (f.user_id) {
      var actions = document.createElement('div');
      actions.className = 'actions';
      var activer = document.createElement('button');
      activer.type = 'button';
      activer.className = 'btn btn-contour';
      activer.innerHTML = '<span>🗓 Activer un trimestre</span>';
      activer.addEventListener('click', function () { activerTrimestre(f); });
      actions.appendChild(activer);
      c.appendChild(actions);
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
    return nuage.requeteAuth('/rest/v1/abonnements?select=*&order=debut.desc&limit=500')
      .then(function (r) { return r && r.ok ? r.json() : []; })
      .then(function (l) { abonnements = l || []; })
      .catch(function () { abonnements = []; })
      .then(function () {
        return nuage.requeteAuth('/rest/v1/familles?select=user_id,email,donnees,maj&order=maj.desc&limit=500');
      })
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
          chargerReservations();
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
    el('o-reservations').hidden = onglet !== 'reservations';
  });

  el('a-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerDemandes(); });
  el('f-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerFamilles(); });
  el('r-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerReservations(); });
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
