/* Espace famille — dialogue avec le service de comptes (Supabase).
   Comptes avec e-mail et mot de passe : les informations de la famille
   sont retrouvées depuis n'importe quel appareil. Le mot de passe n'est
   jamais stocké ici : le service ne garde qu'une empreinte, et le
   navigateur ne conserve qu'un jeton de session renouvelable. */
(function () {
  'use strict';

  var CFG = window.AV_NUAGE || { url: '', cle: '' };
  var CLE_SESSION = 'av:session';
  var CLE_FAMILLE = 'av:famille';
  var PAGE_COMPTE = 'https://academiedevoltige.com/compte.html';

  function configure() { return !!(CFG.url && CFG.cle); }

  function lireSession() {
    try { return JSON.parse(localStorage.getItem(CLE_SESSION)) || null; } catch (e) { return null; }
  }
  function ecrireSession(s) {
    try {
      if (s) { localStorage.setItem(CLE_SESSION, JSON.stringify(s)); }
      else { localStorage.removeItem(CLE_SESSION); }
    } catch (e) { /* navigation privée */ }
  }

  /* Le carnet appartient à un compte précis, ou à un invité qui a choisi de
     le retenir. Un ancien carnet sans propriétaire n'est jamais adopté. */
  function proprietaire(session) { return session ? session.user_id || null : 'invite'; }
  function lireFamilleLocale(session) {
    try {
      var cache = JSON.parse(localStorage.getItem(CLE_FAMILLE));
      return cache && cache.version === 2 && proprietaire(session) &&
        cache.proprietaire === proprietaire(session) ? cache.donnees || null : null;
    } catch (e) { return null; }
  }
  function ecrireFamilleLocale(famille, session) {
    var qui = proprietaire(session);
    if (!qui) { return false; }
    try {
      localStorage.setItem(CLE_FAMILLE, JSON.stringify({ version: 2, proprietaire: qui, donnees: famille }));
      return true;
    } catch (e) { return false; }
  }
  function oublierFamilleLocale() {
    try { localStorage.removeItem(CLE_FAMILLE); } catch (e) { /* rien */ }
  }
  function effacerDossiersLocaux() {
    ['av:dossier-inscription', 'av:dossier-cours', 'av:dossier-admin', 'av:feuille'].forEach(function (cle) {
      try { localStorage.removeItem(cle); } catch (e) { /* rien */ }
    });
  }
  function memeSession(s) {
    var actuelle = lireSession();
    return !!(s && actuelle && s.user_id && actuelle.user_id === s.user_id);
  }

  function appel(chemin, options) {
    options = options || {};
    var entetes = { apikey: CFG.cle, 'Content-Type': 'application/json' };
    Object.keys(options.headers || {}).forEach(function (k) { entetes[k] = options.headers[k]; });
    options.headers = entetes;
    return fetch(CFG.url + chemin, options);
  }

  /* Messages d'erreur du service, traduits pour les parents. */
  function traduireErreur(j) {
    var code = (j && (j.error_code || j.code || j.error)) || '';
    var msg = String((j && (j.msg || j.message || j.error_description)) || '');
    if (code === 'invalid_credentials' || /invalid login/i.test(msg)) { return 'E-mail ou mot de passe incorrect.'; }
    if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) { return 'Cette adresse n’a pas encore été confirmée : ouvrez l’e-mail de confirmation reçu à la création du compte et cliquez sur son lien, puis reconnectez-vous.'; }
    if (code === 'user_already_exists' || /already registered/i.test(msg)) { return 'Un compte existe déjà avec cette adresse. Utilisez « Se connecter », ou « Mot de passe oublié » si besoin.'; }
    if (code === 'weak_password' || /password should be/i.test(msg)) { return 'Mot de passe trop court : 8 caractères minimum.'; }
    if (/rate limit|too many/i.test(code + ' ' + msg)) { return 'Trop d’essais d’affilée : patientez une minute puis réessayez.'; }
    if (code === 'otp_expired' || /expired/i.test(msg)) { return 'Ce lien a expiré. Demandez-en un nouveau depuis « Mot de passe oublié ».'; }
    if (code === 'validation_failed' || /invalid format/i.test(msg)) { return 'Cette adresse e-mail ne semble pas valide.'; }
    return 'Le service n’a pas répondu comme prévu' + (msg ? ' (détail : ' + msg.slice(0, 160) + ')' : '') + '. Réessayez dans un instant.';
  }

  function garderSession(rep) {
    if (!rep || !rep.access_token) { return null; }
    var s = {
      jeton: rep.access_token,
      rafraichir: rep.refresh_token || '',
      expire: Date.now() + (Number(rep.expires_in || 3600) - 60) * 1000,
      user_id: (rep.user && rep.user.id) || '',
      email: (rep.user && rep.user.email) || ''
    };
    if (!memeSession(s)) { effacerDossiersLocaux(); }
    ecrireSession(s);
    return s;
  }

  /* Session encore valable, renouvelée en silence si elle a expiré. */
  function sessionValide() {
    var s = lireSession();
    if (!configure() || !s) { return Promise.resolve(null); }
    if (Date.now() < s.expire) { return Promise.resolve(s); }
    if (!s.rafraichir) { ecrireSession(null); return Promise.resolve(null); }
    return appel('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: JSON.stringify({ refresh_token: s.rafraichir })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        var actuelle = lireSession();
        if (!actuelle || actuelle.jeton !== s.jeton) { return null; }
        if (!x.ok) { ecrireSession(null); return null; }
        return garderSession(x.j);
      })
      .catch(function () { return null; });
  }

  function versJson(r) {
    return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; });
  }

  function creation(email, motDePasse) {
    return appel('/auth/v1/signup?redirect_to=' + encodeURIComponent(PAGE_COMPTE), {
      method: 'POST', body: JSON.stringify({ email: email, password: motDePasse })
    }).then(versJson).then(function (x) {
      if (!x.ok) { return { erreur: traduireErreur(x.j) }; }
      /* Adresse déjà prise : le service renvoie un faux profil sans identité
         (pour ne pas révéler qui a un compte) — on reste tout aussi vague. */
      var dejaPris = x.j && x.j.identities && x.j.identities.length === 0;
      var session = garderSession(x.j); /* présent si la confirmation d'e-mail est désactivée */
      return { session: session, confirmation: !session, dejaPris: dejaPris };
    }).catch(function () { return { erreur: 'Connexion au service impossible. Vérifiez votre accès internet et réessayez.' }; });
  }

  function connexion(email, motDePasse) {
    return appel('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email: email, password: motDePasse })
    }).then(versJson).then(function (x) {
      if (!x.ok) { return { erreur: traduireErreur(x.j) }; }
      return { session: garderSession(x.j) };
    }).catch(function () { return { erreur: 'Connexion au service impossible. Vérifiez votre accès internet et réessayez.' }; });
  }

  function motDePasseOublie(email) {
    return appel('/auth/v1/recover?redirect_to=' + encodeURIComponent(PAGE_COMPTE), {
      method: 'POST', body: JSON.stringify({ email: email })
    }).then(versJson).then(function (x) {
      return x.ok ? {} : { erreur: traduireErreur(x.j) };
    }).catch(function () { return { erreur: 'Connexion au service impossible. Réessayez dans un instant.' }; });
  }

  function nouveauMotDePasse(motDePasse) {
    return sessionValide().then(function (s) {
      if (!s) { return { erreur: 'Session expirée : redemandez un lien depuis « Mot de passe oublié ».' }; }
      return appel('/auth/v1/user', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + s.jeton },
        body: JSON.stringify({ password: motDePasse })
      }).then(versJson).then(function (x) {
        return x.ok ? {} : { erreur: traduireErreur(x.j) };
      });
    }).catch(function () { return { erreur: 'Connexion au service impossible. Réessayez dans un instant.' }; });
  }

  function deconnexion(options) {
    var s = lireSession();
    ecrireSession(null);
    if (!options || !options.conserverFamille) { oublierFamilleLocale(); }
    effacerDossiersLocaux();
    if (s && configure()) {
      appel('/auth/v1/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + s.jeton } })
        .catch(function () { /* la session locale est déjà effacée */ });
    }
  }

  /* Au retour d'un lien reçu par e-mail (confirmation du compte ou mot de
     passe oublié), le service met la session dans l'adresse de la page. */
  function sessionDepuisAdresse() {
    var h = String(location.hash || '').replace(/^#/, '');
    if (!h) { return null; }
    var p = {};
    h.split('&').forEach(function (morceau) {
      var i = morceau.indexOf('=');
      if (i > 0) { p[morceau.slice(0, i)] = decodeURIComponent(morceau.slice(i + 1).replace(/\+/g, ' ')); }
    });
    if (p.error_code || p.error) {
      history.replaceState(null, '', location.pathname);
      return { erreur: traduireErreur(p) };
    }
    if (!p.access_token) { return null; }
    var s = garderSession({
      access_token: p.access_token, refresh_token: p.refresh_token,
      expires_in: p.expires_in, user: { email: '' }
    });
    history.replaceState(null, '', location.pathname);
    /* l'e-mail du compte n'est pas dans l'adresse : on le demande au service */
    return { session: s, type: p.type || '' };
  }

  function retrouverEmail() {
    return sessionValide().then(function (s) {
      if (!s) { return null; }
      if (s.email && s.user_id) { return s; }
      return appel('/auth/v1/user', { headers: { Authorization: 'Bearer ' + s.jeton } })
        .then(versJson).then(function (x) {
          if (!x.ok || !x.j || !x.j.id) { throw new Error('Impossible de vérifier le compte. Réessayez.'); }
          var actuelle = lireSession();
          if (!actuelle || actuelle.jeton !== s.jeton) { throw new Error('Le compte a changé. Rechargez la page.'); }
          s.email = x.j.email || '';
          s.user_id = x.j.id;
          ecrireSession(s);
          return s;
        });
    });
  }

  /* ---- Les informations de la famille, gardées dans le compte ---- */
  function chargerFamille() {
    return retrouverEmail().then(function (s) {
      if (!s || !s.user_id) { throw new Error('Reconnectez-vous pour charger votre famille.'); }
      return appel('/rest/v1/familles?select=user_id,donnees&user_id=eq.' + encodeURIComponent(s.user_id) + '&limit=1', {
        headers: { Authorization: 'Bearer ' + s.jeton }
      }).then(function (r) {
        if (!r.ok) { throw new Error('Le carnet n’a pas pu être chargé. Réessayez.'); }
        return r.json();
      }).then(function (liste) {
        if (!memeSession(s)) { throw new Error('Le compte a changé. Rechargez la page.'); }
        if (!Array.isArray(liste)) { throw new Error('Réponse du carnet non reconnue.'); }
        if (!liste.length) { return null; }
        if (liste[0].user_id !== s.user_id || !liste[0].donnees || typeof liste[0].donnees !== 'object' || Array.isArray(liste[0].donnees)) {
          throw new Error('Le carnet reçu ne correspond pas au compte.');
        }
        return liste[0].donnees;
      });
    });
  }

  function enregistrerFamille(famille, compteAttendu) {
    return retrouverEmail().then(function (s) {
      if (!s || !s.user_id || (compteAttendu && s.user_id !== compteAttendu)) { return false; }
      return appel('/rest/v1/familles?on_conflict=user_id', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + s.jeton, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: s.user_id, email: s.email || null, donnees: famille })
      }).then(function (r) { return r.ok && memeSession(s); });
    }).catch(function () { return false; });
  }

  /* Appel authentifié générique (utilisé par l'espace académie). */
  function requeteAuth(chemin, options) {
    return sessionValide().then(function (s) {
      if (!s) { return null; }
      options = options || {};
      var entetes = options.headers || {};
      entetes.Authorization = 'Bearer ' + s.jeton;
      options.headers = entetes;
      return appel(chemin, options);
    });
  }

  window.AVNuage = {
    configure: configure,
    requeteAuth: requeteAuth,
    lireSession: lireSession,
    sessionValide: sessionValide,
    creation: creation,
    connexion: connexion,
    motDePasseOublie: motDePasseOublie,
    nouveauMotDePasse: nouveauMotDePasse,
    deconnexion: deconnexion,
    sessionDepuisAdresse: sessionDepuisAdresse,
    retrouverEmail: retrouverEmail,
    lireFamilleLocale: lireFamilleLocale,
    ecrireFamilleLocale: ecrireFamilleLocale,
    oublierFamilleLocale: oublierFamilleLocale,
    chargerFamille: chargerFamille,
    enregistrerFamille: enregistrerFamille
  };
})();
