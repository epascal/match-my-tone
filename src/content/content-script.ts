/**
 * Content script pour Match My Tone
 * 
 * Ce script :
 * - Détecte les éléments <audio> et <video> sur la page
 * - Crée un AudioContext et charge le worklet processor
 * - Applique le traitement audio avec crossfade fluide
 * - Gère les mises à jour de paramètres en temps réel
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
 * Empêche l'injection multiple du script
 */
declare global {
  interface Window {
    __pitchShifterAttached?: boolean;
  }
}

/**
 * Configuration audio
 */
const AUDIO_CONFIG: AudioConfig = {
  workletName: 'soundtouch-processor',
  workletPath: 'audio/processor.js',
  fadeTimeSeconds: 0.150, // Temps de fade pour éviter les "clicks"
  baseHz: 440.0,         // Fréquence de base (La4)
};

/**
 * Implémentation “idiomatique TS” sous forme de classe (état encapsulé)
 * et sans import runtime (important pour MV2 : content scripts classiques).
 */
class PitchShifterContentScript {
  private params: GlobalAudioParams | null = null;
  private audioContext: AudioContext | null = null;
  private workletLoaded: Promise<void> | null = null;

  /**
   * Map des éléments média traités (WeakMap = pas de fuite mémoire)
   */
  private readonly processed = new WeakMap<HTMLMediaElement, ProcessedElementData>();

  constructor(private readonly config: AudioConfig) {}

  /**
   * Point d’entrée : charge les paramètres, installe les listeners, et observe le DOM.
   */
  async start(): Promise<void> {
    console.log('Match My Tone: content script chargé.');
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
      console.log('Match My Tone: Paramètres initiaux chargés', this.params);
    } catch (err) {
      console.error('Match My Tone: Impossible d\'obtenir les paramètres initiaux.', err);
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
      throw new Error('AudioContext non supporté par ce navigateur.');
    }
    return ctor;
  }

  private async ensureAudioContextReady(): Promise<AudioContext> {
    if (!this.audioContext) {
      console.log('Match My Tone: Initialisation AudioContext...');
      const Ctor = this.getAudioContextCtor();
      this.audioContext = new Ctor();
    }

    // Dans certains cas (autoplay), resume() peut échouer sans geste utilisateur.
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {
        // On réessaiera implicitement au prochain "play" (geste utilisateur).
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
  // Connexion des éléments media
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

    // Si déjà en lecture au moment de l’init, on connecte directement.
    if (!element.paused) {
      void this.connectElement(element);
    }
  }

  private async connectElement(element: HTMLMediaElement): Promise<void> {
    if (!this.params) return;
    if (this.processed.has(element)) return;

    try {
      const ctx = await this.ensureAudioContextReady();

      // createMediaElementSource ne peut être appelé qu'une fois par element/context.
      const source = ctx.createMediaElementSource(element);
      const workletNode = new AudioWorkletNode(ctx, this.config.workletName);
      const bypassGain = ctx.createGain();
      const effectGain = ctx.createGain();

      const now = ctx.currentTime;

      // Paramètres initiaux
      workletNode.parameters.get('pitchSemitones')?.setValueAtTime(this.params.pitch, now);
      workletNode.parameters.get('tempo')?.setValueAtTime(1.0, now);

      // Chemin A (bypass): source -> bypassGain -> destination
      source.connect(bypassGain).connect(ctx.destination);

      // Chemin B (effet): source -> worklet -> effectGain -> destination
      source.connect(workletNode).connect(effectGain).connect(ctx.destination);

      // Mix initial (sans fade)
      this.setMixImmediate(bypassGain, effectGain, this.params.isEnabled, now);

      this.processed.set(element, { source, workletNode, bypassGain, effectGain });

      console.log(
        `Match My Tone: élément connecté (${this.params.isEnabled ? 'ACTIVÉ' : 'DÉSACTIVÉ'})`,
        element
      );
    } catch (err) {
      console.warn("Match My Tone: impossible de connecter l'élément média.", err);
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
  // Mises à jour de paramètres (pitch + crossfade)
  // ------------------------------------------------------------

  private applyParamsToAll(params: GlobalAudioParams): void {
    const previous = this.params;
    this.params = params;

    if (!this.audioContext) return; // rien à faire tant que l’audio n’a pas démarré

    const now = this.audioContext.currentTime;
    const stateChanged = !!previous && previous.isEnabled !== params.isEnabled;

    document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((element) => {
      const data = this.processed.get(element);
      if (!data) return;

      // 1) Update pitch (rampe douce)
      data.workletNode.parameters
        .get('pitchSemitones')
        ?.linearRampToValueAtTime(params.pitch, now + this.config.fadeTimeSeconds);

      // 2) Crossfade si activation/désactivation
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
    // Annule toute automation précédente pour éviter les clicks
    this.cancelAndHold(data.bypassGain.gain, now);
    this.cancelAndHold(data.effectGain.gain, now);

    const end = now + this.config.fadeTimeSeconds;

    if (enabled) {
      // Activation: bypass -> 0, effet -> 1
      data.bypassGain.gain.linearRampToValueAtTime(0.0, end);
      data.effectGain.gain.linearRampToValueAtTime(1.0, end);
    } else {
      // Désactivation: bypass -> 1, effet -> 0
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

    // Si le noeud lui-même est un media element
    if (el instanceof HTMLAudioElement || el instanceof HTMLVideoElement) {
      this.setupElement(el);
    }

    // Sinon, on cherche dans ses descendants
    el.querySelectorAll?.('audio, video').forEach((child) => {
      this.setupElement(child as HTMLMediaElement);
    });
  }
}

// -----------------------------------------------------------------
// Bootstrapping (évite double injection)
// -----------------------------------------------------------------
if (!window.__pitchShifterAttached) {
  window.__pitchShifterAttached = true;
  console.log('Match My Tone: Script de contenu injecté.');
  void new PitchShifterContentScript(AUDIO_CONFIG).start();
}
