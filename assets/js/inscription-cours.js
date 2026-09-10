/* Demande d'inscription aux cours — trois étapes, récapitulatif en direct :
   le voltigeur, la famille, puis la formule (à l'unité ou au trimestre).
   Pas de date à choisir : la demande part vers l'académie, Fleur appelle
   la famille pour convenir du créneau du samedi, puis envoie depuis le CRM
   les infos du cours et le lien de paiement. */
(function () {
  'use strict';

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
  function resumeCours() {
    var p = paiementChoisi();
    if (p === 'trimestre') { return 'Cours au trimestre'; }
    if (p === 'unite') { return 'Cours à l’unité'; }
    return '';
  }
  function tarifChoisi() {
    var p = paiementChoisi();
    if (p === 'trimestre') { return '325 € / trimestre'; }
    if (p === 'unite') { return '25 € / cours'; }
    return '';
  }
  function majRecap() {
    document.getElementById('r-formule').textContent = resumeCours() || '—';
    document.getElementById('r-creneau').textContent = 'Le samedi, créneau à convenir avec Fleur';
    document.getElementById('r-total').textContent = tarifChoisi() || '—';
    var enfant = (texte('enfant-prenom') + ' ' + texte('enfant-nom')).trim();
    document.getElementById('r-enfant').textContent = enfant || '—';
    document.getElementById('r-poids').textContent = texte('enfant-gabarit') || '—';
    var niveau = document.getElementById('enfant-niveau');
    document.getElementById('r-niveau').textContent = niveau ? niveau.value : '—';
    document.getElementById('r-contact').textContent = texte('parent-email') || texte('parent-tel') || '—';
  }
  form.addEventListener('input', majRecap);
  form.addEventListener('change', majRecap);
  majRecap();

  /* Service d'envoi automatique (Google Apps Script du compte de l'académie).
     Tant que l'adresse est vide, le site repasse par la messagerie du visiteur. */
  var URL_SERVICE = window.AV_SERVICE_URL || 'https://script.google.com/macros/s/AKfycbyDW_h6BmR4QpKs1l_917hrml-CUjDQCb-GdyNEPfLufxDhgPwsCRP9Wxwnnk-ByZc/exec';

  /* ---- le dossier rempli, gardé dans ce navigateur pour le téléchargement ---- */
  function donneesDossier() {
    var maintenant = new Date();
    return {
      type: 'cours',
      annee: '2026/2027',
      formule: resumeCours() || 'Cours à l’unité',
      creneau: 'Le samedi, créneau à convenir par téléphone',
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
      p.innerHTML = 'L’académie vient de la recevoir et la valide sous 24 h maximum. ' +
        'Fleur vous appelle ensuite pour convenir de la date et de l’heure de votre cours du samedi, ' +
        'puis vous recevrez un e-mail avec le récapitulatif et le lien de paiement sécurisé. ' +
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
      'Formule : ' + dossier.formule,
      'Créneau : ' + dossier.creneau,
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
    var sujet = 'Demande d’inscription cours · ' + (dossier.formule || 'le samedi');
    window.location.href = 'mailto:academiedevoltige@gmail.com?subject=' +
      encodeURIComponent(sujet) + '&body=' + encodeURIComponent(corps);
    document.getElementById('confirmation').classList.add('visible');
  }
})();
