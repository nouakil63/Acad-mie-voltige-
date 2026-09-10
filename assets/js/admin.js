/* Espace académie — la plateforme d'administration (dossier /admin/).
   Réservée aux comptes de la liste « admins » (Supabase) :
   - Les demandes : valider ou refuser en un clic, télécharger le
     dossier d'inscription rempli.
   - Les cours : les familles ne choisissent plus leurs dates. Fleur
     appelle, note la date et l'heure sur la demande, et la plateforme
     envoie aux parents les infos du cours avec le lien de paiement.
   - Le planning des cours planifiés et des stages.
   - La base clients : les comptes familles et les notes. */
(function () {
  'use strict';

  var nuage = window.AVNuage;
  if (!nuage) { return; }

  var SERVICE = window.AV_SERVICE_URL ||
    'https://script.google.com/macros/s/AKfycbyDW_h6BmR4QpKs1l_917hrml-CUjDQCb-GdyNEPfLufxDhgPwsCRP9Wxwnnk-ByZc/exec';

  var MOTIFS = { complet: 'Complet', age: 'Âge', gabarit: 'Gabarit', creneau: 'Créneau indisponible' };
  var VUES = ['p-attente', 'p-connexion', 'p-refuse', 'p-tableau'];
  var ACOMPTE_STAGE = 300;   /* euros, dus a l'inscription ; solde 30 jours avant le stage */
  var CAPACITE_COURS = 8;    /* places par cours (dites-le a Claude pour changer) */
  /* MERCREDI EN PAUSE : les cours ont lieu le samedi pour l'instant.
     Pour revenir au mercredi : JOUR_COURS = 3 et NOM_JOUR_COURS = 'mercredi'. */
  var JOUR_COURS = 6;
  var NOM_JOUR_COURS = 'samedi';

  function el(id) { return document.getElementById(id); }
  function montrer(vue) {
    VUES.forEach(function (id) {
      var e = el(id);
      if (e) { e.classList.toggle('actif', id === vue); }
    });
    document.body.classList.toggle('connecte', vue === 'p-tableau');
  }
  function message(id, texte, bonne) {
    var m = el(id);
    if (!m) { return; }
    m.textContent = texte;
    m.className = 'message ' + (bonne ? 'bonne' : 'souci');
    m.hidden = false;
  }

  var demandes = [];
  var familles = [];
  var core = window.AVCrmCore;
  var ui = window.AVCrmUI;
  var notesDisponibles = false;
  var operations = new Set();
  var chargements = 0;
  var versionDemandes = 0, versionFamilles = 0;
  var erreurDemandes = false, erreurFamilles = false;

  function notifier(texte, erreur) { ui.toast(texte, { error: !!erreur }); }
  function confirmer(texte, danger) {
    return ui.confirm({ title: danger ? 'Confirmer cette action' : 'Vérifier avant de continuer',
      description: texte, submitLabel: 'Confirmer', danger: !!danger });
  }
  function rafraichirAffichage() {
    afficherDemandes(); afficherPaiements(); afficherPlanning(); majCompteurs();
  }
  function statutSynchro() {
    var statut = el('crm-sync-status'), bouton = el('crm-refresh');
    if (bouton) { bouton.disabled = chargements > 0; }
    if (!statut) { return; }
    statut.dataset.state = chargements ? 'loading' : erreurDemandes || erreurFamilles ? 'error' : 'ready';
    statut.textContent = chargements ? 'Actualisation en cours…' : erreurDemandes || erreurFamilles
      ? 'Actualisation incomplète — réessayez' : 'À jour à ' + new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
    statut.classList.toggle('est-erreur', !chargements && (erreurDemandes || erreurFamilles));
  }
  async function operation(cle, action) {
    if (operations.has(cle)) { return null; }
    operations.add(cle);
    try { return await action(); }
    catch (erreur) { notifier(erreur.message || 'L’action n’a pas abouti. Réessayez.', true); return null; }
    finally { operations.delete(cle); }
  }
  async function reponseJson(r, messageErreur) {
    if (!r || !r.ok) {
      var detail = '';
      if (r) { try { detail = (await r.json()).message || ''; } catch (_) {} }
      var erreurs = {
        cours_date_invalide:'La date du cours est invalide.',
        cours_date_passee:'Choisissez une date de cours à venir.',
        cours_samedi_uniquement:'Les cours ont lieu le samedi.',
        cours_heure_invalide:'Indiquez une heure de cours valide.',
        cours_complet:'Ce créneau est complet. Actualisez puis choisissez un autre horaire.'
      };
      throw new Error(erreurs[detail] || messageErreur || 'L’enregistrement a échoué. Vérifiez votre connexion et vos droits.');
    }
    return r.json();
  }
  async function appelService(corps, json) {
    var session = await nuage.sessionValide();
    if (!session) { throw new Error('Votre session a expiré. Reconnectez-vous.'); }
    var controle = new AbortController();
    var delai = setTimeout(function () { controle.abort(); }, 45000);
    try {
      var r = await fetch(SERVICE, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify(Object.assign({}, corps, {jeton:session.jeton})), signal:controle.signal });
      if (!r.ok) { throw new Error('Le service est indisponible. Réessayez dans un instant.'); }
      var texte = await r.text();
      if (!json) { return texte.trim(); }
      var donnees;
      try { donnees = JSON.parse(texte); } catch (_) { throw new Error('Cette fonction nécessite la mise à jour du service CRM. Contactez la personne qui gère le site.'); }
      if (!donnees.ok) { throw new Error(donnees.message || 'Le service n’a pas pu terminer cette action.'); }
      return donnees;
    } catch (erreur) {
      if (erreur.name === 'AbortError') { throw new Error('Le service met trop de temps à répondre. Actualisez les données avant de réessayer.'); }
      throw erreur;
    } finally { clearTimeout(delai); }
  }
  async function creerDemande(ligne) {
    var lignes = await reponseJson(await nuage.requeteAuth('/rest/v1/demandes', {
      method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(ligne)
    }));
    if (!lignes || !lignes[0]) { throw new Error('La demande n’a pas été enregistrée. Actualisez puis réessayez.'); }
    demandes.unshift(lignes[0]); rafraichirAffichage();
    notifier('Demande enregistrée.');
    return lignes[0];
  }
  function demandesVisibles() {
    return core.filterRequests(demandes, {query:filtreTexte,status:filtre,
      type:el('f-type') ? el('f-type').value : 'tous',
      followup:el('f-suivi') ? el('f-suivi').value : 'tous',
      sort:el('f-tri') ? el('f-tri').value : 'recent'});
  }
  function allerDemande(d) {
    ouvrirOnglet('demandes'); filtre = 'toutes'; filtreTexte = d.enfant || d.parent_email || '';
    el('d-recherche').value = filtreTexte;
    ['f-type','f-suivi'].forEach(function (id) { if (el(id)) { el(id).value = 'tous'; } });
    el('a-filtres').querySelectorAll('[data-filtre]').forEach(function (b) {
      b.classList.toggle('actif-filtre', b.dataset.filtre === 'toutes'); b.setAttribute('aria-pressed', String(b.dataset.filtre === 'toutes'));
    });
    afficherDemandes(); el('d-recherche').focus();
  }
  var filtre = 'toutes';
  var filtreTexte = '';

  /* Les cours vus depuis les demandes : une demande de cours validée est
     « à appeler » tant que Fleur n'a pas noté la date, « planifiée » ensuite. */
  function estCours(d) {
    return d.type !== 'stage' && classeStatut(d.statut) === 'validee' && !d.annule;
  }
  function coursAVenir() {
    var aujourdHui = isoLocal(new Date());
    return demandes.filter(function (d) { return estCours(d) && d.cours_date && d.cours_date >= aujourdHui; });
  }
  function coursAPlanifier() {
    return demandes.filter(function (d) { return estCours(d) && !d.cours_date; });
  }

  function classeStatut(statut) {
    if (statut === 'validée') { return 'validee'; }
    if (String(statut || '').indexOf('refusée') === 0) { return 'refusee'; }
    return 'attente';
  }

  function quandLisible(iso) {
    if (!iso) { return ''; }
    var d = new Date(iso);
    return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function jourLisible(iso) {
    var m = String(iso).split('-');
    return new Date(Number(m[0]), Number(m[1]) - 1, Number(m[2]), 12)
      .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function isoLocal(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function majCompteurs() {
    el('c-demandes').textContent = String(demandes.length);
    el('c-attente').textContent = String(demandes.filter(function (d) { return classeStatut(d.statut) === 'attente'; }).length);
    el('c-familles').textContent = String(familles.length);
    el('c-resa').textContent = String(coursAVenir().length);
    el('c-encaisser').textContent = String(demandes.filter(function (d) { return resteAEncaisser(d) > 0; }).length);
    afficherAccueil();
  }

  /* ================= Le tableau de bord d'accueil ================= */
  function debutStageDetail(detail) {
    var MOIS = { janvier: 0, fevrier: 1, 'février': 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, 'août': 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11, 'décembre': 11 };
    var t = String(detail || '').toLowerCase();
    var m = t.match(/du\s+(\d{1,2})\s+au\s+\d{1,2}\s+([a-zà-ÿ]+)\s+(\d{4})/) || t.match(/(\d{1,2})\s+([a-zà-ÿ]+)\s+(\d{4})/);
    if (!m || MOIS[m[2]] == null) { return null; }
    return new Date(Number(m[3]), MOIS[m[2]], Number(m[1]), 12);
  }

  function afficherAccueil() {
    var tuiles = el('t-tuiles');
    if (!tuiles) { return; }
    var maintenant = new Date();
    var moisCourant = maintenant.getFullYear() + '-' + String(maintenant.getMonth() + 1).padStart(2, '0');
    var aujourdHui = isoLocal(maintenant);

    var encaisseMois = 0, encaisseTotal = 0, resteTotal = 0, revenusCours = 0, revenusStages = 0, rembourseTotal = 0;
    var validees = 0, reglees = 0;
    demandes.forEach(function (d) {
      var recu = dejaEncaisse(d);
      rembourseTotal += core.money(d.rembourse_montant);
      encaisseTotal += recu;
      resteTotal += resteAEncaisser(d);
      if (d.type === 'stage') { revenusStages += recu; } else { revenusCours += recu; }
      encaisseMois += core.receivedInMonth(d, moisCourant);
      if (!d.annule && classeStatut(d.statut) === 'validee') { validees++; if (recu > 0) { reglees++; } }
    });

    tuiles.innerHTML = '';
    function tuile(valeur, etiquette, douce) {
      var t = document.createElement('div');
      t.className = 'tuile' + (douce ? ' douce' : '');
      var b = document.createElement('b');
      b.textContent = valeur;
      t.appendChild(b);
      var sp = document.createElement('span');
      sp.textContent = etiquette;
      t.appendChild(sp);
      tuiles.appendChild(t);
    }
    tuile(encaisseMois.toLocaleString('fr-FR', {maximumFractionDigits:2}) + ' €', 'encaissés bruts ce mois-ci');
    tuile(resteTotal + ' €', 'restent à encaisser');
    tuile(encaisseTotal.toLocaleString('fr-FR', {maximumFractionDigits:2}) + ' €', 'encaissés bruts en tout', true);
    tuile(rembourseTotal.toLocaleString('fr-FR', {maximumFractionDigits:2}) + ' €', 'remboursements déclarés', true);

    /* « À traiter » : tout ce qui attend un clic, avec les actions directes. */
    var lTraiter = el('l-traiter');
    if (lTraiter) {
      lTraiter.innerHTML = '';
      var enAttente = demandes.filter(function (d) { return classeStatut(d.statut) === 'attente' && !d.annule; });
      enAttente.forEach(function (d) {
        var li = document.createElement('li');
        li.textContent = (d.enfant || 'Voltigeur') + ' · ' + (d.type === 'stage' ? 'stage' : 'cours') + ' · demande à valider ou refuser';
        if (d.jeton_d && d.jeton_s) {
          li.appendChild(lienAction('Valider', function () { decider(d, 'valider', null, null); }));
        } else {
          li.appendChild(lienAction('Marquer validée', async function () {
            if (!await confirmer('Noter la demande de ' + (d.enfant || 'ce voltigeur') + ' comme validée ? (Aucun mail ne part.)')) { return; }
            patchDemande(d, { statut: 'validée', decide: new Date().toISOString() });
          }));
        }
        li.appendChild(lienAction('Ouvrir', function () { allerDemande(d); }));
        lTraiter.appendChild(li);
      });
      coursAPlanifier().forEach(function (d) {
        var li = document.createElement('li');
        li.textContent = (d.enfant || 'Voltigeur') + ' · cours validé · à appeler pour convenir du créneau';
        li.appendChild(lienAction('Appelé : envoyer date, heure et paiement', function () { planifierCours(d); }));
        lTraiter.appendChild(li);
      });
      el('b-traiter').hidden = !lTraiter.children.length;
    }

    var aRelancer = demandes.filter(function (d) {
      if (d.type !== 'stage' || classeStatut(d.statut) !== 'validee' || d.annule) { return false; }
      if (!d.acompte_paye && d.cree && (maintenant - new Date(d.cree)) > 7 * 24 * 3600 * 1000) { return true; }
      var debut = debutStageDetail(d.detail);
      return !!(d.acompte_paye && !d.solde_paye && debut && debut > maintenant && (debut - maintenant) < 45 * 24 * 3600 * 1000);
    });
    el('b-relances').hidden = !aRelancer.length;
    var lRelances = el('l-relances');
    lRelances.innerHTML = '';
    aRelancer.forEach(function (d) {
      var li = document.createElement('li');
      li.textContent = (d.enfant || 'Voltigeur') + ' · ' + (!d.acompte_paye ? 'acompte de 300 € en attente' : 'solde à réclamer (stage dans moins de 45 jours)');
      li.appendChild(lienAction('Relancer', function () { relancer(d, d.acompte_paye ? 'solde' : 'acompte'); }));
      lRelances.appendChild(li);
    });

    var lProchains = el('l-prochains');
    lProchains.innerHTML = '';
    var parJour = {};
    coursAVenir().forEach(function (d) { (parJour[d.cours_date] = parJour[d.cours_date] || []).push(d); });
    var joursPlanifies = Object.keys(parJour).sort();
    if (!joursPlanifies.length) {
      var liAucun = document.createElement('li');
      liAucun.textContent = 'Aucun cours planifié pour l’instant (les cours apparaissent ici dès que Fleur note la date après son appel).';
      lProchains.appendChild(liAucun);
    }
    joursPlanifies.slice(0, 4).forEach(function (date) {
      var n = parJour[date].length;
      var li = document.createElement('li');
      li.textContent = 'Cours du ' + jourLisible(date) + ' : ' + n + (n > 1 ? ' inscrits' : ' inscrit');
      lProchains.appendChild(li);
    });
    var parStage = {};
    demandes.forEach(function (d) {
      if (d.type === 'stage' && classeStatut(d.statut) === 'validee' && !d.annule) {
        var cle = d.detail || 'Stage';
        parStage[cle] = (parStage[cle] || 0) + 1;
      }
    });
    Object.keys(parStage).sort().forEach(function (cle) {
      var li = document.createElement('li');
      li.textContent = cle + ' : ' + parStage[cle] + (parStage[cle] > 1 ? ' inscrits' : ' inscrit');
      lProchains.appendChild(li);
    });

    var lStats = el('l-stats');
    lStats.innerHTML = '';
    [
      'Encaissé brut en tout : ' + encaisseTotal + ' € (cours et trimestres : ' + revenusCours + ' € · stages : ' + revenusStages + ' €)',
      'Remboursements déclarés : ' + rembourseTotal + ' €',
      'Cours à venir planifiés : ' + coursAVenir().length,
      validees ? 'Demandes validées réglées, au moins en partie : ' + reglees + ' sur ' + validees : 'Aucune demande validée pour l’instant.'
    ].forEach(function (texte) {
      var li = document.createElement('li');
      li.textContent = texte;
      lStats.appendChild(li);
    });
  }

  /* ================= L'export Excel (.xls, aux couleurs de l'academie) =================
     Un vrai classeur mis en forme : titre rouge, ligne d'export, en-tetes
     sur fond sombre, colonnes dimensionnees. Format SpreadsheetML, lu par
     Excel, LibreOffice et Numbers sans aucune dependance. */
  function exporterExcel(nomFichier, titreFeuille, colonnes, lignes) {
    function x(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function celluleXml(v, style) {
      var type = typeof v === 'number' && isFinite(v) ? 'Number' : 'String';
      return '<Cell ss:StyleID="' + style + '"><Data ss:Type="' + type + '">' + x(v) + '</Data></Cell>';
    }
    var n = colonnes.length;
    var xml = '<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">' +
      '<Styles>' +
      '<Style ss:ID="t"><Font ss:Bold="1" ss:Size="15" ss:Color="#D00828"/></Style>' +
      '<Style ss:ID="s"><Font ss:Size="10" ss:Color="#6D6266"/></Style>' +
      '<Style ss:ID="e"><Font ss:Bold="1" ss:Size="10" ss:Color="#FFFFFF"/><Interior ss:Color="#1D1216" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>' +
      '<Style ss:ID="c"><Font ss:Size="10"/><Alignment ss:Vertical="Top" ss:WrapText="1"/>' +
      '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E8E0DC"/></Borders></Style>' +
      '</Styles>' +
      '<Worksheet ss:Name="' + x(titreFeuille) + '"><Table>';
    colonnes.forEach(function (col) {
      xml += '<Column ss:AutoFitWidth="0" ss:Width="' + (col.largeur || 110) + '"/>';
    });
    xml += '<Row ss:Height="22"><Cell ss:StyleID="t" ss:MergeAcross="' + (n - 1) + '"><Data ss:Type="String">Académie de voltige équestre</Data></Cell></Row>';
    xml += '<Row><Cell ss:StyleID="s" ss:MergeAcross="' + (n - 1) + '"><Data ss:Type="String">' +
      x(titreFeuille + ' · exporté le ' + new Date().toLocaleDateString('fr-FR')) + '</Data></Cell></Row>';
    xml += '<Row/>';
    xml += '<Row ss:Height="20">' + colonnes.map(function (col) { return celluleXml(col.titre, 'e'); }).join('') + '</Row>';
    lignes.forEach(function (l) {
      xml += '<Row>' + l.map(function (v) { return celluleXml(v, 'c'); }).join('') + '</Row>';
    });
    xml += '</Table></Worksheet></Workbook>';
    window.__dernierExport = xml; /* relu par les tests automatiques */
    var url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  /* Ce qui reste dû sur une demande validée (0 si soldée ou annulée). */
  function resteAEncaisser(d) { return core.due(d); }

  function dejaEncaisse(d) { return core.paid(d); }

  /* ---- relances par e-mail (via le service Google, jeton signé) ---- */
  async function relancer(d, sous, montant, silencieux) {
    var etiquettes = {acompte:'l’acompte',solde:'le solde',paiement:'le paiement',annulation:'l’annulation'};
    if (!d.parent_email) { notifier('Ajoutez l’e-mail du parent avant d’envoyer un message.', true); return; }
    if (!silencieux && !await confirmer('Envoyer à ' + d.parent_email + ' un e-mail concernant ' + (etiquettes[sous] || sous) + ' de ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    return operation('relance:' + d.id + ':' + sous, async function () {
      var texte = await appelService({type:'relance',relance:sous,d:d.jeton_d || '',s:d.jeton_s || '',
        dtype:d.type || '',enfant:d.enfant || '',parentEmail:d.parent_email,detail:d.detail || '',
        paiement:formuleDe(d),montant:montant || ''});
      if (texte.split(';')[0] !== 'ok relance') { throw new Error('Le service n’a pas confirmé l’envoi de ce message.'); }
      notifier('E-mail envoyé à ' + d.parent_email + '.');
    });
  }

  /* Le bon mail de paiement selon la demande : acompte (300 €) puis
     solde pour un stage, paiement direct pour un cours. */
  function envoyerLienPaiement(d, silencieux) {
    var sous = d.type === 'stage' ? (d.acompte_paye ? 'solde' : 'acompte') : 'paiement';
    relancer(d, sous, null, silencieux);
  }

  /* ---- planifier un cours : Fleur a appelé, elle note la date et
     l'heure, et la plateforme envoie les infos + le lien de paiement ---- */
  function formuleDe(d) {
    if (/trimestre/i.test(d.detail || '')) { return 'trimestre'; }
    if (/Règlement choisi : Au trimestre/.test(d.lignes || '')) { return 'trimestre'; }
    return 'unite';
  }

  async function planifierCours(d) {
    var valeurs = await ui.form({ title:'Planifier le cours', description:d.enfant + ' · ' + (d.parent_email || 'Sans e-mail'),
      validate:function (v) { return erreurCreneau(v.date, v.heure, d.id); },
      submitLabel:'Enregistrer le créneau', fields:[
        {name:'date',label:'Date du cours',type:'date',required:true,value:d.cours_date || prochainsJoursCours(1)[0],help:'Les cours ont lieu le samedi.'},
        {name:'heure',label:'Heure du cours',type:'time',required:true,value:core.time(d.cours_heure) || '10:00'}
      ] });
    if (!valeurs) { return; }
    var enregistre = await patchDemande(d, {cours_date:valeurs.date,cours_heure:valeurs.heure,infos_envoyees_le:null});
    if (!enregistre) { return; }
    if (d.parent_email && await confirmer('Le créneau est enregistré. Envoyer à ' + d.parent_email + ' la date, l’heure et le lien de paiement ?')) {
      await envoyerInfosCours(d, true);
    }
  }

  function erreurCreneau(date, heure, demandeId) {
    var erreur = core.validateSchedule(date, heure, isoLocal(new Date()));
    if (erreur) { return erreur; }
    var cle = core.scheduleKey({cours_date:date,cours_heure:heure});
    var nombre = coursAVenir().filter(function (d) { return d.id !== demandeId && core.scheduleKey(d) === cle; }).length;
    return nombre >= CAPACITE_COURS ? 'Ce créneau compte déjà ' + CAPACITE_COURS + ' inscrits. Choisissez un autre horaire.' : '';
  }

  async function envoyerInfosCours(d, silencieux) {
    if (!d.cours_date) { return planifierCours(d); }
    if (!/.+@.+\..+/.test(d.parent_email || '')) { notifier('Ajoutez une adresse e-mail à cette demande pour prévenir la famille.', true); return; }
    if (!silencieux && !await confirmer('Envoyer à ' + d.parent_email + ' les informations du cours du ' + jourLisible(d.cours_date) + ' à ' + d.cours_heure + ' et le lien de paiement ?')) { return; }
    return operation('infos:' + d.id, async function () {
      var texte = await appelService({type:'infos-cours',email:d.parent_email,enfant:d.enfant || '',
        quand:jourLisible(d.cours_date),heure:d.cours_heure || '',paiement:formuleDe(d)});
      if (texte.indexOf('ok infos') !== 0) { throw new Error('Le service n’a pas confirmé l’envoi. Actualisez puis réessayez.'); }
      var sauve = await patchDemande(d, {infos_envoyees_le:isoLocal(new Date())});
      notifier(sauve ? 'Informations et lien de paiement envoyés à la famille.' : 'E-mail envoyé, mais son suivi n’a pas pu être enregistré. Actualisez avant de renvoyer.', !sauve);
    });
  }

  async function patchDemande(d, patch, apres) {
    return operation('demande:' + d.id, async function () {
      var lignes = await reponseJson(await nuage.requeteAuth('/rest/v1/demandes?id=eq.' + encodeURIComponent(d.id), {
        method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)
      }));
      if (!lignes || !lignes[0]) { throw new Error('Cette demande n’est plus disponible. Actualisez la liste.'); }
      Object.assign(d, lignes[0]); rafraichirAffichage(); notifier('Modifications enregistrées.');
      if (apres) { await apres(); }
      return d;
    });
  }

  async function marquerAcompte(d) {
    if (!await confirmer('Noter l’acompte de 300 € comme reçu pour ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    patchDemande(d, { acompte_paye: true, acompte_le: isoLocal(new Date()) });
  }
  async function marquerSolde(d) {
    if (!await confirmer('Noter le solde comme reçu pour ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    patchDemande(d, { solde_paye: true, solde_le: isoLocal(new Date()) });
  }
  async function annulerDemande(d) {
    var valeurs = await ui.form({title:'Annuler l’inscription',danger:true,submitLabel:'Enregistrer l’annulation',
      description:'Cette action annule l’inscription de ' + d.enfant + '. Le montant ci-dessous déclare un remboursement déjà effectué ; aucun remboursement bancaire n’est exécuté ici.',
      fields:[{name:'montant',label:'Remboursement déjà effectué (€)',type:'number',required:true,min:0,max:dejaEncaisse(d),step:'0.01',value:'0'}]});
    if (!valeurs) { return; }
    var montant = Number(valeurs.montant);
    if (!Number.isFinite(montant) || montant < 0 || montant > dejaEncaisse(d)) { notifier('Le remboursement doit être compris entre 0 € et le montant encaissé.',true); return; }
    var ok = await patchDemande(d,{annule:true,annule_le:isoLocal(new Date()),rembourse_montant:montant + ' €'});
    if (ok && d.parent_email && await confirmer('Prévenir ' + d.parent_email + ' de cette annulation' + (montant ? ' et du remboursement déclaré de ' + montant + ' €' : '') + ' ?')) {
      await relancer(d,'annulation',montant + ' €',true);
    }
  }
  async function retablirDemande(d) {
    var erreur = core.restoreError(d);
    if (erreur) { notifier(erreur, true); return; }
    if (!await confirmer('Rétablir l’inscription de ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    patchDemande(d, { annule: false, annule_le: null, rembourse_montant: null });
  }

  async function modifierMontant(d) {
    var valeurs = await ui.form({title:'Corriger le règlement déclaré',submitLabel:'Enregistrer',fields:[
      {name:'montant',label:'Montant total encaissé (€)',type:'number',required:true,min:String(core.total(d) || 0.01),step:'0.01',value:String(dejaEncaisse(d))}
    ]});
    if (valeurs) { await patchDemande(d,{paye_montant:Number(valeurs.montant) + ' €'}); }
  }

  async function retirerMarques(d) {
    if (!await confirmer('Retirer les marques « payé » (acompte + solde) sur le stage de ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    patchDemande(d, { acompte_paye: false, acompte_le: null, solde_paye: false, solde_le: null, paye: false, paye_le: null, paye_montant: null });
  }

  /* Un stage réglé d'un coup (par exemple payé en entier avant la mise
     en place de l'acompte) : tout est noté en un clic. */
  async function reglerTotalite(d) {
    if (!await confirmer('Noter le stage de ' + (d.enfant || 'ce voltigeur') + ' comme réglé en totalité (acompte + solde) ?')) { return; }
    var jour = isoLocal(new Date());
    patchDemande(d, core.totalPaymentPatch(d, jour));
  }

  /* ---- La vérification des paiements sur Stripe ----
     Le service Google (qui garde la clé Stripe, secrète) renvoie les
     règlements reçus ; on les rapproche ici des demandes en attente. */
  async function verifierStripe() {
    var bouton = el('b-stripe'), etat = el('m-stripe');
    if (bouton.disabled) { return; }
    bouton.disabled = true; etat.textContent = 'Vérification des règlements…';
    try {
      var rep = await appelService({type:'stripe'}, true);
      if (rep.version < 22 || !Array.isArray(rep.propositions)) { throw new Error('La vérification sécurisée nécessite la mise à jour du service CRM. Aucun paiement n’a été modifié.'); }
      rapprocherStripe(rep);
      etat.textContent = rep.propositions.length + ' rapprochement(s) proposé(s) · vérification terminée';
    } catch (erreur) { etat.textContent = 'Vérification non terminée'; notifier(erreur.message,true); }
    finally { bouton.disabled = false; }
  }

  function rapprocherStripe(rep) {
    var conteneur = el('stripe-propositions');
    conteneur.innerHTML = '';
    var titre = document.createElement('h3'); titre.textContent = 'Résultats de la vérification Stripe'; conteneur.appendChild(titre);
    var paiements = (rep.paiements || []).filter(function (p) { return p.statut !== 'deja_rapproche'; });
    if (!paiements.length) {
      var vide = document.createElement('p'); vide.textContent = 'Aucun règlement à rapprocher sur la période vérifiée.'; conteneur.appendChild(vide); return;
    }
    var tbody = fabriquerTableau(conteneur,['Règlement','Famille','Correspondance','Action']);
    paiements.forEach(function (p) {
      var tr = document.createElement('tr');
      cellule(tr,p.montant + ' € · ' + (p.quand || 'Date non renseignée'));
      cellule(tr,p.email || 'E-mail absent');
      var candidats = p.candidats || [];
      var choix = document.createElement('div');
      choix.textContent = p.statut === 'ambigu' ? 'Plusieurs dossiers possibles : vérification manuelle nécessaire.'
        : p.statut === 'sans_correspondance' ? 'Aucune demande compatible.' : '';
      var d = demandes.find(function (x) { return x.id === p.demande_id; });
      if (d) { choix.textContent = d.enfant + ' · ' + (d.detail || ''); }
      cellule(tr,choix);
      var actions = document.createElement('div');
      if (p.statut === 'propose' && p.demande_id) {
        actions.appendChild(lienAction('Rapprocher ce règlement', async function () {
          if (!await confirmer('Attribuer ' + p.montant + ' € reçus de ' + p.email + ' à ' + (d ? d.enfant : 'ce dossier') + ' ?')) { return; }
          await operation('stripe:' + p.session_id, async function () {
            var resultat = await appelService({type:'stripe-rapprocher',demande_id:p.demande_id,session_id:p.session_id}, true);
            if (!resultat.demande) { throw new Error('Le service n’a pas renvoyé la demande mise à jour. Actualisez les données.'); }
            var locale = demandes.find(function (x) { return x.id === resultat.demande.id; });
            if (locale) { Object.assign(locale,resultat.demande); } else { demandes.unshift(resultat.demande); }
            tr.remove(); rafraichirAffichage(); notifier(resultat.deja_rapproche ? 'Ce règlement était déjà rapproché.' : 'Règlement rapproché et enregistré.');
          });
        }));
      } else if (candidats.length) {
        candidats.forEach(function (candidat) {
          var demande = demandes.find(function (x) { return x.id === candidat.demande_id; });
          if (demande) { actions.appendChild(lienAction('Voir ' + demande.enfant,function () { allerDemande(demande); })); }
        });
      }
      cellule(tr,actions); tbody.appendChild(tr);
    });
  }

  /* ================= Les paiements =================
     Note maison : le trimestre est dû, que le voltigeur vienne ou non. */
  function montantNumerique(texte) { return core.money(texte); }

  async function marquerPaye(d) {
    var valeurs = await ui.form({title:'Enregistrer un règlement',description:d.enfant + ' · indiquez le règlement complet déjà reçu. Pour corriger le prix convenu, modifiez d’abord le tarif de la demande.',submitLabel:'Enregistrer le règlement',
      fields:[{name:'montant',label:'Montant total encaissé (€)',type:'number',required:true,min:String(core.total(d) || 0.01),step:'0.01',value:String(core.total(d))},
        {name:'date',label:'Date du règlement',type:'date',required:true,max:isoLocal(new Date()),value:isoLocal(new Date())}]});
    if (!valeurs) { return; }
    if (Number(valeurs.montant) <= 0) { notifier('Le montant doit être supérieur à zéro.',true); return; }
    return patchDemande(d,{paye:true,paye_le:valeurs.date,paye_montant:Number(valeurs.montant) + ' €'});
  }

  async function annulerPaye(d) {
    if (await confirmer('Retirer le règlement déclaré pour ' + d.enfant + ' ? Aucun remboursement bancaire ne sera effectué.',true)) {
      return patchDemande(d,{paye:false,paye_le:null,paye_montant:null});
    }
  }

  function pastilleEtat(texte, bonne) {
    var p = document.createElement('span');
    p.className = 'pastille ' + (bonne ? 'validee' : 'attente');
    p.textContent = texte;
    return p;
  }

  /* Un tableau type CRM : en-tetes de colonnes + corps, dans un cadre
     qui defile horizontalement sur petit ecran. */
  function fabriquerTableau(conteneur, colonnes, classe) {
    var cadre = document.createElement('div');
    cadre.className = 'cadre-tableau' + (classe ? ' ' + classe : '');
    var table = document.createElement('table');
    table.className = 'tableau';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    colonnes.forEach(function (c) {
      var th = document.createElement('th');
      th.textContent = c;
      th.scope = 'col';
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    cadre.appendChild(table);
    conteneur.appendChild(cadre);
    return tbody;
  }

  function cellule(tr, contenu) {
    var td = document.createElement('td');
    if (contenu != null) {
      if (typeof contenu === 'string') { td.textContent = contenu; }
      else { td.appendChild(contenu); }
    }
    tr.appendChild(td);
    return td;
  }

  /* Présentation commune aux demandes et aux paiements ; les règles de
     calcul et les callbacks métier restent dans leurs fonctions dédiées. */
  var formatEuros = new Intl.NumberFormat('fr-FR', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2
  });
  function euros(valeur) { return formatEuros.format(Number(valeur) || 0); }
  function elementFiche(balise, classe, texte) {
    var element = document.createElement(balise);
    if (classe) { element.className = classe; }
    if (texte != null) { element.textContent = String(texte); }
    return element;
  }
  function actionSensible(texte, surClic) {
    var bouton = lienAction(texte, surClic);
    bouton.classList.add('crm-action-danger');
    return bouton;
  }
  function badgeActivite(d) {
    return elementFiche('span', 'pastille ' + (d.type === 'stage' ? 'type-stage' : 'type-cours'), d.type === 'stage' ? 'Stage' : 'Cours');
  }
  function identiteFiche(d, avecInscription) {
    var celluleIdentite = elementFiche('td', 'crm-record-person');
    var personne = elementFiche('div', 'crm-person');
    var nom = d.enfant || 'Voltigeur';
    var initiales = nom.trim().split(/\s+/).slice(0, 2).map(function (mot) { return (mot[0] || '').toUpperCase(); }).join('');
    var avatar = elementFiche('span', 'crm-avatar', initiales);
    avatar.setAttribute('aria-hidden', 'true');
    var copie = elementFiche('div', 'crm-person-copy');
    copie.appendChild(elementFiche('span', 'nom', nom));
    copie.appendChild(elementFiche('span', 'crm-record-meta', d.parent_nom || 'Parent non renseigné'));
    copie.appendChild(elementFiche('span', 'crm-record-meta crm-record-email', d.parent_email || 'E-mail non renseigné'));
    if (avecInscription) {
      var inscription = elementFiche('div', 'crm-person-offer');
      inscription.appendChild(badgeActivite(d));
      inscription.appendChild(elementFiche('span', 'crm-record-detail', detailCourt(d) || 'Inscription'));
      copie.appendChild(inscription);
    } else if (d.cree) {
      copie.appendChild(elementFiche('span', 'crm-record-meta crm-record-date', 'Reçue le ' + quandLisible(d.cree)));
    }
    personne.appendChild(avatar);
    personne.appendChild(copie);
    celluleIdentite.appendChild(personne);
    return celluleIdentite;
  }
  function actionsFiche(d) {
    var celluleActions = elementFiche('td', 'crm-record-actions');
    var contenu = elementFiche('div', 'crm-row-actions');
    var menu = elementFiche('details', 'crm-actions-menu');
    var resume = elementFiche('summary', '', 'Gérer');
    resume.setAttribute('aria-label', 'Gérer le dossier de ' + (d.enfant || 'ce voltigeur'));
    var secondaires = elementFiche('div', 'crm-actions-menu-content');
    menu.appendChild(resume);
    menu.appendChild(secondaires);
    contenu.appendChild(menu);
    celluleActions.appendChild(contenu);
    return {
      cellule: celluleActions, contenu: contenu, menu: menu, secondaires: secondaires,
      principale: function (bouton) {
        bouton.className = 'btn btn-rouge crm-record-primary';
        contenu.insertBefore(bouton, menu);
        return bouton;
      },
      terminer: function () { if (!secondaires.children.length) { menu.remove(); } }
    };
  }

  function lignePaiement(d, groupe) {
    var ligne = elementFiche('tr', 'carte-demande crm-record-row st-' + (groupe === 'regle' ? 'validee' : groupe === 'annule' ? 'refusee' : 'attente'));
    ligne.appendChild(identiteFiche(d, true));

    var reste = resteAEncaisser(d);
    var recu = dejaEncaisse(d);
    var remboursement = montantNumerique(d.rembourse_montant);
    var montant = elementFiche('td', 'crm-record-amount');
    montant.appendChild(elementFiche('span', 'crm-money', euros(groupe === 'du' ? reste : groupe === 'annule' ? remboursement : recu)));
    montant.appendChild(elementFiche('span', 'crm-record-meta', groupe === 'du' ? 'Reste à encaisser' : groupe === 'annule' ? 'Remboursement déclaré' : 'Montant encaissé'));
    montant.appendChild(elementFiche('span', 'crm-record-meta', 'Tarif total : ' + euros(core.total(d))));
    if (groupe === 'du' && recu > 0) {
      montant.appendChild(elementFiche('span', 'crm-record-meta', 'Déjà reçu : ' + euros(recu)));
    }
    ligne.appendChild(montant);

    var etat = elementFiche('td', 'crm-record-status');
    var badges = elementFiche('div', 'crm-status-badges');
    if (groupe === 'annule') {
      badges.appendChild(elementFiche('span', 'pastille refusee', 'Inscription annulée'));
      badges.appendChild(elementFiche('span', 'crm-record-meta', remboursement ? 'Remboursement déclaré' : 'Sans remboursement'));
    } else if (d.type === 'stage') {
      badges.appendChild(pastilleEtat(d.acompte_paye ? 'Acompte reçu' : 'Acompte dû', !!d.acompte_paye));
      badges.appendChild(pastilleEtat(d.solde_paye ? 'Solde reçu' : 'Solde dû', !!d.solde_paye));
    } else if (d.paye) {
      badges.appendChild(pastilleEtat(reste > 0 ? 'Partiellement réglé' : 'Réglé', reste === 0));
    } else {
      badges.appendChild(pastilleEtat('À régler', false));
    }
    etat.appendChild(badges);
    var dateTexte = groupe === 'annule' && d.annule_le
      ? 'Annulée le ' + new Date(d.annule_le + 'T12:00:00').toLocaleDateString('fr-FR')
      : groupe === 'regle' && (d.paye_le || d.solde_le || d.acompte_le)
        ? 'Réglé le ' + new Date((d.solde_le || d.paye_le || d.acompte_le) + 'T12:00:00').toLocaleDateString('fr-FR')
        : d.cree ? 'Demande du ' + quandLisible(d.cree) : '';
    if (dateTexte) { etat.appendChild(elementFiche('span', 'crm-record-meta crm-record-date', dateTexte)); }
    ligne.appendChild(etat);

    var actions = actionsFiche(d);
    var secondaires = actions.secondaires;
    if (groupe === 'annule') {
      actions.principale(lienAction('Rétablir l’inscription', function () { retablirDemande(d); }));
    } else if (d.type === 'stage') {
      if (!d.acompte_paye) {
        actions.principale(lienAction('Acompte reçu', function () { marquerAcompte(d); }));
        secondaires.appendChild(lienAction('Relancer l’acompte', function () { relancer(d, 'acompte'); }));
      } else if (!d.solde_paye) {
        actions.principale(lienAction('Solde reçu', function () { marquerSolde(d); }));
        secondaires.appendChild(lienAction('Relancer le solde', function () { relancer(d, 'solde'); }));
      }
      if (!(d.acompte_paye && d.solde_paye)) {
        secondaires.appendChild(lienAction('Réglé en totalité', function () { reglerTotalite(d); }));
      } else {
        secondaires.appendChild(actionSensible('Retirer les marques « payé »', function () { retirerMarques(d); }));
      }
      secondaires.appendChild(actionSensible('Annuler / déclarer un remboursement', function () { annulerDemande(d); }));
    } else if (groupe === 'regle') {
      actions.principale(lienAction('Modifier le montant', function () { modifierMontant(d); }));
      secondaires.appendChild(actionSensible('Retirer la marque « payé »', function () { annulerPaye(d); }));
    } else {
      actions.principale(lienAction('Marquer payé', function () { marquerPaye(d); }));
      secondaires.appendChild(lienAction('Relancer le paiement', function () { relancer(d, 'paiement'); }));
    }
    if (d.type !== 'stage' && groupe !== 'annule') {
      secondaires.appendChild(actionSensible('Annuler / déclarer un remboursement', function () { annulerDemande(d); }));
    }
    actions.terminer();
    ligne.appendChild(actions.cellule);
    return ligne;
  }

  function afficherPaiements() {
    var encaisser = el('a-encaisser');
    var payes = el('a-payes');
    var annules = el('a-annules');
    if (!encaisser || !payes || !annules) { return; }
    encaisser.innerHTML = '';
    payes.innerHTML = '';
    annules.innerHTML = '';

    var mot = el('f-paiement-recherche') ? el('f-paiement-recherche').value : '';
    var selection = demandes.filter(function (d) { return core.matches(d, mot); });
    var dus = selection.filter(function (d) { return resteAEncaisser(d) > 0; });
    var regles = selection.filter(function (d) { return !d.annule && resteAEncaisser(d) === 0 && dejaEncaisse(d) > 0; });
    var lesAnnules = selection.filter(function (d) { return d.annule; });

    var colonnes = ['Famille / inscription', 'Montant', 'Suivi', 'Actions'];
    var totalDu = 0, totalRegle = 0, totalRembourse = 0;
    if (dus.length) {
      var corpsDus = fabriquerTableau(encaisser, colonnes, 'crm-record-table crm-payment-table');
      dus.forEach(function (d) { totalDu += resteAEncaisser(d); corpsDus.appendChild(lignePaiement(d, 'du')); });
    }
    if (regles.length) {
      var corpsRegles = fabriquerTableau(payes, colonnes, 'crm-record-table crm-payment-table');
      regles.forEach(function (d) { totalRegle += dejaEncaisse(d); corpsRegles.appendChild(lignePaiement(d, 'regle')); });
    }
    if (lesAnnules.length) {
      var corpsAnnules = fabriquerTableau(annules, colonnes, 'crm-record-table crm-payment-table');
      lesAnnules.forEach(function (d) { totalRembourse += montantNumerique(d.rembourse_montant); corpsAnnules.appendChild(lignePaiement(d, 'annule')); });
    }

    el('t-encaisser').textContent = euros(totalDu);
    el('t-payes').textContent = euros(totalRegle);
    el('t-annules').textContent = euros(totalRembourse);
    [['pc-due-count', dus.length, 'dossier'], ['pc-paid-count', regles.length, 'dossier'], ['pc-cancel-count', lesAnnules.length, 'annulation']].forEach(function (compteur) {
      if (el(compteur[0])) { el(compteur[0]).textContent = compteur[1] + ' ' + compteur[2] + (compteur[1] > 1 ? 's' : ''); }
    });
    if (el('resultats-paiements')) {
      var nombre = dus.length + regles.length + lesAnnules.length;
      el('resultats-paiements').textContent = nombre + (nombre > 1 ? ' dossiers' : ' dossier') + (mot.trim() ? ' · Les montants suivent votre recherche.' : ' dans le suivi des règlements.');
    }
    if (!dus.length) {
      encaisser.appendChild(elementFiche('p', 'aide etat-vide', mot ? 'Aucun montant à encaisser pour cette recherche.' : 'Rien à encaisser : toutes les demandes validées sont réglées.'));
    }
    if (!regles.length) {
      payes.appendChild(elementFiche('p', 'aide etat-vide', mot ? 'Aucun règlement complet pour cette recherche.' : 'Aucun paiement complet pour l’instant.'));
    }
    if (!lesAnnules.length) {
      annules.appendChild(elementFiche('p', 'aide etat-vide', mot ? 'Aucune annulation pour cette recherche.' : 'Aucune annulation.'));
    }
  }

  /* ================= Les feuilles de présence ================= */
  function ouvrirFeuille(feuille) {
    try { localStorage.setItem('av:feuille', JSON.stringify(feuille)); } catch (e) { return; }
    window.open('feuille.html', '_blank', 'noopener');
  }

  /* ================= Le dossier d'inscription rempli =================
     Chaque demande garde le texte de son dossier ; on le retraduit en
     fiche imprimable (la même que celle des parents), sans signature. */
  function dossierDepuisLignes(d) {
    var champs = {};
    String(d.lignes || '').split('\n').forEach(function (l) {
      var i = l.indexOf(' : ');
      if (i > 0) {
        var valeur = l.slice(i + 3).trim();
        champs[l.slice(0, i).trim()] = valeur === '—' ? '' : valeur;
      }
    });
    var morceauxNom = String(champs['Voltigeur'] || d.enfant || '').trim().split(/\s+/);
    var cpVille = String(champs['Code postal / ville'] || '').trim().split(/\s+/);
    return {
      type: d.type,
      annee: '2026/2027',
      formule: champs['Formule'] || champs['Stage'] || '',
      creneau: champs['Créneau'] || champs['Dates'] || '',
      tarif: champs['Tarif'] || d.tarif || '',
      enfantPrenom: morceauxNom.shift() || '',
      enfantNom: morceauxNom.join(' '),
      enfantNaissance: champs['Date de naissance'] || '',
      enfantLieu: champs['Né(e) à'] || '',
      nationalite: champs['Nationalité'] || '',
      sexe: champs['Sexe'] || '',
      gabarit: champs['Gabarit'] || '',
      niveau: champs['Niveau'] || '',
      qualite: champs['Qualité'] || '',
      parentNom: champs['Parent'] || d.parent_nom || '',
      adresse: champs['Adresse'] || '',
      cp: cpVille.shift() || '',
      ville: cpVille.join(' '),
      parentTel: champs['Téléphone'] || '',
      telDomicile: champs['Tél. domicile'] || '',
      parentEmail: champs['E-mail'] || d.parent_email || '',
      secuCaisse: champs['Sécurité sociale (caisse)'] || '',
      secuNumero: champs['N° couvrant l’enfant'] || champs["N° couvrant l'enfant"] || '',
      licence: champs['Licence FFE'] || '',
      recommandations: champs['Recommandations (allergies…)'] || champs['Santé / remarques'] || '',
      faitA: '',
      signeLe: champs['Signé en ligne'] || '',
      signature: ''
    };
  }

  function ouvrirDossier(d) {
    try { localStorage.setItem('av:dossier-admin', JSON.stringify(dossierDepuisLignes(d))); }
    catch (e) { return; }
    window.open('../dossier-rempli.html?apercu=admin', '_blank', 'noopener');
  }

  /* ================= Les demandes ================= */
  /* Ajouter, corriger ou supprimer une demande a la main. */
  async function ajouterDemande(options) {
    options = options && (options.type === 'cours' || options.type === 'stage') ? options : {};
    var valeurs = await ui.form({title:'Nouvelle demande',description:'Ajoutez un dossier reçu par téléphone ou sur place. Aucun e-mail ne part à cette étape.',submitLabel:'Créer la demande',
      onChange:function (name, value, controls) {
        if (name !== 'type') { return; }
        var ancienTarif = value === 'stage' ? '25' : '840';
        if (controls.tarif.value === ancienTarif) { controls.tarif.value = value === 'stage' ? '840' : '25'; }
        if (!controls.detail.value || controls.detail.value === 'Cours à l’unité' || controls.detail.value === 'Stage — dates à préciser') {
          controls.detail.value = value === 'stage' ? 'Stage — dates à préciser' : 'Cours à l’unité';
        }
      },fields:[
      {name:'type',label:'Activité',type:'select',value:options.type || 'cours',options:[{value:'cours',label:'Cours'},{value:'stage',label:'Stage'}]},
      {name:'enfant',label:'Nom du voltigeur',required:true},
      {name:'parent_nom',label:'Nom du parent'},
      {name:'parent_email',label:'E-mail du parent',type:'email'},
      {name:'detail',label:'Formule ou stage et dates',required:true,value:options.detail || (options.type === 'stage' ? 'Stage — dates à préciser' : 'Cours à l’unité')},
      {name:'tarif',label:'Tarif total (€)',type:'number',required:true,min:'0.01',step:'0.01',value:options.type === 'stage' ? '840' : '25'},
      {name:'statut',label:'Statut initial',type:'select',value:'en attente',options:[{value:'en attente',label:'En attente de validation'},{value:'validée',label:'Validée'}]}
    ]});
    if (!valeurs) { return; }
    await operation('nouvelle-demande',async function () {
      var ligne = {type:valeurs.type,enfant:valeurs.enfant.trim(),parent_nom:valeurs.parent_nom.trim(),parent_email:valeurs.parent_email.trim(),
        detail:valeurs.detail.trim(),tarif:Number(valeurs.tarif) + ' €',statut:valeurs.statut,lignes:'Ajoutée à la main depuis l’espace académie.'};
      if (ligne.statut === 'validée') { ligne.decide = new Date().toISOString(); }
      var d = await creerDemande(ligne); allerDemande(d);
    });
  }

  async function modifierDemande(d) {
    var valeurs = await ui.form({title:'Modifier la demande',description:d.enfant,submitLabel:'Enregistrer les modifications',
      validate:function (v) { return core.validateTariff(d, v.tarif); },fields:[
      {name:'enfant',label:'Nom du voltigeur',required:true,value:d.enfant || ''},
      {name:'parent_nom',label:'Nom du parent',value:d.parent_nom || ''},
      {name:'parent_email',label:'E-mail du parent',type:'email',value:d.parent_email || ''},
      {name:'detail',label:'Formule ou stage et dates',required:true,value:d.detail || ''},
      {name:'tarif',label:'Tarif total (€)',type:'number',min:'0.01',step:'0.01',required:true,value:String(core.total(d))}
    ]});
    if (!valeurs) { return; }
    return patchDemande(d,{enfant:valeurs.enfant.trim(),parent_nom:valeurs.parent_nom.trim(),parent_email:valeurs.parent_email.trim(),detail:valeurs.detail.trim(),tarif:Number(valeurs.tarif) + ' €'});
  }

  async function supprimerDemande(d) {
    if (dejaEncaisse(d) > 0) { notifier('Cette demande possède un règlement. Utilisez l’annulation pour conserver son historique.',true); return; }
    if (!await confirmer('Supprimer définitivement la demande de ' + d.enfant + ' ? Pour garder son historique, vous pouvez annuler l’inscription à la place.',true)) { return; }
    return operation('demande:' + d.id,async function () {
      var lignes = await reponseJson(await nuage.requeteAuth('/rest/v1/demandes?id=eq.' + encodeURIComponent(d.id),{method:'DELETE',headers:{Prefer:'return=representation'}}));
      if (!lignes || !lignes.length) { throw new Error('Cette demande n’a pas été supprimée. Actualisez la liste.'); }
      demandes = demandes.filter(function (x) { return x.id !== d.id; }); rafraichirAffichage(); notifier('Demande supprimée.');
    });
  }

  /* Pour un stage, la colonne Demande ne garde que les dates (le nom
     complet du stage reste dans « Tout le dossier »). */
  function detailCourt(d) {
    if (d.type === 'stage') {
      var m = String(d.detail || '').match(/\(([^()]*)\)\s*$/);
      if (m && m[1]) { return m[1]; }
    }
    return d.detail || '';
  }

  function carteDemande(d) {
    var c = elementFiche('tr', 'carte-demande crm-record-row st-' + classeStatut(d.statut));
    c.appendChild(identiteFiche(d, false));

    var demande = elementFiche('td', 'crm-record-offer');
    demande.appendChild(badgeActivite(d));
    demande.appendChild(elementFiche('span', 'crm-record-detail', detailCourt(d) || 'Inscription'));
    if (d.tarif) { demande.appendChild(elementFiche('span', 'crm-record-price', d.tarif)); }
    c.appendChild(demande);

    var etatTd = elementFiche('td', 'crm-record-status');
    var badges = elementFiche('div', 'crm-status-badges');
    badges.appendChild(elementFiche('span', 'pastille ' + classeStatut(d.statut), d.statut || 'en attente'));
    etatTd.appendChild(badges);
    c.appendChild(etatTd);
    var actions = actionsFiche(d);
    var secondaires = actions.secondaires;
    var paiementCours;

    if (classeStatut(d.statut) === 'attente' && d.jeton_d && d.jeton_s) {
      var valider = actions.principale(lienAction('Valider', function () { decider(d, 'valider', null, c); }));
      var motif = elementFiche('select', 'crm-refusal-reason');
      motif.setAttribute('aria-label', 'Motif du refus pour ' + (d.enfant || 'ce voltigeur'));
      Object.keys(MOTIFS).forEach(function (cle) {
        var o = elementFiche('option', '', 'Motif : ' + MOTIFS[cle]);
        o.value = cle;
        motif.appendChild(o);
      });
      secondaires.appendChild(motif);
      var refuser = actionSensible('Refuser', function () { decider(d, 'refuser', motif.value, c); });
      secondaires.appendChild(refuser);
      var etat = elementFiche('span', 'crm-record-meta crm-action-status');
      etat.setAttribute('role', 'status');
      actions.contenu.appendChild(etat);
      c.etatAction = etat;
      c.boutons = [valider, refuser];
    }

    if (d.annule) {
      badges.appendChild(elementFiche('span', 'pastille refusee', 'Annulée'));
    } else if (d.type === 'stage' && classeStatut(d.statut) === 'validee') {
      badges.appendChild(pastilleEtat(d.acompte_paye ? 'Acompte reçu' : 'Acompte dû', !!d.acompte_paye));
      badges.appendChild(pastilleEtat(d.solde_paye ? 'Solde reçu' : 'Solde dû', !!d.solde_paye));
    } else if (d.paye) {
      badges.appendChild(elementFiche('span', 'pastille validee', 'Payé' + (d.paye_montant ? ' · ' + d.paye_montant : '')));
    } else if (d.type !== 'stage' && classeStatut(d.statut) === 'validee') {
      paiementCours = lienAction('Marquer payé', function () { marquerPaye(d); });
    }

    if (estCours(d)) {
      badges.appendChild(pastilleEtat(d.cours_date ? 'Planifié' : 'À appeler', !!d.cours_date));
      if (d.cours_date) {
        etatTd.appendChild(elementFiche('span', 'crm-record-schedule', jourLisible(d.cours_date) + (d.cours_heure ? ' · ' + d.cours_heure : '')));
      }
      if (!d.cours_date) {
        actions.principale(lienAction('Planifier le cours', function () { planifierCours(d); }));
        if (paiementCours) { secondaires.appendChild(paiementCours); }
      } else {
        var renvoyer = lienAction('Renvoyer les infos et le lien', function () { envoyerInfosCours(d); });
        if (paiementCours) { actions.principale(paiementCours); secondaires.appendChild(renvoyer); }
        else { actions.principale(renvoyer); }
        secondaires.appendChild(lienAction('Modifier le créneau', function () { planifierCours(d); }));
      }
    }

    /* Les demandes manuelles conservent leur décision locale, sans e-mail. */
    if (classeStatut(d.statut) === 'attente' && !(d.jeton_d && d.jeton_s)) {
      actions.principale(lienAction('Marquer validée', async function () {
        if (!await confirmer('Noter la demande de ' + (d.enfant || 'ce voltigeur') + ' comme validée ? (Aucun mail ne part.)')) { return; }
        patchDemande(d, { statut: 'validée', decide: new Date().toISOString() });
      }));
      secondaires.appendChild(lienAction('Marquer refusée', async function () {
        if (!await confirmer('Noter la demande de ' + (d.enfant || 'ce voltigeur') + ' comme refusée ? (Aucun mail ne part.)')) { return; }
        patchDemande(d, { statut: 'refusée (à la main)', decide: new Date().toISOString() });
      }));
    }
    if (d.type === 'stage' && classeStatut(d.statut) === 'validee' && !d.annule && resteAEncaisser(d) > 0) {
      actions.principale(lienAction('Envoyer le lien de paiement', function () { envoyerLienPaiement(d); }));
    }

    if (d.lignes) {
      var plus = elementFiche('details', 'crm-dossier-details');
      plus.appendChild(elementFiche('summary', '', 'Tout le dossier'));
      plus.appendChild(elementFiche('pre', '', d.lignes));
      secondaires.appendChild(plus);
    }
    secondaires.appendChild(lienAction('Dossier à imprimer', function () { ouvrirDossier(d); }));
    secondaires.appendChild(lienAction('Modifier', function () { modifierDemande(d); }));
    if (!d.annule) { secondaires.appendChild(actionSensible('Annuler l’inscription', function () { annulerDemande(d); })); }
    else { secondaires.appendChild(lienAction('Rétablir l’inscription', function () { retablirDemande(d); })); }
    secondaires.appendChild(actionSensible('Supprimer', function () { supprimerDemande(d); }));
    actions.terminer();
    c.appendChild(actions.cellule);
    return c;
  }

  function afficherDemandes() {
    var conteneur = el('a-demandes');
    conteneur.innerHTML = '';
    var visibles = demandesVisibles();
    if (el('resultats-demandes')) {
      el('resultats-demandes').textContent = visibles.length + (visibles.length > 1 ? ' demandes affichées' : ' demande affichée') + ' sur ' + demandes.length;
    }
    // Les compteurs suivent recherche/activité/suivi et ignorent seulement
    // le statut sélectionné, pour comparer les quatre filtres entre eux.
    var optionsCompteurs = {query: filtreTexte,
      type: el('f-type') ? el('f-type').value : 'tous',
      followup: el('f-suivi') ? el('f-suivi').value : 'tous'};
    document.querySelectorAll('[data-status-count]').forEach(function (compteur) {
      optionsCompteurs.status = compteur.getAttribute('data-status-count');
      compteur.textContent = String(core.filterRequests(demandes, optionsCompteurs).length);
    });
    if (!visibles.length) {
      conteneur.appendChild(elementFiche('p', 'aide etat-vide', demandes.length ? 'Aucune demande ne correspond aux filtres. Essayez un autre nom ou élargissez la sélection.' : 'Aucune demande pour l’instant. Ajoutez un dossier ou attendez la première inscription.'));
      return;
    }
    var corps = fabriquerTableau(conteneur, ['Famille', 'Inscription', 'Suivi', 'Actions'], 'crm-record-table crm-request-table');
    visibles.forEach(function (d) { corps.appendChild(carteDemande(d)); });
  }

  async function decider(d, action, motifCle, carteEl) {
    var question = action === 'valider' ? 'Valider la demande de ' + d.enfant + ' et envoyer l’e-mail à la famille ?'
      : 'Refuser la demande de ' + d.enfant + ' et envoyer le motif « ' + (MOTIFS[motifCle] || motifCle) + ' » à la famille ?';
    if (!await confirmer(question,action !== 'valider')) { return; }
    return operation('decision:' + d.id,async function () {
      if (carteEl) { carteEl.boutons.forEach(function (b) { b.disabled=true; }); carteEl.etatAction.textContent='Traitement en cours…'; }
      try {
        var texte = await appelService({type:'decision',action:action,d:d.jeton_d,s:d.jeton_s,motif:motifCle || ''});
        var code = texte.split(';')[0];
        if (code !== 'ok valide' && code !== 'ok refuse') {
          var erreurs = {
            'decision deja traitee':'Cette demande a déjà été traitée. Actualisez son statut.',
            'decision en cours':'Cette décision est déjà en cours de traitement. Actualisez dans un instant.',
            'decision a verifier':'Le service demande une vérification. Contrôlez le dossier et les e-mails envoyés avant tout renvoi.'
          };
          throw new Error(erreurs[code] || 'La décision n’a pas été confirmée. Actualisez avant de réessayer.');
        }
        // Le service est propriétaire de cette transition : aucun second PATCH aveugle.
        await chargerDemandes(); notifier('Décision enregistrée par le service.');
      } finally {
        if (carteEl) { carteEl.boutons.forEach(function (b) { b.disabled=false; }); carteEl.etatAction.textContent=''; }
      }
    });
  }

  async function chargerDemandes() {
    var version = ++versionDemandes; chargements++; statutSynchro();
    message('m-liste','Chargement de toutes les demandes…',true);
    try {
      var liste = await core.loadAll(nuage.requeteAuth,'/rest/v1/demandes?select=*&order=cree.desc,id.desc','id');
      if (version !== versionDemandes) { return; }
      demandes = liste; erreurDemandes=false; el('m-liste').hidden=true; rafraichirAffichage();
    } catch (erreur) {
      if (version === versionDemandes) { erreurDemandes=true; message('m-liste',erreur.message + (demandes.length ? ' Les données précédentes restent affichées.' : '')); }
    } finally { chargements--; statutSynchro(); }
  }

  /* ================= Le planning en cases ================= */
  var caseChoisie = null;

  function prochainsJoursCours(n) {
    var jours = [];
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    while (jours.length < n) {
      if (d.getDay() === JOUR_COURS) { jours.push(isoLocal(d)); }
      d.setDate(d.getDate() + 1);
    }
    return jours;
  }

  function lienAction(texte, surClic) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lien-doux';
    b.textContent = texte;
    b.addEventListener('click', surClic);
    return b;
  }

  function casePlanning(titre, sousTitre, stage, actif, surClic) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'case-planning' + (stage ? ' case-stage' : '') + (actif ? ' actif' : '');
    var t = document.createElement('b');
    t.textContent = titre;
    b.appendChild(t);
    var sous = document.createElement('span');
    sous.textContent = sousTitre;
    b.appendChild(sous);
    b.addEventListener('click', surClic);
    return b;
  }

  function afficherPlanning() {
    var gCours = el('g-cours');
    var gStages = el('g-stages');
    if (!gCours || !gStages) { return; }
    gCours.innerHTML = '';
    gStages.innerHTML = '';

    var parDate = {};
    coursAVenir().forEach(function (d) { var cle=core.scheduleKey(d); (parDate[cle] = parDate[cle] || []).push(d); });
    var jours = Object.keys(parDate).sort();
    if (!jours.length) {
      var videCours = document.createElement('p');
      videCours.className = 'aide';
      videCours.textContent = 'Aucun cours planifié pour l’instant : validez une demande de cours, appelez la famille, puis cliquez « Appelé : envoyer date, heure et paiement ».';
      gCours.appendChild(videCours);
    }
    jours.forEach(function (date) {
      var n = parDate[date].length;
      var sousTitre = n + '/' + CAPACITE_COURS + (n > 1 ? ' inscrits' : ' inscrit') + (n >= CAPACITE_COURS ? ' · complet' : '');
      var premier=parDate[date][0];
      gCours.appendChild(casePlanning(jourLisible(premier.cours_date) + ' · ' + (core.time(premier.cours_heure) || premier.cours_heure || 'Horaire à préciser'), sousTitre, false,
        !!(caseChoisie && caseChoisie.genre === 'cours' && caseChoisie.date === date),
        function () { caseChoisie = { genre: 'cours', date: date }; afficherPlanning(); }));
    });

    var parStage = {};
    demandes.forEach(function (d) {
      if (d.type !== 'stage' || classeStatut(d.statut) !== 'validee' || d.annule) { return; }
      var cle = d.detail || 'Stage';
      (parStage[cle] = parStage[cle] || []).push(d);
    });
    var cles = Object.keys(parStage).sort();
    if (!cles.length) {
      var vide = document.createElement('p');
      vide.className = 'aide';
      vide.textContent = 'Aucun stage avec des inscrits pour l’instant (les demandes de stage validées apparaissent ici).';
      gStages.appendChild(vide);
    }
    cles.forEach(function (cle) {
      var nS = parStage[cle].length;
      gStages.appendChild(casePlanning(cle, nS + (nS > 1 ? ' inscrits' : ' inscrit'), true,
        !!(caseChoisie && caseChoisie.genre === 'stage' && caseChoisie.cle === cle),
        function () { caseChoisie = { genre: 'stage', cle: cle }; afficherPlanning(); }));
    });

    afficherInscrits(parDate, parStage);
  }

  function afficherInscrits(parDate, parStage) {
    var panneau = el('p-inscrits');
    if (!panneau) { return; }
    panneau.innerHTML = '';
    if (caseChoisie && caseChoisie.genre === 'stage' && !parStage[caseChoisie.cle]) { caseChoisie = null; }
    if (caseChoisie && caseChoisie.genre === 'cours' && !parDate[caseChoisie.date]) { caseChoisie = null; }
    if (!caseChoisie) { panneau.hidden = true; return; }
    panneau.hidden = false;

    var titre = document.createElement('h3');
    var liste = document.createElement('ul');
    var actions = document.createElement('div');
    actions.className = 'actions';

    function boutonAjout(surClic) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-contour';
      b.innerHTML = '<span>Ajouter un inscrit</span>';
      b.addEventListener('click', surClic);
      return b;
    }

    if (caseChoisie.genre === 'cours') {
      var inscrits = parDate[caseChoisie.date] || [];
      var date = inscrits[0].cours_date, heure = core.time(inscrits[0].cours_heure) || inscrits[0].cours_heure || '';
      titre.textContent = 'Cours du ' + jourLisible(date) + (heure ? ' · ' + heure : '');
      inscrits.forEach(function (d) {
        var li = document.createElement('li');
        li.textContent = (d.enfant || 'Voltigeur') + (d.cours_heure ? ' · ' + d.cours_heure : '') + (d.parent_email ? ' · ' + d.parent_email : '');
        li.appendChild(lienAction('Renvoyer les infos', function () { envoyerInfosCours(d); }));
        li.appendChild(lienAction('Modifier le créneau', function () { planifierCours(d); }));
        li.appendChild(lienAction('Retirer', function () { retirerDuPlanning(d); }));
        liste.appendChild(li);
      });
      if (!inscrits.length) {
        var aucun = document.createElement('li');
        aucun.textContent = 'Personne pour l’instant.';
        liste.appendChild(aucun);
      }
      actions.appendChild(boutonAjout(function () { ajouterInscritCours(date,heure); }));
      actions.appendChild(lienAction('Feuille de présence', function () {
        ouvrirFeuille({
          titre: 'Cours du ' + jourLisible(date),
          sousTitre: 'Cours de voltige du ' + NOM_JOUR_COURS,
          colonnes: ['Présent'],
          lignes: inscrits.map(function (d) { return { nom: d.enfant || 'Voltigeur', info: d.cours_heure || d.parent_email || '' }; })
        });
      }));
    } else {
      var cle = caseChoisie.cle;
      var lesInscrits = parStage[cle] || [];
      titre.textContent = cle;
      lesInscrits.forEach(function (d) {
        var li = document.createElement('li');
        li.textContent = (d.enfant || 'Voltigeur') + ' · ' + (d.parent_nom || '') + (d.parent_email ? ' · ' + d.parent_email : '');
        li.appendChild(lienAction('Retirer', function () { supprimerDemande(d); }));
        liste.appendChild(li);
      });
      actions.appendChild(boutonAjout(function () { ajouterInscritStage(cle); }));
      actions.appendChild(lienAction('Feuille de présence de la semaine', function () {
        ouvrirFeuille({
          titre: 'Feuille de présence · ' + cle,
          sousTitre: 'Une colonne par jour de stage',
          colonnes: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
          lignes: lesInscrits.map(function (d) { return { nom: d.enfant || 'Voltigeur', info: d.parent_nom || '' }; })
        });
      }));
    }

    panneau.appendChild(titre);
    panneau.appendChild(liste);
    panneau.appendChild(actions);
  }

  /* ---- inscrire ou retirer un voltigeur a la main ---- */
  async function ajouterInscritCours(date, heureInitiale) {
    var valeurs = await ui.form({title:'Ajouter un inscrit au cours',description:jourLisible(date),submitLabel:'Ajouter au créneau',
      validate:function (v) { return erreurCreneau(date, v.heure); },fields:[
      {name:'enfant',label:'Nom du voltigeur',required:true},{name:'email',label:'E-mail du parent',type:'email'},
      {name:'heure',label:'Heure du cours',type:'time',required:true,value:core.time(heureInitiale) || '10:00'}]});
    if (!valeurs) { return; }
    await operation('nouvel-inscrit',async function () {
      var d=await creerDemande({type:'cours',enfant:valeurs.enfant.trim(),parent_nom:'',parent_email:valeurs.email.trim(),detail:'Cours à l’unité',tarif:'25 € / cours',statut:'validée',decide:new Date().toISOString(),lignes:'Ajoutée à la main depuis l’espace académie.',cours_date:date,cours_heure:valeurs.heure});
      if (d.parent_email && await confirmer('Inscrit ajouté. Envoyer les informations du cours à '+d.parent_email+' ?')) { await envoyerInfosCours(d,true); }
    });
  }

  async function retirerDuPlanning(d) {
    if (!await confirmer('Retirer ' + (d.enfant || 'ce voltigeur') + ' de ce cours ? La demande reste validée : vous pourrez replanifier après un nouvel appel.')) { return; }
    patchDemande(d, { cours_date: null, cours_heure: null, infos_envoyees_le: null });
  }

  function ajouterInscritStage(cle) { return ajouterDemande({type:'stage',detail:cle}); }

  /* ================= La base clients ================= */
  function carteFamille(f) {
    var d = f.donnees || {};
    var r = d.responsable || {};
    var c = document.createElement('tr');
    c.className = 'carte-famille';

    var qui = document.createElement('td');
    var ident = document.createElement('div');
    ident.className = 'identite';
    var nomComplet = r.nom || f.email || 'Famille';
    var initiales = document.createElement('span');
    initiales.className = 'initiales';
    initiales.textContent = nomComplet.trim().split(/\s+/).slice(0, 2).map(function (mot) { return (mot[0] || '').toUpperCase(); }).join('');
    ident.appendChild(initiales);
    var bloc = document.createElement('div');
    var nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = nomComplet;
    bloc.appendChild(nom);
    if (r.qualite) {
      var q = document.createElement('div');
      q.className = 'corps';
      q.textContent = r.qualite;
      bloc.appendChild(q);
    }
    ident.appendChild(bloc);
    qui.appendChild(ident);
    c.appendChild(qui);

    var contact = document.createElement('td');
    var contacts = [f.email, r.tel, [r.cp, r.ville].filter(Boolean).join(' ')].filter(Boolean);
    if (contacts.length) {
      contacts.forEach(function (ligne) {
        var l = document.createElement('div');
        l.textContent = ligne;
        contact.appendChild(l);
      });
    } else {
      contact.textContent = 'Aucune coordonnée renseignée.';
    }
    c.appendChild(contact);

    var voltigeurs = document.createElement('td');
    var enfants = (d.enfants || []).filter(function (e) { return e && (e.prenom || e.nom); });
    enfants.forEach(function (e) {
      var puce = document.createElement('div');
      var morceaux = [(e.prenom + ' ' + (e.nom || '')).trim()];
      if (e.naissance) { morceaux.push('né(e) le ' + new Date(e.naissance).toLocaleDateString('fr-FR')); }
      puce.textContent = morceaux.join(' · ');
      voltigeurs.appendChild(puce);
    });
    if (!enfants.length) { voltigeurs.textContent = '—'; }
    c.appendChild(voltigeurs);

    var suivi = document.createElement('td');
    var nbDemandes = (d.demandes || []).length;
    if (nbDemandes) {
      var lDemandes = document.createElement('div');
      lDemandes.className = 'corps';
      lDemandes.textContent = nbDemandes + (nbDemandes > 1 ? ' demandes envoyées' : ' demande envoyée');
      suivi.appendChild(lDemandes);
    }
    if (f.maj) {
      var maj = document.createElement('div');
      maj.className = 'corps';
      maj.textContent = 'mise à jour le ' + new Date(f.maj).toLocaleDateString('fr-FR');
      suivi.appendChild(maj);
    }
    if (f.note_admin) {
      var note = document.createElement('div');
      note.className = 'corps';
      note.style.fontStyle = 'italic';
      note.textContent = 'Note : ' + f.note_admin;
      suivi.appendChild(note);
    }
    c.appendChild(suivi);

    var actions = document.createElement('div');
    actions.className = 'actions';
    if (f.user_id) {
      var boutonNote = lienAction(f.note_admin ? 'Modifier la note' : 'Ajouter une note', async function () {
        if (!notesDisponibles) { notifier('Les notes privées sont indisponibles. Actualisez la base clients.',true); return; }
        var valeurs=await ui.form({title:'Note privée de l’académie',description:'Cette note est réservée aux administrateurs.',submitLabel:'Enregistrer la note',
          fields:[{name:'note',label:'Note sur cette famille',type:'textarea',value:f.note_admin || ''}]});
        if (!valeurs) { return; }
        await operation('note:'+f.user_id,async function () {
          var lignes=await reponseJson(await nuage.requeteAuth('/rest/v1/notes_familles?on_conflict=user_id',{
            method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({user_id:f.user_id,note:valeurs.note.trim()})
          }),'La note privée n’a pas pu être enregistrée. Vérifiez la connexion et la mise à jour du CRM.');
          if (!lignes || !lignes[0]) { throw new Error('La note n’a pas été enregistrée.'); }
          f.note_admin=lignes[0].note || ''; afficherFamilles(); notifier('Note privée enregistrée.');
        });
      });
      boutonNote.disabled = !notesDisponibles;
      actions.appendChild(boutonNote);
    }
    cellule(c, actions);
    return c;
  }

  function afficherFamilles() {
    var conteneur = el('a-familles');
    conteneur.innerHTML = '';
    var mot = el('f-recherche').value.trim().toLowerCase();
    var visibles = familles.filter(function (f) {
      if (!mot) { return true; }
      return core.normalize(JSON.stringify(f)).indexOf(core.normalize(mot)) !== -1;
    });
    if (!visibles.length) {
      var vide = document.createElement('p');
      vide.className = 'aide';
      vide.textContent = familles.length
        ? 'Aucune famille ne correspond à cette recherche. Essayez un autre nom ou une autre adresse.'
        : 'Aucun compte famille pour l’instant.';
      conteneur.appendChild(vide);
      return;
    }
    var corpsTableau = fabriquerTableau(conteneur, ['Famille', 'Contact', 'Voltigeurs', 'Suivi', 'Actions']);
    visibles.forEach(function (f) { corpsTableau.appendChild(carteFamille(f)); });
  }

  async function chargerFamilles() {
    var version = ++versionFamilles; chargements++; statutSynchro();
    message('m-familles','Chargement des familles et des notes privées…',true);
    try {
      var liste = await core.loadAll(nuage.requeteAuth,'/rest/v1/familles?select=user_id,email,donnees,maj&order=maj.desc,user_id.desc','user_id');
      var notes = [], souciNotes = false;
      try { notes = await core.loadAll(nuage.requeteAuth,'/rest/v1/notes_familles?select=user_id,note,maj&order=user_id','user_id'); }
      catch (_) { souciNotes=true; }
      if (version !== versionFamilles) { return; }
      var index = {}; notes.forEach(function (n) { index[n.user_id]=n.note; });
      liste.forEach(function (f) { f.note_admin=index[f.user_id] || ''; });
      familles=liste; notesDisponibles=!souciNotes; erreurFamilles=souciNotes;
      if (souciNotes) { message('m-familles','Les familles sont chargées, mais les notes privées sont indisponibles. Actualisez ; si le problème persiste, faites vérifier la mise à jour du CRM.'); }
      else { el('m-familles').hidden=true; }
      afficherFamilles(); majCompteurs();
    } catch (erreur) {
      if (version === versionFamilles) { erreurFamilles=true; message('m-familles',erreur.message + (familles.length ? ' Les données précédentes restent affichées.' : '')); }
    } finally { chargements--; statutSynchro(); }
  }

  /* ================= Accès et navigation ================= */
  function entrer() {
    montrer('p-attente');
    nuage.retrouverEmail().then(function (s) {
      if (!s) { montrer('p-connexion'); return; }
      return nuage.requeteAuth('/rest/v1/admins?select=email&limit=1')
        .then(function (r) {
          /* la table admins ne répond pas : l'installation SQL n'a pas été faite */
          if (!r || !r.ok) {
            montrer('p-refuse');
            el('p-refuse-detail').hidden = false;
            return null;
          }
          return r.json();
        })
        .then(function (l) {
          if (!l) { return; }
          if (!l.length) { montrer('p-refuse'); return; }
          el('p-compte').textContent = s.email || '';
          el('p-deconnexion').hidden = false;
          montrer('p-tableau');
          chargerDemandes();
          chargerFamilles();
          var onglet=location.hash.slice(1);
          if (['accueil','demandes','familles','reservations','paiements'].indexOf(onglet)!==-1) { ouvrirOnglet(onglet); }
        })
        .catch(function () { montrer('p-refuse'); });
    }).catch(function () {
      montrer('p-connexion'); message('m-admin','Impossible de vérifier votre session. Reconnectez-vous ou réessayez dans un instant.');
    });
  }

  el('p-connexion').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = el('ad-email').value.trim(), mdp = el('ad-mdp').value;
    if (!/.+@.+\..+/.test(email) || !mdp) { message('m-admin', 'Indiquez votre e-mail et votre mot de passe.'); return; }
    message('m-admin', 'Connexion…', true);
    nuage.connexion(email, mdp).then(function (r) {
      if (r.erreur) { message('m-admin', r.erreur); return; }
      el('ad-mdp').value=''; entrer();
    }).catch(function(){ message('m-admin','Connexion impossible. Vérifiez votre connexion et réessayez.'); });
  });

  el('p-deconnexion').addEventListener('click', function (ev) {
    ev.preventDefault();
    versionDemandes++; versionFamilles++; demandes=[]; familles=[];
    el('ad-mdp').value='';
    nuage.deconnexion();
    el('p-compte').textContent = '';
    el('p-deconnexion').hidden = true;
    montrer('p-connexion');
  });

  function ouvrirOnglet(onglet) {
    document.querySelectorAll('.onglets [data-onglet]').forEach(function (b) {
      b.classList.toggle('actif-onglet', b.getAttribute('data-onglet') === onglet);
    });
    el('o-accueil').hidden = onglet !== 'accueil';
    el('o-demandes').hidden = onglet !== 'demandes';
    el('o-familles').hidden = onglet !== 'familles';
    el('o-reservations').hidden = onglet !== 'reservations';
    el('o-paiements').hidden = onglet !== 'paiements';
    if (ui.setPage) { ui.setPage(onglet); }
    history.replaceState(null,'','#'+onglet);
  }

  document.querySelector('.onglets').addEventListener('click', function (ev) {
    var bouton = ev.target.closest('[data-onglet]');
    if (!bouton) { return; }
    ouvrirOnglet(bouton.getAttribute('data-onglet'));
  });

  el('a-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerDemandes(); });
  el('b-stripe').addEventListener('click', verifierStripe);
  el('b-ajout-demande').addEventListener('click', ajouterDemande);
  el('d-recherche').addEventListener('input', function () {
    filtreTexte = this.value.trim().toLowerCase();
    afficherDemandes();
  });
  el('b-export-demandes').addEventListener('click', function () {
    exporterExcel('demandes-academie.xls', 'Les demandes',
      [{ titre: 'Type', largeur: 50 }, { titre: 'Voltigeur', largeur: 125 }, { titre: 'Parent', largeur: 120 },
       { titre: 'E-mail', largeur: 165 }, { titre: 'Demande', largeur: 210 }, { titre: 'Tarif', largeur: 95 },
       { titre: 'Statut', largeur: 85 }, { titre: 'Reçue le', largeur: 105 }, { titre: 'Paiement', largeur: 150 }],
      demandesVisibles().map(function (d) {
        return [d.type, d.enfant, d.parent_nom, d.parent_email, d.detail, d.tarif, d.statut, quandLisible(d.cree),
          d.annule ? 'annulé' : d.type === 'stage'
            ? (d.acompte_paye ? 'acompte reçu' : 'acompte dû') + ' / ' + (d.solde_paye ? 'solde reçu' : 'solde dû')
            : d.paye ? 'payé ' + (d.paye_montant || '') : 'non payé'];
      }));
  });
  el('b-export-paiements').addEventListener('click', function () {
    exporterExcel('paiements-academie.xls', 'Les paiements',
      [{ titre: 'Type', largeur: 50 }, { titre: 'Voltigeur', largeur: 125 }, { titre: 'Parent', largeur: 120 },
       { titre: 'E-mail', largeur: 165 }, { titre: 'Tarif', largeur: 95 }, { titre: 'Encaissé (€)', largeur: 75 },
       { titre: 'Reste dû (€)', largeur: 75 }, { titre: 'État', largeur: 150 }, { titre: 'Réglé le', largeur: 80 }],
      demandes.filter(function (d) {
        return (classeStatut(d.statut) === 'validee' || d.annule) && core.matches(d, el('f-paiement-recherche') ? el('f-paiement-recherche').value : '');
      }).map(function (d) {
        return [d.type, d.enfant, d.parent_nom, d.parent_email, d.tarif, dejaEncaisse(d), resteAEncaisser(d),
          d.annule ? 'annulé' + (montantNumerique(d.rembourse_montant) ? ' · remboursé ' + d.rembourse_montant : '')
            : resteAEncaisser(d) > 0 ? 'en attente' : 'réglé',
          d.solde_le || d.paye_le || d.acompte_le || ''];
      }));
  });
  el('f-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerFamilles(); });
  el('r-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerDemandes(); });
  el('f-recherche').addEventListener('input', afficherFamilles);

  el('a-filtres').addEventListener('click', function (ev) {
    var bouton = ev.target.closest('[data-filtre]');
    if (!bouton) { return; }
    filtre = bouton.getAttribute('data-filtre');
    el('a-filtres').querySelectorAll('[data-filtre]').forEach(function (b) {
      b.classList.toggle('actif-filtre', b === bouton); b.setAttribute('aria-pressed',String(b===bouton));
    });
    afficherDemandes();
  });

  ['f-type','f-suivi','f-tri'].forEach(function(id){if(el(id)){el(id).addEventListener('change',afficherDemandes);}});
  if(el('f-paiement-recherche')){el('f-paiement-recherche').addEventListener('input',afficherPaiements);}
  if(el('crm-refresh')){el('crm-refresh').addEventListener('click',function(){chargerDemandes();chargerFamilles();});}
  if (!nuage.configure()) { montrer('p-refuse'); return; }
  entrer();
})();
