# Vidéo du hero

Déposer ici la vidéo d'accueil :

- `hero.mp4` — H.264, 1920×1080, **sans piste audio**, idéalement < 8 Mo
  (boucle de 10–20 s : voltigeur au galop, plans du manège, la mer…).
- `hero.webm` — facultatif, même contenu en VP9 (plus léger, servi en priorité).
- `poster.jpg` — image affichée avant le chargement (une frame de la vidéo).

Tant que ces fichiers sont absents, `index.html` affiche automatiquement
le fond animé rouge de secours. Aucun changement de code n'est nécessaire :
il suffit de déposer les fichiers.

Conseils d'export (ffmpeg) :

    ffmpeg -i source.mov -an -vf "scale=1920:-2" -c:v libx264 -crf 28 -preset slow -movflags +faststart hero.mp4
    ffmpeg -i source.mov -an -vf "scale=1920:-2" -c:v libvpx-vp9 -crf 38 -b:v 0 hero.webm
    ffmpeg -i hero.mp4 -vframes 1 -q:v 3 poster.jpg
