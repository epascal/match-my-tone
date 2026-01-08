# Icônes

Les icônes de l'extension sont déjà générées :

- `icon16.png` - 16x16 pixels (barre d'outils)
- `icon48.png` - 48x48 pixels (gestionnaire d'extensions)
- `icon96.png` - 96x96 pixels (store Firefox)
- `icon.svg` - Fichier source SVG

L'icône représente un chanteur stylisé avec un microphone et des notes de musique sur fond vert.

Pour régénérer les icônes PNG à partir du SVG :
```bash
magick -background none icons/icon.svg -resize 16x16 icons/icon16.png
magick -background none icons/icon.svg -resize 48x48 icons/icon48.png
magick -background none icons/icon.svg -resize 96x96 icons/icon96.png
```
