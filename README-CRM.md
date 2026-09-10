# CRM de l’Académie — version 22

Cette mise à jour améliore l’interface d’administration et la fiabilité du service. Elle nécessite une mise à jour coordonnée de Supabase, de Google Apps Script et du site. GitHub Pages ne publie ni le SQL ni le script Google automatiquement.

## Changements

- Interface responsive aux couleurs de l’académie, navigation bureau/mobile, dialogues accessibles et notifications. Les ajouts, modifications, notes, règlements et dates sont saisis dans des formulaires, avec validation.
- Recherche sans accents, filtres combinables par activité/statut/suivi, tri et nombre de résultats. Les exports respectent les recherches/filtres de leur écran.
- Chargement de toutes les pages de demandes/familles, sans limites silencieuses à 200/500 lignes. Si une page échoue, les données précédentes sont conservées et le défaut d’actualisation est signalé.
- Planning par date et heure normalisée ; validation samedi/date à venir/capacité de huit inscrits aussi côté base. Les anciens dossiers restent consultables et leur suivi de paiement reste modifiable.
- Notes stockées dans une table exclusivement administrative ; migration des anciennes notes avant retrait de la colonne exposée aux propriétaires des carnets.
- Carnet local lié à son compte, prévention des mélanges sur appareil partagé et des écrasements sur panne. Un carnet invité n’est adopté qu’avec accord ; les anciens carnets sans propriétaire ne sont pas repris automatiquement. Les carnets distants restent disponibles.
- Registre Stripe par identifiant de session, rapprochement transactionnel et conservation de l’affectation même si une case de paiement est ensuite retirée. Les correspondances ambiguës ne sont pas attribuées automatiquement.
- Journal des décisions signées et verrou avant envoi pour empêcher les décisions et e-mails répétés sur un même lien.
- Encaissements des stages ventilés entre les mois de l’acompte et du solde. Annulation possible pour cours et stages ; un montant de remboursement déclaré n’effectue aucune opération bancaire.
- Tableau de bord des encaissements bruts, y compris les inscriptions annulées, avec remboursements déclarés séparés. Les dates déjà enregistrées sont conservées lorsqu’un stage est soldé. Un changement de tarif ne peut pas modifier artificiellement les sommes reçues ; une inscription remboursée reste archivée et ne peut pas être rétablie comme payée.

## Installation sur une base existante

1. Prévoir une courte fenêtre sans édition du CRM. Sauvegarder la base selon la procédure habituelle du projet et conserver la version/configuration actuelle du script Google.
2. Dans le SQL Editor Supabase, sous le rôle propriétaire, exécuter successivement :
   - `service/migrations/20260911_notes_crm.sql`
   - `service/migrations/20260911_paiements_crm.sql`
   - `service/migrations/20260911_planning_crm.sql`
3. Dans le projet Google Apps Script existant, conserver les paramètres de production et remplacer le code par `service/Code.gs` version 22. Utiliser de préférence les propriétés de script `SUPABASE_URL`, `SUPABASE_CLE_SERVICE` et `STRIPE_CLE`. Les constantes historiques restent des valeurs de repli ; ne pas remplacer une configuration fonctionnelle par les placeholders du dépôt. Conserver impérativement la propriété `secret` utilisée par les anciens liens signés.
4. Publier une nouvelle version du **déploiement Apps Script existant**, pour conserver l’URL `/exec` déjà utilisée par le site. Vérifier que la page d’information du service indique la version 22.
5. Publier le frontend sur la branche de production `claude/academie-voltige-style-x4qbuv`, après réussite des tests. Les fichiers JS concernés ont de nouvelles versions de cache. Recharger le CRM et les éventuelles installations mobiles.
6. Avec un compte administrateur, vérifier lecture des familles, notes, liste des demandes et planning. Tester une action métier uniquement sur un dossier de test identifié ; vérifier la boîte Gmail et le registre Supabase avant de confirmer le fonctionnement en production.

Pour une installation neuve, exécuter d’abord `service/supabase.sql`, puis `service/supabase-admin.sql`, puis les trois migrations ci-dessus.

Les migrations sont transactionnelles et peuvent être rejouées. La migration des notes retire `familles.note_admin` après copie : l’ancien frontend ne peut donc plus modifier les notes après cette étape. Le registre Stripe empêche la suppression physique d’un dossier ayant un règlement affecté ; utiliser son annulation pour conserver l’historique.

## Vérification locale

Node.js 24 et PGlite 0.5.8 sont utilisés. PGlite fournit un PostgreSQL local ; aucune connexion à Supabase, Google ou Stripe n’est utilisée par les tests.

Installer la dépendance de test hors du dépôt :

```sh
npm install --prefix ../tmp/academie-crm-test-tools --no-audit --no-fund --ignore-scripts @electric-sql/pglite@0.5.8
node --test tests/*.test.cjs
```

Un emplacement différent peut être indiqué par `AV_SQL_TEST_TOOLS` (dossier contenant `node_modules`) ou `PGLITE_MODULE_PATH` (chemin absolu du package). Les tests portent sur règles financières, pagination, auth/stockage, Stripe/Apps Script avec mocks, et migrations/RLS exécutées réellement dans PostgreSQL local.

L’aperçu navigateur utilise exclusivement des données fictives :

```sh
node tests/preview-server.cjs
```

Ouvrir `http://127.0.0.1:8765/admin/`. Si le port est occupé, définir `CRM_PREVIEW_PORT`. Cet aperçu remplace Supabase et le service Google par des routes locales en mémoire. Il permet de modifier des dossiers fictifs, des notes et des règlements sans envoyer d’e-mail réel. Les données sont réinitialisées au redémarrage du serveur. Un simple serveur statique, au contraire, garderait les adresses de production des pages.

La CI exécute ces contrôles sur les PR et branches `codex/`. Le déploiement Pages dépend également de leur réussite.

## Limites et exploitation

- La lecture Stripe couvre les sessions complètes et réglées des 120 derniers jours, en mode réel, devise EUR. Toutes les pages de cette fenêtre sont lues. La date disponible est celle de création de la session Checkout, pas une date de versement bancaire.
- Un règlement doit correspondre au montant attendu et à une demande compatible. Les fratries, règlements multiples ou historiques pouvant déjà avoir servi sont signalés pour vérification. Ne pas contourner une ambiguïté en décochant puis recochant arbitrairement les paiements.
- Les remboursements et contestations ne sont pas synchronisés depuis Stripe. Les montants saisis dans le CRM sont des déclarations ; un remboursement bancaire se fait dans Stripe ou par le moyen de règlement initial.
- Les cours gardent un montant global de règlement déclaré ; ce modèle ne constitue pas un journal de versements partiels. Les stages conservent deux échéances, acompte et solde.
- La capacité est de huit par **heure de début exacte**, pas par durée de séance. Les vacances scolaires ne sont pas modélisées. Ces règles concernent le planning CRM dans `demandes` ; la réservation autonome de l’espace famille reste désactivée et ses anciennes tables ne sont pas réactivées.
- Le garde-fou planning s’applique aux nouveaux placements/changements de créneau. L’installation ne corrige pas silencieusement les anciens créneaux ; il faut examiner les anciens horaires inhabituels ou sureffectifs manuellement.
- Gmail et PostgreSQL ne peuvent pas former une transaction unique. Une interruption après réservation d’une décision peut laisser un état « à vérifier ». Consulter `crm_decisions`, le dossier et les messages envoyés avant tout renvoi. Ne pas supprimer un journal de décision sans avoir vérifié si l’e-mail est parti.
- Les tests PostgreSQL locaux exécutent les droits, contraintes, transactions et verrous. PGlite utilise une seule connexion : une course entre deux sessions PostgreSQL indépendantes n’a pas été reproduite.

## Repli

Les nouvelles tables conservent des informations de suivi utiles : ne pas les supprimer pour revenir à un ancien frontend. En cas d’incident, arrêter les écritures concernées et diagnostiquer le service. Préférer revenir au commit testé le plus récent compatible avec ces migrations. Revenir à l’ancien traitement Stripe réintroduirait le risque de réutilisation des règlements ; revenir à l’ancienne colonne de notes réintroduirait son exposition aux familles.

L’installation réelle des migrations, la publication Apps Script et les opérations métiers de production ne sont pas effectuées par les tests ni par le serveur d’aperçu.
