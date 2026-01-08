#!/usr/bin/env node

/**
 * Script pour créer un package .zip pour la publication sur addons.mozilla.org
 * Crée un fichier match-my-tone-{version}.zip avec le contenu de dist/
 */

import { createWriteStream } from 'fs';
import { readFile, readdir, stat } from 'fs/promises';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getVersion() {
  try {
    const manifestPath = join(__dirname, 'static', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    return manifest.version || '1.0.0';
  } catch (err) {
    console.warn('Impossible de lire la version depuis manifest.json, utilisation de 1.0.0');
    return '1.0.0';
  }
}

async function createPackage() {
  const version = await getVersion();
  const distDir = join(__dirname, 'dist');
  const zipPath = join(__dirname, `match-my-tone-${version}.zip`);

  // Vérifier que dist/ existe
  try {
    await stat(distDir);
  } catch (err) {
    console.error('❌ Le dossier dist/ n\'existe pas. Lancez d\'abord "npm run build"');
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Compression maximale
    });

    output.on('close', () => {
      const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`✓ Package créé : ${zipPath}`);
      console.log(`  Taille : ${sizeMB} MB`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Ajouter tous les fichiers de dist/ à la racine du zip
    archive.directory(distDir, false);

    archive.finalize();
  });
}

createPackage().catch((err) => {
  console.error('❌ Erreur lors de la création du package:', err);
  process.exit(1);
});
