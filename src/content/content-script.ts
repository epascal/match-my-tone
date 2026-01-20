/**
 * Content script for Match My Tone
 * Mirror of the working legacy content_script.js (root) with TypeScript typings.
 *
 * Key points:
 * - No touching element.muted/volume; rely on MediaElementSource routing
 * - Two-path mixer (bypass/effect) with crossfade on enable/disable
 * - Connect on play; also connect immediately if already playing
 * - Observe DOM for new media elements
 */

import type { RawAudioParams, ParamsUpdateMessage, GetParamsMessage } from '../types/messages';
import type { GlobalAudioParams, ProcessedElementData } from '../types/audio';

// Prevent multiple injections
declare global {
  interface Window {
    __pitchShifterAttached?: boolean;
  }
}

const WORKLET_NAME = 'soundtouch-processor';
const WORKLET_PATH = 'audio/processor.js';
const FADE_TIME_S = 0.150;
const BASE_HZ = 440.0;

class PitchShifterContentScript {
  private params: GlobalAudioParams | null = null;
  private audioContext: AudioContext | null = null;
  private workletLoaded: Promise<void> | null = null;
  private readonly processed = new WeakMap<HTMLMediaElement, ProcessedElementData>();

  async start(): Promise<void> {
    console.log('Match My Tone: content script loaded.');
    this.installMessageListener();
    await this.loadInitialParams();
    await this.initAudioContext();
    this.setupInitialMedia();
    this.observeDom();
  }

  // ------------------------------------------------------------------
  // Messaging
  // ------------------------------------------------------------------

  private installMessageListener(): void {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!this.isParamsUpdateMessage(message)) return;
      void this.updateAllElements(message.params);
    });
  }

  private isParamsUpdateMessage(message: unknown): message is ParamsUpdateMessage {
    if (message === null || typeof message !== 'object') return false;
    const m = message as { type?: unknown; params?: unknown };
    if (m.type !== 'paramsUpdate') return false;
    if (m.params === null || typeof m.params !== 'object') return false;
    const p = m.params as { pitch?: unknown; isEnabled?: unknown };
    return typeof p.pitch === 'number' && typeof p.isEnabled === 'boolean';
  }

  // ------------------------------------------------------------------
  // Params bootstrap
  // ------------------------------------------------------------------

  private async loadInitialParams(): Promise<void> {
    try {
      const raw = (await browser.runtime.sendMessage({ type: 'getParams' } as GetParamsMessage)) as RawAudioParams;
      this.params = this.toGlobalParams(raw);
      console.log('Match My Tone: Initial parameters loaded', this.params);
    } catch (err) {
      console.error('Match My Tone: Unable to get initial parameters.', err);
      this.params = { pitch: 0, isEnabled: false };
    }
  }

  private toGlobalParams(raw: RawAudioParams): GlobalAudioParams {
    const hzInSemitones = 12 * Math.log2(raw.hz / BASE_HZ);
    return { pitch: raw.semitons + hzInSemitones, isEnabled: raw.isEnabled };
  }

  // ------------------------------------------------------------------
  // AudioContext + worklet
  // ------------------------------------------------------------------

  private async initAudioContext(): Promise<void> {
    if (this.audioContext) return;

    const maybeCtor = (window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!maybeCtor) throw new Error('AudioContext not supported by this browser.');

    this.audioContext = new maybeCtor();

    // Don't try to resume manually - Firefox will resume automatically when audio plays
    // Attempting to resume here can cause CSP warnings on some machines
    // The AudioContext will be automatically resumed when the media element starts playing

    if (!this.workletLoaded) {
      const url = browser.runtime.getURL(WORKLET_PATH);
      this.workletLoaded = this.audioContext.audioWorklet.addModule(url);
    }

    await this.workletLoaded;
    console.log('Match My Tone: AudioContext and worklet ready.');
  }

  // ------------------------------------------------------------------
  // Connection logic (matches legacy script)
  // ------------------------------------------------------------------

  private async connectElement(element: HTMLMediaElement): Promise<void> {
    if (this.params === null) return;
    if (this.processed.has(element)) return;

    try {
      await this.initAudioContext();
      if (this.audioContext === null) return;

      const source = this.audioContext.createMediaElementSource(element);
      const workletNode = new AudioWorkletNode(this.audioContext, WORKLET_NAME);
      const bypassGain = this.audioContext.createGain();
      const effectGain = this.audioContext.createGain();

      const now = this.audioContext.currentTime;

      workletNode.parameters.get('pitchSemitones')?.setValueAtTime(this.params.pitch, now);
      workletNode.parameters.get('tempo')?.setValueAtTime(1.0, now);

      // Path A: bypass -> destination
      source.connect(bypassGain).connect(this.audioContext.destination);
      // Path B: processed -> destination
      source.connect(workletNode).connect(effectGain).connect(this.audioContext.destination);

      if (this.params.isEnabled) {
        bypassGain.gain.setValueAtTime(0.0, now);
        effectGain.gain.setValueAtTime(1.0, now);
      } else {
        bypassGain.gain.setValueAtTime(1.0, now);
        effectGain.gain.setValueAtTime(0.0, now);
      }

      this.processed.set(element, { source, workletNode, bypassGain, effectGain });
      console.log(`Match My Tone: Connected (${this.params.isEnabled ? 'ENABLED' : 'DISABLED'})`, element);
    } catch (err) {
      console.warn('Match My Tone: unable to connect media element.', err);
    }
  }

  private async updateAllElements(params: GlobalAudioParams): Promise<void> {
    const oldParams = this.params;
    this.params = params;

    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;
    const stateChanged = oldParams && oldParams.isEnabled !== params.isEnabled;

    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((element) => {
      const data = this.processed.get(element);
      if (!data) return;

      data.workletNode.parameters
        .get('pitchSemitones')
        ?.linearRampToValueAtTime(params.pitch, now + FADE_TIME_S);

      if (stateChanged) {
        data.bypassGain.gain.cancelScheduledValues(now);
        data.effectGain.gain.cancelScheduledValues(now);
        data.bypassGain.gain.setValueAtTime(data.bypassGain.gain.value, now);
        data.effectGain.gain.setValueAtTime(data.effectGain.gain.value, now);

        if (params.isEnabled) {
          data.bypassGain.gain.linearRampToValueAtTime(0.0, now + FADE_TIME_S);
          data.effectGain.gain.linearRampToValueAtTime(1.0, now + FADE_TIME_S);
        } else {
          data.bypassGain.gain.linearRampToValueAtTime(1.0, now + FADE_TIME_S);
          data.effectGain.gain.linearRampToValueAtTime(0.0, now + FADE_TIME_S);
        }
      } else {
        data.bypassGain.gain.setValueAtTime(params.isEnabled ? 0.0 : 1.0, now);
        data.effectGain.gain.setValueAtTime(params.isEnabled ? 1.0 : 0.0, now);
      }
    });
  }

  // ------------------------------------------------------------------
  // Media discovery / wiring
  // ------------------------------------------------------------------

  private setupInitialMedia(): void {
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

    if (!element.paused && this.params !== null) {
      void this.connectElement(element);
    }
  }

  private observeDom(): void {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          if (el instanceof HTMLAudioElement || el instanceof HTMLVideoElement) {
            this.setupElement(el);
          }
          el.querySelectorAll?.('audio, video').forEach((child) => this.setupElement(child as HTMLMediaElement));
        }
      }
    });

    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  }
}

if (window.__pitchShifterAttached !== true) {
  window.__pitchShifterAttached = true;
  const script = new PitchShifterContentScript();
  void script.start();
}
