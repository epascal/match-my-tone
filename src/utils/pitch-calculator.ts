/**
 * Utilities for audio pitch calculation
 */

/** Standard base frequency (A4) */
const BASE_HZ = 440.0;

/**
 * Calculates pitch in semitones from raw parameters
 * 
 * @param semitons - Semitone offset (manual adjustment)
 * @param hz - Base frequency in Hz (reference adjustment)
 * @returns Total pitch in semitones
 * 
 * @example
 * // For A4 (440Hz) with +2 semitones
 * calculatePitch(2, 440) // => 2.0
 * 
 * // For A#4 (466.16Hz) with 0 semitones
 * calculatePitch(0, 466.16) // => ~1.0 (approximately 1 semitone above A4)
 */
export function calculatePitch(semitons: number, hz: number): number {
  // Convert frequency difference to semitones
  // Formula: semitones = 12 * log2(freq / baseFreq)
  const hzInSemitones = 12 * Math.log2(hz / BASE_HZ);
  
  // Add manual semitone offset
  return semitons + hzInSemitones;
}

/**
 * Converts semitones to frequency ratio
 * 
 * @param semitones - Number of semitones
 * @returns Frequency ratio (1.0 = no change)
 * 
 * @example
 * semitonesToRatio(12) // => 2.0 (one octave higher)
 * semitonesToRatio(-12) // => 0.5 (one octave lower)
 */
export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * Converts frequency ratio to semitones
 * 
 * @param ratio - Frequency ratio
 * @returns Number of semitones
 * 
 * @example
 * ratioToSemitones(2.0) // => 12 (one octave)
 * ratioToSemitones(0.5) // => -12 (one octave lower)
 */
export function ratioToSemitones(ratio: number): number {
  return 12 * Math.log2(ratio);
}
