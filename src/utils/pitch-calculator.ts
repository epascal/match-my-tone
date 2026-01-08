/**
 * Utilitaires pour le calcul du pitch audio
 */

/** Fréquence de base standard (La4) */
const BASE_HZ = 440.0;

/**
 * Calcule le pitch en demi-tons à partir des paramètres bruts
 * 
 * @param semitons - Décalage en demi-tons (ajustement manuel)
 * @param hz - Fréquence de base en Hz (ajustement de la référence)
 * @returns Pitch total en demi-tons
 * 
 * @example
 * // Pour un La4 (440Hz) avec +2 demi-tons
 * calculatePitch(2, 440) // => 2.0
 * 
 * // Pour un La#4 (466.16Hz) avec 0 demi-tons
 * calculatePitch(0, 466.16) // => ~1.0 (environ 1 demi-ton au-dessus de La4)
 */
export function calculatePitch(semitons: number, hz: number): number {
  // Convertit la différence de fréquence en demi-tons
  // Formule: semitones = 12 * log2(freq / baseFreq)
  const hzInSemitones = 12 * Math.log2(hz / BASE_HZ);
  
  // Ajoute le décalage manuel en demi-tons
  return semitons + hzInSemitones;
}

/**
 * Convertit des demi-tons en ratio de fréquence
 * 
 * @param semitones - Nombre de demi-tons
 * @returns Ratio de fréquence (1.0 = pas de changement)
 * 
 * @example
 * semitonesToRatio(12) // => 2.0 (une octave plus haut)
 * semitonesToRatio(-12) // => 0.5 (une octave plus bas)
 */
export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * Convertit un ratio de fréquence en demi-tons
 * 
 * @param ratio - Ratio de fréquence
 * @returns Nombre de demi-tons
 * 
 * @example
 * ratioToSemitones(2.0) // => 12 (une octave)
 * ratioToSemitones(0.5) // => -12 (une octave plus bas)
 */
export function ratioToSemitones(ratio: number): number {
  return 12 * Math.log2(ratio);
}
