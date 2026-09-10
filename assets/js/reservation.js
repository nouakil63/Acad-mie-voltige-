/* Parcours de réservation de stage — quatre étapes, récapitulatif en direct,
   signature en ligne. La demande part vers l'académie, qui confirme la place et
   envoie le lien de paiement. Les réponses remplissent aussi le dossier
   d'inscription téléchargeable. */
(function () {
  'use strict';

  var STAGES = [
    { nom: 'Stage de la Toussaint — semaine 1, 6–14 ans', dates: 'Du 19 au 24 octobre 2026', prix: 840 },
    { nom: 'Stage de la Toussaint — semaine 2, 6–14 ans', dates: 'Du 26 au 31 octobre 2026', prix: 840 }
  ];

  var form = document.getElementById('form-resa');
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

  /* ---- signature au doigt ou à la souris ---- */
  var toile = document.getElementById('signature');
  var signatureFaite = false;
  if (toile) {
    var ctx = toile.getContext('2d');
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1c1417';
    var enTrace = false;
    function pointDe(ev) {
      var r = toile.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * (toile.width / r.width), y: (ev.clientY - r.top) * (toile.height / r.height) };
    }
    toile.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      toile.setPointerCapture(ev.pointerId);
      enTrace = true;
      var p = pointDe(ev);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
      ctx.stroke();
      signatureFaite = true;
      var champ = document.getElementById('champ-signature');
      if (champ) { champ.classList.remove('erreur'); }
    });
    toile.addEventListener('pointermove', function (ev) {
      if (!enTrace) { return; }
      var p = pointDe(ev);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
      toile.addEventListener(t, function () { enTrace = false; });
    });
    var btnEffacer = document.getElementById('signature-effacer');
    if (btnEffacer) {
      btnEffacer.addEventListener('click', function () {
        ctx.clearRect(0, 0, toile.width, toile.height);
        signatureFaite = false;
      });
    }
  }

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
    if (toile && pas.contains(toile) && !signatureFaite) {
      var champSig = document.getElementById('champ-signature');
      if (champSig) { champSig.classList.add('erreur'); }
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
  function majRecap() {
    var choisi = form.querySelector('input[name="stage"]:checked');
    var s = choisi ? STAGES[Number(choisi.value)] : null;
    document.getElementById('r-stage').textContent = s ? s.nom : '—';
    document.getElementById('r-dates').textContent = s ? s.dates : '—';
    document.getElementById('r-total').textContent = s ? s.prix + ' €' : '—';
    var enfant = (texte('enfant-prenom') + ' ' + texte('enfant-nom')).trim();
    document.getElementById('r-enfant').textContent = enfant || '—';
    var niveau = document.getElementById('enfant-niveau');
    document.getElementById('r-niveau').textContent = niveau ? niveau.value : '—';
    document.getElementById('r-contact').textContent = texte('parent-email') || texte('parent-tel') || '—';
  }
  form.addEventListener('input', majRecap);
  form.addEventListener('change', majRecap);

  /* ---- présélection depuis les cartes de stages (?stage=n) ---- */
  var voulu = new URLSearchParams(window.location.search).get('stage');
  if (voulu !== null && STAGES[Number(voulu)]) {
    var radio = form.querySelector('input[name="stage"][value="' + voulu + '"]');
    if (radio) { radio.checked = true; }
  }
  majRecap();

  /* lien de paiement Stripe du stage (public), joint à la demande pour la réponse de confirmation */
  var PAIEMENT_STAGE = 'https://buy.stripe.com/8x23cv5tn82WcmIaU24ow04'; /* 840 € — semaine de stage */

  /* Service d'envoi automatique (Google Apps Script du compte de l'académie).
     Tant que l'adresse est vide, le site repasse par la messagerie du visiteur. */
  var URL_SERVICE = window.AV_SERVICE_URL || 'https://script.google.com/macros/s/AKfycbyDW_h6BmR4QpKs1l_917hrml-CUjDQCb-GdyNEPfLufxDhgPwsCRP9Wxwnnk-ByZc/exec';

  /* ---- le dossier rempli, gardé dans ce navigateur pour le téléchargement ---- */
  function donneesDossier(s) {
    var maintenant = new Date();
    return {
      type: 'stage',
      annee: '2026/2027',
      formule: s.nom, creneau: s.dates, tarif: s.prix + ' € / semaine',
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
      licence: texte('licence-ffe'), recommandations: texte('enfant-sante'),
      faitA: texte('parent-ville'),
      signeLe: maintenant.toLocaleDateString('fr-FR'),
      signature: (toile && signatureFaite) ? toile.toDataURL('image/png') : ''
    };
  }

  function confirmationAuto() {
    var c = document.getElementById('confirmation');
    var h = c.querySelector('h3'); var p = c.querySelector('p');
    if (h) { h.textContent = 'Votre demande est envoyée !'; }
    if (p) {
      p.innerHTML = 'L’académie vient de la recevoir et vous confirme la disponibilité très vite ; ' +
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
    var choisi = form.querySelector('input[name="stage"]:checked');
    var s = STAGES[choisi ? Number(choisi.value) : 0];

    var dossier = donneesDossier(s);
    try { localStorage.setItem('av:dossier-inscription', JSON.stringify(dossier)); } catch (err) { /* navigation privée */ }
    document.dispatchEvent(new CustomEvent('av:demande-envoyee', { detail: dossier }));

    if (URL_SERVICE) {
      fetch(URL_SERVICE, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({
          type: 'stage',
          stage: s.nom,
          dates: s.dates,
          tarif: s.prix + ' € / semaine',
          enfantPrenom: dossier.enfantPrenom,
          enfantNom: dossier.enfantNom,
          enfantNaissance: dossier.enfantNaissance,
          enfantLieuNaissance: dossier.enfantLieu,
          nationalite: dossier.nationalite,
          sexe: dossier.sexe === 'F' ? 'Fille' : dossier.sexe === 'M' ? 'Garçon' : dossier.sexe,
          gabaritDetail: dossier.gabarit,
          niveau: dossier.niveau,
          sante: dossier.recommandations,
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
          droitImage: 'Accepté en ligne',
          autorisationMedicale: 'Acceptée en ligne',
          signeLe: 'Signé en ligne le ' + dossier.signeLe + (dossier.faitA ? ' à ' + dossier.faitA : '')
        })
      }).then(confirmationAuto).catch(function () { envoyerParMessagerie(s, dossier); });
      return;
    }
    envoyerParMessagerie(s, dossier);
  });

  function envoyerParMessagerie(s, dossier) {
    var corps = [
      'Bonjour,',
      '',
      'Je souhaite inscrire mon enfant au stage suivant :',
      '',
      'Stage : ' + s.nom,
      'Dates : ' + s.dates,
      'Tarif : ' + s.prix + ' € / semaine',
      '',
      'Voltigeur : ' + dossier.enfantPrenom + ' ' + dossier.enfantNom,
      'Date de naissance : ' + dossier.enfantNaissance + (dossier.enfantLieu ? ' à ' + dossier.enfantLieu : ''),
      'Sexe : ' + dossier.sexe + ' · Gabarit : ' + dossier.gabarit,
      'Niveau : ' + dossier.niveau,
      'Santé / remarques : ' + (dossier.recommandations || '—'),
      '',
      'Responsable légal (' + dossier.qualite + ') : ' + dossier.parentNom,
      'Adresse : ' + dossier.adresse + ', ' + dossier.cp + ' ' + dossier.ville,
      'Téléphone : ' + dossier.parentTel + (dossier.telDomicile ? ' / ' + dossier.telDomicile : ''),
      'E-mail : ' + dossier.parentEmail,
      dossier.secuCaisse || dossier.secuNumero ? 'Sécurité sociale : ' + dossier.secuCaisse + ' ' + dossier.secuNumero : '',
      dossier.licence ? 'Licence FFE : ' + dossier.licence : '',
      '',
      'Droit à l\'image et autorisation médicale acceptés, signé en ligne le ' + dossier.signeLe + '.',
      'Merci de me confirmer la disponibilité.',
      '',
      '--------------------------------------------------',
      'Pour l\'académie — à joindre à la réponse de confirmation :',
      '· Paiement du stage :',
      PAIEMENT_STAGE,
      '--------------------------------------------------',
    ].filter(function (l) { return l !== ''; }).join('\n');
    var sujet = 'Réservation — ' + s.nom + ' (' + s.dates + ')';
    window.location.href = 'mailto:academiedevoltige@gmail.com?subject=' +
      encodeURIComponent(sujet) + '&body=' + encodeURIComponent(corps);
    document.getElementById('confirmation').classList.add('visible');
  }
})();
