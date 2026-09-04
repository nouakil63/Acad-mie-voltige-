/* ============================================================
   Service d'inscriptions — Académie de voltige équestre
   ------------------------------------------------------------
   Ce script tourne DANS le compte Gmail de l'académie :
   - il reçoit les demandes d'inscription du site (cours et stages),
   - il envoie la demande, joliment mise en page, à l'académie,
   - le mail contient un bouton « Valider » : un clic, et le client
     reçoit automatiquement le mail de validation avec le lien de
     paiement, aux couleurs du site.

   MISE EN PLACE (une seule fois, ~5 minutes) :
   1. Ouvrir https://script.google.com en étant connecté au compte
      academiedevoltige@gmail.com
   2. « Nouveau projet », effacer le contenu, coller TOUT ce fichier
   3. Renommer le projet : « Inscriptions académie »
   4. En haut à droite : Déployer → Nouveau déploiement →
      type « Application Web » →
      Exécuter en tant que : Moi ·
      Qui a accès : Tout le monde → Déployer
   5. Autoriser l'accès quand Google le demande (compte académie)
   6. Copier l'URL qui se termine par /exec et la donner à Claude
      pour qu'il la branche sur le site.
   ============================================================ */

var ADRESSE_ACADEMIE = 'academiedevoltige@gmail.com';
var SITE = 'https://academiedevoltige.com';

/* Liens de paiement Stripe (publics) */
var PAIEMENTS = {
  cours_unite:     { libelle: 'Payer le cours — 25 €',        url: 'https://buy.stripe.com/3cI3cvcVPfvo72od2a4ow00' },
  cours_trimestre: { libelle: 'Payer le trimestre — 325 €',   url: 'https://buy.stripe.com/dRmeVd2hbab41I4gem4ow01' },
  stage:           { libelle: 'Payer la semaine de stage — 840 €', url: 'https://buy.stripe.com/8x23cv5tn82WcmIaU24ow04' }
};

/* Motifs de refus : un clic dans le mail de l'académie, et le parent
   reçoit automatiquement un message courtois avec ce motif.
   {enfant} et {detail} sont remplacés par le prénom/nom et la formule ou le stage. */
var MOTIFS_REFUS = {
  complet: {
    bouton: 'Complet',
    texte: 'Toutes les places sont malheureusement déjà prises pour {detail}. ' +
      'Répondez à ce message si vous souhaitez être prévenu(e) quand une place se libère, ou pour envisager une autre période.'
  },
  age: {
    bouton: 'Âge',
    texte: 'Nos groupes accueillent les enfants de 6 à 14 ans, et l’âge indiqué pour {enfant} ne nous permet malheureusement pas de l’accueillir dans de bonnes conditions.'
  },
  gabarit: {
    bouton: 'Gabarit',
    texte: 'La voltige n’est pas de l’équitation traditionnelle : l’enfant évolue en équilibre sur le poney, qui le porte tout au long du cours. ' +
      'Pour préserver nos poneys et garantir la sécurité de tous, les montures sont attribuées selon le gabarit — et le gabarit indiqué ne nous permet malheureusement pas de proposer une monture adaptée à {enfant}.'
  },
  creneau: {
    bouton: 'Créneau indisponible',
    texte: 'Le créneau demandé pour {detail} n’est plus disponible. Répondez à ce message : nous vous proposerons un autre créneau selon les places restantes.'
  }
};

/* Les couleurs du site */
var ROUGE = '#D00828';
var ENCRE = '#1D1216';
var VOILE = '#F7F3F0';

/* ============ Réception d'une demande du site ============ */
function doPost(e) {
  var d;
  try { d = JSON.parse(e.postData.contents); }
  catch (err) { return reponseTexte('demande illisible'); }
  if (!d || (d.type !== 'cours' && d.type !== 'stage')) { return reponseTexte('type inconnu'); }
  if (!d.parentEmail || !/.+@.+\..+/.test(String(d.parentEmail))) { return reponseTexte('e-mail manquant'); }

  var enfant = nettoyer(d.enfantPrenom) + ' ' + nettoyer(d.enfantNom);
  var sujet = (d.type === 'cours' ? 'Demande d’inscription aux cours — ' : 'Réservation de stage — ') + enfant;

  var lignes = d.type === 'cours' ? [
    ['Formule', nettoyer(d.formule)],
    ['Créneau', nettoyer(d.creneau)],
    ['Tarif', nettoyer(d.tarif)],
    ['Voltigeur', enfant],
    ['Date de naissance', nettoyer(d.enfantNaissance)],
    ['Gabarit', nettoyer(d.gabarit)],
    ['Niveau', nettoyer(d.niveau)],
    ['Parent', nettoyer(d.parentNom)],
    ['Téléphone', nettoyer(d.parentTel)],
    ['E-mail', nettoyer(d.parentEmail)]
  ] : [
    ['Stage', nettoyer(d.stage)],
    ['Dates', nettoyer(d.dates)],
    ['Tarif', nettoyer(d.tarif)],
    ['Voltigeur', enfant],
    ['Date de naissance', nettoyer(d.enfantNaissance)],
    ['Niveau', nettoyer(d.niveau)],
    ['Santé / remarques', nettoyer(d.sante) || '—'],
    ['Parent', nettoyer(d.parentNom)],
    ['Téléphone', nettoyer(d.parentTel)],
    ['E-mail', nettoyer(d.parentEmail)]
  ];

  var jeton = fabriquerJeton({
    type: d.type,
    enfant: enfant,
    parentEmail: nettoyer(d.parentEmail),
    parentNom: nettoyer(d.parentNom),
    detail: d.type === 'cours' ? nettoyer(d.formule) : nettoyer(d.stage) + ' (' + nettoyer(d.dates) + ')'
  });
  var base = ScriptApp.getService().getUrl();
  var urlValider = base + '?action=valider&d=' + jeton.d + '&s=' + jeton.s;
  var mailtoRefus = 'mailto:' + encodeURIComponent(nettoyer(d.parentEmail)) +
    '?subject=' + encodeURIComponent('Votre demande — Académie de voltige') +
    '&body=' + encodeURIComponent('Bonjour ' + nettoyer(d.parentNom) + ',\n\nMerci pour votre demande concernant ' + enfant +
      '.\nMalheureusement, ');

  var boutonsRefus = Object.keys(MOTIFS_REFUS).map(function (cle) {
    return { texte: '❌ ' + MOTIFS_REFUS[cle].bouton, url: base + '?action=refuser&motif=' + cle + '&d=' + jeton.d + '&s=' + jeton.s, plein: false };
  });
  boutonsRefus.push({ texte: '✉️ Autre motif — répondre moi-même', url: mailtoRefus, plein: false });

  var html = gabaritMail(
    d.type === 'cours' ? 'Nouvelle demande d’inscription aux cours' : 'Nouvelle réservation de stage',
    'Reçue à l’instant depuis le site. Un clic sur « Valider » envoie automatiquement au parent le mail de validation avec le lien de paiement.',
    lignes,
    [{ texte: '✅ Valider — envoyer le lien de paiement', url: urlValider, plein: true }],
    'Vous pouvez aussi simplement répondre à ce message : votre réponse partira vers ' + nettoyer(d.parentEmail) + '.',
    boutonsRefus,
    'Ou refuser en un clic — le parent reçoit automatiquement un message courtois avec le motif choisi :'
  );

  GmailApp.sendEmail(ADRESSE_ACADEMIE, sujet, versTexte(lignes), {
    htmlBody: html,
    replyTo: nettoyer(d.parentEmail),
    name: 'Site de l’académie'
  });

  return reponseTexte('ok');
}

/* ============ Clic sur « Valider » ou « Refuser » dans le mail ============ */
function doGet(e) {
  var p = e.parameter || {};
  if ((p.action !== 'valider' && p.action !== 'refuser') || !p.d || !p.s) {
    return pageHtml('Service des inscriptions', 'Ce service reçoit les demandes du site de l’académie. Rien à voir ici !');
  }
  var donnees = verifierJeton(p.d, p.s);
  if (!donnees) {
    return pageHtml('Lien invalide', 'Ce lien n’est pas reconnu. Utilisez les boutons du mail d’origine.');
  }

  if (p.action === 'refuser') {
    var motif = MOTIFS_REFUS[p.motif];
    if (!motif) { return pageHtml('Lien invalide', 'Motif de refus inconnu. Utilisez les boutons du mail d’origine.'); }
    var explication = motif.texte.replace(/\{enfant\}/g, donnees.enfant).replace(/\{detail\}/g, donnees.detail);
    var htmlRefus = gabaritMail(
      'Au sujet de votre demande',
      'Bonjour ' + donnees.parentNom + ', merci pour votre demande concernant <b>' + donnees.enfant + '</b> (' + donnees.detail + '). ' +
      'Nous ne pouvons malheureusement pas y donner suite cette fois-ci :<br><br>' + explication,
      [],
      [],
      'N’hésitez pas à répondre à ce message pour toute question — et à très vite au manège, nous l’espérons !<br>' +
      'Fleur & Georges Cotrait — Académie de voltige équestre, Auberville.'
    );
    GmailApp.sendEmail(donnees.parentEmail, 'Votre demande — Académie de voltige',
      'Bonjour, nous ne pouvons malheureusement pas donner suite à la demande pour ' + donnees.enfant + '. ' +
      explication.replace(/<[^>]+>/g, ''), {
      htmlBody: htmlRefus,
      replyTo: ADRESSE_ACADEMIE,
      name: 'Académie de voltige équestre'
    });
    return pageHtml('Refus envoyé',
      'Le message de refus (motif : ' + motif.bouton + ') vient de partir vers <b>' + donnees.parentEmail + '</b> pour <b>' + donnees.enfant + '</b>.' +
      '<br><br>Vous pouvez fermer cette page.');
  }

  var boutons, intro;
  if (donnees.type === 'cours') {
    intro = 'Bonne nouvelle : la demande d’inscription de <b>' + donnees.enfant + '</b> aux cours (' + donnees.detail + ') est validée ! ' +
      'Pour finaliser l’inscription, choisissez votre formule et réglez en ligne, en toute sécurité :';
    boutons = [
      { texte: PAIEMENTS.cours_unite.libelle, url: PAIEMENTS.cours_unite.url, plein: true },
      { texte: PAIEMENTS.cours_trimestre.libelle, url: PAIEMENTS.cours_trimestre.url, plein: true }
    ];
  } else {
    intro = 'Bonne nouvelle : la réservation de <b>' + donnees.enfant + '</b> pour le ' + donnees.detail + ' est confirmée ! ' +
      'Pour finaliser l’inscription, réglez en ligne, en toute sécurité :';
    boutons = [
      { texte: PAIEMENTS.stage.libelle, url: PAIEMENTS.stage.url, plein: true }
    ];
  }

  var html = gabaritMail(
    'Votre demande est validée ! 🎉',
    intro,
    [],
    boutons,
    'Une question ? Répondez simplement à ce message. À très vite au manège !<br>Fleur & Georges Cotrait — Académie de voltige équestre, Auberville.'
  );

  GmailApp.sendEmail(donnees.parentEmail, 'Votre inscription est validée — Académie de voltige',
    'Bonne nouvelle : la demande pour ' + donnees.enfant + ' est validée. Lien de paiement : ' + boutons[0].url, {
    htmlBody: html,
    replyTo: ADRESSE_ACADEMIE,
    name: 'Académie de voltige équestre'
  });

  return pageHtml('C’est validé ✅',
    'Le mail de validation avec le lien de paiement vient de partir vers <b>' + donnees.parentEmail + '</b> pour <b>' + donnees.enfant + '</b>.' +
    '<br><br>Vous pouvez fermer cette page.');
}

/* ============ La mise en page des mails (couleurs du site) ============ */
function boutonsHtml(boutons) {
  return boutons.map(function (b) {
    return '<a href="' + b.url + '" style="display:inline-block;margin:6px 6px 0 0;padding:13px 22px;border-radius:999px;' +
      (b.plein
        ? 'background:' + ROUGE + ';color:#ffffff;'
        : 'background:#ffffff;color:' + ROUGE + ';border:2px solid ' + ROUGE + ';') +
      'font-weight:700;font-size:15px;text-decoration:none">' + b.texte + '</a>';
  }).join('');
}

function gabaritMail(titre, intro, lignes, boutons, pied, boutons2, libelle2) {
  var rangs = lignes.map(function (l) {
    return '<tr><td style="padding:7px 14px;color:#8a7f83;font-size:13px;white-space:nowrap">' + l[0] + '</td>' +
      '<td style="padding:7px 14px;color:' + ENCRE + ';font-size:14px;font-weight:600">' + (l[1] || '—') + '</td></tr>';
  }).join('');
  var btns = boutonsHtml(boutons);
  if (boutons2 && boutons2.length) {
    btns += '<p style="margin:26px 0 4px;color:#8a7f83;font-size:13px">' + (libelle2 || '') + '</p>' + boutonsHtml(boutons2);
  }

  return enEntites('' +
  '<div style="margin:0;padding:26px 12px;background:' + VOILE + ';font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%">' +
      '<tr><td style="background:' + ENCRE + ';border-radius:16px 16px 0 0;padding:18px 26px">' +
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
          '<td><img src="' + SITE + '/assets/img/logo.jpeg" width="40" height="40" alt="" style="border-radius:50%;display:block"></td>' +
          '<td style="padding-left:12px;color:#ffffff;font-weight:800;font-size:16px">Académie de voltige' +
            '<div style="color:#b9aeb2;font-weight:600;font-size:11px;letter-spacing:.08em;text-transform:uppercase">Fleur &amp; Georges Cotrait</div></td>' +
        '</tr></table>' +
      '</td></tr>' +
      '<tr><td style="background:#ffffff;padding:30px 26px;border-radius:0 0 16px 16px">' +
        '<h1 style="margin:0 0 12px;color:' + ENCRE + ';font-size:22px">' + titre + '</h1>' +
        '<p style="margin:0 0 18px;color:#5f5458;font-size:15px;line-height:1.55">' + intro + '</p>' +
        (rangs ? '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:' + VOILE + ';border-radius:12px;margin:0 0 20px">' + rangs + '</table>' : '') +
        btns +
        '<p style="margin:26px 0 0;padding-top:16px;border-top:1px solid #eee5e7;color:#8a7f83;font-size:12.5px;line-height:1.6">' + pied + '</p>' +
      '</td></tr>' +
      '<tr><td style="padding:14px 8px;text-align:center;color:#a89ba0;font-size:11.5px">' +
        'Académie de voltige équestre · Auberville, Normandie · <a href="' + SITE + '" style="color:' + ROUGE + '">' + SITE.replace('https://','') + '</a>' +
      '</td></tr>' +
    '</table>' +
  '</div>');
}

/* ============ Petits outils ============ */
/* Convertit accents, tirets et émojis en entités HTML : l'affichage
   reste parfait quel que soit l'encodage appliqué par la messagerie. */
function enEntites(html) {
  var sortie = '';
  for (var i = 0; i < html.length; i++) {
    var code = html.codePointAt(i);
    if (code > 127) {
      sortie += '&#' + code + ';';
      if (code > 0xFFFF) { i++; } /* émoji : deux unités de code */
    } else {
      sortie += html.charAt(i);
    }
  }
  return sortie;
}

function nettoyer(v) {
  return String(v == null ? '' : v).slice(0, 300)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function versTexte(lignes) {
  return lignes.map(function (l) { return l[0] + ' : ' + (l[1] || '—'); }).join('\n');
}

function secret() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('secret');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('secret', s); }
  return s;
}

function fabriquerJeton(obj) {
  var d = Utilities.base64EncodeWebSafe(JSON.stringify(obj));
  var s = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(d, secret()));
  return { d: d, s: s };
}

function verifierJeton(d, s) {
  var attendu = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(d, secret()));
  if (attendu !== s) { return null; }
  try { return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(d)).getDataAsString()); }
  catch (e) { return null; }
}

function reponseTexte(t) {
  return ContentService.createTextOutput(t).setMimeType(ContentService.MimeType.TEXT);
}

function pageHtml(titre, corps) {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + titre + '</title></head>' +
    '<body style="margin:0;padding:40px 16px;background:' + VOILE + ';font-family:-apple-system,Segoe UI,Roboto,sans-serif">' +
    '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:34px 28px;text-align:center">' +
    '<img src="' + SITE + '/assets/img/logo.jpeg" width="56" height="56" alt="" style="border-radius:50%">' +
    '<h1 style="color:' + ENCRE + ';font-size:24px;margin:16px 0 10px">' + titre + '</h1>' +
    '<p style="color:#5f5458;font-size:15px;line-height:1.6;margin:0">' + corps + '</p>' +
    '</div></body></html>'
  ).setTitle(titre);
}
