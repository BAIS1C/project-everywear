/**
 * Default ports, paths, and limits shared across applets.
 * Must stay in sync with the Rust shell constants.
 */

export const DEFAULTS = {
  /** Shell frontend dev port */
  SHELL_PORT: 1420,
  /** Gener8 frontend port */
  GENER8_PORT: 3001,
  /** 1magen frontend port */
  ONEMAGEN_PORT: 3002,
  /** Kasai frontend port */
  KASAI_PORT: 3003,
  /** 3nvizen frontend port */
  ENVIZEN_PORT: 3004,
  /** Mymories frontend port */
  MYMORIES_PORT: 3005,
  /** Vid Studio frontend port */
  VID_PORT: 3006,
  /** Avatar Studio frontend port */
  CHARACTER_STUDIO_PORT: 3007,
  /** Video encoder sidecar port */
  VIDEO_ENCODER_PORT: 9877,
  /** Max concurrent model loads */
  MAX_LOADED_MODELS: 3,
  /** Default generation timeout (ms) */
  GENERATION_TIMEOUT_MS: 300_000,
} as const;
