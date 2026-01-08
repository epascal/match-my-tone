# Guide de publication

## Publication sur GitHub

1. **Créer un dépôt sur GitHub** :
   - Allez sur https://github.com/new
   - Créez un nouveau dépôt (par exemple : `match-my-tone`)
   - **Ne cochez pas** "Initialize this repository with a README"

2. **Pousser le code** :
   ```bash
   git remote add origin https://github.com/VOTRE_USERNAME/match-my-tone.git
   git branch -M main
   git push -u origin main
   ```

3. **Créer une release** :
   - Allez dans "Releases" > "Create a new release"
   - Créez un tag (ex: `v1.0.0`)
   - Le workflow GitHub Actions créera automatiquement le package .zip

## Publication sur addons.mozilla.org (AMO)

### Prérequis

1. Créer un compte développeur sur https://addons.mozilla.org/developers/
2. Vérifier votre compte (email + téléphone)

### Étapes

1. **Préparer le package** :
   ```bash
   npm run build
   npm run package
   ```
   Cela crée `match-my-tone-{version}.zip`

2. **Soumettre l'extension** :
   - Allez sur https://addons.mozilla.org/developers/addon/submit/
   - Choisissez "Soumettre une nouvelle extension"
   - Téléversez le fichier `match-my-tone-{version}.zip`
   - Remplissez les informations :
     - **Nom** : Match My Tone
     - **Résumé** : Modifie la hauteur tonale des éléments audio et vidéo sur les pages web
     - **Description** : (voir ci-dessous)
     - **Catégorie** : Audio & Video
     - **Icônes** : Utilisez les fichiers dans `static/icons/`
     - **Captures d'écran** : (optionnel, mais recommandé)

3. **Description suggérée** :
   ```
   Match My Tone est une extension Firefox qui permet de modifier la hauteur tonale (pitch) des éléments audio et vidéo sur les pages web en temps réel.

   Fonctionnalités :
   - Modification du pitch en temps réel pour les éléments <audio> et <video>
   - Contrôle précis via demi-tons (semitones) avec pas de 0.5
   - Ajustement de la fréquence de base (Hz)
   - Activation/désactivation instantanée avec crossfade fluide
   - Compatible avec YouTube, SoundCloud et autres sites web
   - Support multilingue (Anglais, Français, Espagnol)
   - Persistance des paramètres par hostname

   Utilise la bibliothèque SoundTouch pour un traitement audio de haute qualité.
   ```

4. **Révision** :
   - Mozilla examinera votre extension (généralement 1-3 jours)
   - Vous recevrez un email avec le résultat
   - Si approuvé, l'extension sera disponible sur AMO

### Mise à jour

Pour publier une mise à jour :
1. Modifiez la version dans `static/manifest.json`
2. Rebuild et repackage :
   ```bash
   npm run build
   npm run package
   ```
3. Allez sur votre page développeur AMO
4. Cliquez sur "Nouvelle version"
5. Téléversez le nouveau .zip

### Notes importantes

- **Licence** : L'extension utilise SoundTouch sous licence LGPL v2.1
- **Permissions** : L'extension demande `activeTab` et `storage`
- **Manifest V2** : Compatible avec Firefox (Manifest V2)
- **Code source** : Considérez publier le code source sur GitHub pour la transparence
