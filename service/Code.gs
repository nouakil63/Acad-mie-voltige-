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

/* Numéro de version du script : ouvrez l'adresse /exec dans un
   navigateur pour vérifier quelle version est réellement en ligne. */
var VERSION_SCRIPT = '21';

/* ============ L'espace académie (page admin.html du site) ============
   Chaque demande reçue est aussi rangée dans la base Supabase de
   l'académie : la page admin.html du site les affiche toutes et permet
   de valider ou refuser en un clic.
   REMPLACEZ la ligne COLLEZ-ICI... par la clé « service_role » de
   Supabase (menu Project Settings → API Keys → service_role → Reveal).
   ⚠️ Cette clé est SECRÈTE : elle ne se colle QUE dans cet éditeur,
   jamais sur le site, jamais dans un mail ou une discussion.
   Tant qu'elle n'est pas collée, tout marche comme avant : les demandes
   arrivent par mail, simplement sans la page admin. */
var SUPABASE_URL = 'https://vtrmohmupfvxzbsnubye.supabase.co';
var SUPABASE_CLE_SERVICE = 'COLLEZ-ICI-LA-CLE-SERVICE-ROLE';

function supabasePret() {
  return SUPABASE_URL && SUPABASE_CLE_SERVICE && SUPABASE_CLE_SERVICE.indexOf('COLLEZ') !== 0;
}

/* Range une demande dans la base (silencieux : un souci ici n'empêche
   jamais le mail de partir). */
function enregistrerDemande(ligne) {
  if (!supabasePret()) { return; }
  try {
    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/demandes', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: SUPABASE_CLE_SERVICE,
        Authorization: 'Bearer ' + SUPABASE_CLE_SERVICE,
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify(ligne),
      muteHttpExceptions: true
    });
  } catch (e) { /* rien */ }
}

/* Note le statut (validée / refusée) après une décision, que le clic
   vienne du mail ou de la page admin du site. */
function majStatutDemande(dTok, statut) {
  if (!supabasePret() || !dTok) { return; }
  try {
    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/demandes?jeton_d=eq.' + encodeURIComponent(dTok), {
      method: 'patch',
      contentType: 'application/json',
      headers: {
        apikey: SUPABASE_CLE_SERVICE,
        Authorization: 'Bearer ' + SUPABASE_CLE_SERVICE,
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify({ statut: statut, decide: new Date().toISOString() }),
      muteHttpExceptions: true
    });
  } catch (e) { /* rien */ }
}

/* Texte brut, sans les protections HTML des mails. */
function brut(v) {
  return String(v == null ? '' : v).slice(0, 300);
}

/* ============ À EXÉCUTER UNE FOIS DEPUIS L'ÉDITEUR ============
   Le script a besoin de la permission de Google pour aller chercher
   le PDF sur internet. Pour la donner : dans la barre d'outils de
   l'éditeur, choisissez la fonction « autoriserRecuperationPdf » dans
   le menu déroulant, cliquez « Exécuter », et acceptez l'autorisation
   demandée par Google. Le journal d'exécution doit ensuite afficher
   « Code de réponse : 200 ». À faire une seule fois. */
function autoriserRecuperationPdf() {
  var r = UrlFetchApp.fetch(SITE + '/assets/doc/proposition-partenariat-academie-voltige.pdf', { muteHttpExceptions: true });
  Logger.log('Code de réponse : ' + r.getResponseCode() + ' — taille : ' + r.getContent().length + ' octets');
}

/* Clé d'envoi de la prospection : REMPLACEZ CHANGEZ-MOI par un mot de
   passe de votre choix (lettres et chiffres), puis saisissez le même
   dans la page Prospection du builder (Réglages de l'envoi automatique).
   Sans cela, l'envoi automatique de prospection reste désactivé. */
var CLE_PROSPECTION = 'CHANGEZ-MOI';

/* Liens de paiement Stripe (publics) */
var PAIEMENTS = {
  cours_unite:     { libelle: 'Payer le cours (25 €)',        url: 'https://buy.stripe.com/3cI3cvcVPfvo72od2a4ow00' },
  cours_trimestre: { libelle: 'Payer le trimestre (325 €)',   url: 'https://buy.stripe.com/dRmeVd2hbab41I4gem4ow01' },
  stage:           { libelle: 'Payer la semaine de stage (840 €)', url: 'https://buy.stripe.com/8x23cv5tn82WcmIaU24ow04' },
  /* Les stages se règlent en deux temps : l'acompte de 300 € à
     l'inscription, le solde (540 €) au plus tard 30 jours avant le
     début du stage. CRÉEZ ces deux liens de paiement dans Stripe
     (300 € et 540 €) et collez-les ici à la place de COLLEZ-ICI…
     Tant qu'ils n'y sont pas, le mail de validation garde l'ancien
     paiement en une fois (840 €). */
  stage_acompte:   { libelle: 'Payer l’acompte du stage (300 €)', url: 'COLLEZ-ICI-LE-LIEN-STRIPE-ACOMPTE-300' },
  stage_solde:     { libelle: 'Payer le solde du stage (540 €)',  url: 'COLLEZ-ICI-LE-LIEN-STRIPE-SOLDE-540' }
};

function lienPret(p) {
  return p && p.url && p.url.indexOf('COLLEZ') !== 0;
}

/* ============ La lecture des paiements Stripe (espace académie) ======
   Le bouton « Vérifier les paiements Stripe » de la plateforme admin
   demande à ce script la liste des règlements reçus, pour les
   rapprocher des inscriptions en un clic.
   CRÉEZ une clé RESTREINTE dans Stripe : Développeurs → Clés API →
   Créer une clé restreinte → nommez-la « lecture academie » → mettez
   « Sessions Checkout » sur « Lecture » et laissez tout le reste sur
   « Aucune » → Créer la clé → copiez-la et collez-la ci-dessous à la
   place de COLLEZ-ICI…
   ⚠️ Cette clé est SECRÈTE : elle ne se colle QUE dans cet éditeur,
   jamais sur le site, jamais dans un mail ou une discussion.
   Tant qu'elle n'est pas collée, le bouton explique simplement que la
   vérification n'est pas encore disponible. */
var STRIPE_CLE = 'COLLEZ-ICI-LA-CLE-STRIPE-RESTREINTE';

/* Liens d'essai à 0 € : ils apparaissent dans les mails de validation
   pour tester le parcours de paiement sans payer.
   ⚠️ Les vrais parents les voient aussi : mettre ESSAIS_ACTIFS à false
   (puis publier une « Nouvelle version ») dès que les tests sont finis. */
var ESSAIS_ACTIFS = false;
var PAIEMENTS_TEST = {
  cours: { libelle: 'Essai à 0 € (test)', url: 'https://buy.stripe.com/4gMfZh6xrcjc5Ykd2a4ow02' },
  stage: { libelle: 'Essai à 0 € (test)', url: 'https://buy.stripe.com/8x28wP3lf970cmIaU24ow03' }
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
      'Pour préserver nos poneys et garantir la sécurité de tous, les montures sont attribuées selon le gabarit, et celui indiqué ne nous permet malheureusement pas de proposer une monture adaptée à {enfant}.'
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
  if (d && d.type === 'prospection') { return envoyerProspection(d); }
  if (d && d.type === 'decision') { return traiterDecisionPost(d); }
  if (d && d.type === 'relance') { return traiterRelance(d); }
  if (d && d.type === 'stripe') { return traiterStripe(d); }
  if (d && d.type === 'confirmation-resa') { return traiterConfirmationResa(d); }
  if (d && d.type === 'place-libre') { return traiterPlaceLibre(d); }
  if (d && d.type === 'infos-cours') { return traiterInfosCours(d); }
  if (!d || (d.type !== 'cours' && d.type !== 'stage')) { return reponseTexte('type inconnu'); }
  if (!d.parentEmail || !/.+@.+\..+/.test(String(d.parentEmail))) { return reponseTexte('e-mail manquant'); }

  var enfant = nettoyer(d.enfantPrenom) + ' ' + nettoyer(d.enfantNom);
  var sujet = (d.type === 'cours' ? 'Demande d’inscription aux cours de ' : 'Réservation de stage de ') + enfant;

  /* Règlement choisi pour les cours : le mail de validation ne proposera
     que le lien de paiement correspondant. */
  var paiement = (d.paiement === 'unite' || d.paiement === 'trimestre') ? d.paiement : '';

  var lignes = d.type === 'cours' ? [
    ['Formule', nettoyer(d.formule)],
    ['Créneau', nettoyer(d.creneau)],
    ['Tarif', nettoyer(d.tarif)],
    ['Règlement choisi', paiement === 'unite' ? 'Au cours (25 €)' : paiement === 'trimestre' ? 'Au trimestre (325 €)' : '—'],
    ['Voltigeur', enfant],
    ['Date de naissance', nettoyer(d.enfantNaissance)],
    ['Gabarit', nettoyer(d.gabarit)],
    ['Niveau', nettoyer(d.niveau)],
    ['Parent', nettoyer(d.parentNom)],
    ['Téléphone', nettoyer(d.parentTel)],
    ['E-mail', nettoyer(d.parentEmail)]
  ].concat(lignesDossier(d)) : [
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
  ].concat(lignesDossier(d));

  var jeton = fabriquerJeton({
    type: d.type,
    enfant: enfant,
    parentEmail: nettoyer(d.parentEmail),
    parentNom: nettoyer(d.parentNom),
    paiement: paiement,
    detail: d.type === 'cours' ? nettoyer(d.formule) : nettoyer(d.stage) + ' (' + nettoyer(d.dates) + ')'
  });
  /* Les boutons passent par une page du site : elle appelle le service en
     arrière-plan, sans compte Google, ce qui évite la page d'erreur
     « Impossible d'ouvrir le fichier » quand plusieurs comptes Google
     sont connectés dans le navigateur. */
  var base = SITE + '/decision.html';
  var urlValider = base + '?action=valider&d=' + jeton.d + '&s=' + jeton.s;
  var mailtoRefus = 'mailto:' + encodeURIComponent(nettoyer(d.parentEmail)) +
    '?subject=' + encodeURIComponent('Votre demande à l’Académie de voltige') +
    '&body=' + encodeURIComponent('Bonjour ' + nettoyer(d.parentNom) + ',\n\nMerci pour votre demande concernant ' + enfant +
      '.\nMalheureusement, ');

  var boutonsRefus = Object.keys(MOTIFS_REFUS).map(function (cle) {
    return { texte: '❌ ' + MOTIFS_REFUS[cle].bouton, url: base + '?action=refuser&motif=' + cle + '&d=' + jeton.d + '&s=' + jeton.s, plein: false };
  });
  boutonsRefus.push({ texte: '✉️ Autre motif : répondre moi-même', url: mailtoRefus, plein: false });

  var html = gabaritMail(
    d.type === 'cours' ? 'Nouvelle demande d’inscription aux cours' : 'Nouvelle réservation de stage',
    d.type === 'cours'
      ? 'Reçue à l’instant depuis le site. Un clic sur « Valider » prévient le parent que Fleur va l’appeler pour convenir du créneau ; après l’appel, la date, l’heure et le lien de paiement partent en un clic depuis l’espace académie.'
      : 'Reçue à l’instant depuis le site. Un clic sur « Valider » envoie automatiquement au parent le mail de validation avec le lien de paiement.',
    lignes,
    [{ texte: d.type === 'cours' ? '✅ Valider : Fleur appellera la famille' : '✅ Valider : envoyer le lien de paiement', url: urlValider, plein: true }],
    'Vous pouvez aussi simplement répondre à ce message : votre réponse partira vers ' + nettoyer(d.parentEmail) + '.',
    boutonsRefus,
    'Ou refuser en un clic : le parent reçoit automatiquement un message courtois avec le motif choisi.'
  );

  GmailApp.sendEmail(ADRESSE_ACADEMIE, sujet, versTexte(lignes), {
    htmlBody: html,
    replyTo: nettoyer(d.parentEmail),
    name: 'Site de l’académie'
  });

  enregistrerDemande({
    type: d.type,
    enfant: (brut(d.enfantPrenom) + ' ' + brut(d.enfantNom)).trim(),
    parent_nom: brut(d.parentNom),
    parent_email: brut(d.parentEmail),
    detail: d.type === 'cours'
      ? brut(d.formule)
      : (brut(d.stage) + (d.dates ? ' (' + brut(d.dates) + ')' : '')),
    tarif: brut(d.tarif),
    lignes: versTexte(lignes).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
    jeton_d: jeton.d,
    jeton_s: jeton.s
  });

  return reponseTexte('ok');
}

/* ============ Envoi d'un mail de prospection depuis le builder ============ */
function envoyerProspection(d) {
  if (!CLE_PROSPECTION || CLE_PROSPECTION === 'CHANGEZ-MOI') {
    return reponseTexte('cle non configuree dans le script');
  }
  if (String(d.cle || '') !== CLE_PROSPECTION) { return reponseTexte('cle incorrecte'); }

  var dest = String(d.destinataire || '').trim();
  if (!/^[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+$/.test(dest) || dest.length > 200) {
    return reponseTexte('destinataire invalide');
  }
  var sujet = String(d.sujet || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 250);
  var corps = String(d.corps || '').slice(0, 12000);
  if (!sujet || !corps) { return reponseTexte('sujet ou texte manquant'); }

  var options = {
    replyTo: ADRESSE_ACADEMIE,
    name: 'Académie de voltige équestre',
    htmlBody: texteEnHtml(corps)
  };
  /* Le PDF est cherché sur le site, puis directement sur GitHub si le
     site est injoignable. En cas d'échec des deux, le mail part quand
     même et la réponse détaille pourquoi. */
  var SOURCES_PDF = [
    SITE + '/assets/doc/proposition-partenariat-academie-voltige.pdf',
    'https://raw.githubusercontent.com/nouakil63/Acad-mie-voltige-/claude/academie-voltige-style-x4qbuv/assets/doc/proposition-partenariat-academie-voltige.pdf'
  ];
  var avecPdf = false;
  var soucisPdf = [];
  for (var s = 0; s < SOURCES_PDF.length && !avecPdf; s++) {
    try {
      var pdf = UrlFetchApp.fetch(SOURCES_PDF[s], { muteHttpExceptions: true, followRedirects: true });
      if (pdf.getResponseCode() === 200 && pdf.getContent().length > 10000) {
        options.attachments = [pdf.getBlob().setContentType('application/pdf')
          .setName('Proposition de partenariat - Académie de voltige équestre.pdf')];
        avecPdf = true;
      } else {
        soucisPdf.push('source ' + (s + 1) + ' : code ' + pdf.getResponseCode());
      }
    } catch (err) {
      soucisPdf.push('source ' + (s + 1) + ' : ' + String((err && err.message) || err).slice(0, 120));
    }
  }
  GmailApp.sendEmail(dest, sujet, corps, options);
  return reponseTexte(avecPdf ? 'ok' : 'ok sans pdf (' + soucisPdf.join(' ; ') + ')');
}

/* Le texte du mail tel quel, sans aucune mise en forme ajoutée : même
   aspect qu'un mail écrit à la main dans Gmail. Cela évite seulement
   les coupures de ligne et les caractères cassés de l'envoi en texte
   brut, et rend les liens cliquables. */
function texteEnHtml(corps) {
  var t = String(corps)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br>');
  return enEntites('<div dir="ltr">' + t + '</div>');
}

/* ============ Champs du dossier d'inscription (cours) ============ */
/* Le formulaire du site envoie aussi les questions du dossier papier :
   on les ajoute au mail de demande seulement quand elles sont remplies. */
function lignesDossier(d) {
  var extras = [
    ['Qualité', d.qualite], ['Adresse', d.adresse],
    ['Code postal / ville', (nettoyer(d.cp) + ' ' + nettoyer(d.ville)).trim()],
    ['Tél. domicile', d.telDomicile],
    ['Né(e) à', d.enfantLieuNaissance], ['Nationalité', d.nationalite],
    ['Sexe', d.sexe], ['Gabarit', d.gabaritDetail],
    ['Sécurité sociale (caisse)', d.secuCaisse], ['N° couvrant l’enfant', d.secuNumero],
    ['Licence FFE', d.licence],
    ['Recommandations (allergies…)', d.recommandations],
    ['Droit à l’image', d.droitImage],
    ['Autorisation médicale', d.autorisationMedicale],
    ['Signé en ligne', d.signeLe]
  ];
  var lignes = [];
  extras.forEach(function (l) {
    var v = nettoyer(l[1]);
    if (v) { lignes.push([l[0], v]); }
  });
  return lignes;
}

/* ============ « Valider » ou « Refuser » une demande ============ */
/* Le cœur est partagé : doGet (anciens mails, lien direct /exec) et
   doPost type 'decision' (page decision.html du site) font la même chose. */
function executerDecision(action, motifCle, dTok, sTok) {
  var donnees = verifierJeton(String(dTok || ''), String(sTok || ''));
  if (!donnees) { return { code: 'lien invalide' }; }

  if (action === 'refuser') {
    var motif = MOTIFS_REFUS[motifCle];
    if (!motif) { return { code: 'motif inconnu' }; }
    var explication = motif.texte.replace(/\{enfant\}/g, donnees.enfant).replace(/\{detail\}/g, donnees.detail);
    var htmlRefus = gabaritMail(
      'Au sujet de votre demande',
      'Bonjour ' + donnees.parentNom + ', merci pour votre demande concernant <b>' + donnees.enfant + '</b> (' + donnees.detail + '). ' +
      'Nous ne pouvons malheureusement pas y donner suite cette fois-ci :<br><br>' + explication,
      [],
      [],
      'N’hésitez pas à répondre à ce message pour toute question. À très vite à l’académie, nous l’espérons !<br>' +
      'Fleur & Georges Cotrait, Académie de voltige équestre, Auberville.'
    );
    GmailApp.sendEmail(donnees.parentEmail, 'Votre demande à l’Académie de voltige',
      'Bonjour, nous ne pouvons malheureusement pas donner suite à la demande pour ' + donnees.enfant + '. ' +
      explication.replace(/<[^>]+>/g, ''), {
      htmlBody: htmlRefus,
      replyTo: ADRESSE_ACADEMIE,
      name: 'Académie de voltige équestre'
    });
    majStatutDemande(String(dTok || ''), 'refusée (' + motif.bouton + ')');
    return { code: 'ok refuse', titre: 'Refus envoyé',
      texte: 'Le message de refus (motif : ' + motif.bouton + ') vient de partir vers <b>' + donnees.parentEmail + '</b> pour <b>' + donnees.enfant + '</b>.' +
        '<br><br>Vous pouvez fermer cette page.',
      parentEmail: donnees.parentEmail, enfant: donnees.enfant, motifBouton: motif.bouton };
  }

  var boutons, intro;
  if (donnees.type === 'cours') {
    /* Pas de lien de paiement a cette etape : Fleur appelle la famille
       pour convenir de la date et de l'heure du cours du samedi, puis le
       CRM envoie le recapitulatif et le lien de paiement. */
    intro = 'Bonne nouvelle : la demande d’inscription de <b>' + donnees.enfant + '</b> aux cours (' + donnees.detail + ') est validée ! ' +
      'Fleur vous appelle très vite pour convenir ensemble de la date et de l’heure du cours, le samedi. ' +
      'Vous recevrez ensuite un e-mail avec le récapitulatif et le lien de paiement sécurisé.';
    boutons = [];
  } else if (lienPret(PAIEMENTS.stage_acompte)) {
    intro = 'Bonne nouvelle : la réservation de <b>' + donnees.enfant + '</b> pour le ' + donnees.detail + ' est confirmée ! ' +
      'Pour la garantir, réglez l’acompte de 300 € en ligne, en toute sécurité. ' +
      'Le solde (540 €) sera à régler au plus tard 30 jours avant le début du stage.';
    boutons = [
      { texte: PAIEMENTS.stage_acompte.libelle, url: PAIEMENTS.stage_acompte.url, plein: true }
    ];
    if (lienPret(PAIEMENTS.stage_solde)) {
      boutons.push({ texte: PAIEMENTS.stage_solde.libelle, url: PAIEMENTS.stage_solde.url, plein: false });
    }
  } else {
    intro = 'Bonne nouvelle : la réservation de <b>' + donnees.enfant + '</b> pour le ' + donnees.detail + ' est confirmée ! ' +
      'Pour finaliser l’inscription, réglez en ligne, en toute sécurité :';
    boutons = [
      { texte: PAIEMENTS.stage.libelle, url: PAIEMENTS.stage.url, plein: true }
    ];
  }

  var boutonsEssai = null, libelleEssai = null;
  if (ESSAIS_ACTIFS && donnees.type !== 'cours') {
    var essai = PAIEMENTS_TEST.stage;
    boutonsEssai = [{ texte: essai.libelle, url: essai.url, plein: false }];
    libelleEssai = 'Lien d’essai pendant nos tests : il ne débite rien.';
  }

  var html = gabaritMail(
    'Votre demande est validée ! 🎉',
    intro,
    [],
    boutons,
    'Une question ? Répondez simplement à ce message. À très vite à l’académie !<br>Fleur & Georges Cotrait, Académie de voltige équestre, Auberville.',
    boutonsEssai,
    libelleEssai
  );

  GmailApp.sendEmail(donnees.parentEmail, 'Votre inscription est validée !',
    'Bonne nouvelle : la demande pour ' + donnees.enfant + ' est validée. ' +
    (boutons.length ? 'Lien de paiement : ' + boutons[0].url
      : 'Fleur vous appelle très vite pour convenir de la date et de l’heure du cours ; le lien de paiement suivra par e-mail.'), {
    htmlBody: html,
    replyTo: ADRESSE_ACADEMIE,
    name: 'Académie de voltige équestre'
  });

  majStatutDemande(String(dTok || ''), 'validée');
  return { code: 'ok valide', titre: 'C’est validé ✅',
    texte: (donnees.type === 'cours'
      ? 'Le mail de validation vient de partir vers <b>' + donnees.parentEmail + '</b> pour <b>' + donnees.enfant + '</b>. ' +
        'Appelez la famille pour convenir du créneau, puis envoyez la date, l’heure et le lien de paiement depuis l’espace académie.'
      : 'Le mail de validation avec le lien de paiement vient de partir vers <b>' + donnees.parentEmail + '</b> pour <b>' + donnees.enfant + '</b>.') +
      '<br><br>Vous pouvez fermer cette page.',
    parentEmail: donnees.parentEmail, enfant: donnees.enfant };
}

/* ============ Relances et annulations (espace académie) ============
   La page admin du site relance un paiement ou annonce une annulation :
   le lien est prouvé par le même jeton signé que les décisions. */
function traiterRelance(d) {
  var donnees = verifierJeton(String(d.d || ''), String(d.s || ''));
  if (!donnees) {
    /* Demande enregistree par un ancien deploiement : son jeton signe
       n'est plus reconnu. On accepte quand meme la relance si elle
       vient d'un admin connecte (jeton de session Supabase), avec les
       informations de la demande envoyees par la plateforme. */
    var courriel = nettoyer(d.parentEmail);
    if (!adminDepuisJeton(String(d.jeton || '')) || !/.+@.+\..+/.test(courriel)) { return reponseTexte('lien invalide'); }
    donnees = {
      type: d.dtype === 'stage' ? 'stage' : 'cours',
      enfant: nettoyer(d.enfant) || 'votre voltigeur',
      parentEmail: courriel,
      detail: nettoyer(d.detail) || 'votre inscription',
      paiement: d.paiement === 'trimestre' ? 'trimestre' : d.paiement === 'unite' ? 'unite' : ''
    };
  }
  var c = contenusRelance(donnees, String(d.relance || ''), nettoyer(d.montant));
  if (!c) { return reponseTexte('relance inconnue'); }
  GmailApp.sendEmail(donnees.parentEmail, c.titre.replace(/<[^>]+>/g, ''),
    c.intro.replace(/<[^>]+>/g, ''), {
    htmlBody: gabaritMail(c.titre, c.intro, [], c.boutons, c.pied),
    replyTo: ADRESSE_ACADEMIE,
    name: 'Académie de voltige équestre'
  });
  return reponseTexte('ok relance;' + donnees.parentEmail);
}

/* Le contenu d'un mail de relance (partage entre la relance manuelle
   de l'espace academie et la routine quotidienne). */
function contenusRelance(donnees, sous, montant) {
  var pied = 'Une question ? Répondez simplement à ce message. À très vite à l’académie !<br>' +
    'Fleur & Georges Cotrait, Académie de voltige équestre, Auberville.';
  var titre, intro, boutons = [];

  if (sous === 'acompte') {
    titre = 'Un petit rappel pour ' + donnees.enfant;
    intro = 'La place de <b>' + donnees.enfant + '</b> pour le ' + donnees.detail + ' est réservée : ' +
      'il ne manque que l’acompte de 300 € pour la garantir. Le solde (540 €) sera à régler au plus tard 30 jours avant le début du stage.';
    if (lienPret(PAIEMENTS.stage_acompte)) { boutons.push({ texte: PAIEMENTS.stage_acompte.libelle, url: PAIEMENTS.stage_acompte.url, plein: true }); }
  } else if (sous === 'solde') {
    titre = 'Le solde du stage de ' + donnees.enfant;
    intro = 'Le ' + donnees.detail + ' approche pour <b>' + donnees.enfant + '</b> ! ' +
      'Le solde du stage (540 €) est à régler au plus tard 30 jours avant le début du stage.';
    if (lienPret(PAIEMENTS.stage_solde)) { boutons.push({ texte: PAIEMENTS.stage_solde.libelle, url: PAIEMENTS.stage_solde.url, plein: true }); }
    else if (lienPret(PAIEMENTS.stage)) { boutons.push({ texte: PAIEMENTS.stage.libelle, url: PAIEMENTS.stage.url, plein: true }); }
  } else if (sous === 'paiement') {
    titre = 'Un petit rappel pour ' + donnees.enfant;
    intro = 'La demande de <b>' + donnees.enfant + '</b> (' + donnees.detail + ') est validée : ' +
      'il ne reste que le règlement pour finaliser l’inscription.';
    if (donnees.type === 'cours') {
      if (donnees.paiement === 'trimestre') { boutons.push({ texte: PAIEMENTS.cours_trimestre.libelle, url: PAIEMENTS.cours_trimestre.url, plein: true }); }
      else { boutons.push({ texte: PAIEMENTS.cours_unite.libelle, url: PAIEMENTS.cours_unite.url, plein: true }); }
    } else if (lienPret(PAIEMENTS.stage_acompte)) {
      boutons.push({ texte: PAIEMENTS.stage_acompte.libelle, url: PAIEMENTS.stage_acompte.url, plein: true });
    } else {
      boutons.push({ texte: PAIEMENTS.stage.libelle, url: PAIEMENTS.stage.url, plein: true });
    }
  } else if (sous === 'annulation') {
    titre = 'Au sujet du stage de ' + donnees.enfant;
    intro = 'L’inscription de <b>' + donnees.enfant + '</b> pour le ' + donnees.detail + ' est annulée. ' +
      (montant && montant !== '0' && montant !== '0 €'
        ? 'Un remboursement de <b>' + montant + '</b> va vous être adressé.'
        : 'Conformément à nos conditions, les sommes déjà versées restent acquises à l’académie.');
    pied = 'Nous espérons accueillir ' + donnees.enfant + ' à une prochaine occasion. N’hésitez pas à répondre à ce message.<br>' +
      'Fleur & Georges Cotrait, Académie de voltige équestre, Auberville.';
  } else {
    return null;
  }
  return { titre: titre, intro: intro, boutons: boutons, pied: pied };
}

/* ============ Qui est derriere un jeton de session Supabase ============ */
function emailDepuisJeton(jeton) {
  if (!supabasePret() || !jeton) { return null; }
  try {
    var qui = UrlFetchApp.fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SUPABASE_CLE_SERVICE, Authorization: 'Bearer ' + jeton },
      muteHttpExceptions: true
    });
    if (qui.getResponseCode() !== 200) { return null; }
    return String((JSON.parse(qui.getContentText()) || {}).email || '').toLowerCase() || null;
  } catch (e) { return null; }
}

/* Renvoie l'adresse si (et seulement si) c'est un compte admin. */
function adminDepuisJeton(jeton) {
  var email = emailDepuisJeton(jeton);
  if (!email) { return null; }
  try {
    var admin = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/admins?select=email&email=eq.' + encodeURIComponent(email), {
      headers: { apikey: SUPABASE_CLE_SERVICE, Authorization: 'Bearer ' + SUPABASE_CLE_SERVICE },
      muteHttpExceptions: true
    });
    if (admin.getResponseCode() !== 200 || !JSON.parse(admin.getContentText()).length) { return null; }
    return email;
  } catch (e) { return null; }
}

/* ============ Lire et ecrire dans la base (cle service) ============ */
function supabaseLire(chemin) {
  try {
    var r = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + chemin, {
      headers: { apikey: SUPABASE_CLE_SERVICE, Authorization: 'Bearer ' + SUPABASE_CLE_SERVICE },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) { return null; }
    return JSON.parse(r.getContentText());
  } catch (e) { return null; }
}

function supabaseEcrire(chemin, corps) {
  try {
    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + chemin, {
      method: 'patch',
      contentType: 'application/json',
      headers: { apikey: SUPABASE_CLE_SERVICE, Authorization: 'Bearer ' + SUPABASE_CLE_SERVICE, Prefer: 'return=minimal' },
      payload: JSON.stringify(corps),
      muteHttpExceptions: true
    });
  } catch (e) { /* rien */ }
}

/* ============ Les paiements recus sur Stripe ============ */
function paiementsStripe() {
  if (!STRIPE_CLE || STRIPE_CLE.indexOf('COLLEZ') === 0) { return null; }
  try {
    var depuis = Math.floor(Date.now() / 1000) - 120 * 24 * 3600; /* les 4 derniers mois */
    var rep = UrlFetchApp.fetch('https://api.stripe.com/v1/checkout/sessions?limit=100&created%5Bgte%5D=' + depuis, {
      headers: { Authorization: 'Bearer ' + STRIPE_CLE },
      muteHttpExceptions: true
    });
    if (rep.getResponseCode() !== 200) { return null; }
    var paiements = [];
    (JSON.parse(rep.getContentText()).data || []).forEach(function (sess) {
      if (sess.payment_status !== 'paid') { return; }
      paiements.push({
        email: String((sess.customer_details && sess.customer_details.email) || sess.customer_email || '').toLowerCase(),
        montant: Math.round((sess.amount_total || 0) / 100),
        quand: new Date(sess.created * 1000).toISOString().slice(0, 10)
      });
    });
    return paiements;
  } catch (e) { return null; }
}

/* Le bouton « Verifier les paiements Stripe » de l'espace academie. */
function traiterStripe(d) {
  if (!STRIPE_CLE || STRIPE_CLE.indexOf('COLLEZ') === 0) { return reponseTexte('stripe non configuree'); }
  if (!supabasePret()) { return reponseTexte('supabase non configuree'); }
  if (!adminDepuisJeton(String(d.jeton || ''))) { return reponseTexte('acces refuse'); }
  var paiements = paiementsStripe();
  if (!paiements) { return reponseTexte('cle stripe refusee'); }
  return reponseTexte(JSON.stringify({ ok: true, paiements: paiements }));
}

/* ============ La confirmation d'une reservation de cours ============
   Envoyee au parent connecte juste apres sa reservation depuis
   « Mon compte » (son jeton de session prouve qui il est). */
function traiterConfirmationResa(d) {
  var email = emailDepuisJeton(String(d.jeton || ''));
  if (!email) { return reponseTexte('acces refuse'); }
  var enfant = nettoyer(d.enfant) || 'votre voltigeur';
  var quand = nettoyer(d.quand) || 'mercredi choisi';
  var titre = 'Réservation confirmée !';
  var intro = 'C’est noté : <b>' + enfant + '</b> est attendu(e) au cours de voltige du <b>' + quand + '</b>, à l’académie (Auberville).' +
    '<br><br>Un empêchement ? Vous pouvez annuler jusqu’à la veille depuis votre espace « Mon compte » sur le site.';
  GmailApp.sendEmail(email, titre, intro.replace(/<[^>]+>/g, ''), {
    htmlBody: gabaritMail(titre, intro, [], [], 'À très vite à l’académie !<br>Fleur & Georges Cotrait, Académie de voltige équestre, Auberville.'),
    replyTo: ADRESSE_ACADEMIE,
    name: 'Académie de voltige équestre'
  });
  return reponseTexte('ok confirmation');
}

/* ============ Une place s'est liberee (liste d'attente) ============ */
function traiterPlaceLibre(d) {
  if (!adminDepuisJeton(String(d.jeton || ''))) { return reponseTexte('acces refuse'); }
  var email = nettoyer(d.email);
  if (!/.+@.+\..+/.test(email)) { return reponseTexte('e-mail manquant'); }
  var enfant = nettoyer(d.enfant) || 'votre voltigeur';
  var quand = nettoyer(d.quand) || 'mercredi';
  var titre = 'Une place s’est libérée !';
  var intro = 'Bonne nouvelle : une place vient de se libérer pour le cours de voltige du <b>' + quand + '</b>, et <b>' + enfant + '</b> est en tête de la liste d’attente.' +
    '<br><br>Réservez vite depuis votre espace « Mon compte » sur le site, ou répondez simplement à ce message.';
  GmailApp.sendEmail(email, titre, intro.replace(/<[^>]+>/g, ''), {
    htmlBody: gabaritMail(titre, intro, [], [], 'À très vite à l’académie !<br>Fleur & Georges Cotrait, Académie de voltige équestre, Auberville.'),
    replyTo: ADRESSE_ACADEMIE,
    name: 'Académie de voltige équestre'
  });
  return reponseTexte('ok place;' + email);
}

/* ============ Les infos du cours + le lien de paiement ============
   Fleur a appelé la famille et noté la date et l'heure sur le CRM :
   la plateforme envoie ici le récapitulatif aux parents, avec le lien
   de paiement de la formule choisie (à l'unité ou au trimestre). */
function traiterInfosCours(d) {
  if (!adminDepuisJeton(String(d.jeton || ''))) { return reponseTexte('acces refuse'); }
  var email = nettoyer(d.email);
  if (!/.+@.+\..+/.test(email)) { return reponseTexte('e-mail manquant'); }
  var enfant = nettoyer(d.enfant) || 'votre voltigeur';
  var quand = nettoyer(d.quand) || 'samedi';
  var heure = nettoyer(d.heure);
  var bouton = d.paiement === 'trimestre' ? PAIEMENTS.cours_trimestre : PAIEMENTS.cours_unite;
  var titre = 'Votre cours de voltige est fixé !';
  var intro = 'Comme convenu au téléphone, <b>' + enfant + '</b> est attendu(e) au cours de voltige le <b>' + quand + '</b>' +
    (heure ? ', <b>' + heure + '</b>' : '') + ', à l’académie (Auberville).' +
    '<br><br>Pour finaliser l’inscription, réglez en ligne, en toute sécurité :';
  var boutons = [{ texte: bouton.libelle, url: bouton.url, plein: true }];
  GmailApp.sendEmail(email, titre,
    enfant + ' est attendu(e) au cours de voltige le ' + quand + (heure ? ', ' + heure : '') +
    ', à l’académie (Auberville). Lien de paiement : ' + bouton.url, {
    htmlBody: gabaritMail(titre, intro, [], boutons,
      'Un empêchement ou une question ? Répondez simplement à ce message. À très vite à l’académie !<br>' +
      'Fleur & Georges Cotrait, Académie de voltige équestre, Auberville.'),
    replyTo: ADRESSE_ACADEMIE,
    name: 'Académie de voltige équestre'
  });
  return reponseTexte('ok infos;' + email);
}

/* ============ La routine quotidienne (les automatismes) ============
   À INSTALLER UNE FOIS : dans la barre d'outils de l'éditeur,
   choisissez la fonction « installerRoutine » dans le menu déroulant,
   cliquez « Exécuter », et acceptez l'autorisation demandée.
   Ensuite, chaque matin vers 7h, le script tout seul :
   1. lit les paiements reçus sur Stripe et les note dans la base ;
   2. relance l'acompte des stages impayés depuis plus de 7 jours ;
   3. relance le solde des stages à moins de 45 jours du début ;
      (une seule relance automatique par sujet et par demande)
   4. envoie un rappel aux inscrits du cours du lendemain. */
function installerRoutine() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'routineQuotidienne') { ScriptApp.deleteTrigger(t); }
  });
  ScriptApp.newTrigger('routineQuotidienne').timeBased().everyDays(1).atHour(7).create();
  Logger.log('Routine installée : elle tournera chaque matin entre 7h et 8h.');
}

function routineQuotidienne() {
  if (!supabasePret()) { return; }
  try { rapprocherStripeAuto(); } catch (e) { /* silencieux */ }
  try { relancesAuto(); } catch (e) { /* silencieux */ }
  try { rappelsVeille(); } catch (e) { /* silencieux */ }
}

function montantDe(texte) {
  var m = String(texte || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function isoDe(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

/* 1. Noter tout seul les paiements Stripe (memes regles que le bouton
   de la plateforme : e-mail + montant : totalite, acompte 300, solde). */
function rapprocherStripeAuto() {
  var paiements = paiementsStripe();
  if (!paiements) { return; }
  var lignes = supabaseLire('demandes?select=*&statut=eq.' + encodeURIComponent('validée') + '&annule=eq.false&limit=500');
  if (!lignes) { return; }
  var jour = isoDe(new Date());
  lignes.forEach(function (d) {
    if (!d.parent_email) { return; }
    var total = montantDe(d.tarif) || (d.type === 'stage' ? 840 : 0);
    var solde = Math.max(total - 300, 0);
    var reste = d.type === 'stage'
      ? (d.acompte_paye ? 0 : 300) + (d.solde_paye ? 0 : solde)
      : (d.paye ? 0 : total);
    if (reste <= 0) { return; }
    var email = String(d.parent_email).toLowerCase();
    for (var i = 0; i < paiements.length; i++) {
      var p = paiements[i];
      if (p.email !== email) { continue; }
      var patch = null;
      if (d.type === 'stage') {
        if (total > 0 && p.montant >= total) { patch = { acompte_paye: true, acompte_le: jour, solde_paye: true, solde_le: jour, paye: true, paye_le: jour, paye_montant: p.montant + ' €' }; }
        else if (p.montant === 300 && !d.acompte_paye) { patch = { acompte_paye: true, acompte_le: jour }; }
        else if (p.montant === solde && d.acompte_paye && !d.solde_paye) { patch = { solde_paye: true, solde_le: jour }; }
      } else if (total > 0 && p.montant >= total) {
        patch = { paye: true, paye_le: jour, paye_montant: p.montant + ' €' };
      }
      if (!patch) { continue; }
      paiements.splice(i, 1);
      supabaseEcrire('demandes?id=eq.' + encodeURIComponent(d.id), patch);
      break;
    }
  });
}

/* La date de debut d'un stage, lue dans son intitule
   (« ... (Du 19 au 24 octobre 2026) »). */
var MOIS_FRANCAIS = {
  janvier: 0, fevrier: 1, 'février': 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, 'août': 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11, 'décembre': 11
};
function debutStage(detail) {
  var t = String(detail || '').toLowerCase();
  var m = t.match(/du\s+(\d{1,2})\s+au\s+\d{1,2}\s+([a-zà-ÿ]+)\s+(\d{4})/);
  if (!m) { m = t.match(/(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})/); }
  if (!m || MOIS_FRANCAIS[m[2]] == null) { return null; }
  return new Date(Number(m[3]), MOIS_FRANCAIS[m[2]], Number(m[1]), 12);
}

/* 2 et 3. Les relances automatiques des stages. */
function relancesAuto() {
  var lignes = supabaseLire('demandes?select=*&type=eq.stage&statut=eq.' + encodeURIComponent('validée') + '&annule=eq.false&limit=500');
  if (!lignes) { return; }
  var jour = isoDe(new Date());
  var maintenant = new Date();
  lignes.forEach(function (d) {
    if (!d.parent_email || !/.+@.+\..+/.test(d.parent_email)) { return; }
    var donnees = {
      type: 'stage',
      enfant: d.enfant || 'votre voltigeur',
      parentEmail: d.parent_email,
      detail: d.detail || 'votre stage',
      paiement: ''
    };
    if (!d.acompte_paye && !d.relance_acompte_le && d.cree &&
        (maintenant - new Date(d.cree)) > 7 * 24 * 3600 * 1000) {
      if (envoyerRelanceAuto(donnees, 'acompte')) {
        supabaseEcrire('demandes?id=eq.' + encodeURIComponent(d.id), { relance_acompte_le: jour });
      }
      return;
    }
    var debut = debutStage(d.detail);
    if (d.acompte_paye && !d.solde_paye && !d.relance_solde_le && debut &&
        debut > maintenant && (debut - maintenant) < 45 * 24 * 3600 * 1000) {
      if (envoyerRelanceAuto(donnees, 'solde')) {
        supabaseEcrire('demandes?id=eq.' + encodeURIComponent(d.id), { relance_solde_le: jour });
      }
    }
  });
}

function envoyerRelanceAuto(donnees, sous) {
  var c = contenusRelance(donnees, sous, '');
  if (!c) { return false; }
  GmailApp.sendEmail(donnees.parentEmail, c.titre.replace(/<[^>]+>/g, ''), c.intro.replace(/<[^>]+>/g, ''), {
    htmlBody: gabaritMail(c.titre, c.intro, [], c.boutons, c.pied),
    replyTo: ADRESSE_ACADEMIE,
    name: 'Académie de voltige équestre'
  });
  return true;
}

/* 4. Le rappel de la veille aux familles dont le cours est demain
   (les cours planifiés par Fleur, notés sur les demandes du CRM). */
function rappelsVeille() {
  var demain = new Date();
  demain.setDate(demain.getDate() + 1);
  var lignes = supabaseLire('demandes?select=parent_email,enfant,cours_heure&type=eq.cours&statut=eq.' +
    encodeURIComponent('validée') + '&annule=eq.false&cours_date=eq.' + isoDe(demain));
  if (!lignes || !lignes.length) { return; }
  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var joli = JOURS[demain.getDay()] + ' ' + demain.getDate() + ' ' + MOIS[demain.getMonth()];
  var parEmail = {}, heures = {};
  lignes.forEach(function (r) {
    if (r.parent_email && /.+@.+\..+/.test(r.parent_email)) {
      (parEmail[r.parent_email] = parEmail[r.parent_email] || []).push(r.enfant || 'votre voltigeur');
      if (r.cours_heure && !heures[r.parent_email]) { heures[r.parent_email] = r.cours_heure; }
    }
  });
  Object.keys(parEmail).forEach(function (email) {
    var noms = parEmail[email].join(' et ');
    var titre = 'À demain à l’académie !';
    var intro = 'Petit rappel : <b>' + noms + '</b> est attendu(e) demain, <b>' + joli + '</b>' +
      (heures[email] ? ' (<b>' + heures[email] + '</b>)' : '') + ', pour son cours de voltige à l’académie.' +
      '<br><br>Un empêchement ? Répondez simplement à ce message.';
    GmailApp.sendEmail(email, titre, intro.replace(/<[^>]+>/g, ''), {
      htmlBody: gabaritMail(titre, intro, [], [], 'À très vite à l’académie !<br>Fleur & Georges Cotrait, Académie de voltige équestre, Auberville.'),
      replyTo: ADRESSE_ACADEMIE,
      name: 'Académie de voltige équestre'
    });
  });
}

/* Clic direct sur un lien /exec (anciens mails) : mêmes actions, en page web. */
function doGet(e) {
  var p = e.parameter || {};
  if ((p.action !== 'valider' && p.action !== 'refuser') || !p.d || !p.s) {
    return pageHtml('Service des inscriptions', 'Ce service reçoit les demandes du site de l’académie. Rien à voir ici ! Version du script : ' + VERSION_SCRIPT + '.');
  }
  var r = executerDecision(p.action, p.motif, p.d, p.s);
  if (r.code === 'lien invalide') { return pageHtml('Lien invalide', 'Ce lien n’est pas reconnu. Utilisez les boutons du mail d’origine.'); }
  if (r.code === 'motif inconnu') { return pageHtml('Lien invalide', 'Motif de refus inconnu. Utilisez les boutons du mail d’origine.'); }
  return pageHtml(r.titre, r.texte);
}

/* Appel depuis decision.html : même logique, réponse en texte simple. */
function traiterDecisionPost(d) {
  if (d.action !== 'valider' && d.action !== 'refuser') { return reponseTexte('action inconnue'); }
  var r = executerDecision(d.action, d.motif, d.d, d.s);
  if (r.code === 'lien invalide' || r.code === 'motif inconnu') { return reponseTexte(r.code); }
  return reponseTexte(r.code + ';' + r.parentEmail + ';' + r.enfant + (r.motifBouton ? ';' + r.motifBouton : ''));
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
