/**
 * Types pour la communication entre les différents composants de l'extension
 * (background script, content script, popup)
 */

/**
 * Types de messages échangés entre les composants
 */
export type MessageType = 
  | 'getParams'           // Content script demande les paramètres
  | 'paramsUpdate'         // Background envoie une mise à jour de paramètres
  | 'updateParams'        // Popup met à jour les paramètres
  | 'getCurrentTabParams'; // Popup demande les paramètres de l'onglet actuel

/**
 * Paramètres audio bruts (avant calcul du pitch)
 */
export interface RawAudioParams {
  /** Fréquence de base en Hz (par défaut 440 = La4) */
  hz: number;
  /** Décalage en demi-tons */
  semitons: number;
  /** État activé/désactivé */
  isEnabled: boolean;
}

/**
 * Paramètres audio calculés (après conversion en pitch)
 */
export interface CalculatedAudioParams {
  /** Pitch en demi-tons (inclut le calcul de la fréquence de base) */
  pitch: number;
  /** État activé/désactivé */
  isEnabled: boolean;
}

/**
 * Message de demande de paramètres (content script -> background)
 */
export interface GetParamsMessage {
  type: 'getParams';
}

/**
 * Message de mise à jour de paramètres (background -> content script)
 */
export interface ParamsUpdateMessage {
  type: 'paramsUpdate';
  params: CalculatedAudioParams;
}

/**
 * Message de mise à jour depuis le popup (popup -> background)
 */
export interface UpdateParamsMessage {
  type: 'updateParams';
  tabId: number;
  params: RawAudioParams;
}

/**
 * Message de demande de paramètres de l'onglet actuel (popup -> background)
 */
export interface GetCurrentTabParamsMessage {
  type: 'getCurrentTabParams';
}

/**
 * Réponse de succès
 */
export interface SuccessResponse {
  success: true;
}

/**
 * Réponse d'erreur
 */
export interface ErrorResponse {
  success: false;
  error: string;
}

/**
 * Union de tous les types de messages
 */
export type Message = 
  | GetParamsMessage
  | ParamsUpdateMessage
  | UpdateParamsMessage
  | GetCurrentTabParamsMessage;

/**
 * Union de toutes les réponses
 */
export type MessageResponse = 
  | RawAudioParams
  | CalculatedAudioParams
  | SuccessResponse
  | ErrorResponse;
