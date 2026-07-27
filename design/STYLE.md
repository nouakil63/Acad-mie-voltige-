# Direction artistique — « Le Manège » (v2)

Refonte du site de l'Académie de voltige équestre Fleur & Georges Cotrait (Auberville, Normandie).
Démo interactive : ouvrir `design/direction-artistique.html` dans un navigateur.
Référence couleur : `design/logo.jpeg`.

## Concept

Tout est déjà dans le logo : le cercle de longe, la chambrière, le rouge franc sur blanc.
L'identité du site le prolonge. La voltige se pratique sur un cheval au galop, en cercle,
en cadence à trois temps — d'où des formes circulaires et des arches, une seule courbe
d'animation « galop » et des apparitions rythmées par trois. Une seule couleur, une seule
famille de caractères.

## Couleurs (échantillonnées dans le logo)

| Token | Hex | Usage |
|---|---|---|
| `--rouge` (rouge Cotrait) | `#D00828` | Hero, accents, boutons — la couleur du logo |
| `--rouge-sombre` | `#A5081F` | Survols, dégradés de panneaux |
| `--rouge-vif` | `#F2415A` | Le rouge lisible sur fond sombre |
| `--blanc` | `#FFFFFF` | Fond principal — le blanc du logo |
| `--voile` | `#F7F3F0` | Surfaces secondaires, blanc cassé |
| `--encre` | `#1D1216` | Texte, bandeau, fond du thème sombre |

Règles : le rouge est la **seule** couleur du site — pas d'accent secondaire.
Thème sombre « soir de spectacle » : fond encre, texte voile, rouge vif pour les liens.

## Typographie

- **Une seule famille : Archivo** (variable — graisse 100–900, largeur 62–125 %, + italique).
  - Titres : majuscules, largeur 118 %, graisse ~830, interlettrage -0.5 %.
    Un mot par titre en rouge, ou « en creux » (contour blanc, `-webkit-text-stroke`) sur fond rouge.
  - Surtitres/étiquettes : largeur 82 %, graisse 700, majuscules, `letter-spacing: .24em`.
  - Corps : largeur 100 %, graisse 400, 17 px, interlignage 1.6, max 62 caractères.
  - Chiffres (prix, stats) : largeur 118 %, graisse 830, `font-variant-numeric: tabular-nums`.
- Interdits : Inter, Poppins, Space Grotesk, serifs d'apparat (Playfair, Bodoni…).

## Formes

- **Arche** (`border-radius: 999px 999px 0 0`) : cadres photo (portes d'écurie).
- **Cercle** en filet fin : badges tournants, pastilles, orbites — le cercle du logo.
- **Filet 1 px** pour structurer, hiérarchisé par la couleur (encre, rouge, trait).
- Angles vifs (rayon 0) partout ailleurs ; boutons en pilules (`border-radius: 999px`).
- Aucun rayon intermédiaire, pas de `rounded-lg`, pas d'ombres douces décoratives.

## Mouvement

- Courbe unique : `--galop: cubic-bezier(.32, .94, .60, 1)` (départ franc, réception souple).
- Cadence à trois temps : révélations décalées de 120 ms par groupes de trois.
- Entrée de page orchestrée une seule fois ; révélations au défilement ; balayage encre
  sur les boutons au survol ; bandeau défilant pour dates/actualités ; badge circulaire tournant.
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
