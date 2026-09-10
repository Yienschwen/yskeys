/**
 * Every tunable in one place. Values come from PROJECT.md §5–§7 and DESIGN.md.
 * Nothing here may be duplicated inline elsewhere.
 */

export const APP_VERSION = '0.0.0';

/* ---------------------------------------------------------------- storage -- */

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'yskeys:v1:store';
export const BACKUP_KEY_PREFIX = 'yskeys:backup:';
export const MAX_SESSION_SUMMARIES = 200;
export const MAX_PAYLOAD_BYTES = 3 * 1024 * 1024;
export const MIN_TRIGRAM_ATTEMPTS = 3;

/* ---------------------------------------------------------------- session -- */

export const GROUP_SIZE = 5;
export const SESSION_GROUP_COUNTS = [15, 30, 60] as const;
export const DEFAULT_GROUP_COUNT = 30;

/* ------------------------------------------------- accuracy smoothing (F6) -- */

/** Beta prior strength: one attempt can never produce 0% or 100%. */
export const SMOOTHING_ALPHA = 5;
export const SMOOTHING_PRIOR = 0.9;

/* ------------------------------------------------- adaptive sampling (F5) -- */

export const WEIGHT_EXPONENT = 2;
export const WEIGHT_FLOOR = 0.05;
export const SAMPLE_BOOST = 2.5;
export const SAMPLE_BOOST_THRESHOLD = 10;

/** 60% weakest units / 25% next tier / 15% uniform. Must sum to 1. */
export const WEAK_POOL_SHARE = 0.6;
export const MID_POOL_SHARE = 0.25;
export const RANDOM_SHARE = 0.15;
export const WEAK_POOL_FRACTION = 0.3;

/** Chance a drawn unit is embedded in a longer 3–5 char group. */
export const EMBED_PROBABILITY = 0.7;

/* ----------------------------------------------------------------- latency -- */

/** Gaps longer than this are treated as "stepped away" and excluded. */
export const IDLE_GAP_MS = 1500;

/** Below this much active time, speed numbers are noise; report "—" instead. */
export const MIN_SPEED_WINDOW_MS = 1000;

/* --------------------------------------------------------------- keyboard -- */

/** DESIGN.md §4.3 — Tab is deliberately NOT intercepted. */
export const RESTART_KEY = 'Escape';
export const NEXT_SESSION_KEY = 'Enter';
