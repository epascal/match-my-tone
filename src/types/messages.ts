/**
 * Types for communication between different extension components
 * (background script, content script, popup)
 */

/**
 * Message types exchanged between components
 */
export type MessageType = 
  | 'getParams'           // Content script requests parameters
  | 'paramsUpdate'         // Background sends a parameter update
  | 'updateParams'        // Popup updates parameters
  | 'getCurrentTabParams'; // Popup requests current tab parameters

/**
 * Raw audio parameters (before pitch calculation)
 */
export interface RawAudioParams {
  /** Base frequency in Hz (default 440 = A4) */
  hz: number;
  /** Semitone offset */
  semitons: number;
  /** Enabled/disabled state */
  isEnabled: boolean;
}

/**
 * Calculated audio parameters (after pitch conversion)
 */
export interface CalculatedAudioParams {
  /** Pitch in semitones (includes base frequency calculation) */
  pitch: number;
  /** Enabled/disabled state */
  isEnabled: boolean;
}

/**
 * Parameter request message (content script -> background)
 */
export interface GetParamsMessage {
  type: 'getParams';
}

/**
 * Parameter update message (background -> content script)
 */
export interface ParamsUpdateMessage {
  type: 'paramsUpdate';
  params: CalculatedAudioParams;
}

/**
 * Update message from popup (popup -> background)
 */
export interface UpdateParamsMessage {
  type: 'updateParams';
  tabId: number;
  params: RawAudioParams;
}

/**
 * Current tab parameter request message (popup -> background)
 */
export interface GetCurrentTabParamsMessage {
  type: 'getCurrentTabParams';
}

/**
 * Success response
 */
export interface SuccessResponse {
  success: true;
}

/**
 * Error response
 */
export interface ErrorResponse {
  success: false;
  error: string;
}

/**
 * Union of all message types
 */
export type Message = 
  | GetParamsMessage
  | ParamsUpdateMessage
  | UpdateParamsMessage
  | GetCurrentTabParamsMessage;

/**
 * Union of all responses
 */
export type MessageResponse = 
  | RawAudioParams
  | CalculatedAudioParams
  | SuccessResponse
  | ErrorResponse;
