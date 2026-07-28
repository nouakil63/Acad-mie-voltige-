/* Académie de voltige — interactions
   Direction artistique « Le Manège » : une courbe, une cadence. */
(function () {
  'use strict';

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Navigation : transparente sur la vidéo, blanche au défilement ---- */
  var nav = document.querySelector('.nav');
  var claire = document.body.classList.contains('nav-toujours-blanche');
  var attente = false;
  function majNav() {
    nav.classList.toggle('est-blanche', claire || window.scrollY > 24);
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

  /* ---- Loader d'arrivée (accueil, une fois par session) ---- */
  var chargeur = document.getElementById('chargeur');
  var lancerEntree = function () {
    requestAnimationFrame(function () { document.body.classList.add('loaded'); });
  };
  if (chargeur) {
    var deja = false;
    try { deja = sessionStorage.getItem('chargeur-vu') === '1'; } catch (e) {}
    if (deja || reduced) {
      chargeur.remove();
      lancerEntree();
    } else {
      try { sessionStorage.setItem('chargeur-vu', '1'); } catch (e) {}
      var fini = false;
      var debut = Date.now();
      var termine = function () {
        if (fini) { return; }
        var reste = Math.max(0, 2050 - (Date.now() - debut));
        if (reste > 0) { setTimeout(termine, reste); return; }
        fini = true;
        chargeur.classList.add('fini');
        lancerEntree();
        setTimeout(function () { chargeur.remove(); }, 700);
      };
      window.addEventListener('load', function () { setTimeout(termine, 300); });
      setTimeout(termine, 2600);
    }
  } else {
    lancerEntree();
  }

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

  /* ---- Popup d'inscription aux actualités ---- */
  var surgi = document.getElementById('surgi');
  if (surgi) {
    var vu = false;
    try { vu = localStorage.getItem('actus-vu') === '1'; } catch (e) {}
    var marquer = function () { try { localStorage.setItem('actus-vu', '1'); } catch (e) {} };
    var ouvert = false;
    var ouvrir = function () {
      if (ouvert || vu) { return; }
      ouvert = true;
      surgi.hidden = false;
      var champ = document.getElementById('surgi-email');
      if (champ) { champ.focus({ preventScroll: true }); }
    };
    var fermer = function () {
      surgi.hidden = true;
      marquer();
    };
    if (!vu) {
      setTimeout(ouvrir, 4000);
      var surScroll = function () {
        var d = document.documentElement;
        if (window.scrollY > (d.scrollHeight - d.clientHeight) * 0.5) {
          ouvrir();
          window.removeEventListener('scroll', surScroll);
        }
      };
      window.addEventListener('scroll', surScroll, { passive: true });
    }
    surgi.querySelector('.fermer-surgi').addEventListener('click', fermer);
    surgi.addEventListener('click', function (e) { if (e.target === surgi) { fermer(); } });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !surgi.hidden) { fermer(); }
    });
    document.getElementById('form-surgi').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('surgi-email').value.trim();
      if (!/.+@.+\..+/.test(email)) { return; }
      window.location.href = 'mailto:academiedevoltige@gmail.com?subject=' +
        encodeURIComponent('Inscription aux actualités') + '&body=' +
        encodeURIComponent('Bonjour,\n\nJe souhaite recevoir les actualités de l\'académie (dates de stages, cours, représentations).\n\nMon e-mail : ' + email);
      surgi.classList.add('envoye');
      marquer();
      setTimeout(function () { surgi.hidden = true; }, 3500);
    });
  }
})();