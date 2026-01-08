/**
 * Types pour la gestion audio et les éléments média
 */

/**
 * Structure stockant les nœuds audio pour un élément média traité
 */
export interface ProcessedElementData {
  /** Source média créée depuis l'élément HTML */
  source: MediaElementAudioSourceNode;
  /** Nœud AudioWorklet pour le traitement SoundTouch */
  workletNode: AudioWorkletNode;
  /** Nœud Gain pour le chemin bypass (signal original) */
  bypassGain: GainNode;
  /** Nœud Gain pour le chemin effet (signal traité) */
  effectGain: GainNode;
}

/**
 * Paramètres audio globaux utilisés par le content script
 */
export interface GlobalAudioParams {
  /** Pitch en demi-tons */
  pitch: number;
  /** État activé/désactivé */
  isEnabled: boolean;
}

/**
 * Configuration des constantes audio
 */
export interface AudioConfig {
  /** Nom du worklet processor */
  workletName: string;
  /** Chemin vers le fichier processor */
  workletPath: string;
  /** Temps de fade pour le crossfade en secondes */
  fadeTimeSeconds: number;
  /** Fréquence de base en Hz (La4) */
  baseHz: number;
}
