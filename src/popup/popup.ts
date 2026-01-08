/**
 * Script for Match My Tone popup interface
 * 
 * Handles:
 * - Loading parameters from the current tab
 * - Updating parameters via the user interface
 * - Synchronization with the background script
 */

import type { RawAudioParams } from '../types/messages';

/**
 * Small helper to ensure a DOM element exists.
 * We prefer to fail explicitly in the popup rather than having
 * silent errors.
 */
function mustGetElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Popup: element #${id} not found`);
  }
  return el as T;
}

function isRawAudioParams(value: unknown): value is RawAudioParams {
  if (!value || typeof value !== 'object') return false;
  const v = value as { hz?: unknown; semitons?: unknown; isEnabled?: unknown };
  return typeof v.hz === 'number' && typeof v.semitons === 'number' && typeof v.isEnabled === 'boolean';
}

function tryGetHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname || null;
  } catch {
    return null;
  }
}

type PopupDom = {
  enabled: HTMLInputElement;
  semitones: HTMLInputElement;
  semitonesValue: HTMLSpanElement;
  hz: HTMLInputElement;
  hzValue: HTMLSpanElement;
};

/**
 * "Idiomatic TS" popup (class + encapsulated state).
 * Goal: remain compatible with MV2 (classic script, no runtime import/export).
 */
class PitchShifterPopup {
  private tabId: number | null = null;
  private host: string | null = null;
  private readonly dom: PopupDom;

  constructor() {
    this.dom = {
      enabled: mustGetElement<HTMLInputElement>('enabled'),
      semitones: mustGetElement<HTMLInputElement>('semitones'),
      semitonesValue: mustGetElement<HTMLSpanElement>('semitonesValue'),
      hz: mustGetElement<HTMLInputElement>('hz'),
      hzValue: mustGetElement<HTMLSpanElement>('hzValue'),
    };
  }

  start(): void {
    this.localizeStaticText();
    this.installEventListeners();
    void this.refreshFromBackground();
  }

  /**
   * Applies translations to static popup elements.
   * Based on `data-i18n="messageKey"` attributes in `static/popup.html`.
   */
  private localizeStaticText(): void {
    const elements = document.querySelectorAll<HTMLElement>('[data-i18n]');
    for (const el of elements) {
      const key = el.dataset.i18n;
      if (!key) continue;
      const msg = browser.i18n.getMessage(key);
      if (msg) el.textContent = msg;
    }

    const title = browser.i18n.getMessage('popupTitle');
    if (title) document.title = title;
  }

  // ------------------------------------------------------------
  // Initialization / UI read-write
  // ------------------------------------------------------------

  private installEventListeners(): void {
    // Enable / disable
    this.dom.enabled.addEventListener('change', () => {
      void this.pushUiParams();
    });

    // Semitones
    this.dom.semitones.addEventListener('input', () => {
      const value = parseFloat(this.dom.semitones.value);
      this.dom.semitonesValue.textContent = value.toFixed(1);
      void this.pushUiParams();
    });

    // Frequency
    this.dom.hz.addEventListener('input', () => {
      this.dom.hzValue.textContent = this.dom.hz.value;
      void this.pushUiParams();
    });
  }

  private readUiParams(): RawAudioParams {
    return {
      isEnabled: this.dom.enabled.checked,
      semitons: parseFloat(this.dom.semitones.value),
      hz: parseFloat(this.dom.hz.value),
    };
  }

  private render(params: RawAudioParams): void {
    this.dom.enabled.checked = params.isEnabled;
    this.dom.semitones.value = params.semitons.toString();
    this.dom.semitonesValue.textContent = params.semitons.toFixed(1);
    this.dom.hz.value = params.hz.toString();
    this.dom.hzValue.textContent = params.hz.toString();
  }

  // ------------------------------------------------------------
  // Background communication
  // ------------------------------------------------------------

  private async resolveActiveTabId(): Promise<number | null> {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const id = tabs[0]?.id;
    return typeof id === 'number' ? id : null;
  }

  private async resolveActiveTabHost(): Promise<string | null> {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0] as unknown as { url?: string };
    return tryGetHostname(tab?.url);
  }

  private async refreshFromBackground(): Promise<void> {
    try {
      this.tabId = await this.resolveActiveTabId();
      this.host = await this.resolveActiveTabHost();
      if (this.tabId === null) {
        console.warn('Popup: no active tab detected.');
        return;
      }

      const params = await browser.runtime.sendMessage({ type: 'getCurrentTabParams' });
      if (!isRawAudioParams(params)) {
        throw new Error('Popup: invalid getCurrentTabParams response');
      }

      this.render(params);
    } catch (err) {
      console.error('Popup: error loading parameters.', err);
    }
  }

  /**
   * Sends UI parameters to background for the active tab.
   */
  private async pushUiParams(): Promise<void> {
    try {
      if (this.tabId === null) {
        this.tabId = await this.resolveActiveTabId();
      }
      if (this.host === null) {
        this.host = await this.resolveActiveTabHost();
      }
      if (this.tabId === null) return;

      await browser.runtime.sendMessage({
        type: 'updateParams',
        tabId: this.tabId,
        host: this.host,
        params: this.readUiParams(),
      });
    } catch (err) {
      console.error('Popup: error updating parameters.', err);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    new PitchShifterPopup().start();
  } catch (err) {
    console.error('Popup: fatal error.', err);
  }
});
