/* Carnet de famille — évite de tout re-remplir à chaque inscription.
   À la fin d'une demande (cours ou stage), le responsable légal et le
   voltigeur sont retenus dans CE navigateur. Au retour, les informations
   de la famille sont pré-remplies et chaque enfant enregistré se remet
   en un clic. Avec un compte (page « Mon compte »), les informations
   suivent la famille sur tous ses appareils. */
(function () {
  'use strict';

  var form = document.getElementById('form-cours') || document.getElementById('form-resa');
  if (!form) { return; }

  var CLE = 'av:famille';
  var nuage = window.AVNuage || null;
  function connecte() { return !!(nuage && nuage.configure() && nuage.lireSession()); }

  function lire() {
    try { return JSON.parse(localStorage.getItem(CLE)) || null; } catch (e) { return null; }
  }
  function ecrire(f) {
    try { localStorage.setItem(CLE, JSON.stringify(f)); } catch (e) { /* navigation privée */ }
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function met(id, v) {
    var el = document.getElementById(id);
    if (el && v) { el.value = v; }
  }
  /* le champ des recommandations s'appelle autrement sur la page des stages */
  var champRecos = document.getElementById('recommandations') ? 'recommandations' : 'enfant-sante';

  function remplirResponsable(r) {
    met('parent-qualite', r.qualite); met('parent-nom', r.nom);
    met('parent-adresse', r.adresse); met('parent-cp', r.cp); met('parent-ville', r.ville);
    met('parent-tel', r.tel); met('parent-tel-domicile', r.telDomicile);
    met('parent-email', r.email);
    met('secu-caisse', r.secuCaisse); met('secu-numero', r.secuNumero);
  }
  function remplirEnfant(e) {
    met('enfant-prenom', e.prenom); met('enfant-nom', e.nom);
    met('enfant-naissance', e.naissance); met('enfant-lieu', e.lieu);
    met('enfant-nationalite', e.nationalite); met('enfant-sexe', e.sexe);
    met('enfant-gabarit', e.gabarit); met('enfant-niveau', e.niveau);
    met('licence-ffe', e.licence);
    met(champRecos, e.recommandations);
  }
  function notifier() {
    var el = form.querySelector('input');
    if (el) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function lienCompte(texte) {
    var a = document.createElement('a');
    a.href = 'compte.html';
    a.textContent = texte;
    a.style.cssText = 'color:#D00828;font-weight:700';
    return a;
  }

  /* ---- pré-remplir et proposer les voltigeurs enregistrés ---- */
  function afficher(famille) {
    var ancien = document.getElementById('carnet-famille');
    if (ancien) { ancien.remove(); }
    if (!famille || !famille.responsable || !famille.responsable.nom) { return; }

    remplirResponsable(famille.responsable);
    notifier();

    var bandeau = document.createElement('div');
    bandeau.id = 'carnet-famille';
    bandeau.style.cssText = 'background:rgba(210,8,40,.06);border:1px solid rgba(210,8,40,.25);' +
      'border-radius:14px;padding:14px 18px;margin-bottom:18px;font-size:14px;line-height:1.7';

    var intro = document.createElement('span');
    var prenomResp = (famille.responsable.nom || '').trim().split(/\s+/)[0];
    intro.innerHTML = '<b>👋 Bon retour' + (prenomResp ? ', ' : '') + '</b>';
    if (prenomResp) {
      var bNom = document.createElement('b');
      bNom.textContent = prenomResp;
      intro.appendChild(bNom);
      intro.appendChild(document.createTextNode(' !'));
    }
    intro.appendChild(document.createTextNode(' Vos informations de famille sont déjà remplies.'));
    bandeau.appendChild(intro);

    var enfants = (famille.enfants || []).filter(function (e) { return e.prenom || e.nom; });
    if (enfants.length) {
      bandeau.appendChild(document.createTextNode(' Inscrire : '));
      enfants.forEach(function (e) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '🧒 ' + ((e.prenom + ' ' + e.nom).trim() || 'Voltigeur');
        btn.style.cssText = 'margin:2px 6px 2px 0;padding:7px 14px;border-radius:999px;border:1.4px solid #D00828;' +
          'background:#fff;color:#D00828;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit';
        btn.addEventListener('click', function () {
          remplirEnfant(e);
          remplirResponsable(famille.responsable);
          notifier();
          btn.textContent = '✅ ' + ((e.prenom + ' ' + e.nom).trim());
        });
        bandeau.appendChild(btn);
      });
    }

    var oublier = document.createElement('button');
    oublier.type = 'button';
    oublier.textContent = 'Oublier mes informations';
    oublier.style.cssText = 'margin-left:6px;padding:7px 12px;border-radius:999px;border:0;background:transparent;' +
      'color:#6d6266;font-size:12.5px;cursor:pointer;text-decoration:underline;font-family:inherit';
    oublier.addEventListener('click', function () {
      if (!confirm('Effacer les informations de famille et les voltigeurs enregistrés dans ce navigateur ?')) { return; }
      try { localStorage.removeItem(CLE); } catch (e) { /* rien */ }
      bandeau.remove();
    });
    bandeau.appendChild(oublier);

    /* le mot du compte : déjà relié, ou invitation à en créer un */
    var mot = document.createElement('div');
    mot.style.cssText = 'margin-top:6px;font-size:12.5px;color:#6d6266';
    if (connecte()) {
      mot.appendChild(document.createTextNode('Reliées à votre compte, à modifier depuis '));
      mot.appendChild(lienCompte('Mon compte'));
      mot.appendChild(document.createTextNode('.'));
    } else if (nuage && nuage.configure()) {
      mot.appendChild(document.createTextNode('💡 '));
      mot.appendChild(lienCompte('Créez votre compte'));
      mot.appendChild(document.createTextNode(' pour les retrouver sur tous vos appareils.'));
    }
    if (mot.childNodes.length) { bandeau.appendChild(mot); }

    var repere = form.querySelector('.pas-nav');
    if (repere) { form.insertBefore(bandeau, repere); }
  }

  var locale = lire();
  afficher(locale);

  if (connecte()) {
    /* la version du compte fait foi : elle peut venir d'un autre appareil */
    nuage.chargerFamille().then(function (duCompte) {
      if (duCompte && JSON.stringify(duCompte) !== JSON.stringify(locale)) {
        ecrire(duCompte);
        afficher(duCompte);
      }
    });
  } else if (nuage && nuage.configure() && !locale) {
    /* première visite : glisser un mot sur l'espace famille */
    var invite = document.createElement('p');
    invite.id = 'invite-compte';
    invite.style.cssText = 'font-size:13px;color:#6d6266;margin:0 0 18px';
    invite.appendChild(document.createTextNode('💡 Un compte à l’académie évite de tout retaper à chaque fois : '));
    invite.appendChild(lienCompte('se connecter ou créer mon compte'));
    invite.appendChild(document.createTextNode('.'));
    var repere = form.querySelector('.pas-nav');
    if (repere) { form.insertBefore(invite, repere); }
  }

  /* ---- à l'envoi : retenir la famille et le voltigeur (mise à jour sans doublon) ---- */
  /* Un champ vide n'écrase jamais une information déjà connue : le
     formulaire des cours, plus court, ne fait pas perdre les détails
     donnés ailleurs (sexe, sécurité sociale, licence…). */
  function completer(nouveau, ancien) {
    Object.keys(nouveau).forEach(function (k) {
      if (!nouveau[k] && ancien && ancien[k]) { nouveau[k] = ancien[k]; }
    });
    return nouveau;
  }

  form.addEventListener('submit', function () {
    var f = lire() || {};
    f.responsable = completer({
      qualite: val('parent-qualite'), nom: val('parent-nom'),
      adresse: val('parent-adresse'), cp: val('parent-cp'), ville: val('parent-ville'),
      tel: val('parent-tel'), telDomicile: val('parent-tel-domicile'),
      email: val('parent-email'),
      secuCaisse: val('secu-caisse'), secuNumero: val('secu-numero')
    }, f.responsable);
    var enfant = {
      prenom: val('enfant-prenom'), nom: val('enfant-nom'),
      naissance: val('enfant-naissance'), lieu: val('enfant-lieu'),
      nationalite: val('enfant-nationalite'), sexe: val('enfant-sexe'),
      gabarit: val('enfant-gabarit'), niveau: val('enfant-niveau'),
      licence: val('licence-ffe'),
      recommandations: val(champRecos)
    };
    f.enfants = f.enfants || [];
    if (enfant.prenom || enfant.nom) {
      var cleEnfant = (enfant.prenom + ' ' + enfant.nom).toLowerCase().trim();
      var i = -1;
      f.enfants.forEach(function (x, n) {
        if ((x.prenom + ' ' + x.nom).toLowerCase().trim() === cleEnfant) { i = n; }
      });
      if (i >= 0) { f.enfants[i] = completer(enfant, f.enfants[i]); } else { f.enfants.push(enfant); }
    }
    ecrire(f);
  }, true);

  /* ---- demande réellement envoyée : la garder dans le carnet ----
     (et tout envoyer au compte en une fois quand on est connecté) */
  document.addEventListener('av:demande-envoyee', function (ev) {
    var d = ev.detail || {};
    var f = lire() || {};
    f.demandes = f.demandes || [];
    f.demandes.unshift({
      quand: new Date().toISOString(),
      type: d.type,
      enfant: ((d.enfantPrenom || '') + ' ' + (d.enfantNom || '')).trim(),
      detail: (d.formule || '') + (d.creneau ? ' · ' + d.creneau : ''),
      tarif: d.tarif || ''
    });
    f.demandes = f.demandes.slice(0, 20);
    ecrire(f);
    if (connecte()) { nuage.enregistrerFamille(f); }
  });
})();
