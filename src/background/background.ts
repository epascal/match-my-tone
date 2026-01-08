/**
 * Background script to manage Match My Tone parameters
 * 
 * This script handles:
 * - Parameter storage per tab
 * - Communication between popup and content script
 * - Pitch calculation from raw parameters
 */

import type { RawAudioParams } from '../types/messages';

/**
 * Default parameters for a new tab
 */
const DEFAULT_PARAMS: RawAudioParams = {
  hz: 440.0,           // Base frequency (A4)
  semitons: 0,         // Semitone offset
  isEnabled: false     // Enabled/disabled state
};

/**
 * Calculates total pitch (in semitones) from:
 * - a manual offset (semitones)
 * - a base frequency (hz) relative to A4 (440Hz)
 */
function calculatePitchSemitones(semitons: number, hz: number): number {
  const BASE_HZ = 440.0;
  const hzInSemitones = 12 * Math.log2(hz / BASE_HZ);
  return semitons + hzInSemitones;
}

/**
 * Minimal sender type (we avoid runtime imports of polyfills).
 * We only rely on the fields we need.
 */
type MessageSenderLike = {
  tab?: { id?: number };
  url?: string;
};

type GetParamsMessage = { type: 'getParams' };
type UpdateParamsMessage = {
  type: 'updateParams';
  tabId: number;
  /** hostname (optional) provided by popup */
  host?: string | null;
  params: RawAudioParams;
};
type GetCurrentTabParamsMessage = { type: 'getCurrentTabParams' };
type ParamsUpdateMessage = { type: 'paramsUpdate'; params: { pitch: number; isEnabled: boolean } };

type IncomingMessage = GetParamsMessage | UpdateParamsMessage | GetCurrentTabParamsMessage;

const HOST_ENABLED_PREFIX = 'hostEnabled:';

function storageKeyForHost(host: string): string {
  return `${HOST_ENABLED_PREFIX}${host}`;
}

function tryParseHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname || null;
  } catch {
    return null;
  }
}

/**
 * "Idiomatic TS" background (class, encapsulated state, helpers + comments).
 * Goal: remain 100% compatible with MV2 (classic script, no runtime import/export).
 */
class PitchShifterBackground {
  /**
   * Parameter storage per tab ID (Map = O(1))
   */
  private readonly tabParams = new Map<number, RawAudioParams>();

  /**
   * Cache (volatile) tabId -> hostname, useful when popup only sends tabId.
   * Note: MV2 background is non-persistent, so this cache may disappear.
   */
  private readonly tabHost = new Map<number, string>();

  start(): void {
    this.installMessageListener();
    this.installTabCleanup();
  }

  // ------------------------------------------------------------
  // Per-tab storage
  // ------------------------------------------------------------

  private async getOrInitTabParams(tabId: number, host: string | null): Promise<RawAudioParams> {
    let params = this.tabParams.get(tabId);
    if (!params) {
      params = { ...DEFAULT_PARAMS };
      // Apply stored enabled/disabled state for this hostname, if available.
      if (host) {
        const stored = await this.getStoredEnabledForHost(host);
        if (typeof stored === 'boolean') {
          params.isEnabled = stored;
        }
      }
      this.tabParams.set(tabId, params);
    }
    return params;
  }

  private async getStoredEnabledForHost(host: string): Promise<boolean | null> {
    const key = storageKeyForHost(host);
    const result = await browser.storage.local.get(key);
    const value = (result as Record<string, unknown>)[key];
    return typeof value === 'boolean' ? value : null;
  }

  private async setStoredEnabledForHost(host: string, enabled: boolean): Promise<void> {
    const key = storageKeyForHost(host);
    await browser.storage.local.set({ [key]: enabled });
  }

  private updateTabParams(tabId: number, patch: Partial<RawAudioParams>): void {
    // Here, tabParams should already exist. If not (background wake-up),
    // we initialize without host (it will be applied on next getParams).
    let params = this.tabParams.get(tabId);
    if (!params) {
      params = { ...DEFAULT_PARAMS };
      this.tabParams.set(tabId, params);
    }
    Object.assign(params, patch);

    // Notify the tab's content script (if present)
    const msg: ParamsUpdateMessage = {
      type: 'paramsUpdate',
      params: {
        pitch: calculatePitchSemitones(params.semitons, params.hz),
        isEnabled: params.isEnabled,
      },
    };

    // If content script is not yet injected, sendMessage fails: we ignore.
    browser.tabs.sendMessage(tabId, msg).catch(() => undefined);
  }

  // ------------------------------------------------------------
  // Messages
  // ------------------------------------------------------------

  private installMessageListener(): void {
    browser.runtime.onMessage.addListener((message: unknown, sender: MessageSenderLike) => {
      const msg = this.asIncomingMessage(message);
      if (!msg) return;

      if (msg.type === 'getParams') {
        const tabId = sender.tab?.id;
        if (typeof tabId === 'number') {
          const host = tryParseHostname(sender.url);
          if (host) this.tabHost.set(tabId, host);
          return this.getOrInitTabParams(tabId, host ?? this.tabHost.get(tabId) ?? null);
        }
        return Promise.resolve(DEFAULT_PARAMS);
      }

      if (msg.type === 'updateParams') {
        if (typeof msg.tabId === 'number') {
          const host = typeof msg.host === 'string' && msg.host.length > 0 ? msg.host : this.tabHost.get(msg.tabId) ?? null;
          if (host) {
            this.tabHost.set(msg.tabId, host);
            // Store activation (isEnabled) per hostname
            void this.setStoredEnabledForHost(host, msg.params.isEnabled);
          }
          this.updateTabParams(msg.tabId, msg.params);
          return Promise.resolve({ success: true as const });
        }
        return Promise.resolve({ success: false as const, error: 'No tab ID' });
      }

      if (msg.type === 'getCurrentTabParams') {
        return browser.tabs
          .query({ active: true, currentWindow: true })
          .then(async (tabs) => {
            const tabId = tabs[0]?.id;
            if (typeof tabId !== 'number') return DEFAULT_PARAMS;

            // If URL is accessible (activeTab), we retrieve the hostname.
            const host = tryParseHostname((tabs[0] as unknown as { url?: string })?.url);
            if (host) this.tabHost.set(tabId, host);

            return await this.getOrInitTabParams(tabId, host ?? this.tabHost.get(tabId) ?? null);
          });
      }
    });
  }

  private asIncomingMessage(message: unknown): IncomingMessage | null {
    if (!message || typeof message !== 'object') return null;
    const m = message as { type?: unknown };
    if (m.type === 'getParams') return { type: 'getParams' };
    if (m.type === 'getCurrentTabParams') return { type: 'getCurrentTabParams' };
    if (m.type === 'updateParams') {
      const u = message as { tabId?: unknown; params?: unknown; host?: unknown };
      if (typeof u.tabId !== 'number') return null;
      if (!u.params || typeof u.params !== 'object') return null;
      const p = u.params as { hz?: unknown; semitons?: unknown; isEnabled?: unknown };
      if (typeof p.hz !== 'number' || typeof p.semitons !== 'number' || typeof p.isEnabled !== 'boolean') {
        return null;
      }
      return {
        type: 'updateParams',
        tabId: u.tabId,
        host: typeof u.host === 'string' || u.host === null ? (u.host as string | null) : undefined,
        params: { hz: p.hz, semitons: p.semitons, isEnabled: p.isEnabled },
      };
    }
    return null;
  }

  // ------------------------------------------------------------
  // Cleanup (prevents memory leaks)
  // ------------------------------------------------------------

  private installTabCleanup(): void {
    browser.tabs.onRemoved.addListener((tabId: number) => {
      this.tabParams.delete(tabId);
      this.tabHost.delete(tabId);
    });
  }
}

// Bootstrap
new PitchShifterBackground().start();
