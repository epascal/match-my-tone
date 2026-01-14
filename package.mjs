#!/usr/bin/env node

/**
 * Script to create a .zip package for publishing on addons.mozilla.org
 * Creates a match-my-tone-{version}.zip file with the contents of dist/
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
    console.warn('Unable to read version from manifest.json, using 1.0.0');
    return '1.0.0';
  }
}

async function createZip(sourceDir, zipPath, description) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    output.on('close', () => {
      const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      console.log(`✓ ${description} created: ${zipPath}`);
      console.log(`  Size: ${sizeMB} MB`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add all files from sourceDir to the root of the zip
    archive.directory(sourceDir, false);

    archive.finalize();
  });
}

async function createPackage() {
  const version = await getVersion();
  const distDir = join(__dirname, 'dist');
  const srcDir = join(__dirname, 'src');
  const distZipPath = join(__dirname, `match-my-tone-${version}.zip`);
  const srcZipPath = join(__dirname, `match-my-tone-src-${version}.zip`);

  // Check that dist/ exists
  try {
    await stat(distDir);
  } catch (err) {
    console.error('❌ The dist/ directory does not exist. Run "npm run build" first');
    process.exit(1);
  }

  // Check that src/ exists
  try {
    await stat(srcDir);
  } catch (err) {
    console.error('❌ The src/ directory does not exist.');
    process.exit(1);
  }

  // Create both zip files
  await createZip(distDir, distZipPath, 'Package');
  await createZip(srcDir, srcZipPath, 'Source package');
}

createPackage().catch((err) => {
  console.error('❌ Error creating package:', err);
  process.exit(1);
});
