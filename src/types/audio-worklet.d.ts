/**
 * Typings minimales pour l'environnement AudioWorklet.
 *
 * Selon la version de TypeScript / libs activées, ces types ne sont pas
 * toujours présents par défaut. On les déclare ici pour :
 * - `AudioWorkletProcessor`
 * - `registerProcessor`
 * - `sampleRate`
 * - `AudioParamDescriptor`
 *
 * Le but est d'avoir un `processor.ts` propre, sans casts `any` partout.
 */

export {};

declare global {
  type AutomationRate = 'a-rate' | 'k-rate';

  interface AudioParamDescriptor {
    name: string;
    defaultValue?: number;
    minValue?: number;
    maxValue?: number;
    automationRate?: AutomationRate;
  }

  abstract class AudioWorkletProcessor {
    readonly port: MessagePort;
    constructor(options?: any);
    abstract process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>
    ): boolean;
  }

  function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;

  /** sampleRate (Hz) fourni par l'AudioWorkletGlobalScope */
  const sampleRate: number;
}

