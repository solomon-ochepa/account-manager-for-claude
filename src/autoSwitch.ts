/**
 * Picks the account to use next on its own, and says when none can be used. The rules
 * are the ones a person follows by hand: capacity that is not spent before a limit
 * resets is lost, so the account whose limit resets soonest goes first, and an account
 * is only taken when it is available right now.
 *
 * Plain functions over plain objects, like `propose`: the extension, the accounts panel,
 * and the tests share one order. `AutoSwitchController` applies it; nothing here talks
 * to VS Code or to Anthropic.
 */

import { fmtWait, ProposeAccount, ProposeWindow, urgencyOf } from "./propose";

/** How the next account is chosen. `weeklyReset` is the default. */
export type AutoSwitchOrder = "weeklyReset" | "anyReset" | "urgency" | "remaining" | "listOrder";

export const AUTO_SWITCH_ORDERS: { key: AutoSwitchOrder; label: string }[] = [
  { key: "weeklyReset", label: "Weekly limit resetting soonest first" },
  { key: "anyReset", label: "Any limit resetting soonest first" },
  { key: "urgency", label: "Capacity that would be lost soonest first" },
  { key: "remaining", label: "Most usage left first" },
  { key: "listOrder", label: "The order of the account list" },
];

export const DEFAULT_AUTO_SWITCH_ORDER: AutoSwitchOrder = "weeklyReset";

/** Accounts take part in auto-switching unless `autoSwitch` is explicitly false. */
export interface AutoSwitchAccount extends ProposeAccount {
  autoSwitch?: boolean;
}

export interface AutoSwitchOptions {
  order?: AutoSwitchOrder;
  now?: number;
  /** An account is only taken when at least this much of every limit is left. */
  minAvailablePercent?: number;
  /** Accounts passed over in an earlier round, by id: they go last until their skip expires. */
  skipped?: ReadonlyMap<string, AutoSwitchSkip>;
}

/** A candidate that was passed over, kept until `until` so the next check reconsiders it. */
export interface AutoSwitchSkip {
  id: string;
  reason: string;
  at: number;
  until: number;
}

export interface AutoSwitchPlan {
  /** `stay`: the active account is still usable. `switch`: take `target`. `wait`: nothing is usable. */
  action: "stay" | "switch" | "wait";
  target?: AutoSwitchAccount;
  /** Every account that could be taken, best first. */
  ranked: AutoSwitchAccount[];
  reason: string;
  /** When an account is expected to be usable again (epoch ms); only on `wait`, when known. */
  nextAvailableAt?: number;
}

const EXHAUSTED_PERCENT = 100;

/** Opted in unless the account says otherwise. */
export function takesPartInAutoSwitch(acc: AutoSwitchAccount): boolean {
  return acc.autoSwitch !== false;
}

function windowsOf(acc: ProposeAccount): ProposeWindow[] {
  return acc.windows || [];
}

/** Percent left on the most used limit; -1 when no usage is known. */
export function headroomOf(acc: ProposeAccount): number {
  const windows = windowsOf(acc);
  return windows.length ? 100 - Math.max(...windows.map((w) => w.percent)) : -1;
}

function resetMs(w: ProposeWindow | undefined): number {
  const t = w?.resetsAt ? Date.parse(w.resetsAt) : NaN;
  return Number.isFinite(t) ? t : Infinity;
}

/**
 * The reset of the account's weekly limit: the general one, or the soonest model-specific
 * weekly limit when the account reports no general one. Infinity when it has none.
 */
export function weeklyResetOf(acc: ProposeAccount): number {
  const windows = windowsOf(acc);
  const general = windows.find((w) => w.kind === "weekly_all");
  if (general) return resetMs(general);
  const weekly = windows.filter((w) => w.kind.startsWith("weekly_")).map(resetMs);
  return weekly.length ? Math.min(...weekly) : Infinity;
}

/** The soonest reset of any limit; Infinity when no reset time is known. */
export function nextResetOf(acc: ProposeAccount): number {
  const times = windowsOf(acc).map(resetMs);
  return times.length ? Math.min(...times) : Infinity;
}

/** The highest urgency over the account's limits: how much capacity it would lose per hour. */
export function urgencyScoreOf(acc: ProposeAccount, now: number): number {
  const scores = windowsOf(acc).map((w) => urgencyOf(w, w.kind, now));
  return scores.length ? Math.max(...scores) : 0;
}

/**
 * Whether the account can be used right now: its login works, its usage is known, no
 * limit is used up, and at least `minAvailablePercent` of every limit is left.
 */
export function availableNow(acc: ProposeAccount, minAvailablePercent = 0): boolean {
  if (acc.needsReauthorization) return false;
  const windows = windowsOf(acc);
  if (windows.length === 0) return false;
  if (windows.some((w) => w.percent >= EXHAUSTED_PERCENT)) return false;
  return headroomOf(acc) >= minAvailablePercent;
}

/** Whether auto-switching may take this account at all (opted in, available, not the active one). */
export function eligible(acc: AutoSwitchAccount, minAvailablePercent = 0): boolean {
  return !acc.isActive && takesPartInAutoSwitch(acc) && availableNow(acc, minAvailablePercent);
}

/**
 * Compares two accounts by one auto-switch order; 0 when the order does not separate
 * them, so callers can add their own tie-breaks. Shared with the account list, which
 * can follow the same order.
 */
export function compareByOrder(
  order: AutoSwitchOrder,
  now = Date.now()
): (a: ProposeAccount, b: ProposeAccount) => number {
  const cmp: Record<AutoSwitchOrder, (a: ProposeAccount, b: ProposeAccount) => number> = {
    weeklyReset: (a, b) => weeklyResetOf(a) - weeklyResetOf(b) || nextResetOf(a) - nextResetOf(b),
    anyReset: (a, b) => nextResetOf(a) - nextResetOf(b),
    urgency: (a, b) => urgencyScoreOf(b, now) - urgencyScoreOf(a, now),
    remaining: (a, b) => headroomOf(b) - headroomOf(a),
    listOrder: () => 0,
  };
  const compare = cmp[order] ?? cmp[DEFAULT_AUTO_SWITCH_ORDER];
  // Infinity - Infinity is NaN; the caller's tie-break takes over on 0.
  return (a, b) => compare(a, b) || 0;
}

/**
 * The accounts auto-switching may take, best first. A skipped account stays in the list
 * (it is used when nothing else is left) but goes behind every account that was not
 * skipped, and is ranked normally again once its skip expires.
 */
export function rankForAutoSwitch(
  accounts: AutoSwitchAccount[],
  options: AutoSwitchOptions = {}
): AutoSwitchAccount[] {
  const now = options.now ?? Date.now();
  const order = options.order ?? DEFAULT_AUTO_SWITCH_ORDER;
  const skipped = options.skipped;
  const listOrder = new Map(accounts.map((a, i) => [a.id, i]));
  const skipRank = (a: AutoSwitchAccount) => {
    const skip = skipped?.get(a.id);
    return skip && skip.until > now ? 1 : 0;
  };
  const compare = compareByOrder(order, now);
  // The list order is a choice of its own, so it takes no usage tie-break.
  const tieBreak = order === "listOrder" ? () => 0 : (a: AutoSwitchAccount, b: AutoSwitchAccount) => headroomOf(b) - headroomOf(a);
  return accounts
    .filter((a) => eligible(a, options.minAvailablePercent ?? 0))
    .sort(
      (a, b) =>
        skipRank(a) - skipRank(b) ||
        // Infinity - Infinity is NaN; `||` turns that (and a tie) into the next key.
        compare(a, b) ||
        tieBreak(a, b) ||
        (listOrder.get(a.id) ?? 0) - (listOrder.get(b.id) ?? 0)
    );
}

/** One sentence saying why this account is next. */
export function reasonFor(acc: AutoSwitchAccount, order: AutoSwitchOrder, now: number): string {
  const left = headroomOf(acc);
  const reset = order === "anyReset" ? nextResetOf(acc) : weeklyResetOf(acc);
  const name = order === "anyReset" ? "its next limit" : "its weekly limit";
  if (order === "remaining") {
    return `${left}% of its limits is left, the most of the available accounts.`;
  }
  if (order === "listOrder") {
    return `It is the first available account in the list, with ${left}% of its limits left.`;
  }
  if (!Number.isFinite(reset)) {
    return `${left}% of its limits is left; no reset time is known.`;
  }
  const sentence = `${name} resets in ${fmtWait(Math.max(0, reset - now))}, the soonest of the available accounts, and ${left}% of its limits is left.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** When the account is usable again, from its latest reading; null when unknown. */
function availableAt(acc: AutoSwitchAccount, now: number): number | null {
  if (acc.needsReauthorization) return null;
  const blocked = windowsOf(acc).filter((w) => w.percent >= EXHAUSTED_PERCENT);
  if (windowsOf(acc).length === 0) return null;
  if (blocked.length === 0) return now;
  const times = blocked.map(resetMs);
  return times.every(Number.isFinite) ? Math.max(now, ...times) : null;
}

/** Why nothing can be taken, and when that changes. */
function waitPlan(accounts: AutoSwitchAccount[], now: number): AutoSwitchPlan {
  const taking = accounts.filter((a) => !a.isActive && takesPartInAutoSwitch(a));
  if (taking.length === 0) {
    return {
      action: "wait",
      ranked: [],
      reason: accounts.some((a) => !a.isActive)
        ? "Every other account is opted out of auto-switching."
        : "There is no other account to switch to.",
    };
  }
  const times = taking.map((a) => availableAt(a, now)).filter((t): t is number => t !== null);
  const soonest = times.length ? Math.min(...times) : undefined;
  if (taking.every((a) => a.needsReauthorization)) {
    return { action: "wait", ranked: [], reason: "Every other account needs reauthorization." };
  }
  return {
    action: "wait",
    ranked: [],
    reason:
      soonest === undefined
        ? "No other account is available, and no reset time is known."
        : `No other account is available; the first one is usable again in ${fmtWait(Math.max(0, soonest - now))}.`,
    nextAvailableAt: soonest,
  };
}

/**
 * What auto-switching should do now: keep the active account while it can still be used,
 * otherwise take the best available one, otherwise wait.
 */
export function planAutoSwitch(
  accounts: AutoSwitchAccount[],
  options: AutoSwitchOptions = {}
): AutoSwitchPlan {
  const now = options.now ?? Date.now();
  const order = options.order ?? DEFAULT_AUTO_SWITCH_ORDER;
  const min = options.minAvailablePercent ?? 0;
  const active = accounts.find((a) => a.isActive);
  if (active && availableNow(active, min)) {
    return { action: "stay", ranked: [], reason: `"${active.label}" can still be used.` };
  }
  const ranked = rankForAutoSwitch(accounts, { ...options, now, order, minAvailablePercent: min });
  if (ranked.length === 0) {
    return waitPlan(accounts, now);
  }
  return { action: "switch", target: ranked[0], ranked, reason: reasonFor(ranked[0], order, now) };
}

/**
 * The accounts passed over in the current round, with the reason. A skip only lasts until
 * its cooldown ends, so an account that was skipped for a secondary limit or a restriction
 * is checked again on the next round and taken as soon as it meets the rules again.
 */
export class AutoSwitchSkips {
  private readonly skips = new Map<string, AutoSwitchSkip>();

  record(id: string, reason: string, now = Date.now(), cooldownMs = 0): void {
    this.skips.set(id, { id, reason, at: now, until: now + Math.max(0, cooldownMs) });
  }

  /** The skips still in force; expired ones are forgotten. */
  active(now = Date.now()): ReadonlyMap<string, AutoSwitchSkip> {
    for (const [id, skip] of this.skips) {
      if (skip.until <= now) this.skips.delete(id);
    }
    return this.skips;
  }

  get(id: string, now = Date.now()): AutoSwitchSkip | undefined {
    return this.active(now).get(id);
  }

  clear(id?: string): void {
    if (id === undefined) this.skips.clear();
    else this.skips.delete(id);
  }
}
