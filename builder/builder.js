/* ============================================================
   Le Manège — éditeur visuel du site de l'Académie de voltige
   Tout se passe dans le navigateur : les pages sont chargées
   telles quelles, modifiées en direct dans l'aperçu, puis
   publiées sur GitHub (le site se met à jour tout seul).
   ============================================================ */
(function () {
  'use strict';

  /* ============ Configuration ============ */
  var CONFIG = {
    proprietaire: 'nouakil63',
    depot: 'Acad-mie-voltige-',
    branche: 'claude/academie-voltige-style-x4qbuv', /* branche par défaut du dépôt (celle du site en ligne) */
    pages: [
      { fichier: 'index.html', nom: 'Accueil' },
      { fichier: 'histoire.html', nom: "L'académie" },
      { fichier: 'stages.html', nom: 'Les stages' },
      { fichier: 'cours.html', nom: 'Les cours' },
      { fichier: 'theatre.html', nom: 'Le théâtre' },
      { fichier: 'galerie.html', nom: 'Galerie' },
      { fichier: 'contact.html', nom: 'Contact' },
      { fichier: 'inscription.html', nom: 'Inscription' },
      { fichier: 'inscription-cours.html', nom: 'Inscription aux cours' },
      { fichier: 'reservation.html', nom: 'Réservation de stage' },
      { fichier: 'mentions-legales.html', nom: 'Mentions légales' },
      { fichier: 'confidentialite.html', nom: 'Confidentialité' },
      { fichier: '404.html', nom: 'Page introuvable' }
    ],
    imagesConnues: [
      'assets/img/voltige-pyramide.jpeg',
      'assets/img/voltige-longe.jpeg',
      'assets/img/voltige-solo.jpeg',
      'assets/img/voltige-duo.jpeg',
      'assets/img/voltige-planche.jpeg',
      'assets/img/voltige-figure.jpeg',
      'assets/img/georges-cotrait.jpeg',
      'assets/img/photo-theatre.jpg',
      'assets/img/salon-du-cheval.jpg',
      'assets/img/photo-fleur-et-george.jpg',
      'assets/img/photo-fleur-et-george-2.jpg',
      'assets/img/photo-enfant-deguise.jpg',
      'assets/img/photo-enfant-cantine.jpg',
      'assets/img/image-figure.jpg',
      'assets/img/images-de-voltige-nicole-025-2.jpg',
      'assets/img/logo.jpeg',
      'assets/video/poster.jpg'
    ],
    /* sections qui restent en place (contenu modifiable, structure protégée) */
    verrouillees: ['nav', 'pied'],
    paletteDefaut: {
      '--rouge': '#D00828',
      '--rouge-sombre': '#A5081F',
      '--rouge-vif': '#F2415A',
      '--encre': '#1D1216',
      '--voile': '#F7F3F0'
    },
    nomsPalette: {
      '--rouge': 'Rouge principal',
      '--rouge-sombre': 'Rouge sombre',
      '--rouge-vif': 'Rouge vif (fonds sombres)',
      '--encre': 'Encre (textes)',
      '--voile': 'Blanc cassé (fonds)'
    }
  };

  var NUANCES = [
    ['#D00828', 'Rouge'], ['#F2415A', 'Rouge vif'], ['#A5081F', 'Rouge sombre'],
    ['#1D1216', 'Encre'], ['#FFFFFF', 'Blanc'], ['#F7F3F0', 'Blanc cassé'],
    ['#78646C', 'Gris doux']
  ];

  var BLOC_TEXTE = /^(H1|H2|H3|H4|H5|P|LI|BLOCKQUOTE|FIGCAPTION|TD|TH|SUMMARY|DT|DD)$/;
  var INLINE_TEXTE = /^(A|SPAN|B|SMALL|EM|I|STRONG|U|BUTTON|TIME|LABEL)$/;
  /* jamais rendus modifiables d'un bloc : trop grands, on modifie leurs enfants */
  var JAMAIS_BLOC = '.cours-ligne,.carte-stage,.carte-parcours,.choix-stage,.marque,.boite,.carte-surgi';

  var NOMS_SECTIONS = {
    'nav': 'Barre de navigation', 'pied': 'Pied de page',
    'hero-video': 'Grand écran d’accueil', 'page-hero': 'En-tête de page',
    'marquee': 'Bandeau défilant', 'bande-photos': 'Bande de photos',
    'bande-cta': 'Bande d’appel', 'section-theatre': 'Le théâtre',
    'section-stages': 'Les stages'
  };

  /* ============ État ============ */
  var etat = {
    fichier: null,
    pages: {},          /* fichier → { original, travail, sale, historique[], refaire[] } */
    actifs: {},         /* 'assets/img/x.jpg' → { b64, type } */
    palette: {},        /* variables CSS modifiées */
    paletteSale: false,
    sel: null,          /* { el, type } */
    edition: null,      /* élément en cours d'édition texte */
    editionAvant: null, /* instantané pris à l'entrée en édition */
    compteurId: 0
  };

  /* D'où viennent les pages ? Tant que le site en ligne n'affiche que la
     page d'attente, le déploiement place une copie du vrai site sous
     /builder/site/ : on la préfère si elle existe, sinon on lit à la
     racine du site (site complet en ligne, ou serveur local). */
  var racineSite = new URL('..', location.href).href;
  var SOURCES = [new URL('site/', location.href).href, racineSite];
  var baseSite = racineSite;

  function recupererPage(fichier) {
    function essayer(i) {
      if (i >= SOURCES.length) {
        return Promise.reject(new Error('page introuvable sur le site et dans la copie de l’éditeur'));
      }
      return fetch(SOURCES[i] + fichier, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) { return essayer(i + 1); }
        return r.text().then(function (texte) {
          /* la page d'attente ne référence pas la feuille de style du site :
             si le marqueur manque, ce n'est pas une vraie page */
          if (texte.indexOf('assets/css/style.css') === -1) { return essayer(i + 1); }
          baseSite = SOURCES[i];
          return texte;
        });
      }, function () { return essayer(i + 1); });
    }
    return essayer(0);
  }

  /* ============ Raccourcis DOM ============ */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var cadreEl = $('#cadre'), iframe = $('#apercu'), chargEl = $('#chargement');
  var panneauDroit = $('#panneau-droit');

  function idoc() { return iframe.contentDocument; }
  function iwin() { return iframe.contentWindow; }

  function echapper(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var notifTimer = null;
  function notifier(msg, type) {
    var n = $('#notif');
    n.textContent = msg;
    n.className = 'notif' + (type ? ' ' + type : '');
    n.hidden = false;
    clearTimeout(notifTimer);
    notifTimer = setTimeout(function () { n.hidden = true; }, 3600);
  }

  /* ============ Ce qui est injecté dans l'aperçu ============ */
  var STYLE_EDITEUR =
    '<style data-av-editeur>' +
    'html{scroll-behavior:auto!important}' +
    '.reveal{opacity:1!important;transform:none!important}' +
    '.chargeur,.surgi,.acces-rapide,.defile{display:none!important}' +
    '.marquee-piste,.bande-photos .piste{animation-play-state:paused}' +
    '.hero-photo,.page-hero-photo,.arche-photo img,.page-arche img,.bp img,.theatre-arche img,' +
    '.carte-visuel img,.cercle-hero .rond-photo img,.photo-frise img,.carte-parcours .visuel img{animation:none!important}' +
    '.hero-contenu h1 .ligne>span,.page-hero .ligne>span{transform:none!important}' +
    '.hero-sub,.hero-cta,.cercle-hero .rond-photo,.page-arche{opacity:1!important;transform:none!important}' +
    '.longe ellipse{stroke-dashoffset:0!important;transition:none!important}' +
    /* le JS du site est neutralisé dans l'aperçu : on émule la barre blanche des pages intérieures */
    'body.nav-toujours-blanche .nav{background:var(--blanc);color:var(--encre);border-bottom:1px solid var(--trait);height:64px}' +
    'body.nav-toujours-blanche .nav::after{opacity:0}' +
    'body.nav-toujours-blanche .marque img{border-color:var(--trait)}' +
    'body.nav-toujours-blanche .btn-nav{background:var(--rouge);color:var(--blanc)}' +
    '.av-survol{outline:1.5px dashed rgba(208,8,40,.8)!important;outline-offset:3px}' +
    '.av-choisi{outline:2.5px solid #D00828!important;outline-offset:3px}' +
    '[contenteditable="true"]{outline:2.5px solid #1D6FD0!important;outline-offset:4px;cursor:text}' +
    '[data-av-id][hidden]{display:block!important;opacity:.35;filter:grayscale(.7)}' +
    '#av-outil,#av-outil-texte{position:absolute;z-index:2147483000;display:flex;align-items:center;gap:2px;' +
    'background:#16090D;border-radius:9px;padding:4px;box-shadow:0 10px 30px rgba(0,0,0,.4);' +
    'font-family:system-ui,sans-serif;line-height:1;user-select:none}' +
    '#av-outil button,#av-outil-texte button{all:unset;cursor:pointer;color:#fff;font-size:12px;font-weight:600;' +
    'padding:8px 10px;border-radius:6px;white-space:nowrap}' +
    '#av-outil button:hover,#av-outil-texte button:hover{background:#D00828}' +
    '#av-outil button[disabled]{opacity:.3;cursor:default}' +
    '#av-outil button[disabled]:hover{background:none}' +
    '#av-outil .av-sep,#av-outil-texte .av-sep{width:1px;height:16px;background:rgba(255,255,255,.2);margin:0 3px}' +
    '</style>';

  /* Les scripts du site sont endormis dans l'aperçu (sinon ils modifient le
     DOM — loader retiré, classes d'état — et pollueraient le HTML publié).
     Leur type d'origine est mémorisé pour les restaurer à l'identique. */
  function endormirScripts(html) {
    return html.replace(/<script\b([^>]*)>/gi, function (m, attrs) {
      if (/data-av-(editeur|type)/.test(attrs)) { return m; }
      var type = '';
      var reste = attrs.replace(/\s*type\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, function (mm, v) {
        type = v.replace(/^["']|["']$/g, '');
        return '';
      });
      return '<script' + reste + ' data-av-type="' + type + '" type="text/plain">';
    });
  }

  function stylePalette() {
    var regles = '';
    for (var k in etat.palette) { regles += k + ':' + etat.palette[k] + ';'; }
    return '<style id="av-palette" data-av-editeur>:root{' + regles + '}</style>';
  }

  function preparer(html) {
    var out = endormirScripts(html);
    out = out.replace(/<head([^>]*)>/i, function (m, a) {
      return '<head' + a + '><base href="' + baseSite + '" data-av-editeur>';
    });
    out = out.replace(/<\/head>/i, STYLE_EDITEUR + stylePalette() + '</head>');
    return out;
  }

  /* ============ Chargement & rendu ============ */
  function pageCourante() { return etat.pages[etat.fichier]; }

  function chargerPage(fichier) {
    finirEdition(false);
    etat.fichier = fichier;
    majListePages();
    var p = etat.pages[fichier];
    if (p && p.travail) { rendre(p.travail); return; }

    chargEl.classList.remove('fini');
    recupererPage(fichier)
      .then(function (texte) {
        var brouillon = null;
        try { brouillon = localStorage.getItem('av:brouillon:' + fichier); } catch (e) {}
        etat.pages[fichier] = {
          original: texte,
          travail: brouillon || texte,
          sale: !!brouillon,
          historique: [], refaire: []
        };
        if (brouillon) { notifier('Brouillon non publié restauré pour cette page.'); }
        rendre(etat.pages[fichier].travail);
        majEtatGlobal();
      })
      .catch(function (err) {
        chargEl.classList.add('fini');
        notifier('Impossible de charger « ' + fichier + ' » — vérifiez votre connexion, ou ouvrez l’éditeur depuis le site (http), pas depuis un fichier local. (' + err.message + ')', 'erreur');
      });
  }

  function rendre(html, garderDefil) {
    var defil = 0;
    try { defil = garderDefil ? iwin().scrollY : 0; } catch (e) {}
    chargEl.classList.remove('fini');
    var d = iframe.contentDocument;
    d.open();
    d.write(preparer(html));
    d.close();
    brancher();
    if (defil) { try { iwin().scrollTo(0, defil); } catch (e) {} }
    setTimeout(function () { chargEl.classList.add('fini'); }, 350);
  }

  /* ============ Branchement de l'aperçu ============ */
  function selecteurSections() {
    return ':scope > section, :scope > header, :scope > footer, :scope > div.marquee, :scope > div.bande-photos';
  }

  function sectionsGerees() {
    var d = idoc();
    if (!d || !d.body) { return []; }
    return $$(selecteurSections(), d.body).filter(function (el) {
      return el.querySelectorAll ? true : false;
    });
  }

  function estVerrouillee(el) {
    return CONFIG.verrouillees.some(function (c) { return el.classList.contains(c); });
  }

  function nomSection(el) {
    for (var c in NOMS_SECTIONS) {
      if (el.classList.contains(c)) { return NOMS_SECTIONS[c]; }
    }
    var h = el.querySelector('h1,h2,h3');
    if (h && h.textContent.trim()) { return h.textContent.trim().replace(/\s+/g, ' ').slice(0, 44); }
    var e = el.querySelector('.eyebrow');
    if (e && e.textContent.trim()) { return e.textContent.trim().slice(0, 44); }
    return el.tagName === 'FOOTER' ? 'Pied de page' : 'Section';
  }

  function brancher() {
    var d = idoc();
    if (!d || !d.body) { return; }

    sectionsGerees().forEach(function (el) {
      el.setAttribute('data-av-id', 's' + (++etat.compteurId));
    });

    /* barres d'outils flottantes, recréées à chaque rendu */
    var outil = d.createElement('div');
    outil.id = 'av-outil';
    outil.setAttribute('data-av-editeur', '');
    outil.innerHTML =
      '<button data-act="monter" title="Monter la section">↑</button>' +
      '<button data-act="descendre" title="Descendre la section">↓</button>' +
      '<span class="av-sep"></span>' +
      '<button data-act="dupliquer">Dupliquer</button>' +
      '<button data-act="masquer">Masquer</button>' +
      '<button data-act="supprimer">Supprimer</button>';
    outil.style.display = 'none';
    d.body.appendChild(outil);

    var outilTexte = d.createElement('div');
    outilTexte.id = 'av-outil-texte';
    outilTexte.setAttribute('data-av-editeur', '');
    outilTexte.innerHTML =
      '<button data-cmd="bold" title="Gras"><b>G</b></button>' +
      '<button data-cmd="italic" title="Italique"><i>I</i></button>' +
      '<span class="av-sep"></span>' +
      '<button data-cmd="createLink">Lien</button>' +
      '<button data-cmd="unlink">Retirer&nbsp;lien</button>' +
      '<span class="av-sep"></span>' +
      '<button data-cmd="fin">✓ Terminer</button>';
    outilTexte.style.display = 'none';
    d.body.appendChild(outilTexte);

    outil.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    outil.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !etat.sel) { return; }
      e.stopPropagation();
      actionSection(b.dataset.act, etat.sel.el.closest('[data-av-id]'));
    });
    outilTexte.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    outilTexte.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) { return; }
      e.stopPropagation();
      commandeTexte(b.dataset.cmd);
    });

    /* navigation neutralisée, sélection, édition */
    d.addEventListener('click', surClic, true);
    d.addEventListener('dblclick', surDoubleClic, true);
    d.addEventListener('submit', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
    d.addEventListener('mouseover', surSurvol, true);
    d.addEventListener('mouseout', function () { survoler(null); }, true);
    d.addEventListener('keydown', surTouche, true);
    d.addEventListener('focusout', function (e) {
      if (etat.edition && e.target === etat.edition) {
        /* laisse passer les clics sur la barre d'outils texte */
        setTimeout(function () {
          var actif = idoc() && idoc().activeElement;
          if (etat.edition && actif !== etat.edition) { finirEdition(true); }
        }, 120);
      }
    });
    iwin().addEventListener('scroll', placerOutils, { passive: true });
    iwin().addEventListener('resize', placerOutils);

    etat.sel = null; etat.edition = null;
    majListeSections();
    majPanneau();
    majBoutonsHistorique();
  }

  /* ============ Ciblage : que sélectionne un clic ? ============ */
  function cibleTexte(el) {
    var t = el;
    while (t && t.nodeType === 1 && !(t.tagName && (BLOC_TEXTE.test(t.tagName) || INLINE_TEXTE.test(t.tagName)))) {
      t = t.parentElement;
    }
    if (!t || t.nodeType !== 1) { return null; }
    /* remonte tant que le parent est encore un élément textuel, sans avaler les grandes cartes */
    while (t.parentElement &&
           (BLOC_TEXTE.test(t.parentElement.tagName) || INLINE_TEXTE.test(t.parentElement.tagName)) &&
           !t.parentElement.matches(JAMAIS_BLOC) &&
           t.parentElement !== idoc().body) {
      t = t.parentElement;
    }
    if (t.matches(JAMAIS_BLOC)) { return null; }
    if (t.closest('[data-av-editeur]')) { return null; }
    return t;
  }

  function cible(el) {
    if (!el || el.nodeType !== 1) { return null; }
    if (el.closest && el.closest('[data-av-editeur]')) { return null; }
    var img = el.closest ? el.closest('img') : null;
    if (img) { return { el: img, type: 'image' }; }
    var txt = cibleTexte(el);
    if (txt) { return { el: txt, type: txt.tagName === 'A' || txt.tagName === 'BUTTON' ? 'lien' : 'texte' }; }
    var sec = el.closest ? el.closest('[data-av-id]') : null;
    if (sec) { return { el: sec, type: 'section' }; }
    return null;
  }

  /* ============ Survol & sélection ============ */
  var survole = null;
  function survoler(el) {
    if (survole && survole !== el) { survole.classList.remove('av-survol'); }
    survole = el;
    if (el && (!etat.sel || etat.sel.el !== el)) { el.classList.add('av-survol'); }
  }
  function surSurvol(e) {
    if (etat.edition) { return; }
    var c = cible(e.target);
    survoler(c ? c.el : null);
  }

  function surClic(e) {
    if (e.target.closest && e.target.closest('[data-av-editeur]')) { return; }
    var a = e.target.closest && e.target.closest('a');
    if (a) { e.preventDefault(); }
    if (etat.edition) {
      if (!etat.edition.contains(e.target)) { finirEdition(true); }
      return;
    }
    var c = cible(e.target);
    if (c) { e.stopPropagation(); }
    selectionner(c);
  }

  function surDoubleClic(e) {
    if (etat.edition) { return; }
    var t = cibleTexte(e.target);
    if (t) {
      e.preventDefault(); e.stopPropagation();
      selectionner({ el: t, type: t.tagName === 'A' ? 'lien' : 'texte' });
      commencerEdition(t);
    }
  }

  function selectionner(c) {
    if (etat.sel) { etat.sel.el.classList.remove('av-choisi'); }
    etat.sel = c || null;
    if (etat.sel) {
      etat.sel.el.classList.remove('av-survol');
      etat.sel.el.classList.add('av-choisi');
    }
    /* sur mobile, le panneau des réglages glisse quand on choisit un élément */
    var boite = $('#boite-droite');
    if (matchMedia('(max-width:800px)').matches) {
      boite.classList.toggle('ouvert', !!etat.sel);
    }
    placerOutils();
    majListeSections();
    majPanneau();
  }

  function placerOutils() {
    var d = idoc();
    if (!d) { return; }
    var outil = d.getElementById('av-outil');
    var outilTexte = d.getElementById('av-outil-texte');
    if (!outil) { return; }

    if (etat.edition && outilTexte) {
      outil.style.display = 'none';
      poser(outilTexte, etat.edition);
      return;
    }
    if (outilTexte) { outilTexte.style.display = 'none'; }

    if (etat.sel && etat.sel.type === 'section') {
      var sec = etat.sel.el;
      if (estVerrouillee(sec)) { outil.style.display = 'none'; return; }
      poser(outil, sec);
      var liste = sectionsGerees().filter(function (s) { return !estVerrouillee(s); });
      var i = liste.indexOf(sec);
      outil.querySelector('[data-act="monter"]').disabled = i <= 0;
      outil.querySelector('[data-act="descendre"]').disabled = i === liste.length - 1;
      outil.querySelector('[data-act="masquer"]').textContent = sec.hidden ? 'Afficher' : 'Masquer';
    } else {
      outil.style.display = 'none';
    }
  }

  function poser(outil, el) {
    var w = iwin();
    var r = el.getBoundingClientRect();
    outil.style.display = 'flex';
    var haut = r.top + w.scrollY - outil.offsetHeight - 10;
    if (haut < w.scrollY + 8) { haut = r.top + w.scrollY + 10; }
    var gauche = Math.max(8, Math.min(r.left + w.scrollX + 8, w.scrollX + w.innerWidth - outil.offsetWidth - 12));
    outil.style.top = haut + 'px';
    outil.style.left = gauche + 'px';
  }

  /* ============ Édition de texte en direct ============ */
  function commencerEdition(el) {
    finirEdition(true);
    etat.editionAvant = serialiser(idoc(), 'travail');
    etat.edition = el;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');
    el.focus();
    placerOutils();
  }

  function finirEdition(garder) {
    if (!etat.edition) { return; }
    var el = etat.edition;
    etat.edition = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    if (garder && etat.editionAvant != null) {
      var apres = serialiser(idoc(), 'travail');
      if (apres !== etat.editionAvant) { pousserHistorique(etat.editionAvant); }
    }
    etat.editionAvant = null;
    placerOutils();
    majPanneau();
    majListeSections();
  }

  function commandeTexte(cmd) {
    var d = idoc();
    if (cmd === 'fin') { finirEdition(true); return; }
    if (!etat.edition) { return; }
    if (cmd === 'createLink') {
      var url = prompt('Adresse du lien (ex. stages.html, https://…) :');
      if (!url) { return; }
      d.execCommand('createLink', false, url);
    } else {
      d.execCommand(cmd, false, null);
    }
    etat.edition.focus();
  }

  /* ============ Actions sur les sections ============ */
  function actionSection(act, sec) {
    if (!sec) { return; }
    if (estVerrouillee(sec) && act !== 'rien') {
      notifier('Cette partie du site est protégée : son contenu reste modifiable, mais pas sa structure.');
      return;
    }
    var avant = serialiser(idoc(), 'travail');
    var fait = false;

    if (act === 'monter' || act === 'descendre') {
      var liste = sectionsGerees().filter(function (s) { return !estVerrouillee(s); });
      var i = liste.indexOf(sec);
      var voisin = act === 'monter' ? liste[i - 1] : liste[i + 1];
      if (voisin) {
        if (act === 'monter') { voisin.parentNode.insertBefore(sec, voisin); }
        else { voisin.parentNode.insertBefore(sec, voisin.nextSibling); }
        fait = true;
        sec.scrollIntoView({ block: 'center' });
      }
    } else if (act === 'dupliquer') {
      var clone = sec.cloneNode(true);
      nettoyerNoeud(clone, 'travail');
      clone.removeAttribute('id');
      clone.setAttribute('data-av-id', 's' + (++etat.compteurId));
      sec.parentNode.insertBefore(clone, sec.nextSibling);
      fait = true;
    } else if (act === 'masquer') {
      sec.toggleAttribute('hidden');
      fait = true;
    } else if (act === 'supprimer') {
      if (!confirm('Supprimer définitivement la section « ' + nomSection(sec) + ' » ?\n(Vous pourrez encore annuler avec Ctrl+Z tant que l’éditeur est ouvert.)')) { return; }
      if (etat.sel && sec.contains(etat.sel.el)) { selectionner(null); }
      sec.remove();
      fait = true;
    }

    if (fait) {
      pousserHistorique(avant);
      majListeSections();
      placerOutils();
      majPanneau();
    }
  }

  function deplacerAvant(sec, ref) {
    /* dépôt par glisser-déposer depuis la liste : insérer sec avant ref (ou en dernier avant le pied) */
    if (estVerrouillee(sec)) { return; }
    if (ref && ref.classList.contains('nav')) { return; }
    var avant = serialiser(idoc(), 'travail');
    if (ref) { ref.parentNode.insertBefore(sec, ref); }
    else {
      var pied = idoc().body.querySelector(':scope > footer');
      if (pied) { pied.parentNode.insertBefore(sec, pied); }
      else { idoc().body.appendChild(sec); }
    }
    pousserHistorique(avant);
    majListeSections();
    placerOutils();
  }

  /* ============ Historique ============ */
  function pousserHistorique(instantane) {
    var p = pageCourante();
    if (!p) { return; }
    p.historique.push(instantane);
    if (p.historique.length > 60) { p.historique.shift(); }
    p.refaire.length = 0;
    p.sale = true;
    majBoutonsHistorique();
    majEtatGlobal();
    planifierSauvegarde();
  }

  function annuler() {
    var p = pageCourante();
    if (!p || !p.historique.length) { return; }
    finirEdition(false);
    p.refaire.push(serialiser(idoc(), 'travail'));
    var html = p.historique.pop();
    p.travail = html;
    rendre(html, true);
    majBoutonsHistorique();
    planifierSauvegarde();
  }

  function retablir() {
    var p = pageCourante();
    if (!p || !p.refaire.length) { return; }
    finirEdition(false);
    p.historique.push(serialiser(idoc(), 'travail'));
    var html = p.refaire.pop();
    p.travail = html;
    rendre(html, true);
    majBoutonsHistorique();
    planifierSauvegarde();
  }

  function majBoutonsHistorique() {
    var p = pageCourante();
    $('#btn-annuler').disabled = !p || !p.historique.length;
    $('#btn-retablir').disabled = !p || !p.refaire.length;
  }

  /* ============ Sérialisation ============ */
  function nettoyerNoeud(racine, mode) {
    $$('[data-av-editeur]', racine).forEach(function (n) { n.remove(); });
    $$('.av-survol,.av-choisi', racine).forEach(function (n) {
      n.classList.remove('av-survol', 'av-choisi');
      if (n.getAttribute('class') === '') { n.removeAttribute('class'); }
    });
    $$('[contenteditable]', racine).forEach(function (n) {
      n.removeAttribute('contenteditable');
      n.removeAttribute('spellcheck');
    });
    if (mode !== 'travail') {
      $$('[data-av-id]', racine).forEach(function (n) { n.removeAttribute('data-av-id'); });
      $$('img[data-av-asset]', racine).forEach(function (n) {
        if (mode === 'publier') { n.setAttribute('src', n.getAttribute('data-av-asset')); }
        n.removeAttribute('data-av-asset');
      });
      /* réveille les scripts du site, avec leur type d'origine */
      $$('script[data-av-type]', racine).forEach(function (n) {
        var t = n.getAttribute('data-av-type');
        if (t) { n.setAttribute('type', t); } else { n.removeAttribute('type'); }
        n.removeAttribute('data-av-type');
      });
    }
    return racine;
  }

  function serialiser(doc, mode) {
    var clone = doc.documentElement.cloneNode(true);
    nettoyerNoeud(clone, mode);
    return '<!DOCTYPE html>\n' + clone.outerHTML + '\n';
  }

  function serialiserDepuisTexte(html, mode) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    return serialiser(doc, mode);
  }

  /* ============ Sauvegarde locale (brouillons) ============ */
  var minuteurSauvegarde = null;
  function planifierSauvegarde() {
    clearTimeout(minuteurSauvegarde);
    minuteurSauvegarde = setTimeout(function () {
      var p = pageCourante();
      if (!p) { return; }
      p.travail = serialiser(idoc(), 'travail');
      try {
        if (p.sale) { localStorage.setItem('av:brouillon:' + etat.fichier, p.travail); }
        localStorage.setItem('av:palette', JSON.stringify(etat.palette));
      } catch (e) { /* quota : le brouillon reste en mémoire pour la session */ }
    }, 400);
  }

  /* ============ Liste des pages & sections (panneau gauche) ============ */
  function majListePages() {
    var ul = $('#liste-pages');
    ul.innerHTML = CONFIG.pages.map(function (pg) {
      var p = etat.pages[pg.fichier];
      return '<li class="' + (pg.fichier === etat.fichier ? 'active' : '') + '">' +
        '<button type="button" data-fichier="' + pg.fichier + '">' + echapper(pg.nom) +
        (p && p.sale ? '<span class="point-sale" title="Modifications non publiées"></span>' : '') +
        '</button></li>';
    }).join('');
    var sel = $('#choix-page');
    sel.innerHTML = CONFIG.pages.map(function (pg) {
      return '<option value="' + pg.fichier + '"' + (pg.fichier === etat.fichier ? ' selected' : '') + '>' +
        echapper(pg.nom) + '</option>';
    }).join('');
  }

  function majListeSections() {
    var ul = $('#liste-sections');
    var secs = sectionsGerees();
    ul.innerHTML = secs.map(function (s) {
      var verrou = estVerrouillee(s);
      var choisie = etat.sel && etat.sel.el.closest && etat.sel.el.closest('[data-av-id]') === s;
      return '<li data-id="' + s.getAttribute('data-av-id') + '"' +
        (verrou ? '' : ' draggable="true"') +
        ' class="' + [verrou ? 'verrouillee' : '', s.hidden ? 'masquee' : '', choisie ? 'choisie' : ''].join(' ').trim() + '">' +
        (verrou ? '<span class="cadenas" title="Section protégée">🔒</span>' : '<span class="poignee">⋮⋮</span>') +
        '<span class="nom-section">' + echapper(nomSection(s)) + '</span>' +
        (verrou ? '' :
          '<span class="mini-actions">' +
          '<button type="button" data-mini="masquer" title="' + (s.hidden ? 'Afficher' : 'Masquer') + '">' + (s.hidden ? '🙈' : '👁') + '</button>' +
          '<button type="button" data-mini="dupliquer" title="Dupliquer">⧉</button>' +
          '<button type="button" data-mini="supprimer" title="Supprimer">✕</button>' +
          '</span>') +
        '</li>';
    }).join('');
  }

  function sectionParId(id) {
    return idoc() ? idoc().querySelector('[data-av-id="' + id + '"]') : null;
  }

  function brancherListeSections() {
    var ul = $('#liste-sections');
    var idGlisse = null;

    ul.addEventListener('click', function (e) {
      var li = e.target.closest('li');
      if (!li) { return; }
      var sec = sectionParId(li.dataset.id);
      if (!sec) { return; }
      var mini = e.target.closest('[data-mini]');
      if (mini) { actionSection(mini.dataset.mini, sec); return; }
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      selectionner({ el: sec, type: 'section' });
    });
    ul.addEventListener('mouseover', function (e) {
      var li = e.target.closest('li');
      if (li) { var s = sectionParId(li.dataset.id); if (s) { survoler(s); } }
    });
    ul.addEventListener('mouseout', function () { survoler(null); });

    ul.addEventListener('dragstart', function (e) {
      var li = e.target.closest('li');
      if (!li || li.classList.contains('verrouillee')) { e.preventDefault(); return; }
      idGlisse = li.dataset.id;
      li.classList.add('glisse');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', idGlisse); } catch (err) {}
    });
    ul.addEventListener('dragend', function () {
      idGlisse = null;
      $$('#liste-sections li').forEach(function (li) { li.classList.remove('glisse', 'dessus'); });
    });
    ul.addEventListener('dragover', function (e) {
      if (!idGlisse) { return; }
      e.preventDefault();
      var li = e.target.closest('li');
      $$('#liste-sections li').forEach(function (l) { l.classList.remove('dessus'); });
      if (li && li.dataset.id !== idGlisse) { li.classList.add('dessus'); }
    });
    ul.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!idGlisse) { return; }
      var li = e.target.closest('li');
      var sec = sectionParId(idGlisse);
      if (!sec) { return; }
      var ref = li ? sectionParId(li.dataset.id) : null;
      if (ref === sec) { return; }
      deplacerAvant(sec, ref);
    });
  }

  /* ============ Panneau droit ============ */
  var ongletActif = 'page';

  function majPanneau() {
    if (!etat.sel) { panneauAccueil(); return; }
    var t = etat.sel.type;
    if (t === 'image') { panneauImage(etat.sel.el); }
    else if (t === 'lien') { panneauTexte(etat.sel.el, true); }
    else if (t === 'texte') { panneauTexte(etat.sel.el, false); }
    else { panneauSection(etat.sel.el); }
  }

  function nuancierHtml(idr, valeurActuelle) {
    return '<div class="nuancier" data-nuancier="' + idr + '">' +
      NUANCES.map(function (n) {
        return '<button type="button" style="background:' + n[0] + '" data-c="' + n[0] + '" title="' + n[1] + '"' +
          (valeurActuelle && valeurActuelle.toLowerCase() === n[0].toLowerCase() ? ' class="choisi"' : '') + '></button>';
      }).join('') +
      '<input type="color" value="' + (valeurActuelle || '#D00828') + '" title="Couleur libre">' +
      '<button type="button" class="efface" data-c="">Auto</button>' +
      '</div>';
  }

  function brancherNuancier(conteneur, idr, appliquer) {
    var bloc = conteneur.querySelector('[data-nuancier="' + idr + '"]');
    if (!bloc) { return; }
    bloc.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) { return; }
      var avant = serialiser(idoc(), 'travail');
      appliquer(b.dataset.c || '');
      pousserHistorique(avant);
      $$('button', bloc).forEach(function (x) { x.classList.remove('choisi'); });
      if (b.dataset.c) { b.classList.add('choisi'); }
    });
    var libre = bloc.querySelector('input[type="color"]');
    var avantLibre = null;
    libre.addEventListener('focus', function () { avantLibre = serialiser(idoc(), 'travail'); });
    libre.addEventListener('input', function () { appliquer(libre.value); });
    libre.addEventListener('change', function () {
      if (avantLibre != null) { pousserHistorique(avantLibre); avantLibre = null; }
    });
  }

  function curseurHtml(idr, libelle, min, max, valeur, unite) {
    return '<div class="groupe-prop"><label>' + libelle + '</label>' +
      '<div class="rang-curseur">' +
      '<input type="range" data-curseur="' + idr + '" min="' + min + '" max="' + max + '" value="' + valeur + '">' +
      '<output>' + valeur + unite + '</output>' +
      '<button type="button" class="efface" data-raz="' + idr + '" title="Revenir à l’automatique">Auto</button>' +
      '</div></div>';
  }

  function brancherCurseur(conteneur, idr, unite, appliquer, raz, finir) {
    var input = conteneur.querySelector('[data-curseur="' + idr + '"]');
    if (!input) { return; }
    var sortie = input.parentElement.querySelector('output');
    var avant = null;
    input.addEventListener('pointerdown', function () { avant = serialiser(idoc(), 'travail'); });
    input.addEventListener('input', function () {
      sortie.textContent = input.value + unite;
      appliquer(input.value);
    });
    input.addEventListener('change', function () {
      if (finir) { finir(); }
      if (avant != null) { pousserHistorique(avant); avant = null; }
    });
    var btnRaz = conteneur.querySelector('[data-raz="' + idr + '"]');
    if (btnRaz) {
      btnRaz.addEventListener('click', function () {
        var av = serialiser(idoc(), 'travail');
        raz();
        pousserHistorique(av);
        sortie.textContent = 'auto';
      });
    }
  }

  function lierChampTexte(input, appliquer) {
    var avant = null;
    input.addEventListener('focus', function () { avant = serialiser(idoc(), 'travail'); });
    input.addEventListener('input', function () { appliquer(input.value); });
    input.addEventListener('change', function () {
      if (avant != null && serialiser(idoc(), 'travail') !== avant) {
        pousserHistorique(avant);
      }
      avant = null;
    });
  }

  /* ---- panneau : rien de sélectionné ---- */
  function panneauAccueil() {
    var d = idoc();
    var titre = d && d.title ? d.title : '';
    var meta = d && d.querySelector('meta[name="description"]');
    var desc = meta ? meta.getAttribute('content') : '';

    panneauDroit.innerHTML =
      '<div class="onglets">' +
      '<button type="button" data-onglet="page" class="' + (ongletActif === 'page' ? 'actif' : '') + '">Cette page</button>' +
      '<button type="button" data-onglet="design" class="' + (ongletActif === 'design' ? 'actif' : '') + '">Design du site</button>' +
      '</div>' +
      (ongletActif === 'page' ?
        '<div class="prop-corps">' +
        '<div class="groupe-prop"><label>Titre de l’onglet (référencement)</label>' +
        '<input type="text" class="champ-texte" id="prop-titre" value="' + echapper(titre) + '"></div>' +
        '<div class="groupe-prop"><label>Description Google</label>' +
        '<textarea class="champ-zone" id="prop-desc">' + echapper(desc) + '</textarea>' +
        '<p class="note-prop">C’est le petit texte affiché sous le titre dans les résultats de recherche.</p></div>' +
        '<div class="groupe-prop"><div class="libelle">Page</div>' +
        '<div class="actions-prop">' +
        (baseSite === racineSite ? '<button type="button" id="prop-voir">Voir en ligne</button>' : '') +
        '<button type="button" class="danger" id="prop-raz-page"' +
        (baseSite === racineSite ? '' : ' style="grid-column:1/-1"') + '>Réinitialiser la page</button>' +
        '</div>' +
        '<p class="note-prop">« Réinitialiser » abandonne toutes les modifications non publiées de cette page.</p></div>' +
        '<div class="prop-vide"><h3>Pour modifier la page</h3>' +
        'Cliquez sur un texte, une photo ou une section dans l’aperçu. Double-cliquez sur un texte pour l’écrire directement.</div>' +
        '</div>'
        :
        '<div class="prop-corps"><div class="groupe-prop">' +
        '<div class="libelle">Couleurs du site</div>' +
        '<p class="note-prop" style="margin:0 0 12px">Ces couleurs s’appliquent à toutes les pages. L’aperçu se met à jour immédiatement.</p>' +
        Object.keys(CONFIG.paletteDefaut).map(function (k) {
          var v = etat.palette[k] || CONFIG.paletteDefaut[k];
          return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">' +
            '<input type="color" data-var="' + k + '" value="' + v + '" style="width:34px;height:34px;border:1px solid var(--trait);border-radius:8px;background:none;padding:2px;cursor:pointer">' +
            '<span style="flex:1;font-size:12.5px;font-weight:600">' + CONFIG.nomsPalette[k] + '</span>' +
            '</div>';
        }).join('') +
        '<div class="actions-prop" style="margin-top:6px"><button type="button" id="palette-raz">Couleurs d’origine</button></div>' +
        '<p class="note-prop">Les nouvelles couleurs seront enregistrées dans un fichier <code>custom.css</code> à la prochaine publication.</p>' +
        '</div></div>');

    $$('.onglets button', panneauDroit).forEach(function (b) {
      b.addEventListener('click', function () { ongletActif = b.dataset.onglet; panneauAccueil(); });
    });

    var champTitre = $('#prop-titre', panneauDroit);
    if (champTitre) {
      lierChampTexte(champTitre, function (v) { if (idoc()) { idoc().title = v; } });
      lierChampTexte($('#prop-desc', panneauDroit), function (v) {
        var m = idoc() && idoc().querySelector('meta[name="description"]');
        if (m) { m.setAttribute('content', v); }
      });
      var btnVoir = $('#prop-voir', panneauDroit);
      if (btnVoir) {
        btnVoir.addEventListener('click', function () {
          window.open(racineSite + etat.fichier, '_blank');
        });
      }
      $('#prop-raz-page', panneauDroit).addEventListener('click', function () {
        if (!confirm('Abandonner toutes les modifications non publiées de cette page ?')) { return; }
        var p = pageCourante();
        p.travail = p.original;
        p.historique.length = 0; p.refaire.length = 0; p.sale = false;
        try { localStorage.removeItem('av:brouillon:' + etat.fichier); } catch (e) {}
        rendre(p.original);
        majEtatGlobal();
        notifier('Page réinitialisée.');
      });
    }

    $$('input[data-var]', panneauDroit).forEach(function (inp) {
      inp.addEventListener('input', function () {
        etat.palette[inp.dataset.var] = inp.value;
        etat.paletteSale = true;
        appliquerPalette();
        majEtatGlobal();
        planifierSauvegarde();
      });
    });
    var razPal = $('#palette-raz', panneauDroit);
    if (razPal) {
      razPal.addEventListener('click', function () {
        etat.palette = {};
        etat.paletteSale = true;
        appliquerPalette();
        panneauAccueil();
        majEtatGlobal();
        planifierSauvegarde();
      });
    }
  }

  function appliquerPalette() {
    var d = idoc();
    if (!d) { return; }
    var st = d.getElementById('av-palette');
    if (!st) { return; }
    var regles = '';
    for (var k in etat.palette) { regles += k + ':' + etat.palette[k] + ';'; }
    st.textContent = ':root{' + regles + '}';
  }

  /* ---- panneau : section ---- */
  function vitesseActuelle(el, defaut) {
    var d = parseFloat(el.style.animationDuration);
    return isNaN(d) || d <= 0 ? 100 : Math.round(defaut / d * 100);
  }

  function panneauSection(sec) {
    var verrou = estVerrouillee(sec);
    var pad = parseInt(sec.style.paddingTop, 10);
    var piste = sec.querySelector('.marquee-piste, .bande-photos .piste');
    var pisteDefaut = piste && piste.classList.contains('marquee-piste') ? 28 : 36;
    var badge = sec.querySelector('.badge-academie svg, .badge-cercle svg');
    var ytId = null;
    if (sec.classList.contains('hero-video')) {
      var yt = sec.querySelector('.hero-yt iframe');
      var m = yt && /embed\/([\w-]{6,})/.exec(yt.getAttribute('src') || '');
      ytId = m ? m[1] : '';
    }
    var grille = sec.querySelector('.galerie-grille');

    panneauDroit.innerHTML =
      '<div class="prop-tete"><span class="type">Section' + (verrou ? ' · protégée' : '') + '</span>' +
      '<span class="nom">' + echapper(nomSection(sec)) + '</span></div>' +
      '<div class="prop-corps">' +
      (verrou ? '' :
        '<div class="groupe-prop"><div class="libelle">Organisation</div><div class="actions-prop">' +
        '<button type="button" data-act="monter">↑ Monter</button>' +
        '<button type="button" data-act="descendre">↓ Descendre</button>' +
        '<button type="button" data-act="dupliquer">⧉ Dupliquer</button>' +
        '<button type="button" data-act="masquer">' + (sec.hidden ? '👁 Afficher' : '🙈 Masquer') + '</button>' +
        '<button type="button" class="danger" data-act="supprimer" style="grid-column:1/-1">✕ Supprimer la section</button>' +
        '</div>' +
        (sec.hidden ? '<p class="note-prop">Section masquée : elle reste dans la page mais n’apparaîtra pas sur le site.</p>' : '') +
        '</div>') +
      (ytId !== null ?
        '<div class="groupe-prop"><label>Vidéo YouTube de fond</label>' +
        '<input type="text" class="champ-texte" id="prop-yt" value="' + echapper(ytId) + '" placeholder="Identifiant, ex. S66yaWydw9w">' +
        '<p class="note-prop">Collez l’identifiant de la vidéo (les caractères après « watch?v= » dans l’adresse YouTube).</p></div>' : '') +
      (grille ?
        '<div class="groupe-prop"><div class="libelle">Galerie</div>' +
        '<button type="button" class="btn-remplacer" id="prop-ajout-photo">➕ Ajouter des photos…</button>' +
        '<input type="file" id="prop-ajout-fichier" accept="image/*" multiple hidden>' +
        '<p class="note-prop">Les nouvelles photos arrivent en fin de galerie. Cliquez ensuite sur une photo pour la déplacer ou la retirer.</p></div>' : '') +
      (piste ?
        curseurHtml('vitesse', 'Vitesse de défilement', 25, 300, vitesseActuelle(piste, pisteDefaut), ' %') : '') +
      (badge ?
        curseurHtml('rotation', 'Vitesse de rotation du badge', 25, 300, vitesseActuelle(badge, 26), ' %') : '') +
      '<div class="groupe-prop"><div class="libelle">Couleur de fond</div>' + nuancierHtml('fond', sec.style.backgroundColor ? null : null) + '</div>' +
      '<div class="groupe-prop"><div class="libelle">Couleur du texte</div>' + nuancierHtml('texte', null) + '</div>' +
      curseurHtml('pad', 'Espacement intérieur (haut & bas)', 0, 160, isNaN(pad) ? 80 : pad, ' px') +
      '</div>';

    $$('[data-act]', panneauDroit).forEach(function (b) {
      b.addEventListener('click', function () { actionSection(b.dataset.act, sec); });
    });

    if (grille) {
      var ajoutFichier = $('#prop-ajout-fichier', panneauDroit);
      $('#prop-ajout-photo', panneauDroit).addEventListener('click', function () { ajoutFichier.click(); });
      ajoutFichier.addEventListener('change', function () {
        var fs = Array.prototype.slice.call(ajoutFichier.files);
        if (!fs.length) { return; }
        var avant = serialiser(idoc(), 'travail');
        var pousse = false;
        var total = 0;
        fs.forEach(function (f) {
          importerImage(f, function (url, chemin) {
            var fig = idoc().createElement('figure');
            fig.className = 'galerie-photo';
            var im = idoc().createElement('img');
            im.setAttribute('loading', 'lazy');
            im.setAttribute('decoding', 'async');
            im.setAttribute('alt', '');
            im.setAttribute('src', url);
            im.setAttribute('data-av-asset', chemin);
            fig.appendChild(im);
            grille.appendChild(fig);
            if (!pousse) { pousse = true; pousserHistorique(avant); }
            total++;
            notifier(total > 1 ? total + ' photos ajoutées — pensez à publier pour les mettre en ligne.'
              : 'Photo ajoutée à la galerie — pensez à publier pour la mettre en ligne.');
          });
        });
        ajoutFichier.value = '';
      });
    }

    var champYt = $('#prop-yt', panneauDroit);
    if (champYt) {
      lierChampTexte(champYt, function (v) {
        var id = v.trim().replace(/^.*(?:watch\?v=|youtu\.be\/|embed\/)/, '').replace(/[?&].*$/, '');
        var yt = sec.querySelector('.hero-yt iframe');
        if (yt && /^[\w-]{6,}$/.test(id)) {
          yt.setAttribute('src', 'https://www.youtube-nocookie.com/embed/' + id +
            '?autoplay=1&mute=1&loop=1&playlist=' + id +
            '&controls=0&rel=0&playsinline=1&disablekb=1&iv_load_policy=3&modestbranding=1');
        }
      });
    }

    brancherNuancier(panneauDroit, 'fond', function (c) {
      if (c) { sec.style.backgroundColor = c; } else { sec.style.backgroundColor = ''; }
      if (sec.getAttribute('style') === '') { sec.removeAttribute('style'); }
    });
    brancherNuancier(panneauDroit, 'texte', function (c) {
      if (c) { sec.style.color = c; } else { sec.style.color = ''; }
      if (sec.getAttribute('style') === '') { sec.removeAttribute('style'); }
    });
    brancherCurseur(panneauDroit, 'pad', ' px', function (v) {
      sec.style.paddingTop = v + 'px';
      sec.style.paddingBottom = v + 'px';
    }, function () {
      sec.style.paddingTop = '';
      sec.style.paddingBottom = '';
      if (sec.getAttribute('style') === '') { sec.removeAttribute('style'); }
    });

    if (piste) {
      /* pendant le réglage, le bandeau défile pour juger la vitesse ;
         il se remet en pause (côté éditeur seulement) au relâchement */
      brancherCurseur(panneauDroit, 'vitesse', ' %', function (v) {
        piste.style.animationDuration = (pisteDefaut * 100 / v).toFixed(1) + 's';
        piste.style.animationPlayState = 'running';
      }, function () {
        piste.style.animationDuration = '';
        piste.style.animationPlayState = '';
        if (piste.getAttribute('style') === '') { piste.removeAttribute('style'); }
      }, function () {
        piste.style.animationPlayState = '';
        if (piste.getAttribute('style') === '') { piste.removeAttribute('style'); }
      });
    }
    if (badge) {
      brancherCurseur(panneauDroit, 'rotation', ' %', function (v) {
        badge.style.animationDuration = (26 * 100 / v).toFixed(1) + 's';
      }, function () {
        badge.style.animationDuration = '';
        if (badge.getAttribute('style') === '') { badge.removeAttribute('style'); }
      });
    }
  }

  /* ---- panneau : texte / lien ---- */
  function panneauTexte(el, estLien) {
    var taille = parseFloat(el.style.fontSize) || '';
    var estBtn = el.classList.contains('btn');

    panneauDroit.innerHTML =
      '<div class="prop-tete"><span class="type">' + (estLien ? (estBtn ? 'Bouton' : 'Lien') : 'Texte') + '</span>' +
      '<span class="nom">' + echapper(el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) || '(vide)') + '</span></div>' +
      '<div class="prop-corps">' +
      '<div class="groupe-prop"><div class="actions-prop">' +
      '<button type="button" id="prop-editer" style="grid-column:1/-1">✎ Modifier le texte</button></div>' +
      '<p class="note-prop">Ou double-cliquez directement sur le texte dans l’aperçu. Pendant l’écriture, une petite barre permet le gras, l’italique et les liens.</p></div>' +
      (estLien ?
        '<div class="groupe-prop"><label>Adresse du lien</label>' +
        '<input type="text" class="champ-texte" id="prop-href" value="' + echapper(el.getAttribute('href') || '') + '" placeholder="stages.html ou https://…">' +
        '<label style="display:flex;align-items:center;gap:8px;margin-top:9px;font-size:12px;text-transform:none;letter-spacing:0">' +
        '<input type="checkbox" id="prop-cible" ' + (el.getAttribute('target') === '_blank' ? 'checked' : '') + '> Ouvrir dans un nouvel onglet</label></div>' : '') +
      (estBtn ?
        '<div class="groupe-prop"><div class="libelle">Style du bouton</div><div class="segments" id="prop-style-btn">' +
        '<button type="button" data-s="btn-plein"' + (el.classList.contains('btn-plein') ? ' class="actif"' : '') + '>Blanc</button>' +
        '<button type="button" data-s="btn-rouge"' + (el.classList.contains('btn-rouge') ? ' class="actif"' : '') + '>Rouge</button>' +
        '<button type="button" data-s="btn-contour"' + (el.classList.contains('btn-contour') ? ' class="actif"' : '') + '>Contour</button>' +
        '</div></div>' : '') +
      '<div class="groupe-prop"><div class="libelle">Couleur du texte</div>' + nuancierHtml('couleur', null) + '</div>' +
      '<div class="groupe-prop"><div class="libelle">Alignement</div><div class="segments" id="prop-align">' +
      '<button type="button" data-a="left">Gauche</button>' +
      '<button type="button" data-a="center">Centré</button>' +
      '<button type="button" data-a="right">Droite</button>' +
      '<button type="button" data-a="">Auto</button>' +
      '</div></div>' +
      curseurHtml('taille', 'Taille du texte', 60, 180, taille ? Math.round(taille * 100) : 100, ' %') +
      '</div>';

    $('#prop-editer', panneauDroit).addEventListener('click', function () { commencerEdition(el); });

    var href = $('#prop-href', panneauDroit);
    if (href) {
      lierChampTexte(href, function (v) { el.setAttribute('href', v); });
      $('#prop-cible', panneauDroit).addEventListener('change', function (e) {
        var avant = serialiser(idoc(), 'travail');
        if (e.target.checked) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
        else { el.removeAttribute('target'); el.removeAttribute('rel'); }
        pousserHistorique(avant);
      });
    }

    var styleBtn = $('#prop-style-btn', panneauDroit);
    if (styleBtn) {
      styleBtn.addEventListener('click', function (e) {
        var b = e.target.closest('button');
        if (!b) { return; }
        var avant = serialiser(idoc(), 'travail');
        el.classList.remove('btn-plein', 'btn-rouge', 'btn-contour');
        el.classList.add(b.dataset.s);
        pousserHistorique(avant);
        $$('button', styleBtn).forEach(function (x) { x.classList.toggle('actif', x === b); });
      });
    }

    brancherNuancier(panneauDroit, 'couleur', function (c) {
      el.style.color = c || '';
      if (el.getAttribute('style') === '') { el.removeAttribute('style'); }
    });

    $('#prop-align', panneauDroit).addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) { return; }
      var avant = serialiser(idoc(), 'travail');
      el.style.textAlign = b.dataset.a || '';
      if (el.getAttribute('style') === '') { el.removeAttribute('style'); }
      pousserHistorique(avant);
      $$('#prop-align button', panneauDroit).forEach(function (x) { x.classList.toggle('actif', x === b); });
    });

    brancherCurseur(panneauDroit, 'taille', ' %', function (v) {
      el.style.fontSize = (v / 100) + 'em';
    }, function () {
      el.style.fontSize = '';
      if (el.getAttribute('style') === '') { el.removeAttribute('style'); }
    });
  }

  /* ---- import d'une image choisie sur l'ordinateur ---- */
  function importerImage(f, rappel) {
    if (!/^image\//.test(f.type)) { notifier('« ' + f.name + ' » n’est pas une image.', 'erreur'); return; }
    var lecteur = new FileReader();
    lecteur.onload = function () {
      var url = String(lecteur.result);
      var b64 = url.slice(url.indexOf(',') + 1);
      var nom = f.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'photo.jpg';
      if (!/\.[a-z0-9]+$/.test(nom)) { nom += '.jpg'; }
      var chemin = 'assets/img/' + nom;
      var i = 2;
      while (etat.actifs[chemin] || CONFIG.imagesConnues.indexOf(chemin) !== -1) {
        chemin = 'assets/img/' + nom.replace(/(\.[a-z0-9]+)$/, '-' + (i++) + '$1');
      }
      etat.actifs[chemin] = { b64: b64, type: f.type };
      rappel(url, chemin);
    };
    lecteur.readAsDataURL(f);
  }

  /* ---- panneau : image ---- */
  function panneauImage(img) {
    var pos = /center (\d+)%/.exec(img.style.objectPosition || '');
    var toutes = CONFIG.imagesConnues.concat(Object.keys(etat.actifs));
    var figure = img.closest('figure.galerie-photo');

    panneauDroit.innerHTML =
      '<div class="prop-tete"><span class="type">Photo</span>' +
      '<span class="nom">' + echapper((img.getAttribute('data-av-asset') || img.getAttribute('src') || '').split('/').pop().split('?')[0].slice(0, 34)) + '</span></div>' +
      '<div class="prop-corps">' +
      '<div class="groupe-prop">' +
      '<img class="apercu-img" id="prop-apercu-img" src="' + echapper(img.src) + '" alt="">' +
      '<button type="button" class="btn-remplacer" id="prop-remplacer">Remplacer la photo…</button>' +
      '<input type="file" id="prop-fichier" accept="image/*" hidden>' +
      '<p class="note-prop">Formats conseillés : JPEG ou WebP, 2000 px de large maximum pour un site rapide.</p></div>' +
      '<div class="groupe-prop"><div class="libelle">Photos du site</div><div class="galerie" id="prop-galerie">' +
      toutes.map(function (chemin) {
        var src = etat.actifs[chemin] ? 'data:' + etat.actifs[chemin].type + ';base64,' + etat.actifs[chemin].b64 : baseSite + chemin;
        return '<button type="button" data-chemin="' + echapper(chemin) + '" title="' + echapper(chemin.split('/').pop()) + '">' +
          '<img loading="lazy" src="' + echapper(src) + '" alt=""></button>';
      }).join('') +
      '</div></div>' +
      '<div class="groupe-prop"><label>Texte de remplacement (accessibilité)</label>' +
      '<input type="text" class="champ-texte" id="prop-alt" value="' + echapper(img.getAttribute('alt') || '') + '" placeholder="Décrivez la photo en quelques mots">' +
      '</div>' +
      curseurHtml('cadrage', 'Cadrage vertical', 0, 100, pos ? +pos[1] : 50, ' %') +
      (figure ?
        '<div class="groupe-prop"><div class="libelle">Photo de la galerie</div><div class="actions-prop">' +
        '<button type="button" id="prop-gal-prec">◀ Reculer</button>' +
        '<button type="button" id="prop-gal-suiv">Avancer ▶</button>' +
        '<button type="button" class="danger" id="prop-gal-retirer" style="grid-column:1/-1">✕ Retirer de la galerie</button>' +
        '</div></div>' : '') +
      '</div>';

    var fichier = $('#prop-fichier', panneauDroit);
    $('#prop-remplacer', panneauDroit).addEventListener('click', function () { fichier.click(); });
    fichier.addEventListener('change', function () {
      var f = fichier.files[0];
      if (!f) { return; }
      var avant = serialiser(idoc(), 'travail');
      importerImage(f, function (url, chemin) {
        img.setAttribute('src', url);
        img.setAttribute('data-av-asset', chemin);
        pousserHistorique(avant);
        panneauImage(img);
        notifier('Photo remplacée — elle sera envoyée sur le site à la publication.');
      });
    });

    $('#prop-galerie', panneauDroit).addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) { return; }
      var avant = serialiser(idoc(), 'travail');
      var chemin = b.dataset.chemin;
      if (etat.actifs[chemin]) {
        img.setAttribute('src', 'data:' + etat.actifs[chemin].type + ';base64,' + etat.actifs[chemin].b64);
        img.setAttribute('data-av-asset', chemin);
      } else {
        img.setAttribute('src', chemin);
        img.removeAttribute('data-av-asset');
      }
      pousserHistorique(avant);
      $('#prop-apercu-img', panneauDroit).src = img.src;
    });

    if (figure) {
      $('#prop-gal-prec', panneauDroit).addEventListener('click', function () {
        var prec = figure.previousElementSibling;
        if (!prec) { notifier('La photo est déjà en tête de galerie.'); return; }
        var avant = serialiser(idoc(), 'travail');
        figure.parentNode.insertBefore(figure, prec);
        pousserHistorique(avant);
      });
      $('#prop-gal-suiv', panneauDroit).addEventListener('click', function () {
        var suiv = figure.nextElementSibling;
        if (!suiv) { notifier('La photo est déjà en fin de galerie.'); return; }
        var avant = serialiser(idoc(), 'travail');
        figure.parentNode.insertBefore(suiv, figure);
        pousserHistorique(avant);
      });
      $('#prop-gal-retirer', panneauDroit).addEventListener('click', function () {
        var avant = serialiser(idoc(), 'travail');
        figure.remove();
        pousserHistorique(avant);
        selectionner(null);
        notifier('Photo retirée de la galerie.');
      });
    }

    lierChampTexte($('#prop-alt', panneauDroit), function (v) { img.setAttribute('alt', v); });

    brancherCurseur(panneauDroit, 'cadrage', ' %', function (v) {
      img.style.objectPosition = 'center ' + v + '%';
    }, function () {
      img.style.objectPosition = '';
      if (img.getAttribute('style') === '') { img.removeAttribute('style'); }
    });
  }

  /* ============ Clavier ============ */
  function surTouche(e) {
    var z = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (z && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); annuler(); return; }
    if (z && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); retablir(); return; }
    if (z && e.key.toLowerCase() === 's') { e.preventDefault(); ouvrirPublication(); return; }
    if (e.key === 'Escape') {
      if (etat.edition) { finirEdition(true); }
      else { selectionner(null); }
      return;
    }
    if ((e.key === 'Delete') && !etat.edition && etat.sel && etat.sel.type === 'section') {
      e.preventDefault();
      actionSection('supprimer', etat.sel.el);
    }
  }

  /* ============ Indicateurs globaux ============ */
  function fichiersModifies() {
    var liste = [];
    CONFIG.pages.forEach(function (pg) {
      var p = etat.pages[pg.fichier];
      if (p && p.sale) { liste.push(pg.fichier); }
    });
    return liste;
  }

  function majEtatGlobal() {
    var n = fichiersModifies().length + (etat.paletteSale ? 1 : 0);
    $('#etat-brouillon').hidden = n === 0;
    $('#pastille-publier').hidden = n === 0;
    $('#pastille-publier').textContent = n;
    majListePages();
  }

  /* ============ Palette → custom.css ============ */
  function genererCustomCss() {
    var lignes = [];
    for (var k in CONFIG.paletteDefaut) {
      lignes.push('  ' + k + ':' + (etat.palette[k] || CONFIG.paletteDefaut[k]) + ';');
    }
    return '/* Couleurs personnalisées — générées par l’éditeur du site (/builder/). */\n' +
      ':root{\n' + lignes.join('\n') + '\n}\n';
  }

  function assurerLienCustom(html) {
    if (/assets\/css\/custom\.css/.test(html)) { return html; }
    return html.replace(/(<link[^>]*assets\/css\/style\.css[^>]*>)/i,
      '$1\n  <link rel="stylesheet" href="assets/css/custom.css">');
  }

  /* ============ Publication (GitHub) ============ */
  function rassemblerPublication() {
    /* renvoie une promesse de { fichiers: {chemin → {texte} | {b64}}, resume:[…] } */
    var p = pageCourante();
    if (p) { p.travail = serialiser(idoc(), 'travail'); }

    var fichiers = {};
    var resume = [];
    var paletteActive = etat.paletteSale || Object.keys(etat.palette).length > 0;

    var promesses = CONFIG.pages.map(function (pg) {
      var page = etat.pages[pg.fichier];
      if (page && page.sale) {
        var html = serialiserDepuisTexte(page.travail, 'publier');
        if (paletteActive) { html = assurerLienCustom(html); }
        fichiers[pg.fichier] = { texte: html };
        resume.push({ chemin: pg.fichier, quoi: 'contenu modifié' });
        return Promise.resolve();
      }
      if (etat.paletteSale) {
        /* les autres pages doivent recevoir le lien custom.css */
        var base = page ? page.original : null;
        var pr = base ? Promise.resolve(base) : recupererPage(pg.fichier);
        return pr.then(function (texte) {
          var avecLien = assurerLienCustom(texte);
          if (avecLien !== texte) {
            fichiers[pg.fichier] = { texte: avecLien };
            resume.push({ chemin: pg.fichier, quoi: 'lien vers les nouvelles couleurs' });
          }
        });
      }
      return Promise.resolve();
    });

    return Promise.all(promesses).then(function () {
      if (etat.paletteSale) {
        fichiers['assets/css/custom.css'] = { texte: genererCustomCss() };
        resume.unshift({ chemin: 'assets/css/custom.css', quoi: 'couleurs du site' });
      }
      /* images ajoutées, seulement celles réellement utilisées */
      var tout = Object.keys(fichiers).map(function (k) { return fichiers[k].texte || ''; }).join('\n');
      Object.keys(etat.actifs).forEach(function (chemin) {
        if (tout.indexOf(chemin) !== -1) {
          fichiers[chemin] = { b64: etat.actifs[chemin].b64 };
          resume.push({ chemin: chemin, quoi: 'nouvelle photo' });
        }
      });
      return { fichiers: fichiers, resume: resume };
    });
  }

  function ouvrirPublication() {
    finirEdition(true);
    var modale = $('#modale-publier');
    $('#gh-jeton').value = localStorage.getItem('av:gh-jeton') || '';
    $('#gh-depot').value = localStorage.getItem('av:gh-depot') || (CONFIG.proprietaire + '/' + CONFIG.depot);
    $('#gh-branche').value = localStorage.getItem('av:gh-branche') || CONFIG.branche;
    $('#modale-erreur').hidden = true;
    if (!$('#gh-jeton').value) { $('#reglages-github').open = true; }

    $('#modale-fichiers').innerHTML = '<div class="fichier"><span>Préparation…</span></div>';
    modale.hidden = false;

    rassemblerPublication().then(function (paquet) {
      modale.dataset.pret = '1';
      etat.paquet = paquet;
      var r = paquet.resume;
      $('#modale-fichiers').innerHTML = r.length ?
        r.map(function (f) {
          return '<div class="fichier"><span>' + echapper(f.chemin) + '</span><span>' + echapper(f.quoi) + '</span></div>';
        }).join('') :
        '<div class="aucun">Aucune modification à publier — tout est déjà en ligne.</div>';
      $('#btn-confirmer-publier').disabled = !r.length;
    }).catch(function (err) {
      montrerErreur('Impossible de préparer la publication : ' + err.message);
    });
  }

  function montrerErreur(msg) {
    var e = $('#modale-erreur');
    e.textContent = msg;
    e.hidden = false;
  }

  function gh(jeton, methode, chemin, corps) {
    return fetch('https://api.github.com' + chemin, {
      method: methode,
      headers: {
        'Authorization': 'Bearer ' + jeton,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: corps ? JSON.stringify(corps) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        if (!r.ok) {
          var brut = json && json.message ? json.message : ('HTTP ' + r.status);
          var m = brut;
          if (r.status === 401) {
            m = 'Jeton refusé par GitHub — il est peut-être expiré ou mal copié. Recréez-le et collez-le à nouveau.\n(GitHub : ' + brut + ')';
          }
          if (r.status === 403 || r.status === 404) {
            m = 'Le jeton n’a pas accès en écriture à ce dépôt. En le créant, vérifiez ces trois choix :\n' +
              '· Resource owner : ' + CONFIG.proprietaire + '\n' +
              '· Repository access : « Only select repositories » → ' + CONFIG.depot + '\n' +
              '· Permissions → Repository permissions → Contents : « Read and write »\n' +
              '(GitHub : ' + brut + ')';
          }
          throw new Error(m);
        }
        return json;
      });
    });
  }

  function cheminRef(branche) {
    /* garde les / du nom de branche dans l'URL, encode le reste */
    return branche.split('/').map(encodeURIComponent).join('/');
  }

  function publier() {
    var jeton = $('#gh-jeton').value.trim();
    var depotComplet = $('#gh-depot').value.trim();
    var branche = $('#gh-branche').value.trim() || 'main';
    var message = $('#message-commit').value.trim() || 'Mise à jour du contenu via l’éditeur';
    if (!jeton) {
      $('#reglages-github').open = true;
      montrerErreur('Il faut un jeton d’accès GitHub pour publier (voir « Réglages GitHub »).');
      return;
    }
    if (!/^[^/]+\/[^/]+$/.test(depotComplet)) {
      montrerErreur('Le dépôt doit être au format « propriétaire/nom », ex. nouakil63/Acad-mie-voltige-');
      return;
    }
    localStorage.setItem('av:gh-jeton', jeton);
    localStorage.setItem('av:gh-depot', depotComplet);
    localStorage.setItem('av:gh-branche', branche);

    var base = '/repos/' + depotComplet;
    var paquet = etat.paquet;
    var chemins = Object.keys(paquet.fichiers);
    var btn = $('#btn-confirmer-publier');
    btn.disabled = true;
    btn.textContent = 'Publication…';
    $('#modale-erreur').hidden = true;

    var shaCommitBase, shaArbreBase;
    /* d'abord un contrôle du jeton : accès au dépôt, et droit d'écriture */
    gh(jeton, 'GET', base)
      .then(function (depot) {
        if (depot.permissions && depot.permissions.push === false) {
          throw new Error('Le jeton permet de lire ce dépôt mais pas d’y écrire.\n' +
            'Recréez-le avec « Permissions → Repository permissions → Contents : Read and write » ' +
            'et « Repository access : Only select repositories → ' + CONFIG.depot + ' ».');
        }
        return gh(jeton, 'GET', base + '/git/ref/heads/' + cheminRef(branche));
      })
      .then(function (ref) {
        shaCommitBase = ref.object.sha;
        return gh(jeton, 'GET', base + '/git/commits/' + shaCommitBase);
      })
      .then(function (commit) {
        shaArbreBase = commit.tree.sha;
        return Promise.all(chemins.map(function (chemin) {
          var f = paquet.fichiers[chemin];
          var corps = f.b64 ? { content: f.b64, encoding: 'base64' } : { content: f.texte, encoding: 'utf-8' };
          return gh(jeton, 'POST', base + '/git/blobs', corps).then(function (blob) {
            return { path: chemin, mode: '100644', type: 'blob', sha: blob.sha };
          });
        }));
      })
      .then(function (arbre) {
        return gh(jeton, 'POST', base + '/git/trees', { base_tree: shaArbreBase, tree: arbre });
      })
      .then(function (arbre) {
        return gh(jeton, 'POST', base + '/git/commits', {
          message: message, tree: arbre.sha, parents: [shaCommitBase]
        });
      })
      .then(function (commit) {
        return gh(jeton, 'PATCH', base + '/git/refs/heads/' + cheminRef(branche), { sha: commit.sha });
      })
      .then(function () {
        /* tout est en ligne : on repart propre */
        CONFIG.pages.forEach(function (pg) {
          var p = etat.pages[pg.fichier];
          if (p && p.sale) {
            p.original = serialiserDepuisTexte(p.travail, 'travail');
            p.sale = false;
            p.historique.length = 0; p.refaire.length = 0;
          }
          try { localStorage.removeItem('av:brouillon:' + pg.fichier); } catch (e) {}
        });
        etat.paletteSale = false;
        majEtatGlobal();
        majBoutonsHistorique();
        $('#modale-publier').hidden = true;
        btn.disabled = false;
        btn.textContent = 'Publier maintenant';
        notifier('✓ Publié ! Le site sera à jour d’ici une à deux minutes.', 'ok');
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Publier maintenant';
        montrerErreur(err.message);
      });
  }

  /* ============ Téléchargement (secours sans GitHub) ============ */
  function telecharger() {
    finirEdition(true);
    var p = pageCourante();
    if (p) { p.travail = serialiser(idoc(), 'travail'); }
    var n = 0;
    CONFIG.pages.forEach(function (pg) {
      var page = etat.pages[pg.fichier];
      if (page && page.sale) {
        var html = serialiserDepuisTexte(page.travail, 'telecharger');
        var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = pg.fichier;
        a.click();
        URL.revokeObjectURL(a.href);
        n++;
      }
    });
    if (etat.paletteSale) {
      var blob2 = new Blob([genererCustomCss()], { type: 'text/css;charset=utf-8' });
      var a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob2);
      a2.download = 'custom.css';
      a2.click();
      URL.revokeObjectURL(a2.href);
      n++;
    }
    notifier(n ? n + ' fichier(s) téléchargé(s). Les photos ajoutées y sont incluses directement.' :
      'Aucune modification à télécharger.');
  }

  /* ============ Démarrage ============ */
  function demarrer() {
    try {
      var pal = localStorage.getItem('av:palette');
      if (pal) { etat.palette = JSON.parse(pal) || {}; }
      if (Object.keys(etat.palette).length) { etat.paletteSale = true; }
    } catch (e) {}

    majListePages();
    brancherListeSections();

    $('#liste-pages').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-fichier]');
      if (b && b.dataset.fichier !== etat.fichier) {
        var p = pageCourante();
        if (p) { p.travail = serialiser(idoc(), 'travail'); }
        chargerPage(b.dataset.fichier);
      }
    });
    $('#choix-page').addEventListener('change', function (e) {
      var p = pageCourante();
      if (p) { p.travail = serialiser(idoc(), 'travail'); }
      chargerPage(e.target.value);
    });

    $$('.appareils button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.appareils button').forEach(function (x) { x.classList.toggle('actif', x === b); });
        cadreEl.className = 'cadre' + (b.dataset.appareil === 'bureau' ? '' : ' ' + b.dataset.appareil);
      });
    });

    /* panneaux coulissants sur petits écrans */
    var panneauGauche = $('.panneau-gauche');
    $('#btn-sections').addEventListener('click', function () {
      panneauGauche.classList.toggle('ouvert');
    });
    panneauGauche.addEventListener('click', function (e) {
      if (matchMedia('(max-width:1080px)').matches && e.target.closest('button, li')) {
        panneauGauche.classList.remove('ouvert');
      }
    });
    $('#btn-reglages').addEventListener('click', function () {
      $('#boite-droite').classList.toggle('ouvert');
    });
    $('#fermer-panneau').addEventListener('click', function () {
      $('#boite-droite').classList.remove('ouvert');
    });

    $('#btn-annuler').addEventListener('click', annuler);
    $('#btn-retablir').addEventListener('click', retablir);
    $('#btn-publier').addEventListener('click', ouvrirPublication);
    $('#btn-telecharger').addEventListener('click', telecharger);
    $('#btn-confirmer-publier').addEventListener('click', publier);
    $$('#modale-publier [data-fermer]').forEach(function (b) {
      b.addEventListener('click', function () { $('#modale-publier').hidden = true; });
    });
    $('#modale-publier').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) { e.currentTarget.hidden = true; }
    });

    document.addEventListener('keydown', surTouche);
    window.addEventListener('beforeunload', function (e) {
      var p = pageCourante();
      if (p) {
        p.travail = serialiser(idoc(), 'travail');
        try { if (p.sale) { localStorage.setItem('av:brouillon:' + etat.fichier, p.travail); } } catch (err) {}
      }
      if (fichiersModifies().length || etat.paletteSale) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    chargerPage('index.html');
  }

  demarrer();
})();
