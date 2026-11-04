import { AccountStore } from "./accountStore";
import { hasUsableOAuthCreds } from "./credentialValidation";
import { requiresProfileReauthorization } from "./oauth";
import { AccountProfile, OAuthCreds } from "./types";

/**
 * Whether a saved account has to be logged in again before it can be used: its stored
 * login is incomplete, the server rejected its refresh token, or reading its usage
 * failed with an authorization error. The panel and auto-switching ask the same question.
 */
export function needsReauthorization(
  store: AccountStore,
  profile: AccountProfile,
  creds: OAuthCreds | null
): boolean {
  return (
    !hasUsableOAuthCreds(creds) ||
    store.isRefreshTokenDead(profile.id, creds?.refreshToken) ||
    requiresProfileReauthorization(profile.lastUsage?.error)
  );
}
