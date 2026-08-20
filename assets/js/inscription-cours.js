/* Parcours d'inscription aux cours à l'année — trois étapes, récapitulatif en direct.
   En attendant le paiement en ligne, l'envoi ouvre un e-mail pré-rempli. */
(function () {
  'use strict';

  var FORMULES = [
    { nom: 'Éveil', creneau: 'Mercredi 14h00 — 15h30', tarif: '390 € / an' },
    { nom: 'Voltige', creneau: 'Mercredi 16h00 ou samedi 10h00', tarif: '450 € / an' }
  ];

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
    var niveau = document.getElementById('enfant-niveau');
    document.getElementById('r-niveau').textContent = niveau ? niveau.value : '—';
    document.getElementById('r-contact').textContent = texte('parent-email') || texte('parent-tel') || '—';
    var essai = document.getElementById('veut-essai');
    document.getElementById('r-essai').textContent = essai && essai.checked ? 'Oui' : 'Non';
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

  /* ---- envoi : e-mail pré-rempli en attendant le paiement en ligne ---- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var pas = form.querySelector('.pas[data-pas="3"]');
    if (!champsValides(pas)) { return; }
    var choisi = form.querySelector('input[name="formule"]:checked');
    var f = FORMULES[Number(choisi.value)];
    var essai = document.getElementById('veut-essai').checked;
    var corps = [
      'Bonjour,',
      '',
      'Je souhaite inscrire mon enfant aux cours à l\'année :',
      '',
      'Formule : ' + f.nom,
      'Créneau : ' + f.creneau,
      'Tarif : ' + f.tarif,
      'Cours d\'essai souhaité : ' + (essai ? 'Oui' : 'Non'),
      '',
      'Voltigeur : ' + texte('enfant-prenom') + ' ' + texte('enfant-nom'),
      'Date de naissance : ' + texte('enfant-naissance'),
      'Niveau : ' + document.getElementById('enfant-niveau').value,
      '',
      'Parent : ' + texte('parent-nom'),
      'Téléphone : ' + texte('parent-tel'),
      'E-mail : ' + texte('parent-email'),
      '',
      'Merci de me proposer ' + (essai ? 'une date de cours d\'essai.' : 'la marche à suivre pour finaliser l\'inscription.'),
    ].join('\n');
    var sujet = 'Inscription cours — ' + f.nom + (essai ? ' (cours d\'essai)' : '');
    window.location.href = 'mailto:academiedevoltige@gmail.com?subject=' +
      encodeURIComponent(sujet) + '&body=' + encodeURIComponent(corps);
    document.getElementById('confirmation').classList.add('visible');
  });
})();
