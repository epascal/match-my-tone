/**
 * Types for audio management and media elements
 */

/**
 * Structure storing audio nodes for a processed media element
 */
export interface ProcessedElementData {
  /** Media source created from HTML element */
  source: MediaElementAudioSourceNode;
  /** AudioWorklet node for SoundTouch processing */
  workletNode: AudioWorkletNode;
  /** Gain node for bypass path (original signal) */
  bypassGain: GainNode;
  /** Gain node for effect path (processed signal) */
  effectGain: GainNode;
}

/**
 * Global audio parameters used by content script
 */
export interface GlobalAudioParams {
  /** Pitch in semitones */
  pitch: number;
  /** Enabled/disabled state */
  isEnabled: boolean;
}

/**
 * Audio constants configuration
 */
export interface AudioConfig {
  /** Worklet processor name */
  workletName: string;
  /** Path to processor file */
  workletPath: string;
  /** Fade time for crossfade in seconds */
  fadeTimeSeconds: number;
  /** Base frequency in Hz (A4) */
  baseHz: number;
}
