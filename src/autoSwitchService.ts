import * as vscode from "vscode";
import { AccountStore } from "./accountStore";
import { needsReauthorization } from "./accountHealth";
import {
  AutoSwitchAccount,
  AutoSwitchOrder,
  AutoSwitchPlan,
  AutoSwitchSkips,
  AUTO_SWITCH_ORDERS,
  AUTO_SWITCH_WHEN,
  AutoSwitchWhen,
  DEFAULT_AUTO_SWITCH_ORDER,
  DEFAULT_AUTO_SWITCH_WHEN,
  availableNow,
  planAutoSwitch,
  switchOutPercentOf,
} from "./autoSwitch";
import { SwitchResult } from "./switchService";

export interface AutoSwitchSettings {
  enabled: boolean;
  order: AutoSwitchOrder;
  when: AutoSwitchWhen;
  /** An account is only taken when at least this much of every limit is left. */
  minAvailablePercent: number;
  notify: boolean;
  /** The account list follows the auto-switch order. */
  sortList: boolean;
  /** How long an account switched to by hand is held; 0 = no hold. */
  manualHoldMs: number;
}

export const DEFAULT_AUTO_SWITCH_SETTINGS: AutoSwitchSettings = {
  enabled: true,
  order: DEFAULT_AUTO_SWITCH_ORDER,
  when: DEFAULT_AUTO_SWITCH_WHEN,
  minAvailablePercent: 1,
  notify: true,
  sortList: true,
  manualHoldMs: 60 * 60_000,
};

/** Reads the `claudeAutoSwitch.autoSwitch.*` settings, falling back to the defaults. */
export function readAutoSwitchSettings(): AutoSwitchSettings {
  const config = vscode.workspace.getConfiguration("claudeAutoSwitch");
  const order = config.get<string>("autoSwitch.order", DEFAULT_AUTO_SWITCH_ORDER);
  const when = config.get<string>("autoSwitch.when", DEFAULT_AUTO_SWITCH_WHEN);
  return {
    enabled: config.get<boolean>("autoSwitch.enabled", DEFAULT_AUTO_SWITCH_SETTINGS.enabled),
    order: AUTO_SWITCH_ORDERS.find((o) => o.key === order)?.key ?? DEFAULT_AUTO_SWITCH_ORDER,
    when: AUTO_SWITCH_WHEN.find((o) => o.key === when)?.key ?? DEFAULT_AUTO_SWITCH_WHEN,
    minAvailablePercent: Math.min(
      100,
      Math.max(0, config.get<number>("autoSwitch.minAvailablePercent", DEFAULT_AUTO_SWITCH_SETTINGS.minAvailablePercent))
    ),
    notify: config.get<boolean>("autoSwitch.notify", DEFAULT_AUTO_SWITCH_SETTINGS.notify),
    sortList: config.get<boolean>("autoSwitch.sortList", DEFAULT_AUTO_SWITCH_SETTINGS.sortList),
    manualHoldMs: Math.max(0, config.get<number>("manualSwitchHoldMinutes", 60)) * 60_000,
  };
}

export interface AutoSwitchOutcome {
  action: AutoSwitchPlan["action"] | "off" | "busy" | "failed";
  targetId?: string;
  message: string;
}

/** Two switches in a row are kept this far apart, so a flapping limit cannot loop. */
const MIN_SWITCH_INTERVAL_MS = 60_000;

/**
 * Switches Claude Code to the next account on its own, following `planAutoSwitch`.
 *
 * Availability is confirmed before the switch, not only taken from the last poll: the
 * chosen account's usage is read once more, and an account that turns out to be used up,
 * or that the switch itself refuses (a login that expired, an account in use in another
 * window, any other restriction), is skipped and the next one is tried. A skip lasts
 * until the next check, which confirms the account again and takes it as soon as it
 * meets the rules — nothing is opted out permanently by being skipped once.
 */
export class AutoSwitchController {
  private readonly skips = new AutoSwitchSkips();
  private running: Promise<AutoSwitchOutcome> | undefined;
  private lastSwitchAt = 0;

  constructor(
    private readonly store: AccountStore,
    private readonly switchTo: (id: string) => Promise<SwitchResult>,
    private readonly refreshUsage: (id: string) => Promise<void>,
    private readonly settings: () => AutoSwitchSettings,
    private readonly cooldownMs: () => number,
    /** Every decision is written here, so "nothing happened" can be read back. */
    private readonly log: (line: string) => void = () => undefined
  ) {}

  /** The reason an account was passed over in the current round, if any. */
  skipReason(id: string): string | undefined {
    return this.skips.get(id)?.reason;
  }

  /** Runs a check; `manual` also runs it while auto-switching is turned off. */
  evaluate(options: { manual?: boolean } = {}): Promise<AutoSwitchOutcome> {
    if (this.running) {
      return this.running;
    }
    this.running = this.run(options).finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** The accounts as auto-switching sees them, with their saved opt-out and login state. */
  async accounts(): Promise<AutoSwitchAccount[]> {
    const activeId = this.store.getActiveId();
    return Promise.all(
      this.store.list().map(async (p) => ({
        id: p.id,
        label: p.label,
        isActive: p.id === activeId,
        needsReauthorization: needsReauthorization(this.store, p, await this.store.getCreds(p.id)),
        autoSwitch: p.autoSwitch,
        keepActive: p.keepActive,
        switchOutPercent: p.switchOutPercent,
        manualSwitchAt: p.manualSwitchAt,
        windows: p.lastUsage?.windows ?? [],
      }))
    );
  }

  private async run(options: { manual?: boolean }): Promise<AutoSwitchOutcome> {
    const settings = this.settings();
    if (!settings.enabled && !options.manual) {
      return { action: "off", message: "Auto-switching is turned off." };
    }
    const say = (outcome: AutoSwitchOutcome): AutoSwitchOutcome => {
      this.log(`${outcome.action}: ${outcome.message}`);
      return outcome;
    };
    const now = Date.now();
    if (!options.manual && now - this.lastSwitchAt < MIN_SWITCH_INTERVAL_MS) {
      return say({ action: "busy", message: "An account was just switched to; waiting before the next check." });
    }

    const plan = planAutoSwitch(await this.accounts(), {
      order: settings.order,
      when: settings.when,
      manualHoldMs: settings.manualHoldMs,
      now,
      minAvailablePercent: settings.minAvailablePercent,
      skipped: this.skips.active(now),
    });
    if (plan.action !== "switch") {
      if (plan.action === "stay") {
        this.skips.clear();
      }
      return say({ action: plan.action, message: plan.reason });
    }

    // Try the candidates in order: the first one that is still available after a fresh
    // usage check, and that the switch accepts, wins.
    let lastMessage = plan.reason;
    for (const candidate of plan.ranked) {
      // A kept account was chosen by hand: only a used-up limit stops it — not the
      // minimum, and not the account's own hand-over limit.
      const confirmed = await this.confirmAvailable(
        candidate.id,
        plan.held ? 0 : settings.minAvailablePercent,
        plan.held
      );
      if (!confirmed.ok) {
        this.skips.record(candidate.id, confirmed.message, Date.now(), this.cooldownMs());
        lastMessage = confirmed.message;
        continue;
      }
      const result = await this.switchTo(candidate.id);
      if (result.ok) {
        this.lastSwitchAt = Date.now();
        this.skips.clear();
        const message = `Switched to "${candidate.label}". ${plan.reason}`;
        if (settings.notify || options.manual) {
          void vscode.window.showInformationMessage(message);
        }
        return say({ action: "switch", targetId: candidate.id, message });
      }
      this.skips.record(candidate.id, result.message, Date.now(), this.cooldownMs());
      lastMessage = result.message;
    }

    return say({ action: "failed", message: `No account could be switched to. ${lastMessage}` });
  }

  /** Reads the account's usage once more and checks that it is still available. */
  private async confirmAvailable(
    id: string,
    minAvailablePercent: number,
    ignoreSwitchOutLimit = false
  ): Promise<{ ok: boolean; message: string }> {
    await this.refreshUsage(id);
    const profile = this.store.get(id);
    if (!profile) {
      return { ok: false, message: "The account is no longer saved." };
    }
    const creds = await this.store.getCreds(id);
    const account: AutoSwitchAccount = {
      id,
      label: profile.label,
      needsReauthorization: needsReauthorization(this.store, profile, creds),
      autoSwitch: profile.autoSwitch,
      keepActive: profile.keepActive,
      switchOutPercent: profile.switchOutPercent,
      windows: profile.lastUsage?.windows ?? [],
    };
    if (account.needsReauthorization) {
      return { ok: false, message: `"${profile.label}" needs reauthorization.` };
    }
    if (profile.lastUsage?.error) {
      return { ok: false, message: `"${profile.label}": its usage could not be read.` };
    }
    const cap = ignoreSwitchOutLimit ? 100 : undefined;
    if (!availableNow(account, minAvailablePercent, cap ?? switchOutPercentOf(account))) {
      return { ok: false, message: `"${profile.label}" is not available any more.` };
    }
    return { ok: true, message: "" };
  }
}
