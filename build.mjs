#!/usr/bin/env node

/**
 * Build script for Match My Tone Firefox extension
 * Uses esbuild to compile TypeScript to JavaScript
 */

import { build, context } from 'esbuild';
import { readdir, copyFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');

/**
 * Recursively copies static files to dist/
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
    console.log('✓ Static files copied');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    console.log('⚠ static/ directory not found, ignored');
  }
}

/**
 * esbuild configuration for different entry points
 */
const buildOptions = {
  entryPoints: [
    'src/background/background.ts',
    'src/content/content-script.ts',
    'src/popup/popup.ts',
    'src/audio/processor.ts',
  ],
  bundle: false, // No bundling for Firefox extensions
  outdir: 'dist',
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  sourcemap: true,
  minify: false, // Keep code readable for debugging
  tsconfig: 'tsconfig.json',
};

/**
 * Compiles the Rust crate to WASM and copies the binary to dist/audio/.
 * Requires: rustup with wasm32-unknown-unknown target.
 * Falls back gracefully if Rust is not installed.
 */
async function buildWasm() {
  const wasmCrateDir = join(__dirname, 'wasm');
  const distAudioDir = join(__dirname, 'dist', 'audio');

  try {
    await stat(wasmCrateDir);
  } catch {
    console.log('⚠ wasm/ directory not found, skipping WASM build');
    return;
  }

  try {
    console.log('🦀 Building WASM from Rust...');
    execSync(
      'cargo build --release --target wasm32-unknown-unknown',
      { cwd: wasmCrateDir, stdio: 'pipe', env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` } }
    );

    const wasmSrc = join(
      wasmCrateDir, 'target', 'wasm32-unknown-unknown', 'release', 'soundtouch_wasm.wasm'
    );
    await mkdir(distAudioDir, { recursive: true });
    await copyFile(wasmSrc, join(distAudioDir, 'soundtouch.wasm'));
    console.log('✓ WASM built and copied to dist/audio/soundtouch.wasm');
  } catch (err) {
    console.warn('⚠ WASM build failed (Rust/cargo not installed?). JS fallback will be used.');
    console.warn('  ', err.message || err);
  }
}

/**
 * Main build function
 */
async function main() {
  console.log('🔨 Building Match My Tone extension...\n');
  
  // Copy static files
  await copyStaticFiles();
  
  // Build WASM (before TS so fallback is always ready)
  await buildWasm();
  
  if (isWatch) {
    console.log('👀 Watch mode enabled\n');
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log('✓ Build complete, waiting for changes...\n');
  } else {
    const result = await build(buildOptions);
    if (result.errors.length === 0) {
      console.log('✓ Build completed successfully\n');
    } else {
      console.error('✗ Build errors:', result.errors);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('✗ Build error:', err);
  process.exit(1);
});
