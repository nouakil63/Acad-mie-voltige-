/* Espace académie — la plateforme d'administration (dossier /admin/).
   Réservée aux comptes de la liste « admins » (Supabase) :
   - Les demandes : valider ou refuser en un clic, télécharger le
     dossier d'inscription rempli.
   - Le planning des cours : les réservations des abonnés au trimestre.
   - La base clients : les comptes familles, et l'activation d'un
     trimestre après paiement. */
(function () {
  'use strict';

  var nuage = window.AVNuage;
  if (!nuage) { return; }

  var SERVICE = window.AV_SERVICE_URL ||
    'https://script.google.com/macros/s/AKfycbwOXOkUQ0-ls0l8nSCUoG9wkKVNUgiKc4DtO8PsNEmn-yCq4eJu4UbmsJaGYpvqkYpw9w/exec';

  var MOTIFS = { complet: 'Complet', age: 'Âge', gabarit: 'Gabarit', creneau: 'Créneau indisponible' };
  var VUES = ['p-attente', 'p-connexion', 'p-refuse', 'p-tableau'];
  var DUREE_TRIMESTRE = 90; /* jours : 13 semaines de cours */
  var ACOMPTE_STAGE = 300;   /* euros, dus a l'inscription ; solde 30 jours avant le stage */
  var CAPACITE_COURS = 8;    /* places par cours du mercredi (dites-le a Claude pour changer) */

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
  var reservations = [];
  var abonnements = [];
  var attentes = [];
  var filtre = 'toutes';
  var filtreTexte = '';

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
    var aujourdHui = isoLocal(new Date());
    el('c-resa').textContent = String(reservations.filter(function (r) { return r.date >= aujourdHui; }).length);
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

    var encaisseMois = 0, encaisseTotal = 0, resteTotal = 0, revenusCours = 0, revenusStages = 0;
    var validees = 0, reglees = 0;
    demandes.forEach(function (d) {
      if (d.annule) { return; }
      var recu = dejaEncaisse(d);
      encaisseTotal += recu;
      resteTotal += resteAEncaisser(d);
      if (d.type === 'stage') { revenusStages += recu; } else { revenusCours += recu; }
      var quand = String(d.solde_le || d.paye_le || d.acompte_le || '');
      if (recu > 0 && quand.indexOf(moisCourant) === 0) { encaisseMois += recu; }
      if (classeStatut(d.statut) === 'validee') { validees++; if (recu > 0) { reglees++; } }
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
    tuile(encaisseMois + ' €', 'encaissés ce mois-ci');
    tuile(resteTotal + ' €', 'restent à encaisser');
    tuile(encaisseTotal + ' €', 'encaissés en tout', true);

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
    var mercredi = prochainsMercredis(1)[0];
    var nMercredi = reservations.filter(function (r) { return r.date === mercredi; }).length;
    var liM = document.createElement('li');
    liM.textContent = 'Cours du ' + jourLisible(mercredi) + ' : ' + nMercredi + '/' + CAPACITE_COURS + ' inscrits';
    lProchains.appendChild(liM);
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
      'Encaissé en tout : ' + encaisseTotal + ' € (cours et trimestres : ' + revenusCours + ' € · stages : ' + revenusStages + ' €)',
      'Cours à venir réservés : ' + reservations.filter(function (r) { return r.date >= aujourdHui; }).length,
      validees ? 'Demandes validées réglées, au moins en partie : ' + reglees + ' sur ' + validees : 'Aucune demande validée pour l’instant.'
    ].forEach(function (texte) {
      var li = document.createElement('li');
      li.textContent = texte;
      lStats.appendChild(li);
    });
  }

  /* ================= L'export Excel (CSV) ================= */
  function exporterCSV(nom, entetes, lignes) {
    var contenu = '\ufeff' + [entetes].concat(lignes).map(function (l) {
      return l.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    window.__dernierCSV = contenu; /* relu par les tests automatiques */
    var url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  /* Ce qui reste dû sur une demande validée (0 si soldée ou annulée). */
  function resteAEncaisser(d) {
    if (classeStatut(d.statut) !== 'validee' || d.annule) { return 0; }
    var total = montantNumerique(d.tarif) || (d.type === 'stage' ? 840 : 0);
    if (d.type === 'stage') {
      var reste = 0;
      if (!d.acompte_paye) { reste += ACOMPTE_STAGE; }
      if (!d.solde_paye) { reste += Math.max(total - ACOMPTE_STAGE, 0); }
      return reste;
    }
    return d.paye ? 0 : total;
  }

  function dejaEncaisse(d) {
    if (d.type === 'stage') {
      var total = montantNumerique(d.tarif) || 840;
      return (d.acompte_paye ? ACOMPTE_STAGE : 0) + (d.solde_paye ? Math.max(total - ACOMPTE_STAGE, 0) : 0);
    }
    return d.paye ? montantNumerique(d.paye_montant || d.tarif) : 0;
  }

  /* ---- relances par e-mail (via le service Google, jeton signé) ---- */
  function relancer(d, sous, montant, silencieux) {
    var etiquettes = { acompte: 'l’acompte (300 €)', solde: 'le solde', paiement: 'le paiement', annulation: 'l’annulation' };
    if (!silencieux && !confirm('Envoyer au parent le mail concernant ' + (etiquettes[sous] || sous) + ' pour ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    nuage.sessionValide().then(function (session) {
      /* Le jeton signé de la demande prouve le lien ; pour les demandes
         reçues par un ancien déploiement (jeton plus reconnu), la session
         admin et les informations de la demande prennent le relais. */
      var corps = {
        type: 'relance', relance: sous,
        d: d.jeton_d || '', s: d.jeton_s || '',
        jeton: session ? session.jeton : '',
        dtype: d.type || '', enfant: d.enfant || '',
        parentEmail: d.parent_email || '', detail: d.detail || '',
        paiement: /Règlement choisi : Au trimestre/.test(d.lignes || '') ? 'trimestre'
          : /Règlement choisi : Au cours/.test(d.lignes || '') ? 'unite' : ''
      };
      if (montant) { corps.montant = montant; }
      return fetch(SERVICE, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(corps)
      }).then(function (r) { return r.text(); }).then(function (rep) {
        var morceaux = rep.trim().split(';');
        if (morceaux[0] === 'ok relance') { alert('C’est parti : le mail vient d’être envoyé à ' + (morceaux[1] || 'la famille') + '.'); }
        else { alert('Le service a répondu : « ' + rep.trim().slice(0, 120) + ' ». Le script Google est-il bien en version 19 ?'); }
      });
    }).catch(function () { alert('Le service n’a pas répondu. Vérifiez votre connexion et réessayez.'); });
  }

  /* Le bon mail de paiement selon la demande : acompte (300 €) puis
     solde pour un stage, paiement direct pour un cours. */
  function envoyerLienPaiement(d, silencieux) {
    var sous = d.type === 'stage' ? (d.acompte_paye ? 'solde' : 'acompte') : 'paiement';
    relancer(d, sous, null, silencieux);
  }

  function patchDemande(d, patch, apres) {
    nuage.requeteAuth('/rest/v1/demandes?id=eq.' + encodeURIComponent(d.id), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    }).then(function (r) {
      if (!r || !r.ok) { alert('La mise à jour n’a pas abouti (le SQL le plus récent a-t-il été joué dans Supabase ?).'); return; }
      Object.assign(d, patch);
      afficherDemandes();
      afficherPaiements();
      afficherPlanning();
      majCompteurs();
      if (apres) { apres(); }
    });
  }

  function marquerAcompte(d) {
    if (!confirm('Noter l’acompte de 300 € comme reçu pour ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    patchDemande(d, { acompte_paye: true, acompte_le: isoLocal(new Date()) });
  }
  function marquerSolde(d) {
    if (!confirm('Noter le solde comme reçu pour ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    patchDemande(d, { solde_paye: true, solde_le: isoLocal(new Date()) });
  }
  function annulerDemande(d) {
    var total = montantNumerique(d.tarif) || (d.type === 'stage' ? 840 : 0);
    var montant = prompt(
      'Annuler l’inscription de ' + (d.enfant || 'ce voltigeur') + '.\n' +
      'Montant à rembourser (de 0 € à ' + total + ' €) :', '0 €');
    if (montant === null) { return; }
    montant = montant.trim() || '0 €';
    if (!confirm('Confirmer l’annulation' + (montantNumerique(montant) ? ' avec un remboursement de ' + montant : ' sans remboursement') + ' ?')) { return; }
    patchDemande(d, { annule: true, annule_le: isoLocal(new Date()), rembourse_montant: montant }, function () {
      if (confirm('Prévenir la famille par e-mail (annulation' + (montantNumerique(montant) ? ' + remboursement de ' + montant : '') + ') ?')) {
        relancer(d, 'annulation', montant, true);
      }
    });
  }
  function retablirDemande(d) {
    if (!confirm('Rétablir l’inscription de ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    patchDemande(d, { annule: false, annule_le: null, rembourse_montant: null });
  }

  function modifierMontant(d) {
    var montant = prompt('Montant encaissé :', d.paye_montant || d.tarif || '');
    if (montant === null) { return; }
    patchDemande(d, { paye_montant: montant.trim() });
  }

  function retirerMarques(d) {
    if (!confirm('Retirer les marques « payé » (acompte + solde) sur le stage de ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    patchDemande(d, { acompte_paye: false, acompte_le: null, solde_paye: false, solde_le: null, paye: false, paye_le: null, paye_montant: null });
  }

  /* Un stage réglé d'un coup (par exemple payé en entier avant la mise
     en place de l'acompte) : tout est noté en un clic. */
  function reglerTotalite(d) {
    if (!confirm('Noter le stage de ' + (d.enfant || 'ce voltigeur') + ' comme réglé en totalité (acompte + solde) ?')) { return; }
    var jour = isoLocal(new Date());
    patchDemande(d, {
      acompte_paye: true, acompte_le: jour,
      solde_paye: true, solde_le: jour,
      paye: true, paye_le: jour, paye_montant: d.tarif || ''
    });
  }

  /* ---- La vérification des paiements sur Stripe ----
     Le service Google (qui garde la clé Stripe, secrète) renvoie les
     règlements reçus ; on les rapproche ici des demandes en attente. */
  function verifierStripe() {
    var bouton = el('b-stripe');
    var etat = el('m-stripe');
    bouton.disabled = true;
    etat.textContent = 'Interrogation de Stripe…';
    nuage.sessionValide().then(function (s) {
      if (!s) { bouton.disabled = false; etat.textContent = ''; alert('Reconnectez-vous puis réessayez.'); return; }
      return fetch(SERVICE, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'stripe', jeton: s.jeton })
      }).then(function (r) { return r.text(); }).then(function (t) {
        bouton.disabled = false;
        etat.textContent = '';
        var rep = null;
        try { rep = JSON.parse(t); } catch (e) { /* réponse texte : un souci */ }
        if (!rep || !rep.ok) {
          var texte = String(t || '').trim();
          if (texte.indexOf('stripe non configuree') === 0) { alert('La clé Stripe n’est pas encore collée dans le script Google (ligne STRIPE_CLE). Tant qu’elle n’y est pas, cette vérification reste indisponible.'); }
          else if (texte.indexOf('acces refuse') === 0) { alert('Le service n’a pas reconnu votre compte académie. Reconnectez-vous puis réessayez.'); }
          else if (texte.indexOf('cle stripe refusee') === 0) { alert('Stripe a refusé la clé collée dans le script. Vérifiez la clé restreinte (lecture des sessions Checkout).'); }
          else { alert('Le service a répondu : « ' + texte.slice(0, 120) + ' ». Le script Google est-il bien en version 19 ?'); }
          return;
        }
        rapprocherStripe(rep.paiements || []);
      });
    }).catch(function () {
      bouton.disabled = false;
      etat.textContent = '';
      alert('Le service n’a pas répondu. Vérifiez votre connexion et réessayez.');
    });
  }

  function rapprocherStripe(paiements) {
    var libres = paiements.filter(function (p) { return p && p.email && p.montant > 0; });
    var reportes = 0;
    demandes.filter(function (d) { return resteAEncaisser(d) > 0 && d.parent_email; }).forEach(function (d) {
      var email = String(d.parent_email).toLowerCase();
      var total = montantNumerique(d.tarif) || (d.type === 'stage' ? 840 : 0);
      var solde = Math.max(total - ACOMPTE_STAGE, 0);
      for (var i = 0; i < libres.length; i++) {
        var p = libres[i];
        if (String(p.email).toLowerCase() !== email) { continue; }
        var patch = null, quoi = '';
        var jour = /^\d{4}-\d{2}-\d{2}$/.test(String(p.quand)) ? p.quand : isoLocal(new Date());
        if (d.type === 'stage') {
          if (p.montant >= total && total > 0) {
            patch = { acompte_paye: true, acompte_le: jour, solde_paye: true, solde_le: jour, paye: true, paye_le: jour, paye_montant: p.montant + ' €' };
            quoi = 'la totalité du stage';
          } else if (p.montant === ACOMPTE_STAGE && !d.acompte_paye) {
            patch = { acompte_paye: true, acompte_le: jour };
            quoi = 'l’acompte (300 €)';
          } else if (p.montant === solde && d.acompte_paye && !d.solde_paye) {
            patch = { solde_paye: true, solde_le: jour };
            quoi = 'le solde (' + solde + ' €)';
          }
        } else if (!d.paye && total > 0 && p.montant >= total) {
          patch = { paye: true, paye_le: jour, paye_montant: p.montant + ' €' };
          quoi = 'le paiement (' + p.montant + ' €)';
        }
        if (!patch) { continue; }
        libres.splice(i, 1);
        if (confirm('Stripe : ' + p.montant + ' € reçus de ' + d.parent_email + ' le ' +
          new Date(jour + 'T12:00:00').toLocaleDateString('fr-FR') + '.\nNoter ' + quoi + ' pour ' + (d.enfant || 'ce voltigeur') + ' ?')) {
          patchDemande(d, patch);
          reportes++;
        }
        break;
      }
    });
    var bilan = reportes
      ? 'C’est noté : ' + reportes + (reportes > 1 ? ' paiements reportés' : ' paiement reporté') + ' depuis Stripe.'
      : 'Aucun nouveau paiement Stripe ne correspond aux demandes en attente de règlement.';
    if (libres.length) {
      bilan += '\n\nReçus sur Stripe, sans correspondance avec une demande en attente (déjà réglée, e-mail ou montant différent) :\n· ' +
        libres.slice(0, 8).map(function (p) {
          return p.montant + ' € · ' + p.email +
            (/^\d{4}-\d{2}-\d{2}$/.test(String(p.quand)) ? ' · ' + new Date(p.quand + 'T12:00:00').toLocaleDateString('fr-FR') : '');
        }).join('\n· ') +
        '\n\nSi vous reconnaissez un règlement, notez-le à la main sur la bonne ligne (Réglé en totalité, Acompte reçu, Solde reçu ou Marquer payé).';
    }
    alert(bilan);
  }

  /* ================= Les paiements =================
     Note maison : le trimestre est dû, que le voltigeur vienne ou non. */
  function montantNumerique(texte) {
    var m = String(texte || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }

  function marquerPaye(d) {
    var montant = prompt('Montant encaissé pour ' + (d.enfant || 'ce voltigeur') + ' :', d.tarif || '');
    if (montant === null) { return; }
    var patch = { paye: true, paye_le: isoLocal(new Date()), paye_montant: montant.trim() };
    nuage.requeteAuth('/rest/v1/demandes?id=eq.' + encodeURIComponent(d.id), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    }).then(function (r) {
      if (!r || !r.ok) { alert('Le paiement n’a pas pu être noté (le SQL le plus récent a-t-il été joué dans Supabase ?).'); return; }
      Object.assign(d, patch);
      afficherDemandes();
      afficherPaiements();
      majCompteurs();
    });
  }

  function annulerPaye(d) {
    if (!confirm('Retirer la marque « payé » sur la demande de ' + (d.enfant || 'ce voltigeur') + ' ?')) { return; }
    var patch = { paye: false, paye_le: null, paye_montant: null };
    nuage.requeteAuth('/rest/v1/demandes?id=eq.' + encodeURIComponent(d.id), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(patch)
    }).then(function () {
      Object.assign(d, patch);
      afficherDemandes();
      afficherPaiements();
      majCompteurs();
    });
  }

  function pastilleEtat(texte, bonne) {
    var p = document.createElement('span');
    p.className = 'pastille ' + (bonne ? 'validee' : 'attente');
    p.textContent = texte;
    return p;
  }

  /* Un tableau type CRM : en-tetes de colonnes + corps, dans un cadre
     qui defile horizontalement sur petit ecran. */
  function fabriquerTableau(conteneur, colonnes) {
    var cadre = document.createElement('div');
    cadre.className = 'cadre-tableau';
    var table = document.createElement('table');
    table.className = 'tableau';
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    colonnes.forEach(function (c) {
      var th = document.createElement('th');
      th.textContent = c;
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

  function lignePaiement(d, groupe) {
    var ligne = document.createElement('tr');
    ligne.className = 'carte-demande st-' + (groupe === 'regle' ? 'validee' : groupe === 'annule' ? 'refusee' : 'attente');

    var type = document.createElement('span');
    type.className = 'pastille ' + (d.type === 'stage' ? 'type-stage' : 'type-cours');
    type.textContent = d.type === 'stage' ? 'Stage' : 'Cours';
    cellule(ligne, type);

    var qui = document.createElement('td');
    var nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = d.enfant || 'Voltigeur';
    qui.appendChild(nom);
    var parent = document.createElement('div');
    parent.className = 'corps';
    parent.textContent = (d.parent_nom || 'Parent') + ' · ' + (d.parent_email || '');
    qui.appendChild(parent);
    ligne.appendChild(qui);

    var montant = document.createElement('td');
    montant.appendChild(document.createTextNode(d.tarif || ''));
    var reste = resteAEncaisser(d);
    if (groupe === 'du' && d.type === 'stage') {
      var du = document.createElement('div');
      du.className = 'corps';
      du.textContent = 'reste dû : ' + reste + ' €';
      montant.appendChild(du);
    }
    ligne.appendChild(montant);

    var etat = document.createElement('td');
    if (groupe === 'annule') {
      var pAnnule = document.createElement('span');
      pAnnule.className = 'pastille refusee';
      pAnnule.textContent = 'annulé' + (montantNumerique(d.rembourse_montant) ? ' · remboursé ' + d.rembourse_montant : ' · sans remboursement');
      etat.appendChild(pAnnule);
    } else if (d.type === 'stage') {
      etat.appendChild(pastilleEtat(d.acompte_paye ? 'acompte ✓' : 'acompte dû', !!d.acompte_paye));
      etat.appendChild(pastilleEtat(d.solde_paye ? 'solde ✓' : 'solde dû', !!d.solde_paye));
    } else if (d.paye) {
      etat.appendChild(pastilleEtat('payé' + (d.paye_montant ? ' · ' + d.paye_montant : ''), true));
    }
    ligne.appendChild(etat);

    var quand = document.createElement('span');
    quand.className = 'quand';
    quand.textContent = groupe === 'annule' && d.annule_le
      ? 'annulé le ' + new Date(d.annule_le + 'T12:00:00').toLocaleDateString('fr-FR')
      : groupe === 'regle' && (d.paye_le || d.solde_le || d.acompte_le)
        ? 'réglé le ' + new Date((d.solde_le || d.paye_le || d.acompte_le) + 'T12:00:00').toLocaleDateString('fr-FR')
        : quandLisible(d.cree);
    cellule(ligne, quand);

    var actions = document.createElement('div');
    actions.className = 'actions';

    if (groupe === 'annule') {
      var retablir = document.createElement('button');
      retablir.type = 'button';
      retablir.className = 'lien-doux';
      retablir.textContent = 'Rétablir l’inscription';
      retablir.addEventListener('click', function () { retablirDemande(d); });
      actions.appendChild(retablir);
    } else if (d.type === 'stage') {
      if (!d.acompte_paye) {
        var bAcompte = document.createElement('button');
        bAcompte.type = 'button';
        bAcompte.className = 'btn btn-rouge';
        bAcompte.innerHTML = '<span>Acompte reçu</span>';
        bAcompte.addEventListener('click', function () { marquerAcompte(d); });
        actions.appendChild(bAcompte);
        var rAcompte = document.createElement('button');
        rAcompte.type = 'button';
        rAcompte.className = 'lien-doux';
        rAcompte.textContent = 'Relancer l’acompte';
        rAcompte.addEventListener('click', function () { relancer(d, 'acompte'); });
        actions.appendChild(rAcompte);
      } else if (!d.solde_paye) {
        var bSolde = document.createElement('button');
        bSolde.type = 'button';
        bSolde.className = 'btn btn-rouge';
        bSolde.innerHTML = '<span>Solde reçu</span>';
        bSolde.addEventListener('click', function () { marquerSolde(d); });
        actions.appendChild(bSolde);
        var rSolde = document.createElement('button');
        rSolde.type = 'button';
        rSolde.className = 'lien-doux';
        rSolde.textContent = 'Relancer le solde';
        rSolde.addEventListener('click', function () { relancer(d, 'solde'); });
        actions.appendChild(rSolde);
      }
      if (!(d.acompte_paye && d.solde_paye)) {
        var totalite = document.createElement('button');
        totalite.type = 'button';
        totalite.className = 'lien-doux';
        totalite.textContent = 'Réglé en totalité';
        totalite.addEventListener('click', function () { reglerTotalite(d); });
        actions.appendChild(totalite);
      } else {
        actions.appendChild(lienAction('Modifier le montant', function () { modifierMontant(d); }));
        actions.appendChild(lienAction('Retirer les marques « payé »', function () { retirerMarques(d); }));
      }
      var annuler = document.createElement('button');
      annuler.type = 'button';
      annuler.className = 'lien-doux';
      annuler.textContent = 'Annuler / rembourser';
      annuler.addEventListener('click', function () { annulerDemande(d); });
      actions.appendChild(annuler);
    } else if (groupe === 'regle') {
      actions.appendChild(lienAction('Modifier le montant', function () { modifierMontant(d); }));
      var retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'lien-doux';
      retirer.textContent = 'Retirer la marque « payé »';
      retirer.addEventListener('click', function () { annulerPaye(d); });
      actions.appendChild(retirer);
    } else {
      var payer = document.createElement('button');
      payer.type = 'button';
      payer.className = 'btn btn-rouge';
      payer.innerHTML = '<span>Marquer payé</span>';
      payer.addEventListener('click', function () { marquerPaye(d); });
      actions.appendChild(payer);
      var rPaiement = document.createElement('button');
      rPaiement.type = 'button';
      rPaiement.className = 'lien-doux';
      rPaiement.textContent = 'Relancer le paiement';
      rPaiement.addEventListener('click', function () { relancer(d, 'paiement'); });
      actions.appendChild(rPaiement);
    }
    cellule(ligne, actions);
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

    var dus = demandes.filter(function (d) { return resteAEncaisser(d) > 0; });
    var regles = demandes.filter(function (d) { return !d.annule && resteAEncaisser(d) === 0 && dejaEncaisse(d) > 0; });
    var lesAnnules = demandes.filter(function (d) { return d.annule; });

    var COLONNES_PAIEMENTS = ['Type', 'Voltigeur', 'Montant', 'État', 'Date', 'Actions'];
    var totalDu = 0, totalRegle = 0, totalRembourse = 0;
    if (dus.length) {
      var corpsDus = fabriquerTableau(encaisser, COLONNES_PAIEMENTS);
      dus.forEach(function (d) { totalDu += resteAEncaisser(d); corpsDus.appendChild(lignePaiement(d, 'du')); });
    }
    if (regles.length) {
      var corpsRegles = fabriquerTableau(payes, COLONNES_PAIEMENTS);
      regles.forEach(function (d) { totalRegle += dejaEncaisse(d); corpsRegles.appendChild(lignePaiement(d, 'regle')); });
    }
    if (lesAnnules.length) {
      var corpsAnnules = fabriquerTableau(annules, COLONNES_PAIEMENTS);
      lesAnnules.forEach(function (d) { totalRembourse += montantNumerique(d.rembourse_montant); corpsAnnules.appendChild(lignePaiement(d, 'annule')); });
    }

    el('t-encaisser').textContent = dus.length ? 'environ ' + totalDu + ' €' : '';
    el('t-payes').textContent = regles.length ? totalRegle + ' € encaissés' : '';
    el('t-annules').textContent = lesAnnules.length ? totalRembourse + ' € remboursés' : '';

    if (!dus.length) {
      var v1 = document.createElement('p');
      v1.className = 'aide';
      v1.textContent = 'Rien à encaisser : toutes les demandes validées sont réglées.';
      encaisser.appendChild(v1);
    }
    if (!regles.length) {
      var v2 = document.createElement('p');
      v2.className = 'aide';
      v2.textContent = 'Aucun paiement complet pour l’instant.';
      payes.appendChild(v2);
    }
    if (!lesAnnules.length) {
      var v3 = document.createElement('p');
      v3.className = 'aide';
      v3.textContent = 'Aucune annulation.';
      annules.appendChild(v3);
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
  function ajouterDemande() {
    var type = prompt('Quel type de demande ? (cours ou stage)', 'cours');
    if (type === null) { return; }
    type = /stage/i.test(type) ? 'stage' : 'cours';
    var enfant = prompt('Nom du voltigeur :', '');
    if (enfant === null || !enfant.trim()) { return; }
    var parentNom = prompt('Nom du parent :', '');
    if (parentNom === null) { return; }
    var email = prompt('E-mail du parent :', '');
    if (email === null) { return; }
    var detail = prompt(type === 'stage' ? 'Quel stage ? (intitulé et dates)' : 'Quelle formule ?',
      type === 'stage' ? 'Stage de la Toussaint (Du 19 au 24 octobre 2026)' : 'Cours du mercredi');
    if (detail === null) { return; }
    var tarif = prompt('Tarif :', type === 'stage' ? '840 € / semaine' : '25 € / cours');
    if (tarif === null) { return; }
    var validee = confirm('Noter la demande directement « validée » ? (Annuler = en attente)');
    var ligne = {
      type: type, enfant: enfant.trim(), parent_nom: parentNom.trim(), parent_email: email.trim(),
      detail: detail.trim(), tarif: tarif.trim(),
      lignes: 'Ajoutée à la main depuis l’espace académie.',
      statut: validee ? 'validée' : 'en attente'
    };
    if (validee) { ligne.decide = new Date().toISOString(); }
    nuage.requeteAuth('/rest/v1/demandes', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(ligne)
    }).then(function (r) {
      if (!r || !r.ok) { alert('L’ajout n’a pas abouti (le SQL le plus récent, v7, a-t-il été joué dans Supabase ?).'); return; }
      if (validee && /.+@.+\..+/.test(ligne.parent_email) &&
          confirm('Envoyer tout de suite le lien de paiement à ' + ligne.parent_email +
            (type === 'stage' ? ' (acompte de 300 €) ?' : ' (cours) ?'))) {
        envoyerLienPaiement(ligne, true);
      }
      chargerDemandes();
    });
  }

  function modifierDemande(d) {
    var enfant = prompt('Nom du voltigeur :', d.enfant || '');
    if (enfant === null) { return; }
    var parentNom = prompt('Nom du parent :', d.parent_nom || '');
    if (parentNom === null) { return; }
    var email = prompt('E-mail du parent :', d.parent_email || '');
    if (email === null) { return; }
    var detail = prompt(d.type === 'stage' ? 'Stage (intitulé et dates) :' : 'Formule :', d.detail || '');
    if (detail === null) { return; }
    var tarif = prompt('Tarif :', d.tarif || '');
    if (tarif === null) { return; }
    patchDemande(d, {
      enfant: enfant.trim(), parent_nom: parentNom.trim(), parent_email: email.trim(),
      detail: detail.trim(), tarif: tarif.trim()
    });
  }

  function supprimerDemande(d) {
    if (!confirm('Supprimer la demande de ' + (d.enfant || 'ce voltigeur') + ' ? Son suivi de paiement disparaît aussi.')) { return; }
    nuage.requeteAuth('/rest/v1/demandes?id=eq.' + encodeURIComponent(d.id), {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    }).then(function (r) {
      if (!r || !r.ok) { alert('La suppression n’a pas abouti (le SQL le plus récent, v7, a-t-il été joué dans Supabase ?).'); return; }
      demandes = demandes.filter(function (x) { return x !== d; });
      afficherDemandes();
      afficherPaiements();
      afficherPlanning();
      majCompteurs();
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
    var c = document.createElement('tr');
    c.className = 'carte-demande st-' + classeStatut(d.statut);

    var type = document.createElement('span');
    type.className = 'pastille ' + (d.type === 'stage' ? 'type-stage' : 'type-cours');
    type.textContent = d.type === 'stage' ? 'Stage' : 'Cours';
    cellule(c, type);

    var qui = document.createElement('td');
    var nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = d.enfant || 'Voltigeur';
    qui.appendChild(nom);
    var parent = document.createElement('div');
    parent.className = 'corps';
    parent.textContent = (d.parent_nom || 'Parent') + ' · ' + (d.parent_email || '');
    qui.appendChild(parent);
    c.appendChild(qui);

    var demande = document.createElement('td');
    demande.appendChild(document.createTextNode(detailCourt(d)));
    if (d.tarif) {
      var tarif = document.createElement('div');
      tarif.className = 'corps';
      tarif.textContent = d.tarif;
      demande.appendChild(tarif);
    }
    if (d.lignes) {
      var plus = document.createElement('details');
      var resume = document.createElement('summary');
      resume.textContent = 'Tout le dossier';
      plus.appendChild(resume);
      var pre = document.createElement('pre');
      pre.textContent = d.lignes;
      plus.appendChild(pre);
      demande.appendChild(plus);
    }
    c.appendChild(demande);

    var etatTd = document.createElement('td');
    var statut = document.createElement('span');
    statut.className = 'pastille ' + classeStatut(d.statut);
    statut.textContent = d.statut || 'en attente';
    etatTd.appendChild(statut);
    c.appendChild(etatTd);

    var quand = document.createElement('span');
    quand.className = 'quand';
    quand.textContent = quandLisible(d.cree);
    cellule(c, quand);

    var actions = document.createElement('div');
    actions.className = 'actions';

    if (classeStatut(d.statut) === 'attente' && d.jeton_d && d.jeton_s) {
      var valider = document.createElement('button');
      valider.type = 'button';
      valider.className = 'btn btn-rouge';
      valider.innerHTML = '<span>Valider</span>';
      valider.addEventListener('click', function () { decider(d, 'valider', null, c); });
      actions.appendChild(valider);

      var motif = document.createElement('select');
      motif.setAttribute('aria-label', 'Motif du refus');
      Object.keys(MOTIFS).forEach(function (cle) {
        var o = document.createElement('option');
        o.value = cle;
        o.textContent = 'Motif : ' + MOTIFS[cle];
        motif.appendChild(o);
      });
      actions.appendChild(motif);

      var refuser = document.createElement('button');
      refuser.type = 'button';
      refuser.className = 'btn btn-contour';
      refuser.innerHTML = '<span>Refuser</span>';
      refuser.addEventListener('click', function () { decider(d, 'refuser', motif.value, c); });
      actions.appendChild(refuser);

      var etat = document.createElement('span');
      etat.className = 'quand';
      etat.style.marginLeft = '0';
      actions.appendChild(etat);
      c.etatAction = etat;
      c.boutons = [valider, refuser];
    }

    if (d.annule) {
      var pAnnulee = document.createElement('span');
      pAnnulee.className = 'pastille refusee';
      pAnnulee.textContent = 'annulé';
      etatTd.appendChild(pAnnulee);
    } else if (d.type === 'stage' && classeStatut(d.statut) === 'validee') {
      var pA = document.createElement('span');
      pA.className = 'pastille ' + (d.acompte_paye ? 'validee' : 'attente');
      pA.textContent = d.acompte_paye ? 'acompte ✓' : 'acompte dû';
      etatTd.appendChild(pA);
      var pS = document.createElement('span');
      pS.className = 'pastille ' + (d.solde_paye ? 'validee' : 'attente');
      pS.textContent = d.solde_paye ? 'solde ✓' : 'solde dû';
      etatTd.appendChild(pS);
    } else if (d.paye) {
      var payee = document.createElement('span');
      payee.className = 'pastille validee';
      payee.textContent = 'payé' + (d.paye_montant ? ' · ' + d.paye_montant : '');
      etatTd.appendChild(payee);
    } else if (d.type !== 'stage' && classeStatut(d.statut) === 'validee') {
      var payer = document.createElement('button');
      payer.type = 'button';
      payer.className = 'lien-doux';
      payer.textContent = 'Marquer payé';
      payer.addEventListener('click', function () { marquerPaye(d); });
      actions.appendChild(payer);
    }

    /* demande ajoutée à la main (pas de jeton) : décision directe, sans mail */
    if (classeStatut(d.statut) === 'attente' && !(d.jeton_d && d.jeton_s)) {
      actions.appendChild(lienAction('Marquer validée', function () {
        if (!confirm('Noter la demande de ' + (d.enfant || 'ce voltigeur') + ' comme validée ? (Aucun mail ne part.)')) { return; }
        patchDemande(d, { statut: 'validée', decide: new Date().toISOString() });
      }));
      actions.appendChild(lienAction('Marquer refusée', function () {
        if (!confirm('Noter la demande de ' + (d.enfant || 'ce voltigeur') + ' comme refusée ? (Aucun mail ne part.)')) { return; }
        patchDemande(d, { statut: 'refusée (à la main)', decide: new Date().toISOString() });
      }));
    }

    if (classeStatut(d.statut) === 'validee' && !d.annule && resteAEncaisser(d) > 0) {
      actions.appendChild(lienAction('Envoyer le lien de paiement', function () { envoyerLienPaiement(d); }));
    }

    var dossier = document.createElement('button');
    dossier.type = 'button';
    dossier.className = 'lien-doux';
    dossier.textContent = 'Dossier d’inscription rempli (imprimer / PDF)';
    dossier.addEventListener('click', function () { ouvrirDossier(d); });
    actions.appendChild(dossier);
    actions.appendChild(lienAction('Modifier', function () { modifierDemande(d); }));
    actions.appendChild(lienAction('Supprimer', function () { supprimerDemande(d); }));

    cellule(c, actions);
    return c;
  }

  function afficherDemandes() {
    var conteneur = el('a-demandes');
    conteneur.innerHTML = '';
    var visibles = demandes.filter(function (d) {
      if (filtreTexte && JSON.stringify(d).toLowerCase().indexOf(filtreTexte) === -1) { return false; }
      if (filtre === 'toutes') { return true; }
      if (filtre === 'en attente') { return classeStatut(d.statut) === 'attente'; }
      if (filtre === 'validée') { return classeStatut(d.statut) === 'validee'; }
      return classeStatut(d.statut) === 'refusee';
    });
    if (!visibles.length) {
      var vide = document.createElement('p');
      vide.className = 'aide';
      vide.textContent = demandes.length
        ? 'Aucune demande dans cette catégorie.'
        : 'Aucune demande pour l’instant. Elles apparaîtront ici dès qu’un parent enverra une inscription depuis le site.';
      conteneur.appendChild(vide);
      return;
    }
    var corpsTableau = fabriquerTableau(conteneur, ['Type', 'Voltigeur', 'Demande', 'Statut', 'Reçue le', 'Actions']);
    visibles.forEach(function (d) { corpsTableau.appendChild(carteDemande(d)); });
    majCompteurs();
  }

  function decider(d, action, motifCle, carteEl) {
    var question = action === 'valider'
      ? 'Valider la demande de ' + (d.enfant || 'ce voltigeur') + ' ? Le parent reçoit aussitôt le mail avec le lien de paiement.'
      : 'Refuser la demande de ' + (d.enfant || 'ce voltigeur') + ' (motif : ' + (MOTIFS[motifCle] || motifCle) + ') ? Le parent reçoit un message courtois avec ce motif.';
    if (!confirm(question)) { return; }

    carteEl.boutons.forEach(function (b) { b.disabled = true; });
    carteEl.etatAction.textContent = 'Envoi en cours…';

    var corps = { type: 'decision', action: action, d: d.jeton_d, s: d.jeton_s };
    if (action === 'refuser') { corps.motif = motifCle; }

    fetch(SERVICE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(corps)
    }).then(function (r) { return r.text(); }).then(function (t) {
      var morceaux = t.trim().split(';');
      if (morceaux[0] !== 'ok valide' && morceaux[0] !== 'ok refuse') {
        carteEl.boutons.forEach(function (b) { b.disabled = false; });
        carteEl.etatAction.textContent = 'Souci : « ' + t.trim().slice(0, 120) + ' ». Réessayez, ou utilisez les boutons du mail.';
        return;
      }
      var statut = morceaux[0] === 'ok valide'
        ? 'validée'
        : 'refusée (' + (MOTIFS[motifCle] || motifCle) + ')';
      d.statut = statut;
      d.decide = new Date().toISOString();
      /* le service note aussi le statut ; cette mise à jour rend la page exacte tout de suite */
      nuage.requeteAuth('/rest/v1/demandes?id=eq.' + encodeURIComponent(d.id), {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ statut: statut, decide: d.decide })
      });
      afficherDemandes();
    }).catch(function () {
      carteEl.boutons.forEach(function (b) { b.disabled = false; });
      carteEl.etatAction.textContent = 'Le service n’a pas répondu. Vérifiez votre connexion et réessayez.';
    });
  }

  function chargerDemandes() {
    message('m-liste', 'Chargement des demandes…', true);
    return nuage.requeteAuth('/rest/v1/demandes?select=*&order=cree.desc&limit=200')
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (l) {
        if (!l) { message('m-liste', 'Impossible de charger les demandes. Rechargez la page dans un instant.'); return; }
        demandes = l;
        el('m-liste').hidden = true;
        afficherDemandes();
        afficherPlanning();
        afficherPaiements();
      })
      .catch(function () { message('m-liste', 'Impossible de charger les demandes. Rechargez la page dans un instant.'); });
  }

  /* ================= Le planning en cases ================= */
  var caseChoisie = null;

  function lundiDe(iso) {
    var m = String(iso).split('-');
    var d = new Date(Number(m[0]), Number(m[1]) - 1, Number(m[2]), 12);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoLocal(d);
  }

  function prochainsMercredis(n) {
    var jours = [];
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    while (jours.length < n) {
      if (d.getDay() === 3) { jours.push(isoLocal(d)); }
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

    var aujourdHui = isoLocal(new Date());
    var parDate = {};
    reservations.forEach(function (r) {
      if (r.date >= aujourdHui) { (parDate[r.date] = parDate[r.date] || []).push(r); }
    });
    var dates = {};
    prochainsMercredis(8).forEach(function (d) { dates[d] = true; });
    Object.keys(parDate).forEach(function (d) { dates[d] = true; });
    Object.keys(dates).sort().forEach(function (date) {
      var n = (parDate[date] || []).length;
      var sousTitre = n
        ? n + '/' + CAPACITE_COURS + (n > 1 ? ' inscrits' : ' inscrit') + (n >= CAPACITE_COURS ? ' · complet' : '')
        : 'aucun inscrit · ' + CAPACITE_COURS + ' places';
      gCours.appendChild(casePlanning(jourLisible(date), sousTitre, false,
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
      var date = caseChoisie.date;
      titre.textContent = 'Cours du ' + jourLisible(date);
      var inscrits = parDate[date] || [];
      inscrits.forEach(function (r) {
        var li = document.createElement('li');
        li.textContent = (r.enfant || 'Voltigeur') + (r.email ? ' · ' + r.email : '');
        li.appendChild(lienAction('Retirer', function () { retirerReservation(r); }));
        liste.appendChild(li);
      });
      if (!inscrits.length) {
        var aucun = document.createElement('li');
        aucun.textContent = 'Personne pour l’instant.';
        liste.appendChild(aucun);
      }
      var enAttente = attentes.filter(function (a) { return a.date === date; });
      if (enAttente.length) {
        var titreAttente = document.createElement('li');
        titreAttente.style.fontWeight = '700';
        titreAttente.textContent = 'Liste d’attente :';
        liste.appendChild(titreAttente);
        enAttente.forEach(function (a) {
          var li = document.createElement('li');
          li.textContent = (a.enfant || 'Voltigeur') + (a.email ? ' · ' + a.email : '');
          li.appendChild(lienAction('Prévenir (place libre)', function () { prevenirAttente(a); }));
          li.appendChild(lienAction('Retirer de la liste', function () { retirerAttente(a); }));
          liste.appendChild(li);
        });
      }
      actions.appendChild(boutonAjout(function () { ajouterInscritCours(date); }));
      actions.appendChild(lienAction('Feuille de présence', function () {
        ouvrirFeuille({
          titre: 'Cours du ' + jourLisible(date),
          sousTitre: 'Cours de voltige · 14h00 à 16h00',
          colonnes: ['Présent'],
          lignes: inscrits.map(function (r) { return { nom: r.enfant || 'Voltigeur', info: r.email || '' }; })
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
  function ajouterInscritCours(date) {
    var nActuel = reservations.filter(function (r) { return r.date === date; }).length;
    if (nActuel >= CAPACITE_COURS && !confirm('Ce cours est complet (' + nActuel + '/' + CAPACITE_COURS + '). Ajouter quand même ?')) { return; }
    var enfant = prompt('Nom du voltigeur à inscrire au cours du ' + jourLisible(date) + ' :', '');
    if (enfant === null || !enfant.trim()) { return; }
    var email = prompt('E-mail du parent (facultatif) :', '');
    if (email === null) { return; }
    nuage.requeteAuth('/rest/v1/reservations', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ abonnement_id: null, enfant: enfant.trim(), email: email.trim(), jour: 'mercredi', date: date, semaine: lundiDe(date) })
    }).then(function (r) {
      if (!r || !r.ok) { alert('L’ajout n’a pas abouti (le SQL le plus récent, v7, a-t-il été joué dans Supabase ?).'); return; }
      chargerReservations();
    });
  }

  function retirerReservation(r) {
    if (!confirm('Retirer ' + (r.enfant || 'ce voltigeur') + ' de ce cours ?')) { return; }
    nuage.requeteAuth('/rest/v1/reservations?id=eq.' + encodeURIComponent(r.id), {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    }).then(function (rep) {
      if (!rep || !rep.ok) { alert('Le retrait n’a pas abouti. Réessayez dans un instant.'); return; }
      chargerReservations();
      var premier = attentes.filter(function (a) { return a.date === r.date; })[0];
      if (premier && confirm('Une place se libère le ' + jourLisible(r.date) + ' et ' + (premier.enfant || 'quelqu’un') +
        ' est en tête de la liste d’attente. Le prévenir par e-mail ?')) {
        prevenirAttente(premier, true);
      }
    });
  }

  /* ---- la liste d'attente d'un cours complet ---- */
  function prevenirAttente(a, silencieux) {
    if (!silencieux && !confirm('Prévenir ' + (a.enfant || 'ce voltigeur') + ' (' + (a.email || 'sans e-mail') + ') qu’une place est libre le ' + jourLisible(a.date) + ' ?')) { return; }
    if (!a.email) { alert('Cette attente n’a pas d’adresse e-mail : contactez la famille autrement.'); return; }
    nuage.sessionValide().then(function (session) {
      return fetch(SERVICE, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'place-libre', jeton: session ? session.jeton : '', email: a.email, enfant: a.enfant || '', quand: jourLisible(a.date) })
      }).then(function (r) { return r.text(); }).then(function (t) {
        if (t.trim().indexOf('ok place') === 0) {
          if (confirm('Le mail est parti. Retirer ' + (a.enfant || 'ce voltigeur') + ' de la liste d’attente ?')) { retirerAttente(a, true); }
        } else {
          alert('Le service a répondu : « ' + t.trim().slice(0, 120) + ' ». Le script Google est-il bien en version 19 ?');
        }
      });
    }).catch(function () { alert('Le service n’a pas répondu. Vérifiez votre connexion et réessayez.'); });
  }

  function retirerAttente(a, silencieux) {
    if (!silencieux && !confirm('Retirer ' + (a.enfant || 'ce voltigeur') + ' de la liste d’attente ?')) { return; }
    nuage.requeteAuth('/rest/v1/attentes?id=eq.' + encodeURIComponent(a.id), {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    }).then(function () { chargerAttentes(); });
  }

  function chargerAttentes() {
    return nuage.requeteAuth('/rest/v1/attentes?select=*&order=cree&limit=200')
      .then(function (r) { return r && r.ok ? r.json() : []; })
      .then(function (l) { attentes = l || []; afficherPlanning(); })
      .catch(function () { attentes = []; });
  }

  function ajouterInscritStage(cle) {
    var enfant = prompt('Nom du voltigeur à inscrire au stage :', '');
    if (enfant === null || !enfant.trim()) { return; }
    var parentNom = prompt('Nom du parent :', '');
    if (parentNom === null) { return; }
    var email = prompt('E-mail du parent (facultatif) :', '');
    if (email === null) { return; }
    nuage.requeteAuth('/rest/v1/demandes', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        type: 'stage', enfant: enfant.trim(), parent_nom: parentNom.trim(), parent_email: email.trim(),
        detail: cle, tarif: '840 € / semaine', statut: 'validée', decide: new Date().toISOString(),
        lignes: 'Ajoutée à la main depuis l’espace académie.'
      })
    }).then(function (r) {
      if (!r || !r.ok) { alert('L’ajout n’a pas abouti (le SQL le plus récent, v7, a-t-il été joué dans Supabase ?).'); return; }
      if (/.+@.+\..+/.test(email.trim()) &&
          confirm('Envoyer tout de suite le lien de paiement de l’acompte (300 €) à ' + email.trim() + ' ?')) {
        envoyerLienPaiement({ type: 'stage', enfant: enfant.trim(), parent_email: email.trim(), detail: cle, tarif: '840 € / semaine' }, true);
      }
      chargerDemandes();
    });
  }

  function chargerReservations() {
    return nuage.requeteAuth('/rest/v1/reservations?select=*&order=date&limit=500')
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (l) {
        if (!l) { message('m-resa', 'Impossible de charger les réservations. Le SQL le plus récent a-t-il été joué dans Supabase ?'); return; }
        reservations = l;
        el('m-resa').hidden = true;
        afficherPlanning();
        majCompteurs();
      })
      .catch(function () { message('m-resa', 'Impossible de charger les réservations. Rechargez la page dans un instant.'); });
  }

  /* ================= La base clients ================= */
  function abonnementDe(userId) {
    var aujourdHui = isoLocal(new Date());
    var courant = null;
    abonnements.forEach(function (a) {
      if (a.user_id !== userId) { return; }
      if (a.fin >= aujourdHui && (!courant || a.fin < courant.fin)) { courant = a; }
    });
    return courant;
  }

  function activerTrimestre(f) {
    var enfants = ((f.donnees || {}).enfants || []).filter(function (e) { return e && (e.prenom || e.nom); });
    var suggestion = enfants.length ? ((enfants[0].prenom + ' ' + (enfants[0].nom || '')).trim()) : '';
    var enfant = prompt('Le trimestre est pour quel voltigeur ?', suggestion);
    if (enfant === null) { return; }
    var debut = prompt('Premier jour du trimestre (AAAA-MM-JJ) :', isoLocal(new Date()));
    if (debut === null) { return; }
    debut = debut.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debut)) { alert('Date non comprise : écrivez-la comme 2026-09-14.'); return; }
    var m = debut.split('-');
    var finDate = new Date(Number(m[0]), Number(m[1]) - 1, Number(m[2]) + DUREE_TRIMESTRE, 12);
    var fin = isoLocal(finDate);
    if (!confirm('Activer un trimestre pour ' + (enfant || 'ce voltigeur') + ', du ' + debut + ' au ' + fin +
      ' ? Le parent pourra réserver un cours par semaine depuis Mon compte.')) { return; }
    nuage.requeteAuth('/rest/v1/abonnements', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: f.user_id, email: f.email || '', enfant: enfant || '', debut: debut, fin: fin })
    }).then(function (r) {
      if (r && r.ok) { chargerFamilles(); return; }
      message('m-familles', 'L’activation n’a pas abouti (le SQL le plus récent a-t-il été joué dans Supabase ?).');
    }).catch(function () {
      message('m-familles', 'L’activation n’a pas abouti. Vérifiez votre connexion et réessayez.');
    });
  }

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
    var abo = f.user_id ? abonnementDe(f.user_id) : null;
    if (abo) {
      var pAbo = document.createElement('span');
      pAbo.className = 'pastille validee';
      pAbo.textContent = 'Trimestre en cours';
      suivi.appendChild(pAbo);
      var finAbo = document.createElement('div');
      finAbo.className = 'corps';
      finAbo.textContent = (abo.enfant ? abo.enfant + ' · ' : '') + 'jusqu’au ' + new Date(abo.fin + 'T12:00:00').toLocaleDateString('fr-FR');
      suivi.appendChild(finAbo);
    }
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
      var activer = document.createElement('button');
      activer.type = 'button';
      activer.className = 'btn btn-contour';
      activer.innerHTML = '<span>Activer un trimestre</span>';
      activer.addEventListener('click', function () { activerTrimestre(f); });
      actions.appendChild(activer);
      actions.appendChild(lienAction(f.note_admin ? 'Modifier la note' : 'Ajouter une note', function () {
        var note = prompt('Note sur cette famille (visible de l’académie seulement) :', f.note_admin || '');
        if (note === null) { return; }
        nuage.requeteAuth('/rest/v1/familles?user_id=eq.' + encodeURIComponent(f.user_id), {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ note_admin: note.trim() || null })
        }).then(function (r) {
          if (!r || !r.ok) { alert('La note n’a pas pu être enregistrée (le SQL le plus récent, v8, a-t-il été joué dans Supabase ?).'); return; }
          f.note_admin = note.trim();
          afficherFamilles();
        });
      }));
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
      return JSON.stringify(f).toLowerCase().indexOf(mot) !== -1;
    });
    if (!visibles.length) {
      var vide = document.createElement('p');
      vide.className = 'aide';
      vide.textContent = familles.length
        ? 'Aucune famille ne correspond à cette recherche.'
        : 'Aucun compte famille pour l’instant.';
      conteneur.appendChild(vide);
      return;
    }
    var corpsTableau = fabriquerTableau(conteneur, ['Famille', 'Contact', 'Voltigeurs', 'Suivi', 'Actions']);
    visibles.forEach(function (f) { corpsTableau.appendChild(carteFamille(f)); });
  }

  function chargerFamilles() {
    message('m-familles', 'Chargement de la base clients…', true);
    return nuage.requeteAuth('/rest/v1/abonnements?select=*&order=debut.desc&limit=500')
      .then(function (r) { return r && r.ok ? r.json() : []; })
      .then(function (l) { abonnements = l || []; })
      .catch(function () { abonnements = []; })
      .then(function () {
        return nuage.requeteAuth('/rest/v1/familles?select=user_id,email,donnees,maj,note_admin&order=maj.desc&limit=500');
      })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (l) {
        if (!l) { message('m-familles', 'Impossible de charger la base clients. Rechargez la page dans un instant.'); return; }
        familles = l;
        el('m-familles').hidden = true;
        afficherFamilles();
        majCompteurs();
      })
      .catch(function () { message('m-familles', 'Impossible de charger la base clients. Rechargez la page dans un instant.'); });
  }

  /* ================= Accès et navigation ================= */
  function entrer() {
    montrer('p-attente');
    nuage.retrouverEmail().then(function (s) {
      if (!s) { montrer('p-connexion'); return; }
      nuage.requeteAuth('/rest/v1/admins?select=email&limit=1')
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
          chargerReservations();
          chargerAttentes();
        })
        .catch(function () { montrer('p-refuse'); });
    });
  }

  el('p-connexion').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = el('ad-email').value.trim(), mdp = el('ad-mdp').value;
    if (!/.+@.+\..+/.test(email) || !mdp) { message('m-admin', 'Indiquez votre e-mail et votre mot de passe.'); return; }
    message('m-admin', 'Connexion…', true);
    nuage.connexion(email, mdp).then(function (r) {
      if (r.erreur) { message('m-admin', r.erreur); return; }
      entrer();
    });
  });

  el('p-deconnexion').addEventListener('click', function (ev) {
    ev.preventDefault();
    nuage.deconnexion();
    el('p-compte').textContent = '';
    el('p-deconnexion').hidden = true;
    montrer('p-connexion');
  });

  document.querySelector('.onglets').addEventListener('click', function (ev) {
    var bouton = ev.target.closest('[data-onglet]');
    if (!bouton) { return; }
    var onglet = bouton.getAttribute('data-onglet');
    document.querySelectorAll('.onglets [data-onglet]').forEach(function (b) {
      b.classList.toggle('actif-onglet', b === bouton);
    });
    el('o-accueil').hidden = onglet !== 'accueil';
    el('o-demandes').hidden = onglet !== 'demandes';
    el('o-familles').hidden = onglet !== 'familles';
    el('o-reservations').hidden = onglet !== 'reservations';
    el('o-paiements').hidden = onglet !== 'paiements';
  });

  el('a-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerDemandes(); });
  el('b-stripe').addEventListener('click', verifierStripe);
  el('b-ajout-demande').addEventListener('click', ajouterDemande);
  el('d-recherche').addEventListener('input', function () {
    filtreTexte = this.value.trim().toLowerCase();
    afficherDemandes();
  });
  el('b-export-demandes').addEventListener('click', function () {
    exporterCSV('demandes-academie.csv',
      ['Type', 'Voltigeur', 'Parent', 'E-mail', 'Demande', 'Tarif', 'Statut', 'Reçue le', 'Paiement'],
      demandes.map(function (d) {
        return [d.type, d.enfant, d.parent_nom, d.parent_email, d.detail, d.tarif, d.statut, quandLisible(d.cree),
          d.annule ? 'annulé' : d.type === 'stage'
            ? (d.acompte_paye ? 'acompte reçu' : 'acompte dû') + ' / ' + (d.solde_paye ? 'solde reçu' : 'solde dû')
            : d.paye ? 'payé ' + (d.paye_montant || '') : 'non payé'];
      }));
  });
  el('b-export-paiements').addEventListener('click', function () {
    exporterCSV('paiements-academie.csv',
      ['Type', 'Voltigeur', 'Parent', 'E-mail', 'Tarif', 'Encaissé (€)', 'Reste dû (€)', 'État', 'Réglé le'],
      demandes.filter(function (d) { return classeStatut(d.statut) === 'validee' || d.annule; }).map(function (d) {
        return [d.type, d.enfant, d.parent_nom, d.parent_email, d.tarif, dejaEncaisse(d), resteAEncaisser(d),
          d.annule ? 'annulé' + (montantNumerique(d.rembourse_montant) ? ' · remboursé ' + d.rembourse_montant : '')
            : resteAEncaisser(d) > 0 ? 'en attente' : 'réglé',
          d.solde_le || d.paye_le || d.acompte_le || ''];
      }));
  });
  el('f-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerFamilles(); });
  el('r-rafraichir').addEventListener('click', function (ev) { ev.preventDefault(); chargerReservations(); });
  el('f-recherche').addEventListener('input', afficherFamilles);

  el('a-filtres').addEventListener('click', function (ev) {
    var bouton = ev.target.closest('[data-filtre]');
    if (!bouton) { return; }
    filtre = bouton.getAttribute('data-filtre');
    el('a-filtres').querySelectorAll('[data-filtre]').forEach(function (b) {
      b.classList.toggle('actif-filtre', b === bouton);
    });
    afficherDemandes();
  });

  if (!nuage.configure()) { montrer('p-refuse'); return; }
  entrer();
})();
