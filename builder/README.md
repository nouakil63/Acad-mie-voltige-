# Le Manège — l'éditeur visuel du site

Un « builder » à la Elementor, taillé sur mesure pour le site de l'Académie de voltige.
Il tourne entièrement dans le navigateur : aucune installation, aucun serveur, aucune base de données.

## Ouvrir l'éditeur

- **Sur le site en ligne** : ouvrir `https://academiedevoltige.com/builder/`
- **En local** : lancer un petit serveur à la racine du dépôt, puis ouvrir `http://localhost:8000/builder/`

  ```bash
  python3 -m http.server 8000
  ```

  (L'éditeur ne fonctionne pas en ouvrant le fichier directement — il a besoin de `http` pour charger les pages.)

L'éditeur fonctionne **même pendant que le site affiche la page d'attente** : le déploiement
publie la page d'attente à la racine, l'éditeur sur `/builder/`, et une copie du vrai site sous
`/builder/site/` (non référencée, exclue des moteurs de recherche) dans laquelle l'éditeur charge
les pages et les photos. Chaque publication redéclenche le déploiement, la copie reste donc à jour.
Le jour où le site complet est mis en ligne, l'éditeur bascule tout seul sur les vraies pages.

## Ce qu'on peut faire

| Geste | Effet |
|---|---|
| Cliquer sur un élément | Le sélectionner — ses réglages apparaissent à droite |
| Double-cliquer sur un texte | L'écrire directement, avec gras / italique / liens |
| Cliquer sur une photo | La remplacer (fichier de l'ordinateur ou photothèque du site), changer son cadrage et son texte alternatif |
| Sélectionner une section | La monter, descendre, dupliquer, masquer ou supprimer |
| Glisser dans la liste « Sections » | Réordonner la page |
| Onglet « Design du site » | Changer les couleurs de tout le site |
| Onglet « Cette page » | Titre et description Google, réinitialisation de la page |
| `Ctrl+Z` / `Ctrl+Maj+Z` | Annuler / rétablir |
| Boutons ordinateur / tablette / mobile | Vérifier le rendu sur chaque écran |

La navigation et le pied de page sont **protégés** : leur contenu se modifie, mais ils ne peuvent être
ni déplacés ni supprimés (pour ne jamais casser le site).

Les modifications sont conservées en **brouillon dans le navigateur** tant qu'elles ne sont pas publiées :
on peut fermer l'onglet et reprendre plus tard sur le même ordinateur.

## Publier

Le bouton **Publier** envoie les fichiers modifiés sur GitHub ; GitHub Pages reconstruit le site
tout seul en une à deux minutes.

Il faut une seule chose, une seule fois : un **jeton d'accès GitHub** (fine-grained), à créer sur
<https://github.com/settings/personal-access-tokens/new> avec :

- **Repository access** : uniquement ce dépôt ;
- **Permissions → Contents : Read and write**.

Le jeton se colle dans « Réglages GitHub » de la fenêtre de publication ; il reste enregistré
uniquement dans le navigateur utilisé.

Sans jeton, le bouton **Télécharger** récupère les pages modifiées en fichiers `.html`
(photos incluses), à remettre en ligne à la main.

## Notes techniques

- L'éditeur charge les vraies pages du site dans un aperçu, les modifie dans le DOM, puis les
  ré-enregistre en HTML propre : commentaires, structure et classes d'origine sont préservés.
- Les nouvelles photos sont commitées dans `assets/img/` au moment de la publication.
- Les couleurs personnalisées sont écrites dans `assets/css/custom.css`, ajouté automatiquement
  aux pages ; supprimer ce fichier redonne les couleurs d'origine.
- Le dossier `/builder/` est exclu des moteurs de recherche (`robots.txt` + `noindex`).
- L'éditeur n'a pas de mot de passe : il ne peut rien publier sans le jeton GitHub, mais si vous
  préférez qu'il ne soit pas en ligne du tout, il suffit de ne pas déployer ce dossier.
