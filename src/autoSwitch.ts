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
  /**
   * Marked to stay the account in use: auto-switching holds it and moves nowhere else
   * until the mark is taken off. One account at a time.
   */
  keepActive?: boolean;
  /**
   * The account's own hand-over limit: once any of its limits reaches this percent,
   * auto-switching treats it as spent and takes the next account in the queue. Unset
   * means it is used until a limit is actually used up.
   */
  switchOutPercent?: number;
}

/**
 * When a switch happens: `always` keeps the account the order puts first active, so the
 * capacity that resets soonest is the one being spent; `exhausted` waits until the active
 * account runs out of a limit.
 */
export type AutoSwitchWhen = "always" | "exhausted";

export const AUTO_SWITCH_WHEN: { key: AutoSwitchWhen; label: string }[] = [
  { key: "always", label: "Keep the first account of the order active" },
  { key: "exhausted", label: "Only when the active account runs out of a limit" },
];

export const DEFAULT_AUTO_SWITCH_WHEN: AutoSwitchWhen = "always";

export interface AutoSwitchOptions {
  order?: AutoSwitchOrder;
  when?: AutoSwitchWhen;
  now?: number;
  /** An account is only taken when at least this much of every limit is left. */
  minAvailablePercent?: number;
  /** Accounts passed over in an earlier round, by id: they go last until their skip expires. */
  skipped?: ReadonlyMap<string, AutoSwitchSkip>;
  /** Rank the active account along with the others (to see whether it is still the best one). */
  includeActive?: boolean;
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
  /** true when the plan follows an account marked to stay in use, not the order. */
  held?: boolean;
  target?: AutoSwitchAccount;
  /** Every account that could be taken, best first. */
  ranked: AutoSwitchAccount[];
  reason: string;
  /** When an account is expected to be usable again (epoch ms); only on `wait`, when known. */
  nextAvailableAt?: number;
}

const EXHAUSTED_PERCENT = 100;

/**
 * The percent at which auto-switching hands this account over: its own limit, or 100 —
 * a limit that is actually used up. Values outside 1..100 are ignored.
 */
export function switchOutPercentOf(acc: AutoSwitchAccount): number {
  const own = acc.switchOutPercent;
  return typeof own === "number" && own > 0 && own <= EXHAUSTED_PERCENT ? own : EXHAUSTED_PERCENT;
}

/** The most used limit of `acc`, or undefined when no usage is known. */
export function busiestWindow(acc: AutoSwitchAccount): ProposeWindow | undefined {
  return windowsOf(acc).reduce<ProposeWindow | undefined>(
    (worst, w) => (worst === undefined || w.percent > worst.percent ? w : worst),
    undefined
  );
}

/**
 * Whether the account is out of the queue only because of its own hand-over limit:
 * a limit has reached it, but none is actually used up. Raising the limit brings the
 * account back; waiting for a reset is not needed.
 */
export function reachedOwnLimit(acc: AutoSwitchAccount): boolean {
  const cap = switchOutPercentOf(acc);
  if (cap >= EXHAUSTED_PERCENT) return false;
  const busiest = busiestWindow(acc);
  return busiest !== undefined && busiest.percent >= cap && busiest.percent < EXHAUSTED_PERCENT;
}

/** The limits of `acc` that have reached its hand-over limit. */
export function spentWindows(acc: AutoSwitchAccount, cap = switchOutPercentOf(acc)): ProposeWindow[] {
  return windowsOf(acc).filter((w) => w.percent >= cap);
}

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
 * weekly limit when the account reports no general one. Infinity when it has none. The 5h
 * window never counts, not even as a tie-break — a weekly date is what the order is about.
 */
export function weeklyResetOf(acc: ProposeAccount): number {
  const general = windowsOf(acc).find((w) => w.kind === "weekly_all");
  if (general) return resetMs(general);
  const weekly = weeklyWindowsOf(acc).map(resetMs);
  return weekly.length ? Math.min(...weekly) : Infinity;
}

/** The account's weekly limits: the general one and any model-specific one (never the 5h window). */
function weeklyWindowsOf(acc: ProposeAccount): ProposeWindow[] {
  return windowsOf(acc).filter((w) => w.kind.startsWith("weekly"));
}

/**
 * Percent left on the most used weekly limit; -1 when the account reports none. The 5h
 * window is left out on purpose: it refills several times a day, so it says nothing about
 * which account to spend this week.
 */
export function weeklyHeadroomOf(acc: ProposeAccount): number {
  const weekly = weeklyWindowsOf(acc);
  return weekly.length ? 100 - Math.max(...weekly.map((w) => w.percent)) : -1;
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
export function availableNow(
  acc: AutoSwitchAccount,
  minAvailablePercent = 0,
  cap = switchOutPercentOf(acc)
): boolean {
  if (acc.needsReauthorization) return false;
  const windows = windowsOf(acc);
  if (windows.length === 0) return false;
  if (windows.some((w) => w.percent >= cap)) return false;
  return headroomOf(acc) >= minAvailablePercent;
}

/** Whether auto-switching may take this account at all (opted in, available, not the active one). */
export function eligible(acc: AutoSwitchAccount, minAvailablePercent = 0, includeActive = false): boolean {
  if (acc.isActive && !includeActive) return false;
  return takesPartInAutoSwitch(acc) && availableNow(acc, minAvailablePercent);
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
    // Weekly dates only: accounts that reset on the same date are separated by how much of
    // the weekly limit is left, never by the 5h window.
    weeklyReset: (a, b) =>
      weeklyResetOf(a) - weeklyResetOf(b) || weeklyHeadroomOf(b) - weeklyHeadroomOf(a),
    anyReset: (a, b) => nextResetOf(a) - nextResetOf(b) || headroomOf(b) - headroomOf(a),
    urgency: (a, b) => urgencyScoreOf(b, now) - urgencyScoreOf(a, now) || headroomOf(b) - headroomOf(a),
    remaining: (a, b) => headroomOf(b) - headroomOf(a) || weeklyResetOf(a) - weeklyResetOf(b),
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
  return accounts
    .filter((a) => eligible(a, options.minAvailablePercent ?? 0, options.includeActive))
    .sort(
      (a, b) =>
        skipRank(a) - skipRank(b) ||
        // Infinity - Infinity is NaN; `||` turns that (and a tie) into the next key.
        compare(a, b) ||
        (listOrder.get(a.id) ?? 0) - (listOrder.get(b.id) ?? 0)
    );
}

/** One sentence saying why this account is next. */
export function reasonFor(acc: AutoSwitchAccount, order: AutoSwitchOrder, now: number): string {
  const weekly = order !== "anyReset";
  const left = weekly ? weeklyHeadroomOf(acc) : headroomOf(acc);
  const reset = weekly ? weeklyResetOf(acc) : nextResetOf(acc);
  const name = weekly ? "its weekly limit" : "its next limit";
  const what = weekly ? "its weekly limit" : "its limits";
  if (order === "remaining") {
    return `${headroomOf(acc)}% of its limits is left, the most of the available accounts.`;
  }
  if (order === "listOrder") {
    return `It is the first available account in the list, with ${headroomOf(acc)}% of its limits left.`;
  }
  if (!Number.isFinite(reset)) {
    return `${left}% of ${what} is left; no reset date is known.`;
  }
  const sentence = `${name} resets in ${fmtWait(Math.max(0, reset - now))}, the soonest of the available accounts, and ${left}% of ${what} is left.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function lower(sentence: string): string {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
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

/** When the account is usable again, from its latest reading; null when unknown. */
function availableAt(acc: AutoSwitchAccount, now: number, cap = switchOutPercentOf(acc)): number | null {
  if (acc.needsReauthorization) return null;
  const blocked = spentWindows(acc, cap);
  if (windowsOf(acc).length === 0) return null;
  if (blocked.length === 0) return now;
  const times = blocked.map(resetMs);
  return times.every(Number.isFinite) ? Math.max(now, ...times) : null;
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
  const when = options.when ?? DEFAULT_AUTO_SWITCH_WHEN;

  // A marked account overrides the order, its own opt-out, and the minimum: it was chosen
  // by hand, so auto-switching holds it and waits rather than moving on.
  const held = accounts.find((a) => a.keepActive);
  if (held) {
    const name = `"${held.label}"`;
    if (held.isActive) {
      return { action: "stay", held: true, ranked: [], reason: `${name} is kept active, so auto-switching is paused.` };
    }
    if (held.needsReauthorization) {
      return {
        action: "wait",
        held: true,
        ranked: [],
        reason: `${name} is kept active but its login expired; reauthorize it, or stop keeping it active.`,
      };
    }
    // The mark overrides the account's own hand-over limit too: only a used-up limit stops it.
    if (!availableNow(held, 0, EXHAUSTED_PERCENT)) {
      const at = availableAt(held, now, EXHAUSTED_PERCENT);
      return {
        action: "wait",
        held: true,
        ranked: [],
        reason:
          at === null || at <= now
            ? `${name} is kept active but has no limit left; auto-switching stays paused until you stop keeping it active.`
            : `${name} is kept active but has no limit left; it can be used again in ${fmtWait(at - now)}.`,
        nextAvailableAt: at ?? undefined,
      };
    }
    return { action: "switch", held: true, target: held, ranked: [held], reason: `${name} is kept active.` };
  }

  const active = accounts.find((a) => a.isActive);
  const activeUsable = Boolean(active && takesPartInAutoSwitch(active) && availableNow(active, min));

  // Failover only: the active account keeps the session until one of its limits runs out.
  if (when === "exhausted" && activeUsable) {
    return { action: "stay", ranked: [], reason: `"${active!.label}" can still be used.` };
  }

  // Otherwise the order decides who should be active: an account that is still usable
  // holds the session only while the order puts it first.
  // Why the active account is being left, when it is its own hand-over limit rather than
  // an exhausted one: worth saying, because the limit is not used up.
  const handedOver =
    active && !activeUsable && switchOutPercentOf(active) < EXHAUSTED_PERCENT && spentWindows(active).length > 0
      ? `"${active.label}" reached its ${switchOutPercentOf(active)}% hand-over limit. `
      : "";

  const ranked = rankForAutoSwitch(accounts, {
    ...options,
    now,
    order,
    minAvailablePercent: min,
    includeActive: activeUsable,
  });
  if (ranked.length === 0) {
    const plan = waitPlan(accounts, now);
    return { ...plan, reason: handedOver + plan.reason };
  }
  if (ranked[0].isActive) {
    return {
      action: "stay",
      ranked,
      reason: `"${ranked[0].label}" is the account to use now: ${lower(reasonFor(ranked[0], order, now))}`,
    };
  }
  return {
    action: "switch",
    target: ranked[0],
    ranked: ranked.filter((a) => !a.isActive),
    reason: handedOver + reasonFor(ranked[0], order, now),
  };
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
