/**
 * Déclarations de types pour l'API Firefox WebExtension
 * Complément aux types de @types/webextension-polyfill
 */

import { browser } from 'webextension-polyfill';

declare global {
  /**
   * API browser globale pour les extensions Firefox
   * Utilise webextension-polyfill pour la compatibilité
   */
  const browser: typeof import('webextension-polyfill').browser;
}

export {};
