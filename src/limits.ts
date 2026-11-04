/**
 * The shape of an account's usage limits as the views and the automation see it,
 * and the two measures taken from them. Plain types and plain functions: no DOM,
 * no Node, no VS Code, so webview bundles can import them.
 */

/** One usage limit of an account (5h, weekly, or a model's weekly limit). */
export interface LimitWindow {
  kind: string;
  label?: string;
  /** 0-100 */
  percent: number;
  resetsAt: string | null;
}

/** The part of an account the limit rules look at. */
export interface LimitAccount {
  id: string;
  label: string;
  isActive?: boolean;
  needsReauthorization?: boolean;
  windows: LimitWindow[];
}

/** The cycle length of a limit, used when its reset time is unknown. */
const CYCLE_HOURS: Record<string, number> = { session: 5 };
const WEEK_HOURS = 7 * 24;

function resetMs(w: LimitWindow): number | null {
  const t = w.resetsAt ? Date.parse(w.resetsAt) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** Hours until the limit resets; the full cycle when the reset time is unknown. */
function hoursToReset(w: LimitWindow, kind: string, now: number): number {
  const at = resetMs(w);
  if (at === null) return CYCLE_HOURS[kind] ?? WEEK_HOURS;
  return Math.max(0, (at - now) / 3_600_000);
}

/**
 * Available percent per hour until the reset: the higher, the more capacity would be
 * lost by waiting. A limit that resets within a few minutes with capacity left is the
 * most urgent of all.
 */
export function urgencyOf(w: LimitWindow, kind: string, now: number): number {
  const available = 100 - w.percent;
  if (available <= 0) return 0;
  const hours = hoursToReset(w, kind, now);
  return hours < 1 / 12 ? Infinity : available / hours;
}

/** A duration as "45 min", "2 h 10 min", "3 d 4 h". */
export function fmtWait(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours} h ${mins % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
