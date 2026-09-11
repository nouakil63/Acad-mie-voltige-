/* ============================================================
   Service d'inscriptions — Académie de voltige équestre
   ------------------------------------------------------------
   Ce script tourne DANS le compte Gmail de l'académie :
   - il reçoit les demandes d'inscription du site (cours et stages),
   - il envoie la demande, joliment mise en page, à l'académie,
   - le mail contient un bouton « Valider » : un clic, et le client
     reçoit automatiquement le mail de validation avec le lien de
     paiement, aux couleurs du site.

   MISE À JOUR v24 — voir README-CRM.md :
   1. Installer les migrations SQL dans l'ordre indiqué par le README.
   2. Ouvrir le projet Google Apps Script EXISTANT de l'académie.
      Sauvegarder son code et sa configuration avant remplacement.
   3. Conserver impérativement la propriété « secret » des anciens liens.
      Préférer les propriétés du script SUPABASE_URL,
      SUPABASE_CLE_SERVICE et STRIPE_CLE aux constantes de repli.
   4. Remplacer le code, puis publier une nouvelle version du déploiement
      existant pour conserver son URL /exec. Ne pas créer un autre projet.
   5. STRIPE_REMBOURSEMENTS_ACTIFS reste désactivé tant que sa propriété
      n'est pas exactement « true ». La synchronisation horaire s'installe
      séparément avec installerSynchronisationStripe ; elle ne rembourse pas.
   ============================================================ */

var ADRESSE_ACADEMIE = 'academiedevoltige@gmail.com';
var SITE = 'https://academiedevoltige.com';

/* Numéro de version du script : ouvrez l'adresse /exec dans un
   navigateur pour vérifier quelle version est réellement en ligne. */
var VERSION_SCRIPT = '24';

/* ============ L'espace académie (page admin.html du site) ============
   Chaque demande reçue est aussi rangée dans la base Supabase de
   l'académie : la page admin.html du site les affiche toutes et permet
   de valider ou refuser en un clic.
   Configurer la propriété SUPABASE_CLE_SERVICE avec la clé « service_role » de
   Supabase (menu Project Settings → API Keys → service_role → Reveal).
   ⚠️ Cette clé est SECRÈTE : elle ne se colle QUE dans cet éditeur,
   jamais sur le site, jamais dans un mail ou une discussion.
   Tant qu'elle n'est pas collée, tout marche comme avant : les demandes
   arrivent par mail, simplement sans la page admin. */
var SUPABASE_URL = 'https://vtrmohmupfvxzbsnubye.supabase.co';
var SUPABASE_CLE_SERVICE = 'COLLEZ-ICI-LA-CLE-SERVICE-ROLE';

/* Préférer Paramètres du projet → Propriétés du script pour les secrets.
   Les valeurs de l'ancien déploiement restent compatibles si absentes. */
function configuration(nom, secours) {
  return PropertiesService.getScriptProperties().getProperty(nom) || secours;
}
function urlSupabase() { return String(configuration('SUPABASE_URL', SUPABASE_URL)).replace(/\/$/, ''); }
function cleSupabase() { return configuration('SUPABASE_CLE_SERVICE', SUPABASE_CLE_SERVICE); }
function cleStripe() { return configuration('STRIPE_CLE', STRIPE_CLE); }

function supabasePret() {
  return urlSupabase() && cleSupabase() && cleSupabase().indexOf('COLLEZ') !== 0;
}

/* Range une demande dans la base (silencieux : un souci ici n'empêche
   jamais le mail de partir). */
function enregistrerDemande(ligne) {
  if (!supabasePret()) { return; }
  try {
    UrlFetchApp.fetch(urlSupabase() + '/rest/v1/demandes', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        apikey: cleSupabase(),
        Authorization: 'Bearer ' + cleSupabase(),
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
  return supabaseEcrire('demandes?jeton_d=eq.' + encodeURIComponent(dTok),
    { statut: statut, decide: new Date().toISOString() });
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
  stage_acompte:   { libelle: 'Payer l’acompte du stage (300 €)', url: 'https://buy.stripe.com/cNiaEX1d7ab42M8bY64ow05' },
  stage_solde:     { libelle: 'Payer le solde du stage (540 €)',  url: 'https://buy.stripe.com/dRmbJ19JD970euQ1js4ow06' }
};

function lienPret(p) {
  return p && p.url && p.url.indexOf('COLLEZ') !== 0;
}

/* ============ La lecture des paiements Stripe (espace académie) ======
   Le bouton « Vérifier les paiements Stripe » de la plateforme admin
   demande à ce script la liste des règlements reçus, pour les
   rapprocher des inscriptions en un clic.
   CRÉEZ une clé RESTREINTE dans Stripe : Développeurs → Clés API →
   Créer une clé restreinte : lecture de Sessions Checkout,
   PaymentIntents, Charges et Refunds. Pour autoriser les remboursements
   confirmés dans le CRM, accorder aussi l'écriture de Refunds.
   Placer la clé dans la propriété du script STRIPE_CLE.
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
  if (d && d.type === 'stripe-rapprocher') { return traiterRapprochementStripe(d); }
  if (d && d.type === 'stripe-remboursements') { return traiterEtatRemboursementsStripe(d); }
  if (d && d.type === 'stripe-rembourser') { return traiterRemboursementStripe(d); }
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
  var cleProspection = configuration('CLE_PROSPECTION', CLE_PROSPECTION);
  if (!cleProspection || cleProspection === 'CHANGEZ-MOI') {
    return reponseTexte('cle non configuree dans le script');
  }
  if (String(d.cle || '') !== cleProspection) { return reponseTexte('cle incorrecte'); }

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
  if (action !== 'valider' && action !== 'refuser') { return { code: 'action inconnue' }; }
  if (action === 'refuser' && !MOTIFS_REFUS[motifCle]) { return { code: 'motif inconnu' }; }
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(10000)) {
    return { code: 'decision en cours', titre: 'Décision en cours', texte: 'Une décision est déjà en cours. Patientez puis actualisez le dossier.' };
  }
  try {
    var cible = action === 'valider' ? 'validée' : 'refusée (' + MOTIFS_REFUS[motifCle].bouton + ')';
    var chemin = 'crm_decisions?jeton_signature=eq.' + encodeURIComponent(sTok);
    var existante = supabaseLire(chemin + '&select=*')[0];
    if (existante) {
      if (existante.etat === 'envoye') {
        supabaseEcrire(chemin, { etat: 'termine', termine_le: new Date().toISOString() });
      }
      return { code: existante.etat === 'reserve' ? 'decision a verifier' : 'decision deja traitee',
        titre: 'Décision déjà enregistrée', texte: existante.etat === 'reserve'
          ? 'L’envoi a été réservé mais sa fin n’est pas confirmée. Vérifiez les messages envoyés dans Gmail et le dossier avant toute nouvelle action.'
          : 'Ce lien a déjà été utilisé. Aucun nouvel e-mail n’a été envoyé. Consultez le dossier dans le CRM.' };
    }
    var lignes = supabaseLire('demandes?select=id,statut,annule&jeton_d=eq.' + encodeURIComponent(dTok));
    if (lignes.length > 1) { throw erreurService('decision_ambigue', 'Plusieurs dossiers utilisent cet ancien lien. Décidez depuis le CRM.'); }
    if (lignes.length && (lignes[0].annule || lignes[0].statut !== 'en attente')) {
      return { code: 'decision deja traitee', titre: 'Dossier déjà traité', texte: 'Le dossier a déjà été traité ou annulé. Aucun nouvel e-mail n’a été envoyé.' };
    }
    // Les anciens liens sans ligne Supabase restent utilisables. Le journal
    // assure aussi leur unicité, sans expiration imposée aux familles.
    var reservation = supabaseRequete('crm_decisions?on_conflict=jeton_signature', 'post', {
      jeton_signature: sTok, action: action, statut_cible: cible
    }, 'resolution=ignore-duplicates,return=representation');
    if (!Array.isArray(reservation) || reservation.length !== 1) {
      return { code: 'decision en cours', titre: 'Décision en cours', texte: 'Ce lien est déjà en cours de traitement. Consultez le dossier avant de réessayer.' };
    }
    if (lignes.length) {
      // Compare-and-set : une décision concurrente / annulation dans le CRM
      // empêche l'envoi, même après la lecture de l'état initial.
      supabaseEcrire('demandes?id=eq.' + encodeURIComponent(lignes[0].id) + '&statut=eq.' +
        encodeURIComponent('en attente') + '&annule=eq.false', { statut: cible, decide: new Date().toISOString() });
    }
    var resultat = envoyerDecision(action, motifCle, dTok, sTok);
    supabaseEcrire(chemin, { etat: 'envoye', envoye_le: new Date().toISOString() });
    supabaseEcrire(chemin, { etat: 'termine', termine_le: new Date().toISOString() });
    return resultat;
  } catch (e) {
    return { code: 'erreur decision', titre: 'Décision à vérifier',
      texte: e && e.code ? nettoyer(e.message) : 'Le traitement n’a pas pu être confirmé. Vérifiez le dossier et les messages envoyés dans Gmail avant de réessayer.' };
  } finally { verrou.releaseLock(); }
}

/* Appelée uniquement après réservation persistante dans executerDecision. */
function envoyerDecision(action, motifCle, dTok, sTok) {
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
        ? 'Un remboursement de <b>' + montant + '</b> a été déclaré par l’académie.'
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
  var qui = UrlFetchApp.fetch(urlSupabase() + '/auth/v1/user', {
    headers: { apikey: cleSupabase(), Authorization: 'Bearer ' + jeton },
    muteHttpExceptions: true
  });
  if (qui.getResponseCode() === 401 || qui.getResponseCode() === 403) { return null; }
  var utilisateur = lireReponseJson(qui, 'auth');
  return String(utilisateur.email || '').trim().toLowerCase() || null;
}

/* Renvoie l'adresse si (et seulement si) c'est un compte admin. */
function adminDepuisJeton(jeton) {
  var email = emailDepuisJeton(jeton);
  if (!email) { return null; }
  var admin = supabaseLire('admins?select=email&email=eq.' + encodeURIComponent(email));
  return admin.length ? email : null;
}

/* ============ Lire et ecrire dans la base (cle service) ============ */
function erreurService(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

function lireReponseJson(r, service) {
  var statut = r.getResponseCode(), resultat;
  try { resultat = JSON.parse(r.getContentText() || 'null'); }
  catch (e) { throw erreurService(service + '_reponse_invalide', 'Réponse illisible du service ' + service + '.'); }
  if (statut < 200 || statut >= 300) {
    var code = resultat && typeof resultat.message === 'string' && /^[a-z_]+$/.test(resultat.message)
      ? resultat.message : service + '_http_' + statut;
    throw erreurService(code, service === 'supabase' && (statut === 404 || code === 'PGRST202')
      ? 'Les migrations CRM v22 et v24 doivent être installées dans Supabase.'
      : 'Le service ' + service + ' a refusé la requête (HTTP ' + statut + ').');
  }
  return resultat;
}

function supabaseRequete(chemin, methode, corps, preference) {
  if (!supabasePret()) { throw erreurService('supabase_non_configuree', 'La connexion Supabase n’est pas configurée.'); }
  var options = { method: methode || 'get', muteHttpExceptions: true,
    headers: { apikey: cleSupabase(), Authorization: 'Bearer ' + cleSupabase() } };
  if (corps !== undefined) { options.contentType = 'application/json'; options.payload = JSON.stringify(corps); }
  if (preference) { options.headers.Prefer = preference; }
  return lireReponseJson(UrlFetchApp.fetch(urlSupabase() + '/rest/v1/' + chemin, options), 'supabase');
}

function supabaseLire(chemin) {
  var resultat = supabaseRequete(chemin, 'get');
  if (!Array.isArray(resultat)) { throw erreurService('supabase_reponse_invalide', 'La base n’a pas renvoyé une liste.'); }
  return resultat;
}

/* Suivre Content-Range, y compris si le serveur impose moins de 500 lignes. */
function supabaseLireTout(chemin) {
  if (!supabasePret()) { throw erreurService('supabase_non_configuree', 'La connexion Supabase n’est pas configurée.'); }
  if (/[?&](limit|offset)=/.test(chemin)) { throw erreurService('pagination_invalide', 'Ne pas limiter une lecture paginée.'); }
  var lignes = [], offset = 0;
  for (var page = 0; page < 1000; page++) {
    var rep = UrlFetchApp.fetch(urlSupabase() + '/rest/v1/' + chemin, {
      headers: { apikey: cleSupabase(), Authorization: 'Bearer ' + cleSupabase(),
        'Range-Unit': 'items', Range: offset + '-' + (offset + 499), Prefer: 'count=exact' },
      muteHttpExceptions: true
    });
    var lot = lireReponseJson(rep, 'supabase');
    if (!Array.isArray(lot)) { throw erreurService('supabase_reponse_invalide', 'Pagination Supabase illisible.'); }
    var entetes = rep.getAllHeaders(), plage = '';
    Object.keys(entetes).forEach(function (cle) { if (cle.toLowerCase() === 'content-range') { plage = String(entetes[cle]); } });
    var total = /\/(\d+)$/.exec(plage);
    lignes = lignes.concat(lot);
    offset += lot.length;
    if (total && offset >= Number(total[1])) { return lignes; }
    if (!lot.length) {
      if (total && offset < Number(total[1])) { throw erreurService('pagination_incomplete', 'La lecture de la base est incomplète.'); }
      return lignes;
    }
    // Sans total, une dernière page vide est nécessaire : une page courte
    // peut simplement venir de la limite configurée sur le serveur.
  }
  throw erreurService('pagination_limite', 'Trop de pages Supabase ; aucune vérification partielle n’a été appliquée.');
}

function supabaseEcrire(chemin, corps) {
  var lignes = supabaseRequete(chemin, 'patch', corps, 'return=representation');
  if (!Array.isArray(lignes) || !lignes.length) { throw erreurService('mise_a_jour_vide', 'La demande n’a pas été mise à jour. Rechargez le CRM.'); }
  return lignes;
}

/* ============ Les paiements recus sur Stripe ============ */
/* v24 : Checkout + PaymentIntents + Charges + Refunds en lecture ; Refunds
   en écriture seulement pour les remboursements explicitement confirmés.
   La propriété STRIPE_REMBOURSEMENTS_ACTIFS doit être exactement "true".
   Ne jamais mettre une clé secrète dans le site. Aucune tâche planifiée
   ne crée de remboursement. recu_le reste la création de la session. */
function stripeRequete(chemin) {
  return stripeApi('/checkout/sessions' + chemin);
}

function stripeApi(chemin, methode, parametres, idempotence) {
  var cle = cleStripe();
  if (!cle || cle.indexOf('COLLEZ') === 0) { throw erreurService('stripe_non_configuree', 'La clé Stripe n’est pas configurée.'); }
  var options = { method: methode || 'get', headers: { Authorization: 'Bearer ' + cle }, muteHttpExceptions: true };
  if (methode === 'post') {
    if (chemin !== '/refunds' || !idempotence || !remboursementsStripeActifs()) {
      throw erreurService('remboursements_desactives', 'Les remboursements Stripe ne sont pas activés dans le service.');
    }
    options.contentType = 'application/x-www-form-urlencoded';
    options.headers['Idempotency-Key'] = idempotence;
    options.payload = Object.keys(parametres).sort().map(function (cleParam) {
      return encodeURIComponent(cleParam) + '=' + encodeURIComponent(String(parametres[cleParam]));
    }).join('&');
  }
  return lireReponseJson(UrlFetchApp.fetch('https://api.stripe.com/v1' + chemin, options), 'stripe');
}

function paiementDepuisSession(sess) {
  if (!sess || sess.payment_status !== 'paid' || sess.status !== 'complete' || sess.livemode !== true ||
      sess.mode !== 'payment' || String(sess.currency).toLowerCase() !== 'eur' ||
      !Number.isSafeInteger(sess.amount_total) || sess.amount_total <= 0) { return null; }
  if (!/^cs_[A-Za-z0-9_]+$/.test(String(sess.id || '')) || !Number.isFinite(sess.created) || sess.created <= 0) {
    throw erreurService('stripe_reponse_invalide', 'Identifiant ou date Stripe manquant.');
  }
  var email = String((sess.customer_details && sess.customer_details.email) || sess.customer_email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return null; }
  var recu = new Date(sess.created * 1000);
  return { session_id: sess.id, email: email, montant: sess.amount_total / 100,
    montant_centimes: sess.amount_total, devise: 'eur', recu_le: recu.toISOString(),
    quand: Utilities.formatDate(recu, 'Europe/Paris', 'yyyy-MM-dd') };
}

function paiementsStripe() {
  var depuis = Math.floor(Date.now() / 1000) - 120 * 24 * 3600;
  var paiements = [], curseur = '', vus = {};
  for (var page = 0; page < 1000; page++) {
    var rep = stripeRequete('?limit=100&created%5Bgte%5D=' + depuis +
      (curseur ? '&starting_after=' + encodeURIComponent(curseur) : ''));
    if (!rep || !Array.isArray(rep.data) || typeof rep.has_more !== 'boolean') {
      throw erreurService('stripe_reponse_invalide', 'La liste des paiements Stripe est illisible.');
    }
    rep.data.forEach(function (sess) {
      var p = paiementDepuisSession(sess);
      if (p && !vus[p.session_id]) { paiements.push(p); vus[p.session_id] = true; }
    });
    if (!rep.has_more) { return paiements; }
    var dernier = rep.data.length ? rep.data[rep.data.length - 1].id : '';
    if (!dernier || dernier === curseur) { throw erreurService('stripe_pagination_incomplete', 'Stripe n’a pas fourni la page suivante.'); }
    curseur = dernier;
  }
  throw erreurService('stripe_pagination_limite', 'Trop de pages Stripe ; aucun rapprochement partiel n’a été effectué.');
}

function reponseErreurCRM(e) {
  var code = e && e.code || 'service_indisponible';
  var messages = {
    paiement_deja_affecte: 'Ce règlement Stripe est déjà affecté à un autre dossier. Actualisez les paiements.',
    demande_annulee: 'Le dossier a été annulé. Aucun paiement n’a été affecté.',
    demande_non_validee: 'Validez le dossier avant de rapprocher un paiement.',
    demande_deja_payee: 'Le dossier est déjà réglé. Aucun paiement supplémentaire n’a été affecté.',
    demande_introuvable: 'Le dossier n’existe plus. Actualisez le CRM.',
    paiement_introuvable: 'Le paiement n’est pas encore enregistré. Relancez la vérification Stripe.',
    email_incompatible: 'L’adresse du règlement ne correspond pas à celle du dossier.',
    paiement_anterieur_demande: 'Le règlement est antérieur à la création du dossier.',
    montant_ou_etat_incompatible: 'Le montant ou l’état du dossier a changé. Vérifiez les règlements avant de réessayer.',
    paiement_etat_registre_incompatible: 'Le registre contient déjà un règlement pour ce dossier. Vérifiez les paiements enregistrés.',
    paiement_depasse_tarif: 'Ce rapprochement dépasserait le montant dû pour le dossier.'
  };
  // Ne jamais renvoyer un message brut d'UrlFetchApp (URL / informations internes).
  var message = messages[code] || (e && e.code ? e.message : 'Le service n’a pas pu terminer l’opération. Réessayez après vérification.');
  return reponseTexte(JSON.stringify({ ok: false, code: code, message: message }));
}

function importerPaiementsStripe(paiements) {
  for (var i = 0; i < paiements.length; i += 100) {
    var lot = paiements.slice(i, i + 100).map(function (p) {
      return { session_id: p.session_id, email: p.email, montant_centimes: p.montant_centimes,
        devise: p.devise, recu_le: p.recu_le };
    });
    supabaseRequete('crm_paiements_stripe?on_conflict=session_id', 'post', lot,
      'resolution=ignore-duplicates,return=minimal');
  }
}

function centimesDe(texte) {
  var m = String(texte || '').replace(/[\s\u00a0\u202f]/g, '').match(/\d+(?:[.,]\d{1,2})?/);
  return m ? Math.round(Number(m[0].replace(',', '.')) * 100) : 0;
}

function naturePaiement(d, p) {
  if (d.annule || d.statut !== 'validée' || d.paye ||
      String(d.parent_email || '').trim().toLowerCase() !== p.email ||
      !d.cree || Math.floor(new Date(d.cree).getTime() / 1000) > new Date(p.recu_le).getTime() / 1000) { return ''; }
  var total = centimesDe(d.tarif) || (d.type === 'stage' ? 84000 : 0);
  if (total <= 0 || p.devise !== 'eur') { return ''; }
  if (d.type === 'cours') { return p.montant_centimes === total ? 'total' : ''; }
  if (d.type !== 'stage') { return ''; }
  if (!d.acompte_paye && !d.solde_paye && p.montant_centimes === total) { return 'total'; }
  if (!d.acompte_paye && !d.solde_paye && total > 30000 && p.montant_centimes === 30000) { return 'acompte'; }
  if (d.acompte_paye && !d.solde_paye && total > 30000 && p.montant_centimes === total - 30000) { return 'solde'; }
  return '';
}

/* Avant v22, les cases payé n'avaient aucun identifiant Stripe. Si une
   ancienne ligne pourrait déjà expliquer le règlement, ne pas le réutiliser. */
function paiementHistoriquePossible(d, p, registre) {
  if (String(d.parent_email || '').trim().toLowerCase() !== p.email ||
      !d.cree || Math.floor(new Date(d.cree).getTime() / 1000) > new Date(p.recu_le).getTime() / 1000) { return false; }
  var total = centimesDe(d.tarif) || (d.type === 'stage' ? 84000 : 0);
  var nature = p.montant_centimes === total && d.paye ? 'total' :
    d.type === 'stage' && p.montant_centimes === 30000 && d.acompte_paye ? 'acompte' :
    d.type === 'stage' && p.montant_centimes === total - 30000 && d.solde_paye ? 'solde' : '';
  if (!nature) { return false; }
  var date = nature === 'acompte' ? d.acompte_le : nature === 'solde' ? d.solde_le : d.paye_le;
  if (date && String(date) < p.quand) { return false; }
  var affectes = registre.filter(function (r) { return r.demande_id === d.id; });
  if (nature === 'total') {
    return affectes.reduce(function (somme, r) { return somme + Number(r.montant_centimes || 0); }, 0) < total;
  }
  return !affectes.some(function (r) { return r.nature === nature || r.nature === 'total'; });
}

function preparerRapprochements(paiements, demandes, registre) {
  var connus = {}, utilisations = {};
  registre.forEach(function (r) { connus[r.session_id] = r; });
  var lignes = paiements.map(function (p) {
    var ligne = Object.assign({}, p, { candidats: [] });
    var connu = connus[p.session_id];
    if (connu && connu.demande_id) {
      ligne.statut = 'deja_rapproche'; ligne.demande_id = connu.demande_id; ligne.nature = connu.nature;
      return ligne;
    }
    demandes.forEach(function (d) {
      var nature = naturePaiement(d, p), historique = paiementHistoriquePossible(d, p, registre);
      if (nature && registre.some(function (r) {
        return r.demande_id === d.id && (nature !== 'solde' || r.nature !== 'acompte');
      })) { nature = ''; }
      if (!nature && !historique) { return; }
      ligne.candidats.push({ demande_id: d.id, enfant: d.enfant, detail: d.detail,
        nature: nature || 'historique', historique: historique });
    });
    ligne.statut = !ligne.candidats.length ? 'sans_correspondance' :
      ligne.candidats.length === 1 && !ligne.candidats[0].historique ? 'propose' : 'ambigu';
    if (ligne.statut === 'propose') {
      ligne.demande_id = ligne.candidats[0].demande_id; ligne.nature = ligne.candidats[0].nature;
      var cle = ligne.demande_id;
      utilisations[cle] = (utilisations[cle] || 0) + 1;
    }
    return ligne;
  });
  var bilan = { proposes: 0, ambigus: 0, sans_correspondance: 0, deja_rapproches: 0 };
  lignes.forEach(function (p) {
    if (p.statut === 'propose' && utilisations[p.demande_id] > 1) {
      p.statut = 'ambigu'; p.raison = 'Plusieurs paiements correspondent au même règlement.';
      delete p.demande_id; delete p.nature;
    }
    bilan[p.statut === 'propose' ? 'proposes' : p.statut === 'ambigu' ? 'ambigus' :
      p.statut === 'deja_rapproche' ? 'deja_rapproches' : 'sans_correspondance']++;
  });
  return { ok: true, version: 24, paiements: lignes,
    propositions: lignes.filter(function (p) { return p.statut === 'propose'; }), bilan: bilan, periode_jours: 120 };
}

function chargerRapprochementsStripe() {
  var paiements = paiementsStripe();
  importerPaiementsStripe(paiements);
  // Les anciens règlements associés sont aussi revérifiés, par lots repris à
  // l'appel suivant ou par le déclencheur horaire, sans limite d'ancienneté.
  var synchronisation = synchroniserStripeLot();
  var demandes = supabaseLireTout('demandes?select=*&order=id.asc');
  var registre = supabaseLireTout('crm_paiements_stripe?select=*&order=session_id.asc');
  var liste = preparerRapprochements(paiements, demandes, registre);
  liste.paiements.forEach(function (p) {
    if (p.statut !== 'propose' && p.statut !== 'ambigu') { return; }
    var etat = actualiserPaiementStripe(p).snapshot;
    p.rembourse_centimes = etat.rembourse_centimes;
    p.en_attente_centimes = etat.en_attente_centimes;
    p.conteste = etat.conteste;
    if (etat.rembourse_centimes || etat.en_attente_centimes || etat.conteste) {
      liste.bilan[p.statut === 'propose' ? 'proposes' : 'ambigus']--;
      liste.bilan.sans_correspondance++;
      p.statut = 'sans_correspondance';
      p.raison = 'Paiement remboursé, en cours de remboursement ou contesté dans Stripe.';
      delete p.demande_id; delete p.nature;
    }
  });
  liste.propositions = liste.paiements.filter(function (p) { return p.statut === 'propose'; });
  liste.synchronisation = synchronisation;
  return liste;
}

function appliquerPaiementStripe(demandeId, sessionId, acteur) {
  var paiement = paiementDepuisSession(stripeRequete('/' + encodeURIComponent(sessionId)));
  if (!paiement || paiement.session_id !== sessionId) {
    throw erreurService('paiement_non_eligible', 'Ce paiement Stripe n’est pas un règlement EUR encaissé en production.');
  }
  importerPaiementsStripe([paiement]);
  var etat = actualiserPaiementStripe(paiement).snapshot;
  if (etat.rembourse_centimes || etat.en_attente_centimes || etat.conteste) {
    throw erreurService('paiement_rembourse_ou_conteste', 'Ce règlement est remboursé, en attente de remboursement ou contesté. Aucun rapprochement n’a été effectué.');
  }
  var resultat = supabaseRequete('rpc/crm_appliquer_paiement_stripe', 'post', {
    p_demande_id: demandeId, p_session_id: sessionId, p_acteur: acteur
  });
  if (!resultat || resultat.ok !== true || !resultat.demande || !resultat.paiement) {
    throw erreurService('rapprochement_non_confirme', 'La base n’a pas confirmé le rapprochement. Rechargez les paiements.');
  }
  return resultat;
}

/* Le navigateur choisit un couple proposé ; le serveur relit Stripe et la
   base, puis la RPC contrôle à nouveau l'état sous verrou transactionnel. */
function traiterStripe(d) {
  try {
    if (!supabasePret()) { throw erreurService('supabase_non_configuree', 'La connexion Supabase n’est pas configurée.'); }
    if (!adminDepuisJeton(String(d.jeton || ''))) { throw erreurService('acces_refuse', 'Reconnectez-vous avec un compte académie.'); }
    return reponseTexte(JSON.stringify(chargerRapprochementsStripe()));
  } catch (e) { return reponseErreurCRM(e); }
}

function traiterRapprochementStripe(d) {
  try {
    if (!supabasePret()) { throw erreurService('supabase_non_configuree', 'La connexion Supabase n’est pas configurée.'); }
    var admin = adminDepuisJeton(String(d.jeton || ''));
    if (!admin) { throw erreurService('acces_refuse', 'Reconnectez-vous avec un compte académie.'); }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(d.demande_id || '')) ||
        !/^cs_[A-Za-z0-9_]+$/.test(String(d.session_id || ''))) {
      throw erreurService('identifiants_invalides', 'L’identifiant du dossier ou du paiement est invalide.');
    }
    var propositions = chargerRapprochementsStripe();
    var candidat = propositions.paiements.filter(function (p) { return p.session_id === d.session_id; })[0];
    if (!candidat || candidat.demande_id !== d.demande_id ||
        (candidat.statut !== 'propose' && candidat.statut !== 'deja_rapproche')) {
      throw erreurService('rapprochement_ambigu', 'Le rapprochement n’est plus certain. Actualisez puis vérifiez les dossiers et Stripe.');
    }
    return reponseTexte(JSON.stringify(appliquerPaiementStripe(d.demande_id, d.session_id, admin)));
  } catch (e) { return reponseErreurCRM(e); }
}

/* ============ Remboursements Stripe réels (CRM v24) ============ */
function remboursementsStripeActifs() {
  return PropertiesService.getScriptProperties().getProperty('STRIPE_REMBOURSEMENTS_ACTIFS') === 'true';
}

function uuidCRM(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
}

function idStripe(objet) { return typeof objet === 'string' ? objet : objet && objet.id || ''; }

function verifierIdentifiantStripe(valeur, prefixe) {
  if (!new RegExp('^' + prefixe + '_[A-Za-z0-9_]+$').test(String(valeur || ''))) {
    throw erreurService('stripe_identifiant_invalide', 'Un identifiant Stripe est absent ou invalide.');
  }
  return valeur;
}

function remboursementsDeChargeStripe(chargeId) {
  var lignes = [], vus = {}, curseurs = {}, curseur = '';
  for (var page = 0; page < 1000; page++) {
    var rep = stripeApi('/refunds?charge=' + encodeURIComponent(chargeId) + '&limit=100' +
      (curseur ? '&starting_after=' + encodeURIComponent(curseur) : ''));
    if (!rep || !Array.isArray(rep.data) || typeof rep.has_more !== 'boolean') {
      throw erreurService('stripe_reponse_invalide', 'La liste des remboursements est illisible.');
    }
    rep.data.forEach(function (r) {
      verifierIdentifiantStripe(r && r.id, 're');
      var empreinte = JSON.stringify([r.amount, r.status, r.created, r.currency,
        idStripe(r.charge), idStripe(r.payment_intent), r.reason || null,
        r.metadata && r.metadata.crm_operation_id || null, r.metadata && r.metadata.crm_session_id || null]);
      if (vus[r.id] && vus[r.id] !== empreinte) {
        throw erreurService('stripe_remboursement_modifie', 'Un remboursement a changé pendant la lecture. Actualisez avant toute opération.');
      }
      if (!vus[r.id]) { lignes.push(r); vus[r.id] = empreinte; }
    });
    if (!rep.has_more) { return lignes; }
    var dernier = rep.data.length ? rep.data[rep.data.length - 1].id : '';
    if (!dernier || curseurs[dernier]) { throw erreurService('stripe_pagination_incomplete', 'La liste des remboursements est incomplète.'); }
    curseurs[dernier] = true; curseur = dernier;
  }
  throw erreurService('stripe_pagination_limite', 'La liste des remboursements dépasse la limite de lecture. Aucun remboursement n’a été demandé.');
}

function normaliserRemboursementStripe(r, sessionId, paymentIntentId, chargeId) {
  var statuts = ['succeeded', 'pending', 'requires_action', 'failed', 'canceled'];
  if (!r || idStripe(r.charge) !== chargeId || idStripe(r.payment_intent) !== paymentIntentId ||
      r.currency !== 'eur' || !Number.isSafeInteger(r.amount) || r.amount <= 0 ||
      statuts.indexOf(r.status) === -1 || !Number.isFinite(r.created) || r.created <= 0) {
    throw erreurService('stripe_remboursement_incoherent', 'Stripe a renvoyé un remboursement qui ne correspond pas au paiement vérifié.');
  }
  verifierIdentifiantStripe(r.id, 're');
  var operationId = r.metadata && r.metadata.crm_operation_id;
  var sessionMeta = r.metadata && r.metadata.crm_session_id;
  return { id: r.id, montant_centimes: r.amount, statut: r.status,
    cree_le: new Date(r.created * 1000).toISOString(), motif: r.reason || null,
    payment_intent_id: paymentIntentId, charge_id: chargeId,
    operation_id: uuidCRM(operationId) && sessionMeta === sessionId ? operationId : null };
}

function verifierChargeStripe(charge, paymentIntentId, chargeId, montant) {
  if (!charge || charge.id !== chargeId || idStripe(charge.payment_intent) !== paymentIntentId ||
      charge.livemode !== true || charge.currency !== 'eur' || charge.paid !== true ||
      charge.captured !== true || charge.status !== 'succeeded' ||
      charge.amount !== montant || charge.amount_captured !== montant ||
      !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > montant ||
      typeof charge.disputed !== 'boolean') {
    throw erreurService('stripe_charge_incompatible', 'La charge Stripe ne correspond pas au montant encaissé du registre.');
  }
}

/* Une relation session → PaymentIntent → charge est relue directement chez
   Stripe. L'adresse e-mail n'est jamais utilisée pour autoriser un remboursement.
   Les deux lectures de charge détectent un remboursement/dispute intervenu
   pendant la pagination ; une incohérence bloque les nouvelles opérations. */
function lireSnapshotStripe(paiement) {
  var debutLecture = new Date().toISOString();
  verifierIdentifiantStripe(paiement.session_id, 'cs');
  var sess = stripeRequete('/' + encodeURIComponent(paiement.session_id));
  if (!sess || sess.id !== paiement.session_id || sess.livemode !== true || sess.mode !== 'payment' ||
      sess.status !== 'complete' || sess.payment_status !== 'paid' || sess.currency !== 'eur' ||
      sess.amount_total !== Number(paiement.montant_centimes)) {
    throw erreurService('stripe_session_incompatible', 'La session Stripe ne correspond pas au règlement enregistré.');
  }
  var piId = verifierIdentifiantStripe(idStripe(sess.payment_intent), 'pi');
  var pi = stripeApi('/payment_intents/' + encodeURIComponent(piId));
  if (!pi || pi.id !== piId || pi.livemode !== true || pi.currency !== 'eur' || pi.status !== 'succeeded' ||
      pi.amount !== sess.amount_total || pi.amount_received !== sess.amount_total) {
    throw erreurService('stripe_intent_incompatible', 'Le paiement Stripe n’est pas intégralement encaissé en euros.');
  }
  var chargeId = verifierIdentifiantStripe(idStripe(pi.latest_charge), 'ch');
  var charge = stripeApi('/charges/' + encodeURIComponent(chargeId));
  verifierChargeStripe(charge, piId, chargeId, sess.amount_total);
  var remboursements = remboursementsDeChargeStripe(chargeId).map(function (r) {
    return normaliserRemboursementStripe(r, paiement.session_id, piId, chargeId);
  });
  var actuelle = stripeApi('/charges/' + encodeURIComponent(chargeId));
  verifierChargeStripe(actuelle, piId, chargeId, sess.amount_total);
  if (charge.amount_refunded !== actuelle.amount_refunded || charge.disputed !== actuelle.disputed) {
    throw erreurService('stripe_etat_modifie', 'Le paiement vient de changer dans Stripe. Actualisez avant toute opération.');
  }
  var rembourse = 0, enAttente = 0;
  remboursements.forEach(function (r) {
    if (r.statut === 'succeeded') { rembourse += r.montant_centimes; }
    if (r.statut === 'pending' || r.statut === 'requires_action') { enAttente += r.montant_centimes; }
  });
  if (rembourse + enAttente > sess.amount_total || actuelle.amount_refunded < rembourse ||
      actuelle.amount_refunded > rembourse + enAttente) {
    throw erreurService('stripe_solde_incoherent', 'Le détail Stripe et le total remboursé ne concordent pas. Aucun nouveau remboursement n’est autorisé.');
  }
  return { payment_intent_id: piId, charge_id: chargeId, montant_centimes: sess.amount_total,
    rembourse_centimes: rembourse, en_attente_centimes: enAttente, conteste: actuelle.disputed,
    devise: 'eur', livemode: true, verifie_le: debutLecture, fetched_at: debutLecture,
    remboursements: remboursements };
}

function enregistrerSnapshotStripe(paiement, snapshot) {
  var resultat = supabaseRequete('rpc/crm_enregistrer_snapshot_stripe', 'post', {
    p_session_id: paiement.session_id, p_snapshot: snapshot
  });
  if (!resultat || resultat.ok !== true) { throw erreurService('stripe_sync_non_confirmee', 'La base n’a pas confirmé la synchronisation Stripe.'); }
  return resultat;
}

function actualiserPaiementStripe(paiement) {
  var snapshot = lireSnapshotStripe(paiement);
  var resultat = enregistrerSnapshotStripe(paiement, snapshot);
  return { snapshot: snapshot, resultat: resultat };
}

function exigerAdminStripe(jeton) {
  if (!supabasePret()) { throw erreurService('supabase_non_configuree', 'La connexion Supabase n’est pas configurée.'); }
  var admin = adminDepuisJeton(String(jeton || ''));
  if (!admin) { throw erreurService('acces_refuse', 'Reconnectez-vous avec un compte académie.'); }
  return admin;
}

function paiementsDuDossierStripe(demandeId) {
  if (!uuidCRM(demandeId)) { throw erreurService('identifiants_invalides', 'L’identifiant du dossier est invalide.'); }
  return supabaseLireTout('crm_paiements_stripe?select=*&demande_id=eq.' + encodeURIComponent(demandeId) + '&order=session_id.asc');
}

function operationReprenableStripe(op) {
  var age = Date.now() - new Date(op && op.cree_le).getTime();
  return !!op && !op.stripe_refund_id && ['reserve', 'incertain'].indexOf(op.statut) !== -1 &&
    Number.isFinite(age) && age >= -5 * 60 * 1000 && age < 23 * 3600 * 1000;
}

function presenterPaiementStripe(paiement, actualisation) {
  var resultat = actualisation.resultat, s = actualisation.snapshot;
  var remboursements = (resultat.remboursements || s.remboursements).map(function (r) {
    return { id: r.id || r.refund_id, montant_centimes: Number(r.montant_centimes), statut: r.statut,
      cree_le: r.cree_le, motif: r.motif || null, operation_id: r.operation_id || null };
  });
  var enCours = (resultat.operations || []).filter(function (o) {
    return ['reserve', 'incertain', 'pending', 'requires_action'].indexOf(o.statut) !== -1;
  });
  enCours.sort(function (a, b) {
    var ordreA = ['reserve', 'incertain'].indexOf(a.statut) !== -1 ? 0 : 1;
    var ordreB = ['reserve', 'incertain'].indexOf(b.statut) !== -1 ? 0 : 1;
    return ordreA - ordreB || String(a.cree_le).localeCompare(String(b.cree_le));
  });
  var operation = enCours[0];
  var presentation = { session_id: paiement.session_id, nature: paiement.nature,
    payment_intent_id: s.payment_intent_id, montant_centimes: s.montant_centimes,
    rembourse_centimes: s.rembourse_centimes, en_attente_centimes: s.en_attente_centimes,
    disponible_centimes: Number(resultat.disponible_centimes || 0), conteste: s.conteste,
    verifie_le: s.verifie_le, remboursements: remboursements };
  if (operation) {
    presentation.operation_en_cours = { operation_id: operation.operation_id, montant_centimes: Number(operation.montant_centimes),
      motif: operation.motif, statut: operation.statut, cree_le: operation.cree_le,
      reprise_possible: operationReprenableStripe(operation) && !s.conteste && !s.en_attente_centimes && remboursementsStripeActifs() };
  }
  return presentation;
}

function chargerEtatRemboursementsStripe(demandeId) {
  var paiements = paiementsDuDossierStripe(demandeId).map(function (p) {
    return presenterPaiementStripe(p, actualiserPaiementStripe(p));
  });
  var resume = { rembourse_centimes: 0, en_attente_centimes: 0 };
  paiements.forEach(function (p) { resume.rembourse_centimes += p.rembourse_centimes; resume.en_attente_centimes += p.en_attente_centimes; });
  return { ok: true, version: 24, remboursements_actifs: remboursementsStripeActifs(), paiements: paiements, resume: resume };
}

function verrouillerStripe() {
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(10000)) { throw erreurService('stripe_operation_en_cours', 'Une opération Stripe est déjà en cours. Actualisez dans un instant.'); }
  return verrou;
}

function traiterEtatRemboursementsStripe(d) {
  var verrou;
  try {
    exigerAdminStripe(d.jeton);
    verrou = verrouillerStripe();
    return reponseTexte(JSON.stringify(chargerEtatRemboursementsStripe(d.demande_id)));
  } catch (e) { return reponseErreurCRM(e); }
  finally { if (verrou) { verrou.releaseLock(); } }
}

function resultatRemboursementStripe(demandeId, operation, remboursement) {
  var resultat;
  try { resultat = chargerEtatRemboursementsStripe(demandeId); }
  catch (e) { resultat = { version: 24, remboursements_actifs: remboursementsStripeActifs(), actualisation_incomplete: true }; }
  resultat.ok = remboursement.statut === 'succeeded';
  resultat.operation_id = operation.operation_id;
  resultat.operation = operation;
  resultat.operation_statut = remboursement.statut;
  resultat.operation_reservee = true;
  resultat.remboursement = { id: remboursement.id || remboursement.refund_id,
    montant_centimes: Number(remboursement.montant_centimes), statut: remboursement.statut };
  if (!resultat.ok) {
    resultat.code = remboursement.statut === 'failed' ? 'remboursement_echoue' : remboursement.statut === 'canceled'
      ? 'remboursement_annule' : remboursement.statut === 'requires_action' ? 'remboursement_action_requise' : 'remboursement_en_attente';
    resultat.message = remboursement.statut === 'failed' ? 'Stripe indique que le remboursement a échoué. Aucun succès n’est confirmé.' :
      remboursement.statut === 'canceled' ? 'Ce remboursement a été annulé dans Stripe.' :
      'Le remboursement est enregistré dans Stripe mais n’est pas encore terminé. Actualisez son état, sans créer une nouvelle opération.';
  }
  return reponseTexte(JSON.stringify(resultat));
}

function traiterRemboursementStripe(d) {
  var verrou, operation, tentativeReservation = false, postTente = false, avantPost;
  try {
    var admin = exigerAdminStripe(d.jeton);
    if (!uuidCRM(d.demande_id) || !uuidCRM(d.operation_id) ||
        !/^cs_[A-Za-z0-9_]+$/.test(String(d.session_id || '')) ||
        !Number.isSafeInteger(d.montant_centimes) || d.montant_centimes <= 0 ||
        ['requested_by_customer', 'duplicate', 'fraudulent'].indexOf(d.motif) === -1) {
      throw erreurService('remboursement_invalide', 'Vérifiez le dossier, le règlement, le montant en centimes et le motif.');
    }
    if (!remboursementsStripeActifs()) { throw erreurService('remboursements_desactives', 'Les remboursements Stripe ne sont pas activés dans le service.'); }
    verrou = verrouillerStripe();
    var paiement = paiementsDuDossierStripe(d.demande_id).filter(function (p) { return p.session_id === d.session_id; })[0];
    if (!paiement) { throw erreurService('paiement_non_associe', 'Ce paiement Stripe n’est pas affecté à ce dossier.'); }
    var actualisation = actualiserPaiementStripe(paiement), snapshot = actualisation.snapshot;
    tentativeReservation = true;
    var reservation = supabaseRequete('rpc/crm_reserver_remboursement_stripe', 'post', {
      p_operation_id: d.operation_id, p_demande_id: d.demande_id, p_session_id: d.session_id,
      p_montant_centimes: d.montant_centimes, p_motif: d.motif, p_acteur: admin
    });
    operation = reservation && reservation.operation;
    if (!reservation || reservation.ok !== true || !operation || operation.operation_id !== d.operation_id ||
        operation.session_id !== d.session_id || operation.demande_id !== d.demande_id ||
        Number(operation.montant_centimes) !== d.montant_centimes || operation.motif !== d.motif) {
      throw erreurService('reservation_non_confirmee', 'La réservation du remboursement n’a pas été confirmée. Conservez le même identifiant d’opération.');
    }
    var connu = snapshot.remboursements.filter(function (r) {
      return r.operation_id === d.operation_id || (operation.stripe_refund_id && r.id === operation.stripe_refund_id);
    });
    if (connu.length > 1) { throw erreurService('remboursement_incoherent', 'Plusieurs remboursements portent cet identifiant d’opération. Vérifiez Stripe.'); }
    if (connu.length) {
      if (connu[0].montant_centimes !== d.montant_centimes || connu[0].motif !== d.motif) {
        throw erreurService('remboursement_incoherent', 'Le remboursement retrouvé ne correspond pas à l’opération réservée.');
      }
      return resultatRemboursementStripe(d.demande_id, operation, connu[0]);
    }
    if (operation.stripe_refund_id || !operationReprenableStripe(operation) || reservation.execution_autorisee !== true) {
      throw erreurService('remboursement_verification_manuelle', 'Cette opération ne peut plus être relancée automatiquement. Vérifiez le remboursement dans Stripe ; aucune nouvelle demande n’a été envoyée.');
    }
    if (snapshot.conteste || snapshot.en_attente_centimes > 0) {
      throw erreurService('remboursement_paiement_bloque', 'Un litige ou un remboursement en attente bloque ce règlement.');
    }
    // Une même UUID produit toujours exactement la même requête et la même clé.
    // Passé 23 h, seule la recherche par metadata est autorisée : la clé Stripe
    // pourrait expirer au bout de 24 h et ne protégerait plus un second POST.
    avantPost = new Date().toISOString();
    postTente = true;
    var brutRefund = stripeApi('/refunds', 'post', { charge: snapshot.charge_id,
      amount: d.montant_centimes, reason: d.motif,
      'metadata[crm_operation_id]': d.operation_id, 'metadata[crm_session_id]': d.session_id
    }, 'av-crm-refund-' + d.operation_id);
    var remboursement = normaliserRemboursementStripe(brutRefund, d.session_id, snapshot.payment_intent_id, snapshot.charge_id);
    if (remboursement.operation_id !== d.operation_id || remboursement.montant_centimes !== d.montant_centimes || remboursement.motif !== d.motif) {
      throw erreurService('remboursement_incoherent', 'La réponse Stripe ne correspond pas au remboursement demandé.');
    }
    remboursement.verifie_le = avantPost;
    var finalisation = supabaseRequete('rpc/crm_terminer_remboursement_stripe', 'post', {
      p_operation_id: d.operation_id, p_refund: remboursement
    });
    if (!finalisation || finalisation.ok !== true) { throw erreurService('remboursement_non_confirme', 'Stripe a répondu mais le registre n’a pas confirmé l’opération.'); }
    operation = finalisation.operation || Object.assign({}, operation, { statut: remboursement.statut, stripe_refund_id: remboursement.id });
    return resultatRemboursementStripe(d.demande_id, operation, remboursement);
  } catch (e) {
    if (postTente) {
      try {
        var suivi = supabaseRequete('rpc/crm_terminer_remboursement_stripe', 'post', {
          p_operation_id: d.operation_id, p_refund: { statut: 'incertain', verifie_le: avantPost }
        });
        if (suivi && suivi.operation) { operation = suivi.operation; }
      } catch (ignore) { /* La réservation persistante continue à bloquer toute nouvelle UUID. */ }
      e = erreurService('remboursement_incertain', 'La réponse du remboursement n’est pas confirmée. Actualisez Stripe et conservez le même identifiant d’opération ; ne créez pas un second remboursement.');
    }
    var erreur = { ok: false, code: e && e.code || 'service_indisponible', message: e && e.code ? e.message : 'Le service n’a pas pu confirmer l’opération.' };
    if (uuidCRM(d.operation_id)) { erreur.operation_id = d.operation_id; }
    erreur.operation_reservee = tentativeReservation;
    if (operation) { erreur.operation = operation; erreur.operation_statut = operation.statut; }
    return reponseTexte(JSON.stringify(erreur));
  } finally { if (verrou) { verrou.releaseLock(); } }
}

/* Synchronisation horaire par lots : inclut les règlements associés anciens,
   même hors fenêtre de 120 jours. Le curseur est enregistré après chaque succès.
   Une session en erreur bloque le lot et sera reprise au prochain passage ;
   vérifier l'échec Google avant de considérer le cycle complet.
   Cette fonction ne contient jamais de création de remboursement. */
function synchroniserStripeLot() {
  var proprietes = PropertiesService.getScriptProperties();
  var curseur = proprietes.getProperty('STRIPE_SYNC_CURSOR') || '';
  if (curseur) { verifierIdentifiantStripe(curseur, 'cs'); }
  var lignes = supabaseLire('crm_paiements_stripe?select=*&demande_id=not.is.null&order=session_id.asc&limit=20' +
    (curseur ? '&session_id=gt.' + encodeURIComponent(curseur) : ''));
  var fin = Date.now() + 4 * 60 * 1000, traites = 0;
  for (var i = 0; i < lignes.length && Date.now() < fin; i++) {
    actualiserPaiementStripe(lignes[i]);
    proprietes.setProperty('STRIPE_SYNC_CURSOR', lignes[i].session_id);
    traites++;
  }
  if (traites === lignes.length && lignes.length < 20) { proprietes.setProperty('STRIPE_SYNC_CURSOR', ''); }
  return { synchronises: traites, cycle_termine: traites === lignes.length && lignes.length < 20 };
}

function synchroniserStripe() {
  var verrou = verrouillerStripe();
  try { var resultat = synchroniserStripeLot(); Logger.log(JSON.stringify(resultat)); return resultat; }
  finally { verrou.releaseLock(); }
}

function installerSynchronisationStripe() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'synchroniserStripe') { ScriptApp.deleteTrigger(t); }
  });
  ScriptApp.newTrigger('synchroniserStripe').timeBased().everyHours(1).create();
  Logger.log('Synchronisation Stripe horaire installée. Aucun remboursement automatique.');
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
  if (!supabasePret()) { throw erreurService('supabase_non_configuree', 'Configurer Supabase avant la routine.'); }
  // Si Stripe échoue, ne pas relancer des familles dont le paiement pourrait
  // être reçu mais non synchronisé. L'échec apparaît dans les exécutions Google.
  var bilan = rapprocherStripeAuto();
  relancesAuto(bilan.demandes_a_verifier);
  rappelsVeille();
  Logger.log('Routine terminée : ' + JSON.stringify(bilan));
  return bilan;
}

function montantDe(texte) {
  return centimesDe(texte) / 100;
}

function isoDe(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

/* 1. Même registre et même RPC que le bouton du CRM. Une ambiguïté
   (fratrie, doublon, paiement historique) ne modifie aucun dossier. */
function rapprocherStripeAuto() {
  var liste = chargerRapprochementsStripe(), appliques = 0, aVerifier = {};
  liste.paiements.forEach(function (p) {
    if (p.statut === 'ambigu') {
      p.candidats.forEach(function (c) { aVerifier[c.demande_id] = true; });
    }
  });
  liste.propositions.forEach(function (p) {
    var resultat = appliquerPaiementStripe(p.demande_id, p.session_id, 'routine');
    if (!resultat.deja_rapproche) { appliques++; }
  });
  return { appliques: appliques, ambigus: liste.bilan.ambigus,
    sans_correspondance: liste.bilan.sans_correspondance, demandes_a_verifier: Object.keys(aVerifier) };
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
function relancesAuto(demandesAVerifier) {
  var lignes = supabaseLireTout('demandes?select=*&type=eq.stage&statut=eq.' + encodeURIComponent('validée') + '&annule=eq.false&order=id.asc');
  var jour = isoDe(new Date());
  var maintenant = new Date();
  lignes.forEach(function (d) {
    // Ne pas relancer un dossier auquel un paiement ambigu pourrait appartenir.
    if ((demandesAVerifier || []).indexOf(d.id) !== -1) { return; }
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
  var lignes = supabaseLireTout('demandes?select=parent_email,enfant,cours_heure&type=eq.cours&statut=eq.' +
    encodeURIComponent('validée') + '&annule=eq.false&cours_date=eq.' + isoDe(demain) + '&order=id.asc');
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
  if (r.code.indexOf('ok ') !== 0) { return reponseTexte(r.code + (r.texte ? ';' + r.texte : '')); }
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
  // Deux inscriptions identiques restent deux décisions distinctes.
  var contenu = Object.assign({}, obj, { nonce: Utilities.getUuid() });
  var d = Utilities.base64EncodeWebSafe(JSON.stringify(contenu));
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
