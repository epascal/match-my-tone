#!/usr/bin/env node

/**
 * Script de build pour l'extension Firefox Match My Tone
 * Utilise esbuild pour compiler TypeScript en JavaScript
 */

import { build, context } from 'esbuild';
import { readdir, copyFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');

/**
 * Copie récursivement les fichiers statiques vers dist/
 */
async function copyStaticFiles() {
  const staticDir = join(__dirname, 'static');
  const distDir = join(__dirname, 'dist');
  
  async function copyRecursive(src, dest) {
    await mkdir(dest, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await copyRecursive(srcPath, destPath);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  }
  
  try {
    await stat(staticDir);
    await copyRecursive(staticDir, distDir);
    console.log('✓ Fichiers statiques copiés');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    console.log('⚠ Dossier static/ non trouvé, ignoré');
  }
}

/**
 * Configuration esbuild pour les différents points d'entrée
 */
const buildOptions = {
  entryPoints: [
    'src/background/background.ts',
    'src/content/content-script.ts',
    'src/popup/popup.ts',
    'src/audio/processor.ts',
  ],
  bundle: false, // Pas de bundling pour les extensions Firefox
  outdir: 'dist',
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  sourcemap: true,
  minify: false, // Garder le code lisible pour le debug
  tsconfig: 'tsconfig.json',
};

/**
 * Fonction principale de build
 */
async function main() {
  console.log('🔨 Build de l\'extension Match My Tone...\n');
  
  // Copie les fichiers statiques
  await copyStaticFiles();
  
  if (isWatch) {
    console.log('👀 Mode watch activé\n');
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log('✓ Build terminé, en attente de modifications...\n');
  } else {
    const result = await build(buildOptions);
    if (result.errors.length === 0) {
      console.log('✓ Build terminé avec succès\n');
    } else {
      console.error('✗ Erreurs de build:', result.errors);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('✗ Erreur lors du build:', err);
  process.exit(1);
});
