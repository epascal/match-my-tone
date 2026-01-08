/**
 * SoundTouch AudioWorklet Processor
 *
 * Goal: provide a `registerProcessor('soundtouch-processor', ...)`
 * with readable and idiomatic TypeScript code (ES classes, types, comments),
 * without keeping the "transpiled"/Babel structure.
 *
 * The algorithm is based on SoundTouch (LGPL-2.1+).
 *
 * Copyright (c) Olli Parviainen
 * Copyright (c) Ryan Berdeen
 * Copyright (c) Jakub Fiala
 * Copyright (c) Steve 'Cutter' Blades
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place, Suite 330, Boston, MA  02111-1307  USA
 */

// ------------------------------------------------------------
// Constants & helpers
// ------------------------------------------------------------

/** AudioWorklet = 128 frames per quantum (WebAudio spec) */
const RENDER_QUANTUM_FRAMES = 128;

/** Our buffers are stereo interleaved: [L0,R0,L1,R1,...] */
const CHANNELS = 2;

/** Epsilon to consider a float "different" */
const FLOAT_EPSILON = 1e-10;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hasSignificantChange(a: number, b: number): boolean {
  return Math.abs(a - b) > FLOAT_EPSILON;
}

// ------------------------------------------------------------
// FIFO buffer (stereo interleaved)
// ------------------------------------------------------------

/**
 * FIFO of stereo interleaved audio frames.
 *
 * Storage: `_vector` contains interleaved samples, and we reason
 * in "frames" (1 frame = 2 samples: L + R).
 */
class FifoSampleBuffer {
  private _vector: Float32Array = new Float32Array(0);
  private _positionFrames = 0;
  private _frameCount = 0;

  get vector(): Float32Array {
    return this._vector;
  }

  get positionFrames(): number {
    return this._positionFrames;
  }

  /** Index (in samples) of the start of valid data */
  get startIndex(): number {
    return this._positionFrames * CHANNELS;
  }

  get frameCount(): number {
    return this._frameCount;
  }

  /** Index (in samples) of the end of valid data (exclusive) */
  get endIndex(): number {
    return (this._positionFrames + this._frameCount) * CHANNELS;
  }

  clear(): void {
    this.receive(this._frameCount);
    this.rewind();
  }

  /** "Reserves" numFrames frames in the buffer (after manual write in `vector`). */
  put(numFrames: number): void {
    this._frameCount += numFrames;
  }

  /**
   * Adds interleaved samples to the buffer.
   *
   * @param samples - interleaved samples
   * @param positionFrames - offset (in frames) in `samples`
   * @param numFrames - number of frames to copy
   */
  putSamples(samples: Float32Array, positionFrames = 0, numFrames = -1): void {
    const sourceOffset = positionFrames * CHANNELS;
    const frames =
      numFrames >= 0 ? numFrames : Math.floor((samples.length - sourceOffset) / CHANNELS);
    const numSamples = frames * CHANNELS;

    this.ensureCapacity(this._frameCount + frames);

    const destOffset = this.endIndex;
    this._vector.set(samples.subarray(sourceOffset, sourceOffset + numSamples), destOffset);
    this._frameCount += frames;
  }

  /**
   * Copies frames from another FIFO.
   */
  putBuffer(buffer: FifoSampleBuffer, positionFrames = 0, numFrames = -1): void {
    const frames = numFrames >= 0 ? numFrames : buffer.frameCount - positionFrames;
    this.putSamples(buffer.vector, buffer.positionFrames + positionFrames, frames);
  }

  /**
   * Consumes frames.
   */
  receive(numFrames: number = this._frameCount): void {
    const frames = clamp(numFrames, 0, this._frameCount);
    this._frameCount -= frames;
    this._positionFrames += frames;
  }

  /**
   * Copies `numFrames` frames into `output` (interleaved), then consumes these frames.
   * If fewer frames are available, the missing part is not written.
   */
  receiveSamples(output: Float32Array, numFrames: number): void {
    const numSamples = numFrames * CHANNELS;
    const sourceOffset = this.startIndex;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
    this.receive(numFrames);
  }

  /**
   * Extracts without consuming.
   */
  extract(output: Float32Array, positionFrames = 0, numFrames = 0): void {
    const sourceOffset = this.startIndex + positionFrames * CHANNELS;
    const numSamples = numFrames * CHANNELS;
    output.set(this._vector.subarray(sourceOffset, sourceOffset + numSamples));
  }

  ensureCapacity(numFrames: number): void {
    const minLength = Math.max(0, Math.ceil(numFrames * CHANNELS));
    if (this._vector.length < minLength) {
      const newVector = new Float32Array(minLength);
      newVector.set(this._vector.subarray(this.startIndex, this.endIndex));
      this._vector = newVector;
      this._positionFrames = 0;
      return;
    }

    // We already have enough space: "rewind" if needed to free space at the beginning
    this.rewind();
  }

  ensureAdditionalCapacity(numFrames: number): void {
    this.ensureCapacity(this._frameCount + numFrames);
  }

  private rewind(): void {
    if (this._positionFrames === 0) return;
    this._vector.copyWithin(0, this.startIndex, this.endIndex);
    this._positionFrames = 0;
  }
}

// ------------------------------------------------------------
// Pipes (rate transposer + time stretch)
// ------------------------------------------------------------

abstract class AbstractFifoSamplePipe {
  inputBuffer: FifoSampleBuffer = new FifoSampleBuffer();
  outputBuffer: FifoSampleBuffer = new FifoSampleBuffer();

  clear(): void {
    this.inputBuffer.clear();
    this.outputBuffer.clear();
  }

  abstract process(): void;
}

/**
 * RateTransposer: changes the "rate" via linear resampling.
 */
class RateTransposer extends AbstractFifoSamplePipe {
  private _rate = 1.0;
  private slopeCount = 0;
  private prevSampleL = 0;
  private prevSampleR = 0;

  set rate(rate: number) {
    this._rate = rate;
  }

  reset(): void {
    this.slopeCount = 0;
    this.prevSampleL = 0;
    this.prevSampleR = 0;
  }

  process(): void {
    const numFrames = this.inputBuffer.frameCount;
    if (numFrames === 0) return;

    // Approximation of the number of frames produced
    this.outputBuffer.ensureAdditionalCapacity(numFrames / this._rate + 1);

    const numFramesOutput = this.transpose(numFrames);
    this.inputBuffer.receive(numFrames);
    this.outputBuffer.put(numFramesOutput);
  }

  private transpose(numFrames: number): number {
    if (numFrames === 0) return 0;

    const src = this.inputBuffer.vector;
    const srcOffset = this.inputBuffer.startIndex;
    const dest = this.outputBuffer.vector;
    const destOffset = this.outputBuffer.endIndex;

    let used = 0;
    let outFrames = 0;

    // First point: interpolation from "prevSample"
    while (this.slopeCount < 1.0) {
      dest[destOffset + CHANNELS * outFrames] =
        (1.0 - this.slopeCount) * this.prevSampleL + this.slopeCount * src[srcOffset];
      dest[destOffset + CHANNELS * outFrames + 1] =
        (1.0 - this.slopeCount) * this.prevSampleR + this.slopeCount * src[srcOffset + 1];

      outFrames++;
      this.slopeCount += this._rate;
    }
    this.slopeCount -= 1.0;

    if (numFrames !== 1) {
      // Standard interpolation between src[used] and src[used+1]
      outer: while (true) {
        while (this.slopeCount > 1.0) {
          this.slopeCount -= 1.0;
          used++;
          if (used >= numFrames - 1) break outer;
        }

        const srcIndex = srcOffset + CHANNELS * used;
        dest[destOffset + CHANNELS * outFrames] =
          (1.0 - this.slopeCount) * src[srcIndex] + this.slopeCount * src[srcIndex + 2];
        dest[destOffset + CHANNELS * outFrames + 1] =
          (1.0 - this.slopeCount) * src[srcIndex + 1] + this.slopeCount * src[srcIndex + 3];

        outFrames++;
        this.slopeCount += this._rate;
      }
    }

    // Store the last sample for the next interpolation
    this.prevSampleL = src[srcOffset + CHANNELS * numFrames - 2];
    this.prevSampleR = src[srcOffset + CHANNELS * numFrames - 1];

    return outFrames;
  }
}

// --- Stretch configuration (time-stretch) ---
const DEFAULT_SEQUENCE_MS = 0; // 0 = auto
const DEFAULT_SEEKWINDOW_MS = 0; // 0 = auto
const DEFAULT_OVERLAP_MS = 8;

const SCAN_OFFSETS: number[][] = [
  [124, 186, 248, 310, 372, 434, 496, 558, 620, 682, 744, 806, 868, 930, 992, 1054, 1116, 1178, 1240, 1302, 1364, 1426, 1488, 0],
  [-100, -75, -50, -25, 25, 50, 75, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [-20, -15, -10, -5, 5, 10, 15, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [-4, -3, -2, -1, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const AUTOSEQ_TEMPO_LOW = 0.25;
const AUTOSEQ_TEMPO_TOP = 4.0;
const AUTOSEQ_AT_MIN = 125.0;
const AUTOSEQ_AT_MAX = 50.0;
const AUTOSEQ_K = (AUTOSEQ_AT_MAX - AUTOSEQ_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEQ_C = AUTOSEQ_AT_MIN - AUTOSEQ_K * AUTOSEQ_TEMPO_LOW;

const AUTOSEEK_AT_MIN = 25.0;
const AUTOSEEK_AT_MAX = 15.0;
const AUTOSEEK_K = (AUTOSEEK_AT_MAX - AUTOSEEK_AT_MIN) / (AUTOSEQ_TEMPO_TOP - AUTOSEQ_TEMPO_LOW);
const AUTOSEEK_C = AUTOSEEK_AT_MIN - AUTOSEEK_K * AUTOSEQ_TEMPO_LOW;

/**
 * Stretch : time-stretch (WSOLA-ish) qui ajuste la durée sans changer le pitch.
 */
class Stretch extends AbstractFifoSamplePipe {
  private quickSeek = true;

  private sampleRate: number;
  private overlapMs = DEFAULT_OVERLAP_MS;
  private sequenceMs = DEFAULT_SEQUENCE_MS;
  private seekWindowMs = DEFAULT_SEEKWINDOW_MS;

  private autoSeqSetting = true;
  private autoSeekSetting = true;

  private overlapLength = 0; // frames
  private seekWindowLength = 0; // frames
  private seekLength = 0; // frames

  private nominalSkip = 0;
  private skipFract = 0;
  private sampleReq = 0;

  private _tempo = 1.0;

  private midBuffer: Float32Array = new Float32Array(0);
  private refMidBuffer: Float32Array = new Float32Array(0);
  private midBufferInitialized = false;

  constructor(sampleRate: number) {
    super();
    this.sampleRate = sampleRate;
    this.setParameters(sampleRate, DEFAULT_SEQUENCE_MS, DEFAULT_SEEKWINDOW_MS, DEFAULT_OVERLAP_MS);
  }

  clear(): void {
    super.clear();
    this.midBufferInitialized = false;
  }

  set tempo(newTempo: number) {
    this._tempo = newTempo;
    this.calculateSequenceParameters();

    this.nominalSkip = this._tempo * (this.seekWindowLength - this.overlapLength);
    this.skipFract = 0;

    const intSkip = Math.floor(this.nominalSkip + 0.5);
    this.sampleReq = Math.max(intSkip + this.overlapLength, this.seekWindowLength) + this.seekLength;
  }

  get tempo(): number {
    return this._tempo;
  }

  setParameters(sampleRate: number, sequenceMs: number, seekWindowMs: number, overlapMs: number): void {
    if (sampleRate > 0) this.sampleRate = sampleRate;
    if (overlapMs > 0) this.overlapMs = overlapMs;

    if (sequenceMs > 0) {
      this.sequenceMs = sequenceMs;
      this.autoSeqSetting = false;
    } else {
      this.autoSeqSetting = true;
    }

    if (seekWindowMs > 0) {
      this.seekWindowMs = seekWindowMs;
      this.autoSeekSetting = false;
    } else {
      this.autoSeekSetting = true;
    }

    this.calculateSequenceParameters();
    this.calculateOverlapLength(this.overlapMs);

    // Force recalculation of tempo-dependent sizes
    this.tempo = this._tempo;
    this.midBufferInitialized = false;
  }

  process(): void {
    // First initialization: fill midBuffer with overlapLength frames
    if (!this.midBufferInitialized) {
      if (this.inputBuffer.frameCount < this.overlapLength) return;
      this.inputBuffer.receiveSamples(this.midBuffer, this.overlapLength);
      this.midBufferInitialized = true;
    }

    // While we have enough input data for one iteration
    while (this.inputBuffer.frameCount >= this.sampleReq) {
      const offset = this.seekBestOverlapPosition();

      // 1) Overlap-add of overlapLength frames
      this.outputBuffer.ensureAdditionalCapacity(this.overlapLength);
      this.overlap(offset);
      this.outputBuffer.put(this.overlapLength);

      // 2) Copy the "middle" (without overlap)
      const nonOverlap = this.seekWindowLength - 2 * this.overlapLength;
      if (nonOverlap > 0) {
        this.outputBuffer.putBuffer(this.inputBuffer, offset + this.overlapLength, nonOverlap);
      }

      // 3) Update midBuffer (last overlap of window) for next iteration
      const start =
        this.inputBuffer.startIndex +
        CHANNELS * (offset + this.seekWindowLength - this.overlapLength);
      this.midBuffer.set(this.inputBuffer.vector.subarray(start, start + CHANNELS * this.overlapLength));

      // 4) Advance in input according to tempo
      this.skipFract += this.nominalSkip;
      const overlapSkip = Math.floor(this.skipFract);
      this.skipFract -= overlapSkip;
      this.inputBuffer.receive(overlapSkip);
    }
  }

  private calculateOverlapLength(overlapInMs: number): void {
    let newOvl = (this.sampleRate * overlapInMs) / 1000;
    newOvl = newOvl < 16 ? 16 : newOvl;
    newOvl -= newOvl % 8;

    this.overlapLength = Math.floor(newOvl);
    this.refMidBuffer = new Float32Array(this.overlapLength * CHANNELS);
    this.midBuffer = new Float32Array(this.overlapLength * CHANNELS);
  }

  private calculateSequenceParameters(): void {
    if (this.autoSeqSetting) {
      const seq = clamp(AUTOSEQ_C + AUTOSEQ_K * this._tempo, AUTOSEQ_AT_MAX, AUTOSEQ_AT_MIN);
      this.sequenceMs = Math.floor(seq + 0.5);
    }

    if (this.autoSeekSetting) {
      const seek = clamp(AUTOSEEK_C + AUTOSEEK_K * this._tempo, AUTOSEEK_AT_MAX, AUTOSEEK_AT_MIN);
      this.seekWindowMs = Math.floor(seek + 0.5);
    }

    this.seekWindowLength = Math.floor((this.sampleRate * this.sequenceMs) / 1000);
    this.seekLength = Math.floor((this.sampleRate * this.seekWindowMs) / 1000);
  }

  private seekBestOverlapPosition(): number {
    return this.quickSeek ? this.seekBestOverlapPositionStereoQuick() : this.seekBestOverlapPositionStereo();
  }

  private seekBestOverlapPositionStereo(): number {
    this.preCalculateCorrelationReferenceStereo();

    let bestOffset = 0;
    let bestCorrelation = -Infinity;

    for (let offset = 0; offset < this.seekLength; offset++) {
      const correlation = this.calculateCrossCorrelationStereo(offset, this.refMidBuffer);
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    return bestOffset;
  }

  private seekBestOverlapPositionStereoQuick(): number {
    this.preCalculateCorrelationReferenceStereo();

    let bestOffset = 0;
    let bestCorrelation = -Infinity;
    let correlationOffset = 0;

    for (let scanPass = 0; scanPass < 4; scanPass++) {
      const offsets = SCAN_OFFSETS[scanPass];
      for (let j = 0; offsets[j] !== 0; j++) {
        const tempOffset = correlationOffset + offsets[j];
        if (tempOffset >= this.seekLength) break;

        const correlation = this.calculateCrossCorrelationStereo(tempOffset, this.refMidBuffer);
        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestOffset = tempOffset;
        }
      }
      correlationOffset = bestOffset;
    }

    return bestOffset;
  }

  /**
   * Prépare le buffer de référence pour corrélation (pondération).
   */
  private preCalculateCorrelationReferenceStereo(): void {
    for (let i = 0; i < this.overlapLength; i++) {
      const weight = i * (this.overlapLength - i);
      const idx = CHANNELS * i;
      this.refMidBuffer[idx] = this.midBuffer[idx] * weight;
      this.refMidBuffer[idx + 1] = this.midBuffer[idx + 1] * weight;
    }
  }

  /**
   * Corrélation croisée stéréo entre `midBuffer` (référence) et l'entrée
   * à partir de `offsetFrames`.
   */
  private calculateCrossCorrelationStereo(offsetFrames: number, compare: Float32Array): number {
    const mixing = this.inputBuffer.vector;
    const mixingPosition = this.inputBuffer.startIndex + CHANNELS * offsetFrames;

    let correlation = 0;
    const calcLengthSamples = CHANNELS * this.overlapLength;

    // i starts at 2 as in original impl (small skip)
    for (let i = 2; i < calcLengthSamples; i += CHANNELS) {
      const mixIdx = mixingPosition + i;
      correlation += mixing[mixIdx] * compare[i] + mixing[mixIdx + 1] * compare[i + 1];
    }

    return correlation;
  }

  /**
   * Overlap-add of `overlapLength` frames starting from `offsetFrames`.
   */
  private overlap(offsetFrames: number): void {
    const input = this.inputBuffer.vector;
    const inputPosition = this.inputBuffer.startIndex + CHANNELS * offsetFrames;

    const output = this.outputBuffer.vector;
    const outputPosition = this.outputBuffer.endIndex;

    const frameScale = 1 / this.overlapLength;

    for (let i = 0; i < this.overlapLength; i++) {
      const fadeOut = (this.overlapLength - i) * frameScale;
      const fadeIn = i * frameScale;

      const ctx = CHANNELS * i;
      const inIdx = inputPosition + ctx;
      const outIdx = outputPosition + ctx;

      output[outIdx] = input[inIdx] * fadeIn + this.midBuffer[ctx] * fadeOut;
      output[outIdx + 1] = input[inIdx + 1] * fadeIn + this.midBuffer[ctx + 1] * fadeOut;
    }
  }
}

/**
 * SoundTouch : combine Stretch + RateTransposer.
 *
 * Le “pitch shift” est réalisé via combinaison tempo/rate :
 * - pitch change = rate * pitch, tempo = tempo / pitch
 */
class SoundTouch {
  readonly inputBuffer = new FifoSampleBuffer();
  readonly outputBuffer = new FifoSampleBuffer();
  private readonly intermediateBuffer = new FifoSampleBuffer();

  private readonly transposer = new RateTransposer();
  private readonly stretch: Stretch;

  private _rate = 1.0;
  private _tempo = 1.0;

  private virtualPitch = 1.0;
  private virtualRate = 1.0;
  private virtualTempo = 1.0;

  constructor(sampleRate: number) {
    this.stretch = new Stretch(sampleRate);
    this.calculateEffectiveRateAndTempo();
  }

  clear(): void {
    this.transposer.clear();
    this.stretch.clear();
    this.inputBuffer.clear();
    this.intermediateBuffer.clear();
    this.outputBuffer.clear();
  }

  set rate(rate: number) {
    this.virtualRate = rate;
    this.calculateEffectiveRateAndTempo();
  }

  get rate(): number {
    return this._rate;
  }

  set tempo(tempo: number) {
    this.virtualTempo = tempo;
    this.calculateEffectiveRateAndTempo();
  }

  get tempo(): number {
    return this._tempo;
  }

  /**
   * `pitch` ici est un ratio (1.0 = pas de changement).
   * Pour des demi-tons, utiliser `2^(semitones/12)`.
   */
  set pitch(pitch: number) {
    this.virtualPitch = pitch;
    this.calculateEffectiveRateAndTempo();
  }

  process(): void {
    // Ordonne Stretch/Transposer selon le rate effectif (comme SoundTouch)
    if (this._rate > 1.0) {
      this.stretch.process();
      this.transposer.process();
    } else {
      this.transposer.process();
      this.stretch.process();
    }
  }

  private calculateEffectiveRateAndTempo(): void {
    const previousTempo = this._tempo;
    const previousRate = this._rate;

    // “effective” rate & tempo
    this._tempo = this.virtualTempo / this.virtualPitch;
    this._rate = this.virtualRate * this.virtualPitch;

    if (hasSignificantChange(this._tempo, previousTempo)) {
      this.stretch.tempo = this._tempo;
    }
    if (hasSignificantChange(this._rate, previousRate)) {
      this.transposer.rate = this._rate;
    }

    // Reconnecte les buffers selon la direction (rate > 1 => stretch->transposer)
    if (this._rate > 1.0) {
      if (this.transposer.outputBuffer !== this.outputBuffer) {
        this.stretch.inputBuffer = this.inputBuffer;
        this.stretch.outputBuffer = this.intermediateBuffer;
        this.transposer.inputBuffer = this.intermediateBuffer;
        this.transposer.outputBuffer = this.outputBuffer;
      }
    } else {
      if (this.stretch.outputBuffer !== this.outputBuffer) {
        this.transposer.inputBuffer = this.inputBuffer;
        this.transposer.outputBuffer = this.intermediateBuffer;
        this.stretch.inputBuffer = this.intermediateBuffer;
        this.stretch.outputBuffer = this.outputBuffer;
      }
    }
  }
}

// ------------------------------------------------------------
// AudioWorkletProcessor
// ------------------------------------------------------------

type WorkletParams = Record<'rate' | 'tempo' | 'pitch' | 'pitchSemitones', Float32Array>;

function paramValue(params: WorkletParams, name: keyof WorkletParams, fallback: number): number {
  const arr = params[name];
  return arr && arr.length > 0 ? arr[0] : fallback;
}

class SoundTouchProcessor extends AudioWorkletProcessor {
  private readonly pipe = new SoundTouch(sampleRate);
  private readonly inputInterleaved = new Float32Array(RENDER_QUANTUM_FRAMES * CHANNELS);
  private readonly outputInterleaved = new Float32Array(RENDER_QUANTUM_FRAMES * CHANNELS);

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: WorkletParams): boolean {
    const input = inputs[0];
    const output = outputs[0];

    // Si aucune sortie, stop
    if (!output || output.length === 0) return false;

    const leftOut = output[0];
    const rightOut = output[1] ?? output[0];

    // If no input, output silence
    if (!input || input.length === 0 || !input[0]) {
      leftOut.fill(0);
      if (rightOut !== leftOut) rightOut.fill(0);
      return true;
    }

    const leftIn = input[0];
    const rightIn = input[1] ?? input[0];

    // Parameters
    const rate = paramValue(parameters, 'rate', 1.0);
    const tempo = paramValue(parameters, 'tempo', 1.0);
    const pitch = paramValue(parameters, 'pitch', 1.0);
    const pitchSemitones = paramValue(parameters, 'pitchSemitones', 0);

    // Apply to pipeline
    this.pipe.rate = rate;
    this.pipe.tempo = tempo;
    this.pipe.pitch = pitch * Math.pow(2, pitchSemitones / 12);

    // Interleave input
    for (let i = 0; i < leftIn.length; i++) {
      this.inputInterleaved[i * 2] = leftIn[i];
      this.inputInterleaved[i * 2 + 1] = rightIn[i];
    }

    // Process
    this.pipe.inputBuffer.putSamples(this.inputInterleaved, 0, leftIn.length);
    this.pipe.process();

    // De-interleave output (if not enough frames available => silence on the rest)
    this.outputInterleaved.fill(0);
    this.pipe.outputBuffer.receiveSamples(this.outputInterleaved, leftOut.length);

    for (let i = 0; i < leftOut.length; i++) {
      const l = this.outputInterleaved[i * 2];
      const r = this.outputInterleaved[i * 2 + 1];

      // NaN protection
      leftOut[i] = Number.isFinite(l) ? l : 0;
      rightOut[i] = Number.isFinite(r) ? r : 0;
    }

    return true;
  }

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'rate', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0 },
      { name: 'tempo', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0 },
      { name: 'pitch', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0 },
      { name: 'pitchSemitones', defaultValue: 0, minValue: -24, maxValue: 24 },
    ];
  }
}

registerProcessor('soundtouch-processor', SoundTouchProcessor);

