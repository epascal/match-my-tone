/**
 * Content script for Match My Tone
 * 
 * This script:
 * - Detects <audio> and <video> elements on the page
 * - Creates an AudioContext and loads the worklet processor
 * - Applies audio processing with smooth crossfade
 * - Handles real-time parameter updates
 */

import type {
  RawAudioParams,
  ParamsUpdateMessage,
  GetParamsMessage,
} from '../types/messages';
import type {
  GlobalAudioParams,
  ProcessedElementData,
  AudioConfig,
} from '../types/audio';

/**
 * Prevents multiple script injection
 */
declare global {
  interface Window {
    __pitchShifterAttached?: boolean;
  }
}

/**
 * Audio configuration
 */
const AUDIO_CONFIG: AudioConfig = {
  workletName: 'soundtouch-processor',
  workletPath: 'audio/processor.js',
  fadeTimeSeconds: 0.150, // Fade time to avoid "clicks"
  baseHz: 440.0,         // Base frequency (A4)
};

/**
 * "Idiomatic TS" implementation as a class (encapsulated state)
 * and without runtime imports (important for MV2: classic content scripts).
 */
class PitchShifterContentScript {
  private params: GlobalAudioParams | null = null;
  private audioContext: AudioContext | null = null;
  private workletLoaded: Promise<void> | null = null;

  /**
   * Map of processed media elements (WeakMap = no memory leaks)
   */
  private readonly processed = new WeakMap<HTMLMediaElement, ProcessedElementData>();

  constructor(private readonly config: AudioConfig) {}

  /**
   * Entry point: loads parameters, installs listeners, and observes the DOM.
   */
  async start(): Promise<void> {
    console.log('Match My Tone: content script loaded.');
    this.installMessageListener();
    await this.loadInitialParams();
    this.setupExistingElements();
    this.observeDomForNewMedia();
  }

  // ------------------------------------------------------------
  // Messages (background -> content)
  // ------------------------------------------------------------

  private installMessageListener(): void {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!this.isParamsUpdateMessage(message)) return;
      this.applyParamsToAll(message.params);
    });
  }

  private isParamsUpdateMessage(message: unknown): message is ParamsUpdateMessage {
    if (!message || typeof message !== 'object') return false;
    const m = message as { type?: unknown; params?: unknown };
    if (m.type !== 'paramsUpdate') return false;
    if (!m.params || typeof m.params !== 'object') return false;
    const p = m.params as { pitch?: unknown; isEnabled?: unknown };
    return typeof p.pitch === 'number' && typeof p.isEnabled === 'boolean';
  }

  private async loadInitialParams(): Promise<void> {
    try {
      const raw = (await browser.runtime.sendMessage({
        type: 'getParams',
      } as GetParamsMessage)) as RawAudioParams;

      this.params = this.toGlobalAudioParams(raw);
      console.log('Match My Tone: Initial parameters loaded', this.params);
    } catch (err) {
      console.error('Match My Tone: Unable to get initial parameters.', err);
      this.params = { pitch: 0, isEnabled: false };
    }
  }

  private toGlobalAudioParams(raw: RawAudioParams): GlobalAudioParams {
    const hzInSemitones = 12 * Math.log2(raw.hz / this.config.baseHz);
    return {
      pitch: raw.semitons + hzInSemitones,
      isEnabled: raw.isEnabled,
    };
  }

  // ------------------------------------------------------------
  // AudioContext + Worklet
  // ------------------------------------------------------------

  private getAudioContextCtor(): typeof AudioContext {
    const w = window as Window & { webkitAudioContext?: typeof AudioContext };
    const ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!ctor) {
      throw new Error('AudioContext not supported by this browser.');
    }
    return ctor;
  }

  private async ensureAudioContextReady(): Promise<AudioContext> {
    if (!this.audioContext) {
      console.log('Match My Tone: Initializing AudioContext...');
      const Ctor = this.getAudioContextCtor();
      this.audioContext = new Ctor();
    }

    // In some cases (autoplay), resume() may fail without user gesture.
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {
        // We will retry implicitly on next "play" (user gesture).
      }
    }

    if (!this.workletLoaded) {
      const url = browser.runtime.getURL(this.config.workletPath);
      this.workletLoaded = this.audioContext.audioWorklet.addModule(url);
    }

    await this.workletLoaded;
    return this.audioContext;
  }

  // ------------------------------------------------------------
  // Media element connection
  // ------------------------------------------------------------

  private setupExistingElements(): void {
    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => this.setupElement(el));
  }

  private setupElement(element: HTMLMediaElement): void {
    element.addEventListener(
      'play',
      () => {
        void this.connectElement(element);
      },
      { once: true }
    );

    // If already playing at init time, connect directly.
    if (!element.paused) {
      void this.connectElement(element);
    }
  }

  private async connectElement(element: HTMLMediaElement): Promise<void> {
    if (!this.params) return;
    if (this.processed.has(element)) return;

    try {
      const ctx = await this.ensureAudioContextReady();

      // createMediaElementSource can only be called once per element/context.
      const source = ctx.createMediaElementSource(element);
      const workletNode = new AudioWorkletNode(ctx, this.config.workletName);
      const bypassGain = ctx.createGain();
      const effectGain = ctx.createGain();

      const now = ctx.currentTime;

      // Initial parameters
      workletNode.parameters.get('pitchSemitones')?.setValueAtTime(this.params.pitch, now);
      workletNode.parameters.get('tempo')?.setValueAtTime(1.0, now);

      // Path A (bypass): source -> bypassGain -> destination
      source.connect(bypassGain).connect(ctx.destination);

      // Path B (effect): source -> worklet -> effectGain -> destination
      source.connect(workletNode).connect(effectGain).connect(ctx.destination);

      // Initial mix (without fade)
      this.setMixImmediate(bypassGain, effectGain, this.params.isEnabled, now);

      this.processed.set(element, { source, workletNode, bypassGain, effectGain });

      console.log(
        `Match My Tone: element connected (${this.params.isEnabled ? 'ENABLED' : 'DISABLED'})`,
        element
      );
    } catch (err) {
      console.warn("Match My Tone: unable to connect media element.", err);
    }
  }

  private setMixImmediate(bypass: GainNode, effect: GainNode, enabled: boolean, now: number): void {
    if (enabled) {
      bypass.gain.setValueAtTime(0.0, now);
      effect.gain.setValueAtTime(1.0, now);
    } else {
      bypass.gain.setValueAtTime(1.0, now);
      effect.gain.setValueAtTime(0.0, now);
    }
  }

  // ------------------------------------------------------------
  // Parameter updates (pitch + crossfade)
  // ------------------------------------------------------------

  private applyParamsToAll(params: GlobalAudioParams): void {
    const previous = this.params;
    this.params = params;

    if (!this.audioContext) return; // nothing to do until audio has started

    const now = this.audioContext.currentTime;
    const stateChanged = !!previous && previous.isEnabled !== params.isEnabled;

    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((element) => {
      const data = this.processed.get(element);
      if (!data) return;

      // 1) Update pitch (smooth ramp)
      data.workletNode.parameters
        .get('pitchSemitones')
        ?.linearRampToValueAtTime(params.pitch, now + this.config.fadeTimeSeconds);

      // 2) Crossfade if enable/disable
      if (stateChanged) {
        this.crossfade(data, params.isEnabled, now);
      }
    });
  }

  private cancelAndHold(param: AudioParam, now: number): void {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }

  private crossfade(data: ProcessedElementData, enabled: boolean, now: number): void {
    // Cancel any previous automation to avoid clicks
    this.cancelAndHold(data.bypassGain.gain, now);
    this.cancelAndHold(data.effectGain.gain, now);

    const end = now + this.config.fadeTimeSeconds;

    if (enabled) {
      // Enable: bypass -> 0, effect -> 1
      data.bypassGain.gain.linearRampToValueAtTime(0.0, end);
      data.effectGain.gain.linearRampToValueAtTime(1.0, end);
    } else {
      // Disable: bypass -> 1, effect -> 0
      data.bypassGain.gain.linearRampToValueAtTime(1.0, end);
      data.effectGain.gain.linearRampToValueAtTime(0.0, end);
    }
  }

  // ------------------------------------------------------------
  // DOM observer (YouTube, SPA, etc.)
  // ------------------------------------------------------------

  private observeDomForNewMedia(): void {
    const root = document.body ?? document.documentElement;
    if (!root) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          this.trySetupFromNode(node);
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
  }

  private trySetupFromNode(node: Node): void {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;

    // If the node itself is a media element
    if (el instanceof HTMLAudioElement || el instanceof HTMLVideoElement) {
      this.setupElement(el);
    }

    // Otherwise, search in its descendants
    el.querySelectorAll?.('audio, video').forEach((child) => {
      this.setupElement(child as HTMLMediaElement);
    });
  }
}

// -----------------------------------------------------------------
// Bootstrapping (prevents double injection)
// -----------------------------------------------------------------
if (!window.__pitchShifterAttached) {
  window.__pitchShifterAttached = true;
  console.log('Match My Tone: Content script injected.');
  void new PitchShifterContentScript(AUDIO_CONFIG).start();
}
