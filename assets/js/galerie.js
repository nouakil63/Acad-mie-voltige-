/* Galerie — visionneuse plein écran avec navigation au clavier. */
(function () {
  'use strict';

  var grille = document.querySelector('.galerie-grille');
  var vis = document.getElementById('visionneuse');
  if (!grille || !vis) { return; }

  var grandImg = vis.querySelector('figure img');
  var legende = vis.querySelector('figcaption');
  var courante = -1;

  function photos() {
    return Array.prototype.slice.call(grille.querySelectorAll('.galerie-photo img'));
  }

  function ouvrir(i) {
    var liste = photos();
    if (!liste.length) { return; }
    courante = (i + liste.length) % liste.length;
    var img = liste[courante];
    grandImg.src = img.currentSrc || img.src;
    grandImg.alt = img.alt || '';
    legende.textContent = img.alt || '';
    vis.classList.add('ouverte');
    document.body.style.overflow = 'hidden';
  }

  function fermer() {
    vis.classList.remove('ouverte');
    document.body.style.overflow = '';
    courante = -1;
  }

  grille.addEventListener('click', function (e) {
    var fig = e.target.closest('.galerie-photo');
    if (!fig) { return; }
    ouvrir(photos().indexOf(fig.querySelector('img')));
  });

  vis.querySelector('.vis-fermer').addEventListener('click', fermer);
  vis.querySelector('.vis-nav.prec').addEventListener('click', function () { ouvrir(courante - 1); });
  vis.querySelector('.vis-nav.suiv').addEventListener('click', function () { ouvrir(courante + 1); });
  vis.addEventListener('click', function (e) { if (e.target === vis) { fermer(); } });

  document.addEventListener('keydown', function (e) {
    if (!vis.classList.contains('ouverte')) { return; }
    if (e.key === 'Escape') { fermer(); }
    if (e.key === 'ArrowLeft') { ouvrir(courante - 1); }
    if (e.key === 'ArrowRight') { ouvrir(courante + 1); }
  });
})();
