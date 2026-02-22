/**
 * SoundTouch WASM AudioWorklet Processor
 *
 * Pitch shifting via a Rust/WASM SoundTouch implementation.
 * The WASM binary is received from the content script via port.postMessage.
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

const RENDER_QUANTUM_FRAMES = 128;
const CHANNELS = 2;

// Maximum drain chunk: how many frames we request from WASM per receive call.
const DRAIN_CHUNK = 2048;

// Fade-in length (in frames) applied once when audio first arrives,
// to prevent a click at the silence→signal transition.
const FADE_IN_FRAMES = 64;

// ------------------------------------------------------------
// WASM wrapper
// ------------------------------------------------------------

interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_alloc(size: number): number;
  wasm_dealloc(ptr: number, size: number): number;
  soundtouch_new(sampleRate: number): number;
  soundtouch_free(ptr: number): void;
  soundtouch_set_rate(ptr: number, rate: number): void;
  soundtouch_set_tempo(ptr: number, tempo: number): void;
  soundtouch_set_pitch(ptr: number, pitch: number): void;
  soundtouch_put_samples(ptr: number, inputPtr: number, numFrames: number): void;
  soundtouch_process(ptr: number): void;
  soundtouch_receive_samples(ptr: number, outputPtr: number, maxFrames: number): number;
  soundtouch_clear(ptr: number): void;
  soundtouch_set_agc(ptr: number, enabled: number): void;
}

class WasmSoundTouch {
  private exports: WasmExports | null = null;
  private handle = 0;
  private inputPtr = 0;
  private outputPtr = 0;
  private inputFrames = 0;
  private outputFrames = 0;

  // JS-side output FIFO: interleaved stereo samples.
  // This smooths out the bursty output from the phase vocoder pipeline.
  private fifo = new Float32Array(0);
  private fifoWrite = 0;
  private fifoRead = 0;
  private audioStarted = false;
  private fadeInPos = 0;

  get ready(): boolean {
    return this.exports !== null && this.handle !== 0;
  }

  private get fifoAvailable(): number {
    return this.fifoWrite - this.fifoRead;
  }

  init(wasmBytes: ArrayBuffer, sr: number): boolean {
    try {
      const module = new WebAssembly.Module(wasmBytes);
      const instance = new WebAssembly.Instance(module);
      this.exports = instance.exports as unknown as WasmExports;
      this.handle = this.exports.soundtouch_new(sr);

      this.allocInput(RENDER_QUANTUM_FRAMES);
      this.allocOutput(DRAIN_CHUNK);

      // Pre-allocate FIFO for ~0.5s of stereo audio
      this.fifo = new Float32Array(sr * CHANNELS);
      this.fifoRead = 0;
      this.fifoWrite = 0;
      this.audioStarted = false;
      this.fadeInPos = 0;

      return true;
    } catch {
      this.exports = null;
      this.handle = 0;
      return false;
    }
  }

  private allocInput(frames: number): void {
    if (!this.exports || this.inputFrames >= frames) return;
    if (this.inputPtr) {
      this.exports.wasm_dealloc(this.inputPtr, this.inputFrames * CHANNELS * 4);
    }
    this.inputPtr = this.exports.wasm_alloc(frames * CHANNELS * 4);
    this.inputFrames = frames;
  }

  private allocOutput(frames: number): void {
    if (!this.exports || this.outputFrames >= frames) return;
    if (this.outputPtr) {
      this.exports.wasm_dealloc(this.outputPtr, this.outputFrames * CHANNELS * 4);
    }
    this.outputPtr = this.exports.wasm_alloc(frames * CHANNELS * 4);
    this.outputFrames = frames;
  }

  setRate(rate: number): void {
    this.exports!.soundtouch_set_rate(this.handle, rate);
  }

  setTempo(tempo: number): void {
    this.exports!.soundtouch_set_tempo(this.handle, tempo);
  }

  setPitch(pitch: number): void {
    this.exports!.soundtouch_set_pitch(this.handle, pitch);
  }

  setAgc(enabled: boolean): void {
    this.exports!.soundtouch_set_agc(this.handle, enabled ? 1 : 0);
  }

  processQuantum(
    leftIn: Float32Array,
    rightIn: Float32Array,
    leftOut: Float32Array,
    rightOut: Float32Array,
  ): void {
    const numFrames = leftIn.length;
    this.allocInput(numFrames);

    // 1. Write interleaved input into WASM memory
    const mem = new Float32Array(this.exports!.memory.buffer);
    const inOff = this.inputPtr >> 2;
    for (let i = 0; i < numFrames; i++) {
      mem[inOff + i * 2] = leftIn[i];
      mem[inOff + i * 2 + 1] = rightIn[i];
    }

    this.exports!.soundtouch_put_samples(this.handle, this.inputPtr, numFrames);
    this.exports!.soundtouch_process(this.handle);

    // 2. Drain ALL available output from WASM into JS FIFO
    this.drainWasmToFifo();

    // 3. Output exactly numFrames from the FIFO
    const avail = this.fifoAvailable;
    const availFrames = avail / CHANNELS;

    if (availFrames >= numFrames) {
      // Normal case: enough data in FIFO
      for (let i = 0; i < numFrames; i++) {
        let l = this.fifo[this.fifoRead];
        let r = this.fifo[this.fifoRead + 1];
        this.fifoRead += CHANNELS;

        // Apply fade-in on first audio arrival to prevent initial click
        if (!this.audioStarted) {
          this.audioStarted = true;
          this.fadeInPos = 0;
        }
        if (this.fadeInPos < FADE_IN_FRAMES) {
          const gain = this.fadeInPos / FADE_IN_FRAMES;
          l *= gain;
          r *= gain;
          this.fadeInPos++;
        }

        leftOut[i] = Number.isFinite(l) ? l : 0;
        rightOut[i] = Number.isFinite(r) ? r : 0;
      }
    } else if (availFrames > 0) {
      // Partial: output what we have, hold last sample for the rest
      const partial = Math.floor(availFrames);
      let lastL = 0, lastR = 0;

      for (let i = 0; i < partial; i++) {
        lastL = this.fifo[this.fifoRead];
        lastR = this.fifo[this.fifoRead + 1];
        this.fifoRead += CHANNELS;

        if (!this.audioStarted) {
          this.audioStarted = true;
          this.fadeInPos = 0;
        }
        if (this.fadeInPos < FADE_IN_FRAMES) {
          const gain = this.fadeInPos / FADE_IN_FRAMES;
          lastL *= gain;
          lastR *= gain;
          this.fadeInPos++;
        }

        leftOut[i] = Number.isFinite(lastL) ? lastL : 0;
        rightOut[i] = Number.isFinite(lastR) ? lastR : 0;
      }

      // Hold last sample value instead of zero-padding (prevents clicks)
      for (let i = partial; i < numFrames; i++) {
        leftOut[i] = lastL;
        rightOut[i] = lastR;
      }
    } else {
      // No output yet (initial latency): output silence
      leftOut.fill(0);
      if (rightOut !== leftOut) rightOut.fill(0);
    }

    this.compactFifo();
  }

  private drainWasmToFifo(): void {
    const outSamples = this.outputFrames * CHANNELS;

    // Loop: keep reading until the WASM has no more output
    for (;;) {
      // Re-acquire memory view (WASM calls may grow memory)
      const mem = new Float32Array(this.exports!.memory.buffer);
      const outOff = this.outputPtr >> 2;

      const received = this.exports!.soundtouch_receive_samples(
        this.handle, this.outputPtr, this.outputFrames
      );
      if (received === 0) break;

      const samplesReceived = received * CHANNELS;

      // Ensure FIFO has space
      const needed = this.fifoWrite + samplesReceived;
      if (needed > this.fifo.length) {
        const newSize = Math.max(this.fifo.length * 2, needed + 4096);
        const bigger = new Float32Array(newSize);
        bigger.set(this.fifo.subarray(0, this.fifoWrite));
        this.fifo = bigger;
      }

      // Re-acquire view after potential FIFO reallocation (not needed
      // for WASM memory but let's be safe after any allocation)
      const mem2 = new Float32Array(this.exports!.memory.buffer);
      const outOff2 = this.outputPtr >> 2;

      // Copy from WASM output buffer into FIFO
      for (let i = 0; i < samplesReceived; i++) {
        this.fifo[this.fifoWrite + i] = mem2[outOff2 + i];
      }
      this.fifoWrite += samplesReceived;
    }
  }

  private compactFifo(): void {
    // Shift remaining data to the front when we've consumed enough
    if (this.fifoRead > 4096) {
      const remaining = this.fifoWrite - this.fifoRead;
      if (remaining > 0) {
        this.fifo.copyWithin(0, this.fifoRead, this.fifoWrite);
      }
      this.fifoWrite = remaining;
      this.fifoRead = 0;
    }
  }

  destroy(): void {
    if (!this.exports) return;
    if (this.inputPtr) {
      this.exports.wasm_dealloc(this.inputPtr, this.inputFrames * CHANNELS * 4);
    }
    if (this.outputPtr) {
      this.exports.wasm_dealloc(this.outputPtr, this.outputFrames * CHANNELS * 4);
    }
    this.inputPtr = 0;
    this.outputPtr = 0;
    this.inputFrames = 0;
    this.outputFrames = 0;
    if (this.handle) {
      this.exports.soundtouch_free(this.handle);
      this.handle = 0;
    }
    this.exports = null;
  }
}

// ------------------------------------------------------------
// AudioWorkletProcessor
// ------------------------------------------------------------

type WorkletParams = Record<'rate' | 'tempo' | 'pitch' | 'pitchSemitones' | 'agcEnabled', Float32Array>;

function paramValue(params: WorkletParams, name: keyof WorkletParams, fallback: number): number {
  const arr = params[name];
  return arr && arr.length > 0 ? arr[0] : fallback;
}

class SoundTouchProcessor extends AudioWorkletProcessor {
  private readonly wasmPipe = new WasmSoundTouch();

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === 'load-wasm' && e.data.wasm instanceof ArrayBuffer) {
        const ok = this.wasmPipe.init(e.data.wasm, sampleRate);
        this.port.postMessage({ type: 'wasm-loaded', success: ok });
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: WorkletParams): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0) return false;

    const leftOut = output[0];
    const rightOut = output[1] ?? output[0];

    if (!input || input.length === 0 || !input[0]) {
      leftOut.fill(0);
      if (rightOut !== leftOut) rightOut.fill(0);
      return true;
    }

    const leftIn = input[0];
    const rightIn = input[1] ?? input[0];

    if (!this.wasmPipe.ready) {
      leftOut.set(leftIn);
      rightOut.set(rightIn);
      return true;
    }

    const rate = paramValue(parameters, 'rate', 1.0);
    const tempo = paramValue(parameters, 'tempo', 1.0);
    const pitch = paramValue(parameters, 'pitch', 1.0);
    const pitchSemitones = paramValue(parameters, 'pitchSemitones', 0);
    const agcEnabled = paramValue(parameters, 'agcEnabled', 0);
    const effectivePitch = pitch * Math.pow(2, pitchSemitones / 12);

    try {
      this.wasmPipe.setRate(rate);
      this.wasmPipe.setTempo(tempo);
      this.wasmPipe.setPitch(effectivePitch);
      this.wasmPipe.setAgc(agcEnabled > 0.5);
      this.wasmPipe.processQuantum(leftIn, rightIn, leftOut, rightOut);
    } catch {
      leftOut.set(leftIn);
      rightOut.set(rightIn);
    }

    return true;
  }

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      { name: 'rate', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0 },
      { name: 'tempo', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0 },
      { name: 'pitch', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0 },
      { name: 'pitchSemitones', defaultValue: 0, minValue: -24, maxValue: 24 },
      { name: 'agcEnabled', defaultValue: 0, minValue: 0, maxValue: 1 },
    ];
  }
}

registerProcessor('soundtouch-processor', SoundTouchProcessor);
