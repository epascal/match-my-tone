#!/usr/bin/env node

/**
 * Unit tests for the SoundTouch WASM module.
 * Run: node test-wasm.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 44100;
const CHANNELS = 2;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const ok = Math.abs(actual - expected) <= tolerance;
  assert(ok, `${message} (got ${actual}, expected ~${expected} ±${tolerance})`);
}

function loadWasm() {
  const wasmPath = join(__dirname, 'dist', 'audio', 'soundtouch.wasm');
  const buf = readFileSync(wasmPath);
  const mod = new WebAssembly.Module(buf);
  const instance = new WebAssembly.Instance(mod);
  return instance.exports;
}

function allocF32(exports, count) {
  const bytes = count * 4;
  const ptr = exports.wasm_alloc(bytes);
  return { ptr, bytes, count };
}

function generateSine(numFrames, freqHz, sampleRate) {
  const buf = new Float32Array(numFrames * CHANNELS);
  for (let i = 0; i < numFrames; i++) {
    const sample = Math.sin(2 * Math.PI * freqHz * i / sampleRate);
    buf[i * 2] = sample;
    buf[i * 2 + 1] = sample;
  }
  return buf;
}

function rms(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / arr.length);
}

// ---- FFT utilities ----

/** In-place radix-2 Cooley-Tukey FFT. `re` and `im` must have power-of-2 length. */
function fft(re, im) {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // Butterfly passes
  for (let len = 2; len <= n; len *= 2) {
    const halfLen = len / 2;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < halfLen; j++) {
        const a = i + j;
        const b = i + j + halfLen;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Extract the left channel from interleaved stereo. */
function extractLeft(interleaved, numFrames) {
  const mono = new Float64Array(numFrames);
  for (let i = 0; i < numFrames; i++) mono[i] = interleaved[i * 2];
  return mono;
}

/**
 * Find the dominant frequency in a mono signal using FFT.
 * Applies a Hann window, runs FFT, returns the frequency (Hz) of the peak bin.
 * `fftSize` must be a power of 2 and <= signal.length.
 */
function findPeakFrequency(signal, sampleRate, fftSize) {
  const n = fftSize;
  const re = new Float64Array(n);
  const im = new Float64Array(n);

  // Apply Hann window
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    re[i] = signal[i] * w;
  }

  fft(re, im);

  // Compute magnitude spectrum (only positive frequencies: bins 1..n/2-1)
  let peakMag = 0;
  let peakBin = 0;
  for (let k = 1; k < n / 2; k++) {
    const mag = re[k] * re[k] + im[k] * im[k];
    if (mag > peakMag) {
      peakMag = mag;
      peakBin = k;
    }
  }

  // Parabolic interpolation around peak for sub-bin accuracy
  if (peakBin > 0 && peakBin < n / 2 - 1) {
    const magPrev = Math.sqrt(re[peakBin - 1] ** 2 + im[peakBin - 1] ** 2);
    const magPeak = Math.sqrt(re[peakBin] ** 2 + im[peakBin] ** 2);
    const magNext = Math.sqrt(re[peakBin + 1] ** 2 + im[peakBin + 1] ** 2);
    const delta = 0.5 * (magNext - magPrev) / (2 * magPeak - magPrev - magNext);
    if (Number.isFinite(delta)) {
      return (peakBin + delta) * sampleRate / n;
    }
  }

  return peakBin * sampleRate / n;
}

/**
 * Drain all available output frames from the SoundTouch instance.
 * Reads in chunks until nothing more is available.
 */
function drainOutput(exports, handle, outBuf, drainChunk, outputChunks) {
  while (true) {
    const outView = new Float32Array(exports.memory.buffer, outBuf.ptr, drainChunk * CHANNELS);
    outView.fill(0);
    const received = exports.soundtouch_receive_samples(handle, outBuf.ptr, drainChunk);
    if (received === 0) break;
    const freshView = new Float32Array(exports.memory.buffer, outBuf.ptr, received * CHANNELS);
    outputChunks.push(Float32Array.from(freshView));
  }
}

/**
 * Feed input in chunks, process, and collect all output.
 * Uses generous flushing to handle the algorithm's latency.
 */
function processAudio(exports, handle, input, numFrames, chunkSize = 128) {
  const inBuf = allocF32(exports, chunkSize * CHANNELS);
  const drainChunk = 4096;
  const outBuf = allocF32(exports, drainChunk * CHANNELS);
  const outputChunks = [];
  let inPos = 0;

  // Feed real input
  while (inPos < numFrames) {
    const thisChunk = Math.min(chunkSize, numFrames - inPos);
    const src = input.subarray(inPos * CHANNELS, (inPos + thisChunk) * CHANNELS);
    const inView = new Float32Array(exports.memory.buffer, inBuf.ptr, chunkSize * CHANNELS);
    inView.fill(0);
    inView.set(src);

    exports.soundtouch_put_samples(handle, inBuf.ptr, thisChunk);
    exports.soundtouch_process(handle);
    drainOutput(exports, handle, outBuf, drainChunk, outputChunks);
    inPos += thisChunk;
  }

  // Flush: feed silence to push remaining data through the pipeline.
  // The Stretch needs ~6000 frames before producing output, so feed generously.
  const flushIterations = 80;
  for (let flush = 0; flush < flushIterations; flush++) {
    const inView = new Float32Array(exports.memory.buffer, inBuf.ptr, chunkSize * CHANNELS);
    inView.fill(0);
    exports.soundtouch_put_samples(handle, inBuf.ptr, chunkSize);
    exports.soundtouch_process(handle);
    drainOutput(exports, handle, outBuf, drainChunk, outputChunks);
  }

  exports.wasm_dealloc(inBuf.ptr, inBuf.bytes);
  exports.wasm_dealloc(outBuf.ptr, outBuf.bytes);

  const totalSamples = outputChunks.reduce((s, c) => s + c.length, 0);
  const result = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of outputChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ======================================================================
// Tests
// ======================================================================

console.log('\n=== SoundTouch WASM Unit Tests ===\n');

const exports = loadWasm();

// ---- Test 1: Module exports ----
console.log('1. Module exports');
{
  const required = [
    'memory', 'wasm_alloc', 'wasm_dealloc',
    'soundtouch_new', 'soundtouch_free',
    'soundtouch_set_rate', 'soundtouch_set_tempo', 'soundtouch_set_pitch',
    'soundtouch_put_samples', 'soundtouch_process', 'soundtouch_receive_samples',
    'soundtouch_clear',
  ];
  for (const name of required) {
    assert(name in exports, `export "${name}" exists`);
  }
}

// ---- Test 2: Lifecycle (new / free) ----
console.log('\n2. Lifecycle');
{
  const handle = exports.soundtouch_new(SAMPLE_RATE);
  assert(handle !== 0, 'soundtouch_new returns non-null handle');
  exports.soundtouch_free(handle);
  assert(true, 'soundtouch_free does not crash');
}

// ---- Test 3: Memory allocation ----
console.log('\n3. Memory allocation');
{
  const ptr = exports.wasm_alloc(1024);
  assert(ptr !== 0, 'wasm_alloc returns non-null pointer');
  const view = new Float32Array(exports.memory.buffer, ptr, 256);
  view[0] = 42.0;
  view[255] = -1.0;
  assert(view[0] === 42.0, 'can write/read f32 at allocated memory start');
  assert(view[255] === -1.0, 'can write/read f32 at allocated memory end');
  exports.wasm_dealloc(ptr, 1024);
  assert(true, 'wasm_dealloc does not crash');
}

// ---- Test 4: Parameter setters ----
console.log('\n4. Parameter setters');
{
  const handle = exports.soundtouch_new(SAMPLE_RATE);
  exports.soundtouch_set_rate(handle, 1.0);
  assert(true, 'set_rate(1.0) ok');
  exports.soundtouch_set_tempo(handle, 1.0);
  assert(true, 'set_tempo(1.0) ok');
  exports.soundtouch_set_pitch(handle, 1.5);
  assert(true, 'set_pitch(1.5) ok');
  exports.soundtouch_set_pitch(handle, 0.5);
  assert(true, 'set_pitch(0.5) ok');
  exports.soundtouch_set_rate(handle, 2.0);
  assert(true, 'set_rate(2.0) ok');
  exports.soundtouch_set_tempo(handle, 0.5);
  assert(true, 'set_tempo(0.5) ok');
  exports.soundtouch_clear(handle);
  assert(true, 'clear() ok');
  exports.soundtouch_free(handle);
}

// ---- Test 5: FFT pass-through (pitch=1.0, 440 Hz -> 440 Hz) ----
console.log('\n5. FFT pass-through (pitch=1.0, 440 Hz sine)');
{
  const handle = exports.soundtouch_new(SAMPLE_RATE);
  exports.soundtouch_set_pitch(handle, 1.0);

  const inputFreq = 440;
  const numFrames = 32768;
  const input = generateSine(numFrames, inputFreq, SAMPLE_RATE);
  const output = processAudio(exports, handle, input, numFrames);

  const totalOutputFrames = output.length / CHANNELS;
  assert(totalOutputFrames > 0, `produces output (${totalOutputFrames} frames)`);
  assert(rms(output) > 0.01, `output is not silent`);

  // FFT analysis: skip transient at start, use a stable portion
  const skipFrames = 4096;
  const fftSize = 8192;
  if (totalOutputFrames > skipFrames + fftSize) {
    const mono = extractLeft(output.subarray(skipFrames * CHANNELS), fftSize);
    const peakHz = findPeakFrequency(mono, SAMPLE_RATE, fftSize);
    assertApprox(peakHz, inputFreq, 15,
      `peak frequency = ${peakHz.toFixed(1)} Hz, expected ${inputFreq} Hz`);
  } else {
    assert(false, `not enough output for FFT (${totalOutputFrames} frames)`);
  }

  exports.soundtouch_free(handle);
}

// ---- Test 6: FFT pitch up (+6 semitones, 440 Hz -> ~622 Hz) ----
console.log('\n6. FFT pitch shift up (+6 semitones, 440 Hz -> 622 Hz)');
{
  const semitones = 6;
  const pitchRatio = Math.pow(2, semitones / 12);
  const inputFreq = 440;
  const expectedFreq = inputFreq * pitchRatio; // 622.25 Hz

  const handle = exports.soundtouch_new(SAMPLE_RATE);
  exports.soundtouch_set_pitch(handle, pitchRatio);

  const numFrames = 32768;
  const input = generateSine(numFrames, inputFreq, SAMPLE_RATE);
  const output = processAudio(exports, handle, input, numFrames);

  const totalOutputFrames = output.length / CHANNELS;
  assert(totalOutputFrames > 0, `produces output (${totalOutputFrames} frames)`);
  assert(rms(output) > 0.01, `output is not silent`);

  const skipFrames = 4096;
  const fftSize = 8192;
  if (totalOutputFrames > skipFrames + fftSize) {
    const mono = extractLeft(output.subarray(skipFrames * CHANNELS), fftSize);
    const peakHz = findPeakFrequency(mono, SAMPLE_RATE, fftSize);
    assertApprox(peakHz, expectedFreq, 25,
      `peak frequency = ${peakHz.toFixed(1)} Hz, expected ${expectedFreq.toFixed(1)} Hz`);
  } else {
    assert(false, `not enough output for FFT (${totalOutputFrames} frames)`);
  }

  exports.soundtouch_free(handle);
}

// ---- Test 7: FFT pitch down (-6 semitones, 440 Hz -> ~311 Hz) ----
console.log('\n7. FFT pitch shift down (-6 semitones, 440 Hz -> 311 Hz)');
{
  const semitones = -6;
  const pitchRatio = Math.pow(2, semitones / 12);
  const inputFreq = 440;
  const expectedFreq = inputFreq * pitchRatio; // 311.13 Hz

  const handle = exports.soundtouch_new(SAMPLE_RATE);
  exports.soundtouch_set_pitch(handle, pitchRatio);

  const numFrames = 32768;
  const input = generateSine(numFrames, inputFreq, SAMPLE_RATE);
  const output = processAudio(exports, handle, input, numFrames);

  const totalOutputFrames = output.length / CHANNELS;
  assert(totalOutputFrames > 0, `produces output (${totalOutputFrames} frames)`);
  assert(rms(output) > 0.01, `output is not silent`);

  const skipFrames = 4096;
  const fftSize = 8192;
  if (totalOutputFrames > skipFrames + fftSize) {
    const mono = extractLeft(output.subarray(skipFrames * CHANNELS), fftSize);
    const peakHz = findPeakFrequency(mono, SAMPLE_RATE, fftSize);
    assertApprox(peakHz, expectedFreq, 25,
      `peak frequency = ${peakHz.toFixed(1)} Hz, expected ${expectedFreq.toFixed(1)} Hz`);
  } else {
    assert(false, `not enough output for FFT (${totalOutputFrames} frames)`);
  }

  exports.soundtouch_free(handle);
}

// ---- Test 8: Stereo channel independence ----
console.log('\n8. Stereo channel independence');
{
  const handle = exports.soundtouch_new(SAMPLE_RATE);
  exports.soundtouch_set_pitch(handle, 1.0);

  const numFrames = 16384;
  const input = new Float32Array(numFrames * CHANNELS);
  for (let i = 0; i < numFrames; i++) {
    input[i * 2] = Math.sin(2 * Math.PI * 440 * i / SAMPLE_RATE);
    input[i * 2 + 1] = Math.sin(2 * Math.PI * 880 * i / SAMPLE_RATE);
  }

  const output = processAudio(exports, handle, input, numFrames);
  const totalOutputFrames = output.length / CHANNELS;
  assert(totalOutputFrames > 0, `produces output (${totalOutputFrames} frames)`);

  if (totalOutputFrames > 1024) {
    const skipFrames = 512;
    let diffSum = 0;
    const checkFrames = Math.min(totalOutputFrames - skipFrames, 2048);
    for (let i = skipFrames; i < skipFrames + checkFrames; i++) {
      diffSum += Math.abs(output[i * 2] - output[i * 2 + 1]);
    }
    const avgDiff = diffSum / checkFrames;
    assert(avgDiff > 0.001, `L/R channels are different (avg diff=${avgDiff.toFixed(4)})`);
  } else {
    assert(false, `not enough output to check stereo (${totalOutputFrames} frames)`);
  }

  exports.soundtouch_free(handle);
}

// ---- Test 9: Multiple instances ----
console.log('\n9. Multiple simultaneous instances');
{
  const h1 = exports.soundtouch_new(SAMPLE_RATE);
  const h2 = exports.soundtouch_new(48000);
  assert(h1 !== h2, 'two instances have different handles');
  assert(h1 !== 0 && h2 !== 0, 'both handles are non-null');

  exports.soundtouch_set_pitch(h1, 1.5);
  exports.soundtouch_set_pitch(h2, 0.75);

  const numFrames = 16384;
  const input = generateSine(numFrames, 440, SAMPLE_RATE);

  const out1 = processAudio(exports, h1, input, numFrames);
  const out2 = processAudio(exports, h2, input, numFrames);

  const frames1 = out1.length / CHANNELS;
  const frames2 = out2.length / CHANNELS;
  assert(frames1 > 0, `instance 1 produces output (${frames1} frames)`);
  assert(frames2 > 0, `instance 2 produces output (${frames2} frames)`);

  exports.soundtouch_free(h1);
  exports.soundtouch_free(h2);
  assert(true, 'both instances freed without crash');
}

// ---- Test 10: Silent input ----
console.log('\n10. Silent input');
{
  const handle = exports.soundtouch_new(SAMPLE_RATE);
  exports.soundtouch_set_pitch(handle, 1.0);

  const numFrames = 16384;
  const silence = new Float32Array(numFrames * CHANNELS);
  const output = processAudio(exports, handle, silence, numFrames);

  const totalOutputFrames = output.length / CHANNELS;
  assert(totalOutputFrames > 0, `produces output (${totalOutputFrames} frames)`);

  const silentRms = rms(output);
  assert(silentRms < 0.001, `silent input -> silent output (RMS=${silentRms.toFixed(6)})`);

  exports.soundtouch_free(handle);
}

// ---- Test 11: Extreme pitch values ----
console.log('\n11. Extreme pitch values');
{
  for (const pitchVal of [0.25, 4.0]) {
    const handle = exports.soundtouch_new(SAMPLE_RATE);
    exports.soundtouch_set_pitch(handle, pitchVal);

    const numFrames = 16384;
    const input = generateSine(numFrames, 440, SAMPLE_RATE);
    const output = processAudio(exports, handle, input, numFrames);

    const totalOutputFrames = output.length / CHANNELS;
    assert(totalOutputFrames > 0, `pitch=${pitchVal}: produces output (${totalOutputFrames} frames)`);

    let hasNaN = false;
    for (let i = 0; i < output.length; i++) {
      if (!Number.isFinite(output[i])) { hasNaN = true; break; }
    }
    assert(!hasNaN, `pitch=${pitchVal}: no NaN/Infinity in output`);

    exports.soundtouch_free(handle);
  }
}

// ---- Test 12: FFT matrix -- multiple pitches x multiple input frequencies ----
console.log('\n12. FFT spectral analysis matrix');
{
  const testCases = [
    { inputFreq: 440,  semitones:   0, label: '440 Hz, +0 st'  },
    { inputFreq: 440,  semitones:  +3, label: '440 Hz, +3 st'  },
    { inputFreq: 440,  semitones:  -3, label: '440 Hz, -3 st'  },
    { inputFreq: 440,  semitones: +12, label: '440 Hz, +12 st' },
    { inputFreq: 440,  semitones: -12, label: '440 Hz, -12 st' },
    { inputFreq: 1000, semitones:  +5, label: '1000 Hz, +5 st' },
    { inputFreq: 1000, semitones:  -7, label: '1000 Hz, -7 st' },
    { inputFreq: 261,  semitones:  +4, label: '261 Hz (C4), +4 st -> E4' },
  ];

  const numFrames = 32768;
  const skipFrames = 4096;
  const fftSize = 8192;

  for (const { inputFreq, semitones, label } of testCases) {
    const pitchRatio = Math.pow(2, semitones / 12);
    const expectedFreq = inputFreq * pitchRatio;

    // Skip if expected frequency is above Nyquist or too low for FFT resolution
    const binResolution = SAMPLE_RATE / fftSize;
    if (expectedFreq > SAMPLE_RATE / 2 - binResolution || expectedFreq < binResolution * 2) {
      console.log(`  - ${label}: skipped (expected ${expectedFreq.toFixed(0)} Hz outside usable range)`);
      continue;
    }

    const handle = exports.soundtouch_new(SAMPLE_RATE);
    exports.soundtouch_set_pitch(handle, pitchRatio);

    const input = generateSine(numFrames, inputFreq, SAMPLE_RATE);
    const output = processAudio(exports, handle, input, numFrames);
    const totalOutputFrames = output.length / CHANNELS;

    if (totalOutputFrames > skipFrames + fftSize) {
      const mono = extractLeft(output.subarray(skipFrames * CHANNELS), fftSize);
      const peakHz = findPeakFrequency(mono, SAMPLE_RATE, fftSize);
      // Tolerance: 1 semitone = ~6% of the frequency. We allow ~0.5 semitone error.
      const tolerance = expectedFreq * 0.04;
      assertApprox(peakHz, expectedFreq, tolerance,
        `${label}: peak=${peakHz.toFixed(1)} Hz, expected=${expectedFreq.toFixed(1)} Hz`);
    } else {
      assert(false, `${label}: not enough output (${totalOutputFrames} frames)`);
    }

    exports.soundtouch_free(handle);
  }
}

// ---- Test 13: FFT verify input sine is clean (sanity check) ----
console.log('\n13. FFT sanity check on raw input sine');
{
  const fftSize = 8192;
  for (const freq of [261, 440, 880, 1000]) {
    const signal = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      signal[i] = Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
    }
    const peakHz = findPeakFrequency(signal, SAMPLE_RATE, fftSize);
    assertApprox(peakHz, freq, 5,
      `raw sine ${freq} Hz -> FFT peak = ${peakHz.toFixed(1)} Hz`);
  }
}

// ---- Test 14: Continuous streaming (mimics real AudioWorklet usage) ----
console.log('\n14. Continuous streaming (128-frame quanta)');
{
  const handle = exports.soundtouch_new(SAMPLE_RATE);
  exports.soundtouch_set_pitch(handle, Math.pow(2, 3 / 12)); // +3 semitones

  const inBuf = allocF32(exports, 128 * CHANNELS);
  const outBuf = allocF32(exports, 128 * CHANNELS);

  let totalIn = 0;
  let totalOut = 0;
  const numQuanta = 512; // ~1.5 seconds of audio

  for (let q = 0; q < numQuanta; q++) {
    const inView = new Float32Array(exports.memory.buffer, inBuf.ptr, 128 * CHANNELS);
    for (let i = 0; i < 128; i++) {
      const t = (totalIn + i) / SAMPLE_RATE;
      const sample = Math.sin(2 * Math.PI * 440 * t);
      inView[i * 2] = sample;
      inView[i * 2 + 1] = sample;
    }
    totalIn += 128;

    exports.soundtouch_put_samples(handle, inBuf.ptr, 128);
    exports.soundtouch_process(handle);

    const outView = new Float32Array(exports.memory.buffer, outBuf.ptr, 128 * CHANNELS);
    outView.fill(0);
    const received = exports.soundtouch_receive_samples(handle, outBuf.ptr, 128);
    totalOut += received;
  }

  assert(totalIn === numQuanta * 128, `fed ${totalIn} frames total`);
  assert(totalOut > 0, `received ${totalOut} frames total`);

  // After pipeline warmup, output rate should be ~1:1 (pitch shift preserves duration)
  const ratio = totalOut / totalIn;
  assertApprox(ratio, 1.0, 0.5, `output/input ratio is reasonable (${ratio.toFixed(3)})`);

  exports.wasm_dealloc(inBuf.ptr, inBuf.bytes);
  exports.wasm_dealloc(outBuf.ptr, outBuf.bytes);
  exports.soundtouch_free(handle);
}

// ---- Test 15: Crackling / glitch detection (sine) ----
console.log('\n15. Crackling / glitch detection (sine)');
{
  const testPitches = [
    { pitch: 1.0, label: 'pass-through' },
    { pitch: Math.pow(2, -6/12), label: '-6 semitones' },
    { pitch: Math.pow(2, 3/12), label: '+3 semitones' },
    { pitch: Math.pow(2, -12/12), label: '-12 semitones (octave down)' },
    { pitch: Math.pow(2, 12/12), label: '+12 semitones (octave up)' },
  ];

  const inputFreq = 440;
  const numFrames = 65536;
  const input = generateSine(numFrames, inputFreq, SAMPLE_RATE);

  for (const { pitch, label } of testPitches) {
    runCrackleTest(exports, input, numFrames, pitch, label, { minSnr: 30 });
  }
}

// ---- Test 16: Crackling with complex signal (chord) ----
console.log('\n16. Crackling / glitch detection (chord: 261+329+392 Hz)');
{
  const numFrames = 65536;
  const chord = new Float32Array(numFrames * CHANNELS);
  for (let i = 0; i < numFrames; i++) {
    const s = 0.3 * Math.sin(2 * Math.PI * 261.63 * i / SAMPLE_RATE)
            + 0.3 * Math.sin(2 * Math.PI * 329.63 * i / SAMPLE_RATE)
            + 0.3 * Math.sin(2 * Math.PI * 392.00 * i / SAMPLE_RATE);
    chord[i * 2] = s;
    chord[i * 2 + 1] = s;
  }

  const testPitches = [
    { pitch: 1.0, label: 'chord pass-through' },
    { pitch: Math.pow(2, -5/12), label: 'chord -5 semitones' },
    { pitch: Math.pow(2, 4/12), label: 'chord +4 semitones' },
    { pitch: Math.pow(2, -12/12), label: 'chord octave down' },
  ];

  for (const { pitch, label } of testPitches) {
    runCrackleTest(exports, chord, numFrames, pitch, label, { minSnr: 15 });
  }
}

// ---- Test 17: Crackling with swept sine (chirp) ----
console.log('\n17. Crackling / glitch detection (chirp 200-2000 Hz)');
{
  const numFrames = 65536;
  const chirp = new Float32Array(numFrames * CHANNELS);
  for (let i = 0; i < numFrames; i++) {
    const t = i / SAMPLE_RATE;
    const f = 200 + (2000 - 200) * (i / numFrames);
    const s = 0.8 * Math.sin(2 * Math.PI * f * t);
    chirp[i * 2] = s;
    chirp[i * 2 + 1] = s;
  }

  const testPitches = [
    { pitch: Math.pow(2, -6/12), label: 'chirp -6 semitones' },
    { pitch: Math.pow(2, 6/12), label: 'chirp +6 semitones' },
  ];

  for (const { pitch, label } of testPitches) {
    // Chirp sweeps across many frequencies: skip SNR check (single-peak model
    // is inapplicable), and use relaxed click threshold since rapid frequency
    // changes are inherently harder for the phase vocoder.
    runCrackleTest(exports, chirp, numFrames, pitch, label, {
      minSnr: -Infinity,
      clickThreshold: 0.40,
    });
  }
}

/**
 * Comprehensive crackling test:
 *   A) Sample-to-sample click detection (derivative outliers)
 *   B) Spectral purity (SNR)
 *   C) Amplitude stability (RMS deviation)
 *   D) Clipping detection (samples > 1.0)
 */
function runCrackleTest(exports, input, numFrames, pitch, label, opts = {}) {
  const { minSnr = 20 } = opts;

  const handle = exports.soundtouch_new(SAMPLE_RATE);
  exports.soundtouch_set_pitch(handle, pitch);

  const output = processAudio(exports, handle, input, numFrames);
  const totalFrames = output.length / CHANNELS;
  exports.soundtouch_free(handle);

  if (totalFrames < 16384) {
    assert(false, `${label}: not enough output (${totalFrames} frames)`);
    return;
  }

  const skipStart = 8192;
  const analyzeFrames = Math.min(totalFrames - skipStart - 4096, 32768);
  if (analyzeFrames < 8192) {
    assert(false, `${label}: not enough stable output to analyze`);
    return;
  }

  // Extract left channel from stable region
  const mono = new Float64Array(analyzeFrames);
  for (let i = 0; i < analyzeFrames; i++) {
    mono[i] = output[(skipStart + i) * CHANNELS];
  }

  // --- Test A: Click detection via derivative outliers ---
  const windowSize = 512;
  let maxClickRatio = 0;
  let clickCount = 0;
  const clickThreshold = opts.clickThreshold ?? 0.35;

  for (let i = 1; i < analyzeFrames; i++) {
    const delta = Math.abs(mono[i] - mono[i - 1]);

    const wStart = Math.max(0, i - windowSize / 2);
    const wEnd = Math.min(analyzeFrames, i + windowSize / 2);
    let localSum = 0;
    for (let j = wStart; j < wEnd; j++) localSum += mono[j] * mono[j];
    const localRms = Math.sqrt(localSum / (wEnd - wStart));

    if (localRms > 0.01) {
      const ratio = delta / (localRms * 2);
      if (ratio > maxClickRatio) maxClickRatio = ratio;
      if (ratio > clickThreshold) clickCount++;
    }
  }

  assert(clickCount === 0,
    `${label}: clicks: ${clickCount} (max ratio=${maxClickRatio.toFixed(4)}, limit=${clickThreshold})`);

  // --- Test B: Spectral purity (SNR) ---
  const fftSize = 8192;
  if (analyzeFrames >= fftSize + 4096) {
    const reFFT = new Float64Array(fftSize);
    const imFFT = new Float64Array(fftSize);
    const fftStart = 4096;
    for (let i = 0; i < fftSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
      reFFT[i] = mono[fftStart + i] * w;
    }
    fft(reFFT, imFFT);

    const halfFFT = fftSize / 2;
    const magSpectrum = new Float64Array(halfFFT);
    let peakBin = 0, peakMag = 0;
    for (let k = 1; k < halfFFT; k++) {
      magSpectrum[k] = reFFT[k] * reFFT[k] + imFFT[k] * imFFT[k];
      if (magSpectrum[k] > peakMag) { peakMag = magSpectrum[k]; peakBin = k; }
    }

    // For multi-frequency signals: find all peaks above -20dB from max
    const peakThresholdMag = peakMag * 0.01; // -20dB
    let signalPower = 0, noisePower = 0;
    const mainLobeWidth = 6;
    const signalBins = new Set();

    for (let k = 1; k < halfFFT; k++) {
      if (magSpectrum[k] > peakThresholdMag &&
          magSpectrum[k] >= (magSpectrum[k-1] || 0) &&
          magSpectrum[k] >= (magSpectrum[k+1] || 0)) {
        for (let j = k - mainLobeWidth; j <= k + mainLobeWidth; j++) {
          if (j > 0 && j < halfFFT) signalBins.add(j);
        }
      }
    }

    for (let k = 1; k < halfFFT; k++) {
      if (signalBins.has(k)) signalPower += magSpectrum[k];
      else noisePower += magSpectrum[k];
    }

    const snrDb = noisePower > 0 ? 10 * Math.log10(signalPower / noisePower) : 100;
    assert(snrDb >= minSnr,
      `${label}: SNR = ${snrDb.toFixed(1)} dB (min ${minSnr} dB)`);
  }

  // --- Test C: Amplitude stability ---
  const rmsWindowSize = 1024;
  const rmsValues = [];
  for (let i = 0; i + rmsWindowSize <= analyzeFrames; i += rmsWindowSize) {
    let sum = 0;
    for (let j = 0; j < rmsWindowSize; j++) sum += mono[i + j] * mono[i + j];
    rmsValues.push(Math.sqrt(sum / rmsWindowSize));
  }
  if (rmsValues.length > 3) {
    const stableRms = rmsValues.slice(1);
    const meanRms = stableRms.reduce((a, b) => a + b) / stableRms.length;
    let maxDeviation = 0;
    for (const r of stableRms) {
      const dev = Math.abs(r - meanRms) / meanRms;
      if (dev > maxDeviation) maxDeviation = dev;
    }
    // Polyphonic content at extreme pitch shifts naturally exhibits beating
    // patterns that cause amplitude fluctuations; allow up to 35%.
    const maxAllowed = 0.35;
    assert(maxDeviation <= maxAllowed,
      `${label}: amplitude stability: ${(maxDeviation*100).toFixed(1)}% deviation (limit ${(maxAllowed*100).toFixed(0)}%)`);
  }

  // --- Test D: Clipping detection ---
  // Phase modification can cause constructive interference that pushes peaks
  // slightly above the COLA-normalized unity. Allow 0.5% headroom for f32 rounding.
  const clipThreshold = 1.005;
  let clippedSamples = 0;
  let maxAbs = 0;
  for (let i = 0; i < analyzeFrames; i++) {
    const a = Math.abs(mono[i]);
    if (a > maxAbs) maxAbs = a;
    if (a > clipThreshold) clippedSamples++;
  }
  assert(clippedSamples === 0,
    `${label}: clipping: ${clippedSamples} samples > ${clipThreshold} (peak=${maxAbs.toFixed(6)})`);
}

// ---- Summary ----
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
