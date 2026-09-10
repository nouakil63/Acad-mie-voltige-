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
        sessionCourante = session;
        afficherFamille(famille, session);
        if (motBienvenue) { message('m-famille', motBienvenue, true); }
        chargerTrimestre();
      });
    });
  }

  /* ---------- Mes cours du trimestre (abonnés) ----------
     L'académie active le trimestre après le paiement ; le parent réserve
     alors UN cours par semaine (mercredi ou samedi) jusqu'à la fin du
     trimestre. Les règles sont aussi verrouillées côté base de données. */
  var sessionCourante = null;
  var abonnement = null;

  function isoLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function depuisIso(iso) {
    var m = iso.split('-');
    return new Date(Number(m[0]), Number(m[1]) - 1, Number(m[2]), 12, 0, 0);
  }
  function lundiDe(iso) {
    var d = depuisIso(iso);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoLocal(d);
  }
  function joliJour(iso) {
    return depuisIso(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function joliLong(iso) {
    return depuisIso(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  var CAPACITE_COURS = 8; /* places par cours, meme valeur que dans l'espace academie */
  var SERVICE_ACADEMIE = window.AV_SERVICE_URL ||
    'https://script.google.com/macros/s/AKfycbwOXOkUQ0-ls0l8nSCUoG9wkKVNUgiKc4DtO8PsNEmn-yCq4eJu4UbmsJaGYpvqkYpw9w/exec';

  function chargerTrimestre() {
    if (!nuage.requeteAuth) { return; }
    nuage.requeteAuth('/rest/v1/abonnements?select=*&order=fin.desc')
      .then(function (r) { return r && r.ok ? r.json() : []; })
      .then(function (liste) {
        var aujourdHui = isoLocal(new Date());
        abonnement = null;
        (liste || []).forEach(function (a) {
          if (a.fin >= aujourdHui && (!abonnement || a.fin < abonnement.fin)) { abonnement = a; }
        });
        if (!abonnement) { el('bloc-trimestre').hidden = true; return; }
        var chargeFreq = nuage.requeteAuth('/rest/v1/frequentation?select=*')
          .then(function (r) { return r && r.ok ? r.json() : []; })
          .catch(function () { return []; });
        var chargeAttentes = nuage.requeteAuth('/rest/v1/attentes?select=*&order=cree')
          .then(function (r) { return r && r.ok ? r.json() : []; })
          .catch(function () { return []; });
        nuage.requeteAuth('/rest/v1/reservations?select=*&abonnement_id=eq.' + encodeURIComponent(abonnement.id) + '&order=date')
          .then(function (r) { return r && r.ok ? r.json() : []; })
          .then(function (resas) {
            return Promise.all([chargeFreq, chargeAttentes]).then(function (autres) {
              afficherTrimestre(resas || [], autres[0] || [], autres[1] || []);
            });
          });
      })
      .catch(function () { /* la section reste cachée */ });
  }

  function afficherTrimestre(resas, frequentation, mesAttentes) {
    var bloc = el('bloc-trimestre');
    bloc.hidden = false;
    el('m-trimestre').hidden = true;
    el('tr-intro').textContent = 'Trimestre' + (abonnement.enfant ? ' de ' + abonnement.enfant : '') +
      ' du ' + joliLong(abonnement.debut) + ' au ' + joliLong(abonnement.fin) + ' · ' +
      resas.length + (resas.length > 1 ? ' cours réservés.' : ' cours réservé.');

    var aujourdHui = isoLocal(new Date());
    var placesPrises = {};
    (frequentation || []).forEach(function (f) { placesPrises[f.date] = f.nombre || 0; });
    var attenteDe = {};
    (mesAttentes || []).forEach(function (a) { attenteDe[a.date] = a; });
    var semainesReservees = {};
    var listeEl = el('tr-reservations');
    listeEl.innerHTML = '';
    resas.forEach(function (r) {
      semainesReservees[r.semaine] = r;
      var ligne = document.createElement('div');
      ligne.style.cssText = 'display:flex;align-items:center;gap:10px;border:1.4px solid var(--trait);border-radius:12px;padding:9px 14px;font-size:13.5px';
      var texteResa = document.createElement('span');
      texteResa.textContent = '✔ ' + joliJour(r.date) + (r.date < aujourdHui ? ' (passé)' : '');
      ligne.appendChild(texteResa);
      if (r.date > aujourdHui) {
        var annuler = document.createElement('button');
        annuler.type = 'button';
        annuler.textContent = 'Annuler';
        annuler.style.cssText = 'margin-left:auto;border:0;background:transparent;color:#6d6266;font-size:12.5px;cursor:pointer;text-decoration:underline;font-family:inherit';
        annuler.addEventListener('click', function () {
          if (!confirm('Annuler le cours du ' + joliJour(r.date) + ' ?')) { return; }
          nuage.requeteAuth('/rest/v1/reservations?id=eq.' + encodeURIComponent(r.id), { method: 'DELETE' })
            .then(function () { chargerTrimestre(); });
        });
        ligne.appendChild(annuler);
      }
      listeEl.appendChild(ligne);
    });

    /* le planning des semaines restantes du trimestre */
    var planningEl = el('tr-planning');
    planningEl.innerHTML = '';
    var lundi = lundiDe(abonnement.debut >= aujourdHui ? abonnement.debut : aujourdHui);
    var nbSemaines = 0;
    while (lundi <= abonnement.fin && nbSemaines < 20) {
      nbSemaines++;
      var base = depuisIso(lundi);
      /* MERCREDI EN PAUSE : les cours ont lieu le samedi pour l'instant.
         Pour rouvrir le mercredi, décommentez la deuxième ligne (et son
         pendant dans inscription-cours.js et admin.js). */
      var jours = [
        { jour: 'samedi', decalage: 5 }
        /* , { jour: 'mercredi', decalage: 2 } */
      ];
      var rang = document.createElement('div');
      rang.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
      var etiquette = document.createElement('span');
      etiquette.style.cssText = 'font-size:12.5px;color:var(--texte-2);min-width:130px';
      etiquette.textContent = 'Semaine du ' + joliJour(lundi);
      rang.appendChild(etiquette);

      if (semainesReservees[lundi]) {
        var deja = document.createElement('span');
        deja.style.cssText = 'font-size:13px;font-weight:700;color:#1d7a3d';
        deja.textContent = '✔ ' + joliJour(semainesReservees[lundi].date) + ' réservé';
        rang.appendChild(deja);
      } else {
        var propose = 0;
        jours.forEach(function (j) {
          var d = new Date(base);
          d.setDate(d.getDate() + j.decalage);
          var iso = isoLocal(d);
          if (iso < abonnement.debut || iso > abonnement.fin || iso < aujourdHui) { return; }
          propose++;
          if ((placesPrises[iso] || 0) >= CAPACITE_COURS) {
            var complet = document.createElement('span');
            complet.style.cssText = 'font-size:12.5px;color:var(--texte-2)';
            complet.textContent = joliJour(iso) + ' : complet';
            rang.appendChild(complet);
            var attente = attenteDe[iso];
            var lienAttente = document.createElement('button');
            lienAttente.type = 'button';
            lienAttente.style.cssText = 'border:0;background:transparent;color:#6d6266;font-size:12.5px;cursor:pointer;text-decoration:underline;font-family:inherit';
            lienAttente.textContent = attente ? 'en liste d’attente · se retirer' : 'liste d’attente';
            lienAttente.addEventListener('click', function () {
              if (attente) {
                nuage.requeteAuth('/rest/v1/attentes?id=eq.' + encodeURIComponent(attente.id), { method: 'DELETE' })
                  .then(function () { chargerTrimestre(); });
                return;
              }
              if (!confirm('Ce cours est complet. Vous inscrire en liste d’attente pour le ' + joliJour(iso) +
                ' ? L’académie vous préviendra par e-mail si une place se libère.')) { return; }
              nuage.requeteAuth('/rest/v1/attentes', {
                method: 'POST',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ date: iso, email: (sessionCourante && sessionCourante.email) || '', enfant: abonnement.enfant || '' })
              }).then(function (r) {
                if (r && r.ok) { chargerTrimestre(); return; }
                message('m-trimestre', 'L’inscription en liste d’attente n’a pas abouti. Réessayez dans un instant.');
              });
            });
            rang.appendChild(lienAttente);
            return;
          }
          var puce = document.createElement('button');
          puce.type = 'button';
          puce.className = 'date-chip';
          puce.textContent = joliJour(iso) + ((placesPrises[iso] || 0) >= CAPACITE_COURS - 2
            ? ' · ' + (CAPACITE_COURS - (placesPrises[iso] || 0)) + ' places restantes' : '');
          puce.addEventListener('click', function () { reserver(iso, j.jour); });
          rang.appendChild(puce);
        });
        if (!propose) { rang.remove(); lundi = isoLocal(new Date(base.setDate(base.getDate() + 7))); continue; }
      }
      planningEl.appendChild(rang);
      var suivant = depuisIso(lundi);
      suivant.setDate(suivant.getDate() + 7);
      lundi = isoLocal(suivant);
    }
    if (!planningEl.children.length) {
      var fini = document.createElement('p');
      fini.className = 'aide';
      fini.textContent = 'Votre trimestre est terminé : toutes les semaines sont passées. Parlez-en à l’académie pour le renouveler !';
      planningEl.appendChild(fini);
    }
  }

  function reserver(iso, jour) {
    if (!confirm('Réserver le cours du ' + joliJour(iso) + (abonnement.enfant ? ' pour ' + abonnement.enfant : '') + ' ?')) { return; }
    nuage.requeteAuth('/rest/v1/reservations', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        abonnement_id: abonnement.id,
        email: (sessionCourante && sessionCourante.email) || '',
        enfant: abonnement.enfant || '',
        jour: jour,
        date: iso,
        semaine: lundiDe(iso)
      })
    }).then(function (r) {
      if (r && r.ok) {
        chargerTrimestre();
        /* la confirmation part par mail, sans bloquer la page */
        try {
          fetch(SERVICE_ACADEMIE, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              type: 'confirmation-resa',
              jeton: (sessionCourante && sessionCourante.jeton) || '',
              enfant: abonnement.enfant || '',
              quand: joliLong(iso)
            })
          });
        } catch (e) { /* rien */ }
        return;
      }
      message('m-trimestre', r && r.status === 409
        ? 'Un cours est déjà réservé cette semaine-là (un seul par semaine).'
        : 'La réservation n’a pas abouti. Rechargez la page et réessayez.');
    }).catch(function () {
      message('m-trimestre', 'La réservation n’a pas abouti. Vérifiez votre connexion et réessayez.');
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
