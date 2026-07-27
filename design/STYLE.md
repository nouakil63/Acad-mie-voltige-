# Direction artistique — « Le Manège »

Refonte du site de l'Académie de voltige équestre Fleur & Georges Cotrait (Auberville, Normandie).
Démo interactive : ouvrir `design/direction-artistique.html` dans un navigateur.

## Concept

Tout part du cercle de longe : la voltige se pratique sur un cheval au galop, en cercle,
en cadence à trois temps. L'identité en découle — formes circulaires et arches, une seule
courbe d'animation « galop », apparitions rythmées par trois. Le vert profond et l'or
viennent du monde équestre et de la scène (l'académie est aussi un théâtre).

## Couleurs

| Token | Hex | Usage |
|---|---|---|
| `--vert` (vert manège) | `#1F3A2D` | Hero, panneaux, pied de page |
| `--vert-fonce` | `#152920` | Dégradés de panneaux |
| `--encre` | `#17211B` | Texte, fond du thème sombre |
| `--sable` (sable d'arène) | `#EDE4CF` | Fond principal de jour |
| `--craie` | `#F7F2E7` | Surfaces, texte sur vert |
| `--or` (or de projecteur) | `#C99B3F` | Accent unique (liens, prix, badges) — `#DFB255` sur fond sombre |

Règles : jamais de blanc pur ni de noir pur ; un seul accent, utilisé avec parcimonie.
Thème sombre « soir de spectacle » : fond encre, texte craie, or vif.

## Typographie

- **Titres : Bodoni Moda** (didone d'affiche de spectacle, variable 400–900 + italique).
  L'italique souligne un seul mot par titre.
- **Texte & UI : Hanken Grotesk** (variable 300–800 + italique).
- Surtitres : Hanken 700, 12 px, majuscules, `letter-spacing: .22em`, couleur or.
- Interdits : Inter, Poppins, Space Grotesk, Playfair Display.

## Formes

- **Arche** (`border-radius: 999px 999px 0 0`) : cadres photo (portes d'écurie).
- **Cercle** en filet fin : badges tournants, pastilles, orbites décoratives.
- **Filet 1 px** pour structurer ; angles vifs (rayon 0) partout ailleurs.
- Boutons : pilules (`border-radius: 999px`). Aucun rayon intermédiaire, pas de `rounded-lg`.

## Mouvement

- Courbe unique : `--galop: cubic-bezier(.32, .94, .60, 1)` (départ franc, réception souple).
- Cadence à trois temps : révélations décalées de 120 ms par groupes de trois.
- Entrée de page orchestrée une seule fois ; révélations au défilement ; micro-interactions
  au survol (balayage or sur les boutons) ; bandeau défilant pour les actualités/dates.
- Toujours respecter `prefers-reduced-motion`.
- Interdits : parallaxe généralisée, particules, tilt 3D, curseurs personnalisés.

## Garde-fous anti « site généré »

- Grille asymétrique, jamais tout centré.
- Pas d'emoji en puces ou titres.
- Pas de dégradés violet/bleu, pas de glassmorphism.
- Vraies photos des chevaux et des enfants, cadrées en arche.

## Prochaine étape

Architecture des pages + système de réservation (stages, cours, inscriptions),
construit sur ces tokens.
