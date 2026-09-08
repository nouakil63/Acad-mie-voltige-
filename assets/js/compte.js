/* Page « Mon compte » — l'espace famille de l'académie.
   Création de compte, connexion, mot de passe oublié, et le carnet de
   famille (responsable légal + voltigeurs) enregistré dans le compte :
   les inscriptions se pré-remplissent ensuite sur tous les appareils. */
(function () {
  'use strict';

  var nuage = window.AVNuage;
  if (!nuage) { return; }

  var CLE_FAMILLE = 'av:famille';
  var VUES = ['v-attente', 'v-indisponible', 'f-connexion', 'f-creation', 'f-oubli', 'f-nouveau', 'v-famille'];

  function el(id) { return document.getElementById(id); }
  function val(id) { var e = el(id); return e ? e.value.trim() : ''; }
  function met(id, v) { var e = el(id); if (e) { e.value = v || ''; } }

  function montrer(vue) {
    VUES.forEach(function (id) {
      var e = el(id);
      if (e) { e.classList.toggle('actif', id === vue); }
    });
    document.querySelectorAll('.message').forEach(function (m) { m.hidden = true; });
  }

  function message(id, texte, bonne) {
    var m = el(id);
    if (!m) { return; }
    m.textContent = texte;
    m.className = 'message ' + (bonne ? 'bonne' : 'souci');
    m.hidden = false;
  }

  function lireFamilleLocale() {
    try { return JSON.parse(localStorage.getItem(CLE_FAMILLE)) || null; } catch (e) { return null; }
  }
  function ecrireFamilleLocale(f) {
    try { localStorage.setItem(CLE_FAMILLE, JSON.stringify(f)); } catch (e) { /* navigation privée */ }
  }

  /* liens « Créer mon compte », « Se connecter », « Mot de passe oublié ? » */
  document.querySelectorAll('[data-vue]').forEach(function (lien) {
    lien.addEventListener('click', function (ev) {
      ev.preventDefault();
      montrer(lien.getAttribute('data-vue'));
    });
  });

  /* ---------- Les cartes des voltigeurs ---------- */
  var liste = el('liste-enfants');

  function carteEnfant(e) {
    e = e || {};
    var carte = document.createElement('div');
    carte.className = 'carte-enfant';
    carte.innerHTML =
      '<div class="entete-enfant"><b>🧒 Voltigeur</b>' +
      '<button type="button" class="retirer">Retirer</button></div>' +
      '<div class="champs">' +
        '<div class="rang">' +
          '<div class="champ"><label>Prénom</label><input data-champ="prenom"></div>' +
          '<div class="champ"><label>Nom</label><input data-champ="nom"></div>' +
        '</div>' +
        '<div class="rang">' +
          '<div class="champ"><label>Date de naissance</label><input data-champ="naissance" type="date"></div>' +
          '<div class="champ"><label>Né(e) à</label><input data-champ="lieu"></div>' +
        '</div>' +
        '<div class="rang">' +
          '<div class="champ"><label>Nationalité</label><input data-champ="nationalite" value="Française"></div>' +
          '<div class="champ"><label>Sexe</label><select data-champ="sexe">' +
            '<option value="">Choisir…</option><option value="F">Fille</option><option value="M">Garçon</option>' +
          '</select></div>' +
        '</div>' +
        '<div class="rang">' +
          '<div class="champ"><label>Gabarit (poids et taille)</label><select data-champ="gabarit">' +
            '<option value="">Choisir…</option>' +
            "<option>Moins de 35 kg et moins d'1m30</option>" +
            "<option>Moins de 40 kg et moins d'1m60</option>" +
            "<option>Autre gabarit (l'académie étudie la demande)</option>" +
          '</select></div>' +
          '<div class="champ"><label>Niveau</label><select data-champ="niveau">' +
            '<option value="Jamais monté">N’a jamais monté</option>' +
            '<option value="Débutant">A déjà monté un peu</option>' +
            '<option value="Voltige">Pratique déjà la voltige</option>' +
          '</select></div>' +
        '</div>' +
        '<div class="champ"><label>N° de licence Assurance Fédérale <small>(facultatif)</small></label><input data-champ="licence"></div>' +
        '<div class="champ"><label>Recommandations</label><textarea data-champ="recommandations" rows="2" placeholder="Allergies, interdictions, contre-indications médicales…"></textarea></div>' +
      '</div>';

    var titre = carte.querySelector('.entete-enfant b');
    function majTitre() {
      var p = carte.querySelector('[data-champ="prenom"]').value.trim();
      var n = carte.querySelector('[data-champ="nom"]').value.trim();
      titre.textContent = '🧒 ' + ((p + ' ' + n).trim() || 'Voltigeur');
    }
    Object.keys(e).forEach(function (k) {
      var champ = carte.querySelector('[data-champ="' + k + '"]');
      if (champ && e[k]) { champ.value = e[k]; }
    });
    majTitre();
    carte.querySelector('[data-champ="prenom"]').addEventListener('input', majTitre);
    carte.querySelector('[data-champ="nom"]').addEventListener('input', majTitre);
    carte.querySelector('.retirer').addEventListener('click', function () {
      if (liste.children.length <= 1 || confirm('Retirer ce voltigeur du carnet de famille ?')) { carte.remove(); }
      if (!liste.children.length) { liste.appendChild(carteEnfant()); }
    });
    return carte;
  }

  el('fa-ajouter').addEventListener('click', function () {
    liste.appendChild(carteEnfant());
  });

  /* ---------- Les dernières demandes d'inscription ---------- */
  var familleChargee = null;

  function afficherDemandes(famille) {
    var conteneur = el('liste-demandes');
    if (!conteneur) { return; }
    conteneur.innerHTML = '';
    var demandes = (famille && famille.demandes) || [];
    if (!demandes.length) {
      var vide = document.createElement('p');
      vide.className = 'aide';
      vide.textContent = 'Aucune demande envoyée pour l’instant.';
      conteneur.appendChild(vide);
      return;
    }
    demandes.slice(0, 10).forEach(function (d) {
      var ligne = document.createElement('div');
      ligne.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;' +
        'border:1.4px solid var(--trait);border-radius:12px;padding:12px 16px;font-size:13.5px';
      var badge = document.createElement('b');
      badge.textContent = d.type === 'stage' ? 'Stage' : 'Cours';
      badge.style.cssText = 'padding:3px 12px;border-radius:999px;font-size:12px;' +
        (d.type === 'stage'
          ? 'border:1.4px solid #D00828;color:#D00828'
          : 'background:#D00828;color:#fff');
      ligne.appendChild(badge);
      var texte = document.createElement('span');
      var quand = d.quand ? new Date(d.quand).toLocaleDateString('fr-FR') : '';
      texte.textContent = (d.enfant || 'Voltigeur') + ' · ' + (d.detail || '') +
        (quand ? ' · envoyée le ' + quand : '');
      texte.style.cssText = 'color:var(--texte-2)';
      ligne.appendChild(texte);
      if (d.tarif) {
        var tarif = document.createElement('b');
        tarif.textContent = d.tarif;
        tarif.style.cssText = 'margin-left:auto;white-space:nowrap';
        ligne.appendChild(tarif);
      }
      conteneur.appendChild(ligne);
    });
  }

  /* ---------- Afficher la famille du compte ---------- */
  function afficherFamille(famille, session) {
    famille = famille || {};
    familleChargee = famille;
    var r = famille.responsable || {};
    el('fa-compte').textContent = session.email || 'votre compte';
    met('c-qualite', r.qualite); met('c-nom', r.nom);
    met('c-adresse', r.adresse); met('c-cp', r.cp); met('c-ville', r.ville);
    met('c-tel', r.tel); met('c-tel2', r.telDomicile);
    met('c-courriel', r.email || session.email);
    met('c-secu-caisse', r.secuCaisse); met('c-secu-numero', r.secuNumero);

    liste.innerHTML = '';
    var enfants = (famille.enfants || []).filter(function (e) { return e && (e.prenom || e.nom); });
    if (enfants.length) { enfants.forEach(function (e) { liste.appendChild(carteEnfant(e)); }); }
    else { liste.appendChild(carteEnfant()); }
    afficherDemandes(famille);
    montrer('v-famille');
  }

  function ramasserFamille() {
    var enfants = [];
    liste.querySelectorAll('.carte-enfant').forEach(function (carte) {
      var e = {};
      carte.querySelectorAll('[data-champ]').forEach(function (champ) {
        e[champ.getAttribute('data-champ')] = champ.value.trim();
      });
      if (e.prenom || e.nom) { enfants.push(e); }
    });
    return {
      responsable: {
        qualite: val('c-qualite'), nom: val('c-nom'),
        adresse: val('c-adresse'), cp: val('c-cp'), ville: val('c-ville'),
        tel: val('c-tel'), telDomicile: val('c-tel2'),
        email: val('c-courriel'),
        secuCaisse: val('c-secu-caisse'), secuNumero: val('c-secu-numero')
      },
      enfants: enfants,
      /* l'historique des demandes est conservé tel quel */
      demandes: (familleChargee && familleChargee.demandes) || []
    };
  }

  /* Une fois connecté : charger la famille du compte. S'il n'y en a pas
     encore mais que cet appareil en a une (anciennes inscriptions), elle
     est adoptée et envoyée dans le compte. */
  function entrer(motBienvenue) {
    montrer('v-attente');
    nuage.retrouverEmail().then(function (session) {
      if (!session) { montrer('f-connexion'); return; }
      nuage.chargerFamille().then(function (famille) {
        var locale = lireFamilleLocale();
        if (!famille && locale && locale.responsable && locale.responsable.nom) {
          famille = locale;
          nuage.enregistrerFamille(famille);
        }
        if (famille) { ecrireFamilleLocale(famille); }
        afficherFamille(famille, session);
        if (motBienvenue) { message('m-famille', motBienvenue, true); }
      });
    });
  }

  /* ---------- Les formulaires ---------- */
  el('f-connexion').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = val('cx-email'), mdp = el('cx-mdp').value;
    if (!/.+@.+\..+/.test(email) || !mdp) { message('m-connexion', 'Indiquez votre e-mail et votre mot de passe.'); return; }
    message('m-connexion', 'Connexion…', true);
    nuage.connexion(email, mdp).then(function (r) {
      if (r.erreur) { message('m-connexion', r.erreur); return; }
      entrer();
    });
  });

  el('f-creation').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = val('cr-email'), mdp = el('cr-mdp').value, mdp2 = el('cr-mdp2').value;
    if (!/.+@.+\..+/.test(email)) { message('m-creation', 'Cette adresse e-mail ne semble pas valide.'); return; }
    if (mdp.length < 8) { message('m-creation', 'Choisissez un mot de passe d’au moins 8 caractères.'); return; }
    if (mdp !== mdp2) { message('m-creation', 'Les deux mots de passe ne sont pas identiques.'); return; }
    message('m-creation', 'Création du compte…', true);
    nuage.creation(email, mdp).then(function (r) {
      if (r.erreur) { message('m-creation', r.erreur); return; }
      if (r.session) { entrer('Bienvenue ! Votre compte est créé : enregistrez ici votre famille.'); return; }
      el('m-creation').hidden = true;
      el('creation-adresse').textContent = email;
      el('creation-envoyee').classList.add('visible');
    });
  });

  el('f-oubli').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = val('ou-email');
    if (!/.+@.+\..+/.test(email)) { message('m-oubli', 'Cette adresse e-mail ne semble pas valide.'); return; }
    message('m-oubli', 'Envoi…', true);
    nuage.motDePasseOublie(email).then(function (r) {
      if (r.erreur) { message('m-oubli', r.erreur); return; }
      el('m-oubli').hidden = true;
      el('oubli-envoye').classList.add('visible');
    });
  });

  el('f-nouveau').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var mdp = el('nv-mdp').value, mdp2 = el('nv-mdp2').value;
    if (mdp.length < 8) { message('m-nouveau', 'Choisissez un mot de passe d’au moins 8 caractères.'); return; }
    if (mdp !== mdp2) { message('m-nouveau', 'Les deux mots de passe ne sont pas identiques.'); return; }
    message('m-nouveau', 'Enregistrement…', true);
    nuage.nouveauMotDePasse(mdp).then(function (r) {
      if (r.erreur) { message('m-nouveau', r.erreur); return; }
      entrer('Votre nouveau mot de passe est enregistré.');
    });
  });

  el('v-famille').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var famille = ramasserFamille();
    message('m-famille', 'Enregistrement…', true);
    nuage.enregistrerFamille(famille).then(function (ok) {
      if (!ok) { message('m-famille', 'L’enregistrement n’a pas abouti. Vérifiez votre connexion internet et réessayez.'); return; }
      familleChargee = famille;
      ecrireFamilleLocale(famille);
      message('m-famille', '✅ Enregistré ! Vos prochaines inscriptions se rempliront toutes seules.', true);
    });
  });

  el('fa-deconnexion').addEventListener('click', function (ev) {
    ev.preventDefault();
    nuage.deconnexion();
    if (confirm('Faut-il aussi effacer les informations de famille retenues sur cet appareil ? (conseillé sur un ordinateur partagé)')) {
      try { localStorage.removeItem(CLE_FAMILLE); localStorage.removeItem('av:dossier-inscription'); } catch (e) { /* rien */ }
    }
    montrer('f-connexion');
  });

  /* ---------- Au chargement ---------- */
  if (!nuage.configure()) { montrer('v-indisponible'); return; }

  var retour = nuage.sessionDepuisAdresse();
  if (retour && retour.erreur) {
    montrer('f-connexion');
    message('m-connexion', retour.erreur);
  } else if (retour && retour.session && retour.type === 'recovery') {
    montrer('f-nouveau');
  } else if (retour && retour.session) {
    entrer('Votre adresse est confirmée : bienvenue ! Enregistrez ici votre famille.');
  } else if (nuage.lireSession()) {
    entrer();
  } else {
    montrer('f-connexion');
  }
})();
