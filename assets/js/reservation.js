/* Parcours de réservation — trois étapes, récapitulatif en direct.
   En attendant le paiement en ligne, l'envoi ouvre un e-mail pré-rempli. */
(function () {
  'use strict';

  var STAGES = [
    { nom: 'Stage découverte, 6–10 ans', dates: 'Du 3 au 8 août 2026', prix: 540 },
    { nom: 'Stage perfectionnement, 11–16 ans', dates: 'Du 10 au 15 août 2026', prix: 590 },
    { nom: 'Stage voltige & théâtre, 8–16 ans', dates: 'Du 19 au 24 octobre 2026', prix: 560 }
  ];

  var form = document.getElementById('form-resa');
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

  /* ---- envoi : e-mail pré-rempli en attendant le paiement en ligne ---- */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var pas = form.querySelector('.pas[data-pas="3"]');
    if (!champsValides(pas)) { return; }
    var choisi = form.querySelector('input[name="stage"]:checked');
    var s = STAGES[Number(choisi.value)];
    var corps = [
      'Bonjour,',
      '',
      'Je souhaite inscrire mon enfant au stage suivant :',
      '',
      'Stage : ' + s.nom,
      'Dates : ' + s.dates,
      'Tarif : ' + s.prix + ' € / semaine',
      '',
      'Voltigeur : ' + texte('enfant-prenom') + ' ' + texte('enfant-nom'),
      'Date de naissance : ' + texte('enfant-naissance'),
      'Niveau : ' + document.getElementById('enfant-niveau').value,
      'Santé / remarques : ' + (texte('enfant-sante') || '—'),
      '',
      'Parent : ' + texte('parent-nom'),
      'Téléphone : ' + texte('parent-tel'),
      'E-mail : ' + texte('parent-email'),
      '',
      'Merci de me confirmer la disponibilité.',
    ].join('\n');
    var sujet = 'Réservation — ' + s.nom + ' (' + s.dates + ')';
    window.location.href = 'mailto:academiedevoltige@gmail.com?subject=' +
      encodeURIComponent(sujet) + '&body=' + encodeURIComponent(corps);
    document.getElementById('confirmation').classList.add('visible');
  });
})();
