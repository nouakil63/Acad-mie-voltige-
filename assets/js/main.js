/* Académie de voltige — interactions
   Direction artistique « Le Manège » : une courbe, une cadence. */
(function () {
  'use strict';

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Navigation : transparente sur la vidéo, blanche au défilement ---- */
  var nav = document.querySelector('.nav');
  var attente = false;
  function majNav() {
    nav.classList.toggle('est-blanche', window.scrollY > 24);
    attente = false;
  }
  window.addEventListener('scroll', function () {
    if (!attente) {
      attente = true;
      requestAnimationFrame(majNav);
    }
  }, { passive: true });
  majNav();

  /* ---- Menu mobile ---- */
  var burger = document.querySelector('.burger');
  var menu = document.querySelector('.menu-mobile');
  if (burger && menu) {
    burger.addEventListener('click', function () {
      var ouvert = menu.classList.toggle('ouvert');
      burger.setAttribute('aria-expanded', String(ouvert));
      document.body.style.overflow = ouvert ? 'hidden' : '';
      if (ouvert) { nav.classList.remove('est-blanche'); }
      else { majNav(); }
    });
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        menu.classList.remove('ouvert');
        burger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        majNav();
      });
    });
  }

  /* ---- Vidéo du hero : bascule sur le fond animé si absente ---- */
  var hero = document.querySelector('.hero-video');
  var video = hero && hero.querySelector('video');
  if (video && !reduced) {
    video.addEventListener('canplay', function () { hero.classList.add('a-video'); });
    video.addEventListener('error', function () { video.remove(); });
    if (video.readyState >= 3) { hero.classList.add('a-video'); }
  }

  /* ---- Entrée de page orchestrée (une seule fois) ---- */
  requestAnimationFrame(function () { document.body.classList.add('loaded'); });

  /* ---- Révélations au défilement, en cadence ---- */
  var cibles = document.querySelectorAll('.section');
  if ('IntersectionObserver' in window && !reduced) {
    var io = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    cibles.forEach(function (s) { io.observe(s); });
  } else {
    cibles.forEach(function (s) { s.classList.add('in'); });
  }
})();
