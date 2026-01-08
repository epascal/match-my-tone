# Match My Tone - Extension Firefox

Extension Firefox pour modifier la hauteur tonale (pitch) des éléments audio et vidéo sur les pages web en temps réel.

## Fonctionnalités

- Modification du pitch en temps réel pour les éléments `<audio>` et `<video>`
- Contrôle précis via demi-tons (semitones)
- Ajustement de la fréquence de base (Hz)
- Activation/désactivation instantanée avec crossfade fluide
- Compatible avec YouTube, SoundCloud et autres sites web

## Prérequis

- Node.js 18+ et npm
- Firefox (pour tester l'extension)

## Installation et Build

1. **Installer les dépendances** :
   ```bash
   npm install
   ```

2. **Compiler le projet** :
   ```bash
   npm run build
   ```
   
   Cela compile les fichiers TypeScript dans `dist/` et copie les fichiers statiques.

3. **Mode développement (watch)** :
   ```bash
   npm run watch
   ```
   
   Recompile automatiquement lors des modifications.

4. **Charger l'extension dans Firefox** :
   - Ouvrez Firefox
   - Allez dans `about:debugging`
   - Cliquez sur "Ce Firefox" dans le menu de gauche
   - Cliquez sur "Charger un module complémentaire temporaire"
   - Sélectionnez le fichier `dist/manifest.json`

## Utilisation

1. Cliquez sur l'icône de l'extension dans la barre d'outils
2. Activez le changement de pitch avec la case à cocher
3. Ajustez le décalage en demi-tons avec le curseur (-12 à +12)
4. Ajustez la fréquence de base si nécessaire (400-480 Hz, par défaut 440 Hz = La4)

## Structure du projet

```
pitchchange/
├── src/                    # Sources TypeScript
│   ├── background/
│   │   └── background.ts   # Script background avec types
│   ├── content/
│   │   └── content-script.ts # Content script avec types
│   ├── popup/
│   │   ├── popup.ts        # Logique du popup
│   │   └── popup.html      # HTML (copié vers static/)
│   ├── audio/
│   │   └── processor.ts    # AudioWorklet Processor en TS
│   ├── types/
│   │   ├── messages.ts     # Types pour les messages
│   │   ├── audio.ts        # Types pour l'audio
│   │   └── webextension.d.ts # Types Firefox
│   └── utils/
│       └── pitch-calculator.ts # Utilitaires de calcul
├── static/                  # Fichiers statiques (copiés vers dist/)
│   ├── manifest.json       # Configuration de l'extension
│   ├── popup.html          # Interface utilisateur
│   ├── popup.css           # Styles
│   └── icons/              # Icônes de l'extension
├── dist/                    # Fichiers compilés (générés)
├── tsconfig.json           # Configuration TypeScript
├── package.json            # Dépendances et scripts
├── build.mjs               # Script de build esbuild
└── README.md
```

## Comment ça fonctionne

1. **Content Script** : Détecte les éléments audio/vidéo et crée un `AudioContext`
2. **AudioWorklet** : Charge le processeur SoundTouch (`soundtouch-processor`)
3. **Traitement** : Crée deux chemins parallèles :
   - Bypass : signal original
   - Effet : signal traité par SoundTouch
4. **Crossfade** : Mélange les deux signaux avec un fade fluide lors de l'activation/désactivation

## SoundTouch

Le plugin utilise la bibliothèque [SoundTouch](https://soundtouch.surina.net/) pour le traitement audio en temps réel. SoundTouch permet de modifier le pitch, le tempo et le taux d'échantillonnage sans altérer les autres paramètres audio.

## Développement

### Scripts disponibles

- `npm run build` - Compile le projet en mode production
- `npm run watch` - Compile en mode watch (recompilation automatique)
- `npm run clean` - Nettoie le dossier `dist/`

### Workflow de développement

1. Lancez `npm run watch` pour activer le mode watch
2. Modifiez les fichiers TypeScript dans `src/`
3. Les fichiers sont automatiquement recompilés dans `dist/`
4. Dans Firefox (`about:debugging`), cliquez sur "Recharger" à côté de l'extension

### Architecture TypeScript

Le projet utilise TypeScript avec :
- **Types stricts** : Tous les fichiers avec types explicites
- **Commentaires JSDoc** : Documentation complète des fonctions
- **Modularité** : Séparation claire des responsabilités
- **Build rapide** : esbuild pour compilation ultra-rapide

## Notes

- Les paramètres sont stockés par onglet
- Le crossfade utilise une transition de 150ms pour éviter les clics audio
- Compatible avec les pages dynamiques (YouTube, etc.) grâce à un `MutationObserver`

## Licence

Ce projet utilise SoundTouch sous licence LGPL v2.1.
