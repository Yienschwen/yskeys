/**
 * Display formatting. Every function that can receive "no data" renders the em
 * dash rather than a zero, per DESIGN.md §3.2.
 */

export const DASH = '—';

/** Visible stand-in for the space character in tables, where a blank cell is a lie. */
export const SPACE_GLYPH = '␣';

export function displayUnit(unit: string): string {
  return unit.replaceAll(' ', SPACE_GLYPH);
}

export function formatPercent(value: number | null): string {
  return value === null ? DASH : `${(value * 100).toFixed(1)}%`;
}

export function formatSpeed(value: number | null): string {
  return value === null ? DASH : String(Math.round(value));
}

export function formatCount(value: number): string {
  return String(value);
}

export function formatMs(value: number | null): string {
  return value === null ? DASH : `${Math.round(value)} ms`;
}

/** `m:ss`, growing to `h:mm:ss` past an hour. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${String(minutes)}:${pad(seconds)}`;
}
