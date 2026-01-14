#!/usr/bin/env node

/**
 * Release script: increments version, builds, and packages
 * Usage: node release.mjs
 */

import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Increments a version string (e.g., "1.0.3" -> "1.0.4")
 */
function incrementVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid version format: ${version}`);
  }
  
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);
  
  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    throw new Error(`Invalid version format: ${version}`);
  }
  
  // Increment patch version
  const newPatch = patch + 1;
  return `${major}.${minor}.${newPatch}`;
}

/**
 * Updates version in a JSON file
 */
async function updateVersionInFile(filePath: string, newVersion: string): Promise<void> {
  const content = await readFile(filePath, 'utf-8');
  const json = JSON.parse(content);
  
  if (json.version) {
    const oldVersion = json.version;
    json.version = newVersion;
    const updated = JSON.stringify(json, null, 2) + '\n';
    await writeFile(filePath, updated, 'utf-8');
    console.log(`✓ Updated ${filePath}: ${oldVersion} -> ${newVersion}`);
  } else {
    console.warn(`⚠ No version field found in ${filePath}`);
  }
}

/**
 * Main release function
 */
async function release(): Promise<void> {
  console.log('🚀 Starting release process...\n');
  
  // 1. Read current version from package.json
  const packageJsonPath = join(__dirname, 'package.json');
  const packageJsonContent = await readFile(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(packageJsonContent);
  const currentVersion = packageJson.version;
  
  if (!currentVersion) {
    throw new Error('No version found in package.json');
  }
  
  const newVersion = incrementVersion(currentVersion);
  console.log(`📦 Version: ${currentVersion} -> ${newVersion}\n`);
  
  // 2. Update versions in all files
  console.log('📝 Updating versions...');
  await updateVersionInFile(packageJsonPath, newVersion);
  await updateVersionInFile(join(__dirname, 'manifest.json'), newVersion);
  await updateVersionInFile(join(__dirname, 'static', 'manifest.json'), newVersion);
  console.log('');
  
  // 3. Build
  console.log('🔨 Building...');
  try {
    const { stdout, stderr } = await execAsync('npm run build', { cwd: __dirname });
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    console.log('✓ Build completed\n');
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
  
  // 4. Package
  console.log('📦 Packaging...');
  try {
    const { stdout, stderr } = await execAsync('npm run package', { cwd: __dirname });
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    console.log('✓ Package completed\n');
  } catch (err) {
    console.error('❌ Package failed:', err);
    process.exit(1);
  }
  
  console.log(`✅ Release ${newVersion} completed successfully!`);
}

// Run release
release().catch((err) => {
  console.error('❌ Release failed:', err);
  process.exit(1);
});
