/* Demande d'inscription aux cours — trois étapes, récapitulatif en direct :
   le voltigeur, la famille, puis les dates cochées sur le planning des
   mercredis et des samedis (à l'unité ou au trimestre). La demande part
   vers l'académie ; Georges Cotrait la valide sous 24 h maximum, puis le
   client reçoit le lien de paiement correspondant. */
(function () {
  'use strict';

  var HORAIRES = {
    mercredi: 'Mercredi 14h00 — 16h00',
    samedi: 'Samedi 10h00 — 13h00 · 14h00 — 16h00'
  };
  var SEMAINES = 10; /* nombre de semaines proposées sur le planning */

  /* SAMEDI EN PAUSE : pour rouvrir les cours du samedi, remettez
     JOURS_COURS = ['mercredi', 'samedi'] (tout le reste suit). */
  var JOURS_COURS = ['mercredi'];

  /* liens de paiement Stripe (publics), rappelés dans la messagerie de secours */
  var PAIEMENTS = {
    unite: 'https://buy.stripe.com/3cI3cvcVPfvo72od2a4ow00',      /* 25 € — cours à l'unité */
    trimestre: 'https://buy.stripe.com/dRmeVd2hbab41I4gem4ow01'   /* 325 € — trimestre */
  };

  var form = document.getElementById('form-cours');
  if (!form) { return; }

  var pasCourant = 1;
  var lesPas = form.querySelectorAll('.pas');
  var dernierPas = lesPas.length;
  var jalons = form.querySelectorAll('.jalon');

  function montrePas(n) {
    pasCourant = n;
    lesPas.forEach(function (p) { p.classList.toggle('actif', Number(p.dataset.pas) === n); });
    jalons.forEach(function (j) {
      var v = Number(j.dataset.jalon);
      j.classList.toggle('actif', v === n);
      j.classList.toggle('fait', v < n);
    });
    form.closest('.section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---- le planning : les prochains mercredis et samedis à cocher ---- */
  function fabriquerPlanning() {
    var conteneurs = { mercredi: document.getElementById('dates-mercredi'), samedi: document.getElementById('dates-samedi') };
    if (!conteneurs.mercredi || !conteneurs.samedi) { return; }
    [{ jour: 'mercredi', cible: 3 }, { jour: 'samedi', cible: 6 }].forEach(function (regle) {
      if (JOURS_COURS.indexOf(regle.jour) === -1) {
        var groupe = conteneurs[regle.jour].closest('.jour-groupe');
        if (groupe) { groupe.hidden = true; }
        return;
      }
      var d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + 1); /* on commence demain au plus tôt */
      while (d.getDay() !== regle.cible) { d.setDate(d.getDate() + 1); }
      for (var i = 0; i < SEMAINES; i++) {
        var puce = document.createElement('button');
        puce.type = 'button';
        puce.className = 'date-chip';
        puce.dataset.jour = regle.jour;
        puce.dataset.iso = d.toISOString().slice(0, 10);
        puce.textContent = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
        conteneurs[regle.jour].appendChild(puce);
        d.setDate(d.getDate() + 7);
      }
    });
  }
  fabriquerPlanning();

  var planning = document.getElementById('planning-cours');
  if (planning) {
    planning.addEventListener('click', function (e) {
      var puce = e.target.closest('.date-chip');
      if (!puce) { return; }
      puce.classList.toggle('choisi');
      planning.classList.remove('erreur');
      majRecap();
    });
  }

  function datesChoisies() {
    var liste = [];
    form.querySelectorAll('.date-chip.choisi').forEach(function (puce) {
      liste.push({ jour: puce.dataset.jour, iso: puce.dataset.iso, label: puce.textContent });
    });
    liste.sort(function (a, b) { return a.iso < b.iso ? -1 : 1; });
    return liste;
  }

  function resumeCours() {
    var dates = datesChoisies();
    if (!dates.length) { return ''; }
    var mercredis = dates.filter(function (d) { return d.jour === 'mercredi'; }).length;
    var samedis = dates.length - mercredis;
    var morceaux = [];
    if (mercredis) { morceaux.push(mercredis + (mercredis > 1 ? ' mercredis' : ' mercredi')); }
    if (samedis) { morceaux.push(samedis + (samedis > 1 ? ' samedis' : ' samedi')); }
    return dates.length + (dates.length > 1 ? ' cours (' : ' cours (') + morceaux.join(', ') + ')';
  }

  function listeDates() {
    return datesChoisies().map(function (d) { return d.label; }).join(', ');
  }

  /* ---- signature : plus demandée pour les cours (elle reste sur les stages) ---- */
  var toile = document.getElementById('signature');
  var signatureFaite = false;

  /* MODE ESSAI : tous les champs sont facultatifs le temps des tests du
     parcours. Pour revenir a la normale, passer MODE_ESSAI a false. */
  var MODE_ESSAI = false;

  function champsValides(pas) {
    if (MODE_ESSAI) { return true; }
    var ok = true;
    pas.querySelectorAll('[required]').forEach(function (c) {
      var champ = c.closest('.champ') || c.closest('.case');
      var vide = c.type === 'checkbox' ? !c.checked
               : c.type === 'radio' ? !form.querySelector('input[name="' + c.name + '"]:checked')
               : !c.value.trim();
      var invalide = vide || (c.type === 'email' && c.value && !/.+@.+\..+/.test(c.value));
      if (champ) { champ.classList.toggle('erreur', invalide); }
      if (invalide) { ok = false; }
    });
    if (planning && pas.contains(planning) && !datesChoisies().length) {
      planning.classList.add('erreur');
      ok = false;
    }
    return ok;
  }

  form.addEventListener('click', function (e) {
    if (e.target.closest('[data-suivant]')) {
      var pas = e.target.closest('.pas');
      if (champsValides(pas)) { montrePas(pasCourant + 1); }
    }
    if (e.target.closest('[data-retour]')) { montrePas(pasCourant - 1); }
  });

  /* ---- récapitulatif en direct ---- */
  function texte(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function paiementChoisi() {
    var p = form.querySelector('input[name="paiement"]:checked');
    return p ? p.value : '';
  }
  function tarifChoisi() {
    var p = paiementChoisi();
    var n = datesChoisies().length;
    if (p === 'trimestre') { return '325 € / trimestre'; }
    if (p === 'unite') { return n ? (n * 25) + ' € (' + n + ' × 25 €)' : '25 € / cours'; }
    return n ? n + ' × 25 € ou 325 € / trimestre' : '';
  }
  function majRecap() {
    var dates = datesChoisies();
    document.getElementById('r-formule').textContent = resumeCours() || '—';
    var courts = dates.slice(0, 4).map(function (d) { return d.label; }).join(', ');
    document.getElementById('r-creneau').textContent = dates.length
      ? courts + (dates.length > 4 ? '…' : '')
      : '—';
    document.getElementById('r-total').textContent = tarifChoisi() || '—';
    var enfant = (texte('enfant-prenom') + ' ' + texte('enfant-nom')).trim();
    document.getElementById('r-enfant').textContent = enfant || '—';
    document.getElementById('r-poids').textContent = texte('enfant-gabarit') || '—';
    var niveau = document.getElementById('enfant-niveau');
    document.getElementById('r-niveau').textContent = niveau ? niveau.value : '—';
    document.getElementById('r-contact').textContent = texte('parent-email') || texte('parent-tel') || '—';
    var resume = document.getElementById('planning-resume');
    if (resume) {
      resume.textContent = dates.length
        ? 'Vos dates : ' + listeDates() + '.'
        : 'Aucune date choisie pour l’instant.';
    }
  }
  form.addEventListener('input', majRecap);
  form.addEventListener('change', majRecap);
  majRecap();

  /* Service d'envoi automatique (Google Apps Script du compte de l'académie).
     Tant que l'adresse est vide, le site repasse par la messagerie du visiteur. */
  var URL_SERVICE = window.AV_SERVICE_URL || 'https://script.google.com/macros/s/AKfycbwOXOkUQ0-ls0l8nSCUoG9wkKVNUgiKc4DtO8PsNEmn-yCq4eJu4UbmsJaGYpvqkYpw9w/exec';

  /* ---- le dossier rempli, gardé dans ce navigateur pour le téléchargement ---- */
  function donneesDossier() {
    var maintenant = new Date();
    var dates = datesChoisies();
    var horaires = [];
    JOURS_COURS.forEach(function (j) {
      if (dates.some(function (d) { return d.jour === j; })) { horaires.push(HORAIRES[j]); }
    });
    return {
      type: 'cours',
      annee: '2026/2027',
      formule: resumeCours() || 'Cours à l’unité',
      creneau: (listeDates() || '—') + (horaires.length ? ' · ' + horaires.join(' · ') : ''),
      tarif: tarifChoisi() || '25 € / cours ou 325 € / trimestre',
      paiement: paiementChoisi(),
      enfantPrenom: texte('enfant-prenom'), enfantNom: texte('enfant-nom'),
      enfantNaissance: texte('enfant-naissance'), enfantLieu: texte('enfant-lieu'),
      nationalite: texte('enfant-nationalite'), sexe: texte('enfant-sexe'),
      gabarit: texte('enfant-gabarit'),
      niveau: document.getElementById('enfant-niveau').value,
      qualite: texte('parent-qualite'), parentNom: texte('parent-nom'),
      adresse: texte('parent-adresse'), cp: texte('parent-cp'), ville: texte('parent-ville'),
      parentTel: texte('parent-tel'), telDomicile: texte('parent-tel-domicile'),
      parentEmail: texte('parent-email'),
      secuCaisse: texte('secu-caisse'), secuNumero: texte('secu-numero'),
      licence: texte('licence-ffe'), recommandations: texte('recommandations'),
      faitA: texte('parent-ville'),
      signeLe: maintenant.toLocaleDateString('fr-FR'),
      signature: ''
    };
  }

  function confirmationAuto() {
    var c = document.getElementById('confirmation');
    var h = c.querySelector('h3'); var p = c.querySelector('p');
    if (h) { h.textContent = 'Votre demande est envoyée !'; }
    if (p) {
      p.innerHTML = 'L’académie vient de la recevoir. Georges Cotrait valide chaque demande sous 24 h maximum ; ' +
        'vous recevrez alors un e-mail avec le lien de paiement sécurisé. ' +
        'Une question ? Écrivez-nous à <a href="mailto:academiedevoltige@gmail.com" style="font-weight:700">academiedevoltige@gmail.com</a>.';
    }
    c.classList.add('visible');
  }

  /* ---- envoi ---- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var pas = form.querySelector('.pas[data-pas="' + dernierPas + '"]');
    if (!champsValides(pas)) { return; }

    var dossier = donneesDossier();
    try { localStorage.setItem('av:dossier-inscription', JSON.stringify(dossier)); } catch (err) { /* navigation privée */ }
    document.dispatchEvent(new CustomEvent('av:demande-envoyee', { detail: dossier }));

    if (URL_SERVICE) {
      fetch(URL_SERVICE, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({
          type: 'cours',
          formule: dossier.formule,
          creneau: dossier.creneau,
          tarif: dossier.tarif,
          paiement: dossier.paiement,
          enfantPrenom: dossier.enfantPrenom,
          enfantNom: dossier.enfantNom,
          enfantNaissance: dossier.enfantNaissance,
          enfantLieuNaissance: dossier.enfantLieu,
          nationalite: dossier.nationalite,
          sexe: dossier.sexe === 'F' ? 'Fille' : dossier.sexe === 'M' ? 'Garçon' : dossier.sexe,
          gabarit: dossier.gabarit,
          niveau: dossier.niveau,
          qualite: dossier.qualite,
          parentNom: dossier.parentNom,
          adresse: dossier.adresse,
          cp: dossier.cp,
          ville: dossier.ville,
          parentTel: dossier.parentTel,
          telDomicile: dossier.telDomicile,
          parentEmail: dossier.parentEmail,
          secuCaisse: dossier.secuCaisse,
          secuNumero: dossier.secuNumero,
          licence: dossier.licence,
          recommandations: dossier.recommandations,
          signeLe: 'Demande envoyée en ligne le ' + dossier.signeLe + (dossier.faitA ? ' depuis ' + dossier.faitA : '')
        })
      }).then(confirmationAuto).catch(function () { envoyerParMessagerie(dossier); });
      return;
    }
    envoyerParMessagerie(dossier);
  });

  function envoyerParMessagerie(dossier) {
    var corps = [
      'Bonjour,',
      '',
      'DEMANDE D’INSCRIPTION aux cours :',
      '',
      'Cours choisis : ' + dossier.formule,
      'Dates : ' + dossier.creneau,
      'Tarif : ' + dossier.tarif,
      '',
      'Voltigeur : ' + dossier.enfantPrenom + ' ' + dossier.enfantNom,
      'Date de naissance : ' + dossier.enfantNaissance,
      'Gabarit : ' + dossier.gabarit,
      'Niveau : ' + dossier.niveau,
      '',
      'Responsable légal : ' + dossier.parentNom,
      'Adresse : ' + dossier.adresse + ', ' + dossier.cp + ' ' + dossier.ville,
      'Téléphone : ' + dossier.parentTel,
      'E-mail : ' + dossier.parentEmail,
      dossier.recommandations ? 'Recommandations : ' + dossier.recommandations : '',
      '',
      'J’ai compris que cette demande sera validée sous 24 h maximum,',
      'et que je recevrai alors un lien de paiement sécurisé par e-mail.',
      '',
      '--------------------------------------------------',
      'Pour l’académie — à joindre à la réponse de validation :',
      '· Paiement du cours à l’unité (25 €) :',
      PAIEMENTS.unite,
      '· Paiement du trimestre (325 €) :',
      PAIEMENTS.trimestre,
      '--------------------------------------------------',
    ].filter(function (l) { return l !== ''; }).join('\n');
    var sujet = 'Demande d’inscription cours — ' + (dossier.formule || 'planning');
    window.location.href = 'mailto:academiedevoltige@gmail.com?subject=' +
      encodeURIComponent(sujet) + '&body=' + encodeURIComponent(corps);
    document.getElementById('confirmation').classList.add('visible');
  }
})();
