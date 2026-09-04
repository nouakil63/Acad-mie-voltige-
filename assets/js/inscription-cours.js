/* Demande d'inscription aux cours à l'année — trois étapes, récapitulatif en direct.
   La demande part par e-mail ; Georges Cotrait la valide sous 24 h maximum, puis
   le client reçoit un lien de paiement sécurisé. */
(function () {
  'use strict';

  var FORMULES = [
    { nom: 'Cours du mercredi', creneau: 'Mercredi 14h00 — 16h00', tarif: '25 € / cours ou 325 € / trimestre' },
    { nom: 'Cours du samedi', creneau: 'Samedi 10h00 — 13h00 · 14h00 — 16h00', tarif: '25 € / cours ou 325 € / trimestre' }
  ];

  /* liens de paiement Stripe (publics), joints à la demande pour la réponse de validation.
     ⚠ MODE TEST (lien à 0 €) — après les essais, remettre les vrais liens :
     unite:     https://buy.stripe.com/3cI3cvcVPfvo72od2a4ow00   (25 € — cours à l'unité)
     trimestre: https://buy.stripe.com/dRmeVd2hbab41I4gem4ow01   (325 € — trimestre) */
  var PAIEMENTS = {
    unite: 'https://buy.stripe.com/4gMfZh6xrcjc5Ykd2a4ow02',
    trimestre: 'https://buy.stripe.com/4gMfZh6xrcjc5Ykd2a4ow02'
  };

  var form = document.getElementById('form-cours');
  if (!form) { return; }

  var pasCourant = 1;
  var lesPas = form.querySelectorAll('.pas');
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

  function champsValides(pas) {
    var ok = true;
    pas.querySelectorAll('[required]').forEach(function (c) {
      var champ = c.closest('.champ');
      var vide = c.type === 'checkbox' ? !c.checked
               : c.type === 'radio' ? !form.querySelector('input[name="' + c.name + '"]:checked')
               : !c.value.trim();
      var invalide = vide || (c.type === 'email' && c.value && !/.+@.+\..+/.test(c.value));
      if (champ) { champ.classList.toggle('erreur', invalide); }
      if (invalide) { ok = false; }
    });
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
  function majRecap() {
    var choisi = form.querySelector('input[name="formule"]:checked');
    var f = choisi ? FORMULES[Number(choisi.value)] : null;
    document.getElementById('r-formule').textContent = f ? f.nom : '—';
    document.getElementById('r-creneau').textContent = f ? f.creneau : '—';
    document.getElementById('r-total').textContent = f ? f.tarif : '—';
    var enfant = (texte('enfant-prenom') + ' ' + texte('enfant-nom')).trim();
    document.getElementById('r-enfant').textContent = enfant || '—';
    document.getElementById('r-poids').textContent = texte('enfant-gabarit') || '—';
    var niveau = document.getElementById('enfant-niveau');
    document.getElementById('r-niveau').textContent = niveau ? niveau.value : '—';
    document.getElementById('r-contact').textContent = texte('parent-email') || texte('parent-tel') || '—';
  }
  form.addEventListener('input', majRecap);
  form.addEventListener('change', majRecap);

  /* ---- présélection depuis la page cours (?formule=n) ---- */
  var voulu = new URLSearchParams(window.location.search).get('formule');
  if (voulu !== null && FORMULES[Number(voulu)]) {
    var radio = form.querySelector('input[name="formule"][value="' + voulu + '"]');
    if (radio) { radio.checked = true; }
  }
  majRecap();

  /* Service d'envoi automatique (Google Apps Script du compte de l'académie).
     Tant que l'adresse est vide, le site repasse par la messagerie du visiteur. */
  var URL_SERVICE = window.AV_SERVICE_URL || 'https://script.google.com/macros/s/AKfycbwdzYKL2g-tV8PYMPswFgdU8Vi4PbrkRG7yrRvTaTv5daT2XTpOkaboswyi0jzntALYqw/exec';

  function confirmationAuto() {
    var c = document.getElementById('confirmation');
    var h = c.querySelector('h3'); var p = c.querySelector('p');
    if (h) { h.textContent = 'Votre demande est envoyée !'; }
    if (p) {
      p.innerHTML = 'L’académie vient de la recevoir. Georges Cotrait valide chaque demande sous 24 h maximum ; ' +
        'vous recevrez alors un e-mail avec le lien de paiement sécurisé. ' +
        'Une question ? Écrivez-nous à <a href="mailto:academiedevoltige@gmail.com" style="font-weight:700">academiedevoltige@gmail.com</a>.';
    }
    c.classList.add('visible');
  }

  /* ---- envoi : e-mail pré-rempli en attendant le paiement en ligne ---- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var pas = form.querySelector('.pas[data-pas="3"]');
    if (!champsValides(pas)) { return; }
    var choisi = form.querySelector('input[name="formule"]:checked');
    var f = FORMULES[Number(choisi.value)];

    if (URL_SERVICE) {
      fetch(URL_SERVICE, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({
          type: 'cours',
          formule: f.nom,
          creneau: f.creneau,
          tarif: f.tarif,
          enfantPrenom: texte('enfant-prenom'),
          enfantNom: texte('enfant-nom'),
          enfantNaissance: texte('enfant-naissance'),
          gabarit: texte('enfant-gabarit'),
          niveau: document.getElementById('enfant-niveau').value,
          parentNom: texte('parent-nom'),
          parentTel: texte('parent-tel'),
          parentEmail: texte('parent-email')
        })
      }).then(confirmationAuto).catch(function () { envoyerParMessagerie(f); });
      return;
    }
    envoyerParMessagerie(f);
  });

  function envoyerParMessagerie(f) {
    var corps = [
      'Bonjour,',
      '',
      'DEMANDE D\'INSCRIPTION aux cours à l\'année :',
      '',
      'Formule : ' + f.nom,
      'Créneau : ' + f.creneau,
      'Tarif : ' + f.tarif,
      '',
      'Voltigeur : ' + texte('enfant-prenom') + ' ' + texte('enfant-nom'),
      'Date de naissance : ' + texte('enfant-naissance'),
      'Gabarit : ' + texte('enfant-gabarit'),
      'Niveau : ' + document.getElementById('enfant-niveau').value,
      '',
      'Parent : ' + texte('parent-nom'),
      'Téléphone : ' + texte('parent-tel'),
      'E-mail : ' + texte('parent-email'),
      '',
      'J\'ai compris que cette demande sera validée sous 24 h maximum,',
      'et que je recevrai alors un lien de paiement sécurisé par e-mail.',
      '',
      '--------------------------------------------------',
      'Pour l\'académie — à joindre à la réponse de validation :',
      '· Paiement du cours à l\'unité (25 €) :',
      PAIEMENTS.unite,
      '· Paiement du trimestre (325 €) :',
      PAIEMENTS.trimestre,
      '--------------------------------------------------',
    ].join('\n');
    var sujet = 'Demande d\'inscription cours — ' + f.nom;
    window.location.href = 'mailto:academiedevoltige@gmail.com?subject=' +
      encodeURIComponent(sujet) + '&body=' + encodeURIComponent(corps);
    document.getElementById('confirmation').classList.add('visible');
  }
})();
