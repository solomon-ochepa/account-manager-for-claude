/**
 * Whether a login Claude Code is using should be saved as a profile on its own.
 * A login is saved once per identity: a failed attempt is not repeated until the
 * login changes, so a broken or incomplete one cannot loop.
 *
 * Plain function over plain values, so the rule is testable without VS Code.
 */

export interface CurrentLogin {
  /** Claude Code has a login (false = logged out, undefined = not known yet). */
  loggedIn?: boolean;
  /** The profile that login belongs to; absent when it is not saved yet. */
  ownerId?: string;
  /** The login's identity, when it could be read. */
  identity?: { accountUuid?: string; email?: string; orgId?: string; orgName?: string };
}

export type AutoSaveDecision =
  | { save: false; reason: "off" | "no-login" | "already-saved" | "tried" }
  | { save: true; key: string };

/** A stable key for the login, so each one is attempted once. */
export function loginKey(login: CurrentLogin): string {
  const identity = login.identity;
  return identity?.accountUuid ?? identity?.email ?? identity?.orgId ?? "unidentified-login";
}

export function autoSaveDecision(
  login: CurrentLogin,
  options: { enabled: boolean; attempted?: string }
): AutoSaveDecision {
  if (!options.enabled) return { save: false, reason: "off" };
  if (!login.loggedIn) return { save: false, reason: "no-login" };
  if (login.ownerId) return { save: false, reason: "already-saved" };
  const key = loginKey(login);
  if (key === options.attempted) return { save: false, reason: "tried" };
  return { save: true, key };
}
