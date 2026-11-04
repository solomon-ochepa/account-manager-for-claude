# Changelog

## 3.0.0

The automation decides which account to use, so the machinery for asking a human to decide is gone.

- **Removed: account proposals.** **Propose** and **Propose for Fable**, the proposal panel, and
  the pop-up that listed the next three accounts when a limit ran out are all gone — auto-switch
  already takes the next account, and the **Claude Auto Switch** log says which and why. Switching
  by hand is unchanged: **Switch** on a card, the status bar, or `Claude: Switch account`.
- **Removed: `src/propose.ts`.** The two measures the automation still uses — urgency and the
  wait formatter — and the shared limit types moved to `src/limits.ts`, named for what they are
  rather than for the feature that used to own them.
- Dead code taken out with it: the proposal's webview rendering (~90 lines), its markup, its 143
  lines of CSS, the `warning` and `plus` icons, the `.notice.warn` style, a toolbar spacer with
  nothing left to push, and an unused message field.
- Fifteen helpers that nothing outside their own file used are no longer exported
  (`stateOf`, `reasonFor`, `eligible`, `spentWindows`, `normalizeEmail`, `keychainAccount`,
  `hasRefreshToken`, `isDefaultConfigDir` and others), so each file's public surface is what it
  actually offers.
- Unused assets deleted: `docs/propose-auto.gif`, `docs/logo.png`, and a 4.7 MB demo video that
  nothing referenced (which also drops the `media/*.mp4` package exclusion it needed).
- The proposal tests are replaced by `limit measures`, covering the urgency rule the
  `urgency` order depends on and the wait formatter.

## 2.5.0

- **A new login saves itself.** When Claude Code starts using a login that is not one of the saved
  accounts, it is saved straight away, with an offer to rename it — logging in is all there is to
  do, and the "this login is not saved yet" prompt is gone. Each login is attempted once, so an
  incomplete one cannot ask again on every poll, and a later login is attempted on its own.
  `autoSaveNewAccounts` turns it off and leaves the panel's **Save** button to it.

## 2.4.4

- The description reads "Auto switch your Claude accounts; Claude Code uses the one whose limit
  resets soonest, with live usage limits." The About sheet and the page's opening line follow it.
- The About sheet names the author under the title, with the version, instead of listing it among
  the details below.

## 2.4.2

- The description leads with what it does: "Auto switch Claude Code between your Claude accounts
  by the limit that resets soonest, with live usage limits."
- The extension's page was rewritten around the automation: what it does, how it picks, and a
  table of the per-account controls, with switching by hand after it. Fixed the install command,
  which still named the old `.vsix`, and the output channel's name in the docs.

## 2.4.1

- The description under the name says what the extension does now: "Switches Claude Code between
  your Claude accounts on its own, by the limit that resets soonest, with live usage limits." The
  About sheet reads the same.
- Fixed: the About sheet's **Source** and **Issues** links still used the repository's old name.

## 2.4.0

- **Keeping an account active asks for a higher hand-over limit** when that account has already
  reached its own: the prompt names the limit that tripped it and takes any value above the
  current usage, and the account is only marked once the limit is raised. When the limit is
  genuinely used up, raising it would change nothing, so it asks to confirm instead — kept active,
  the account is held and waits for the reset.
- The shield badge's tooltip leads with the limit itself (`Hand-over limit: 80%`), says what
  happens when it is reached, and where to change it. The **Keep active** star reads the same way:
  its state first, then what a click does.

## 2.3.2

- The hand-over limit on a card is a shield badge with the percent (`80%`) instead of the words
  "Out at 80%".

## 2.3.1

- **Keep active** moved out of the **⋯** menu: it is now a star button beside **Switch** on every
  card, secondary while off and green with a filled star while the account is held. The separate
  **Kept active** badge is gone, since the button itself shows the state.

## 2.3.0

- **An account can set its own hand-over limit.** **Set a hand-over limit…** on a card's **⋯**
  menu, or `Claude: Set an account's auto-switch hand-over limit`, takes a percent (1-100): once
  any of that account's limits reaches it, auto-switching treats the account as spent and takes
  the next one in the queue, instead of waiting for the limit to be used up. The card shows
  **Out at 80%**, and the log names the hand-over before the account it moved to. An empty box
  clears it.
- **Keeping an account active overrides its hand-over limit too**, so a held account is only
  stopped by a limit that is really used up.

## 2.2.0

- **Keep one account active.** **Keep active (pause auto-switching)** on a card's **⋯** menu, or
  `Claude: Keep an account active`, holds that account: auto-switching takes it and then moves
  nowhere else until the mark comes off. It waits — and says when the account is usable again —
  rather than moving on when the account's limits run out, and the mark beats the account's own
  opt-out and `autoSwitch.minAvailablePercent`. One account carries it at a time, and the card
  shows **Kept active**.
- **The weekly reset date decides on its own.** The 5-hour window no longer influences the
  `weeklyReset` order: it was breaking ties between accounts resetting on the same date, and
  counted toward the "usage left" tie-break. Accounts that share a reset date are now separated
  by how much of the *weekly* limit is left, and the reason sentence says so. The `anyReset`
  order still counts every limit, the 5-hour window included.

## 2.1.0

Renamed to **Claude Auto Switch**.

- The extension is now `solomon-ochepa.claude-auto-switch`, and the activity bar, the panel's
  title, and the About sheet carry the new name.
- Commands and settings moved from `accountManagerForClaude.*` to `claudeAutoSwitch.*`. Settings
  set under the old keys have to be set again; nothing is read from them.
- The extension id changed with the name, and VS Code keys an extension's storage to its id, so
  the account list does not carry over from an earlier install: back it up first
  (`Claude: Back up account list`) and restore it afterwards. The backup file format is unchanged.
- The auto-switch log channel is called **Claude Auto Switch**.
- The package dropped from 5.1 MB to 1.0 MB: a 4.7 MB demo video that nothing referenced is no
  longer shipped (it stays in the repository).

## 2.0.0

First release of this fork, maintained by [Solomon Ochepa](https://github.com/solomon-ochepa).
It continues from the upstream `main` branch (1.0.8); the Marketplace builds 1.0.9–1.1.1 of
[tursoft/account-manager-for-claude](https://github.com/tursoft/account-manager-for-claude) were
never published to that branch and are therefore not included.

- Published under the `solomon-ochepa` publisher, with the repository, issue tracker, and the
  panel's About sheet pointing here. Releases are `.vsix` downloads from GitHub.
- The sidebar ad banner and its assets were removed; the panel ends with its own content.
- MIT, with the copyright of both earlier authors retained. Backups stay compatible: the backup
  file format is unchanged.
- **Auto-switch**: the extension switches to the next account by itself when the active one runs
  out of a limit. On by default; `autoSwitch.enabled` turns it off.
  - The account whose weekly (7-day) limit resets soonest goes first, so capacity is used before
    it is lost. `autoSwitch.order` also offers the soonest reset of any limit, the capacity that
    would be lost soonest, the most usage left, and the panel's own order.
  - `autoSwitch.when` decides when it acts: `always` (the default) keeps the first account of that
    order active, `exhausted` waits until the active account runs out of a limit.
  - Every decision is written to the **Claude Auto-switch** output channel
    (`Claude: Show the auto-switch log`).
  - Availability is confirmed with a fresh usage check right before the switch;
    `autoSwitch.minAvailablePercent` sets how much of every limit an account must still have.
  - An account that is used up, needs reauthorization, is in use in another window, or whose
    switch fails for any other reason is skipped and the next one is tried. The skip only lasts
    until the next check, which confirms the account again and takes it as soon as it qualifies;
    the panel marks it **Skipped** meanwhile.
  - Every saved account takes part by default and can be excluded from its **⋯** menu
    (**No auto-switch** on the card), or with `Claude: Include or exclude an account in auto-switching`.
  - The accounts panel sorts by the same order, next account first (`autoSwitch.sortList`), and
    **Next account first (auto-switch order)** is a sort of its own.
  - `Claude: Switch to the next account now (auto-switch)` runs one round on demand.

- Settings are grouped into **Accounts and limits**, **Switching**, **Auto-switch**, **Usage
  history**, and **Claude Code** sections in the Settings editor.

## 0.3.1

First release of the Tursoft fork of
[KrzysztofZander/claude-account-switcher](https://github.com/KrzysztofZander/claude-account-switcher).

- Renamed the extension to **Account Manager for Claude**; commands and settings now
  use the `claudeAutoSwitch.` prefix (profiles from the original extension are not shared).
- Redesigned, compact accounts panel: one-line usage bars with reset times beside them, a status
  dot for the active account, a **⋯** menu per account instead of a row of buttons, **Switch** and
  **Refresh** buttons next to it, and the time of the last update under the account's icon.
- Drag and drop (or **Move up / Move down**) to reorder accounts; the order is remembered.
- Text filter plus **All / Available / Limited** filter, with a button to clear filters.
- Filter by plan (account type) and by model-specific limits, e.g. only accounts with (or
  without) a Fable limit.
- Sort accounts by your custom order, availability (available first, then soonest to become
  available), most usage left, soonest reset, soonest Fable reset, plan, or name. Drag and drop applies
  to the custom order.
- Shows the current Claude Code session at the bottom when it is not saved yet (with **Save to
  account list**), or states that no account is logged in.
- New accounts are saved under their email automatically, with a **Rename** shortcut, instead
  of asking for a name first.
- Password-protected (AES-256 ZIP) backup and restore of the account list, including the panel's
  sort and filter choices and the extension settings. Backup names carry a timestamp.
- Notifications when a used-up session, weekly, or model-specific weekly limit becomes available
  again; a re-check is scheduled at each limit's reset time.
- `autoRefresh` setting to turn regular checks on or off; the polling interval can now go down to
  60 seconds.
- About sheet with author and fork information.
- Double-click an account's name to copy it (in the panel and the availability calendar).
- **Propose** / **Propose for Fable** list the three best other accounts for a limit, most urgent
  first (capacity that resets soonest), each with its limit bar, a one-sentence reason, and a Switch
  button; the next accounts are proposed automatically when the active account's limit runs out.
- The account icon shows the limit state: green while a limit is left, orange once one is used up,
  gray when usage is unknown or the login expired.
- Account names are green while the 5h limit has room and red once the 5h limit or a weekly limit
  (the general one or a model's, such as Fable) is used up. The usage bars and the status bar keep
  their thresholds from `warnThresholdPercent`.
- The reset time of a limit that is used up is colored: yellow under 10 minutes, orange under an
  hour, red beyond a day (gray while some limit is left). Relative times now update every 30 seconds.
- Optional usage history (collected every minute by default, kept 90 days, stored locally) and a
  **Usage analytics** page with per-limit charts over selectable ranges, accounts, chart types,
  and used % or available % of each limit (bar charts by default, colored by level; charts fold
  up to a header sparkline), plus capacity-utilization figures and charts, also grouped by weekday,
  hour of day, week, or month (used
  capacity over the capacity each 5h or weekly cycle offered) for the selected accounts and period.
- **Availability calendar**: a week or day timeline per account with an overall lane and a lane per
  limit (5h, weekly, Fable), past from history and future projected from reset times, plus a
  "right now" card per account. It has the accounts panel's filters and sort orders, starting from
  the panel's current choices, and accounts can be reordered by drag and drop in custom order.
- The view title shows **Usage analytics**, **Availability calendar**, and **Refresh** (which reloads
  the account list, the current login, and all limits); every other action is in its **⋯** menu.

## 0.3.0

Fixes saved accounts and Claude Code itself repeatedly needing reauthorization.

- Token refreshes now take Claude Code's own refresh locks (`<configDir>/.oauth_refresh.lock`
  and the legacy `<configDir>.lock`) instead of a private lock in the temp directory, so Claude
  Code waits for the extension and adopts its rotation instead of spending the same single-use
  refresh token.
- Every rotation is written back (compare-and-swap) to all local credential files holding the
  login, and the newest generation across the vault, `~/.claude` and isolated config dirs is
  always used.
- Switching first saves the outgoing account's latest rotation under the lock. Previously a
  rotation made by Claude Code after the last poll was lost on switch, leaving the profile with a
  spent token.
- Undo restores the newest token generation of the previous profile instead of the raw `.bak`
  copy, which could contain an already rotated refresh token.
- Accounts are identified by Claude account id via `/api/oauth/profile` (no CLI needed), so a
  fully rotated login is still recognized. Team members sharing one organization and one person
  in several organizations are no longer confused with each other.
- Watches `.credentials.json` and imports Claude Code's rotations immediately.
- Switching also replaces `organizationUuid` in `.credentials.json` and `oauthAccount` in
  `.claude.json`, which previously kept the previous account's values.
- A refresh token rejected with `invalid_grant` is never sent again; the profile recovers on its
  own once any copy holds a newer login. Network errors no longer show "Needs reauthorization".
- New **+ Add account** flow logs in to another account in an isolated config dir without
  touching the current one; isolated logins and reauthorizations complete automatically.
  The panel's toolbar buttons are now "Save current" and "+ Add account".
- When Claude Code is logged in to an account that is not saved, the status bar shows it and the
  extension offers to save it.
- Browser authorization and default refresh scopes include `user:plugins`, matching current
  Claude Code.
- Documented that `/logout` revokes the login on Anthropic's side and must not be used to change
  accounts.

## 0.2.5

- Added browser-based OAuth authorization that works without Claude Code CLI.
- Automatically offer browser authorization when the CLI cannot be found.
- Added a dedicated command for browser authorization even when the CLI is available.

## 0.2.4

- Improved authorization reliability for saved accounts by consistently preserving and selecting
  the newest valid access and refresh token generation.
- Added cross-window active-profile leases so background usage polling never spends a rotating
  refresh token currently owned by Claude Code in another VS Code window.
- Propagate successful inactive-profile token rotations to matching credential files with an
  atomic compare-and-swap, preventing stale files from restoring already spent refresh tokens.
- Recover profiles previously marked `invalid_grant` when Claude Code has already persisted a
  newer valid token generation for the same saved profile.
- Reconcile fully rotated active credentials using the verified Claude account identity.

## 0.2.3

- Treat OAuth `invalid_grant` / invalid refresh-token responses as a reauthorization-needed
  state instead of a retryable usage-refresh failure.
- Stop automatic and manual usage refreshes from repeatedly retrying profiles that are already
  known to need reauthorization, reducing repeated "Failed to refresh token" noise.
- Clear stale usage errors and retry backoff automatically when a profile receives fresh
  credentials after reauthorization or a successful token update.
- Use the same per-account lock for Say Hi warmups and usage token refreshes, reducing refresh
  token races between background polling, warmups, and independent VS Code windows.
- Show a short "Needs reauthorization" message in the panel and status tooltip instead of the raw
  token endpoint error payload.

## 0.2.2

- Added independent account windows, Say Hi warmups, and safer cross-window token-refresh locking.
- Added isolated profile reauthorization for broken accounts. The fallback login runs in that
  profile's own `CLAUDE_CONFIG_DIR`, so another active account cannot overwrite it.
- Added account identity checks through `claude auth status --json`; reauthorization is rejected if
  the completed login belongs to a different known profile.
- Hardened credential handling so empty or incomplete OAuth credentials are ignored and never
  written to Claude Code.
- Updated Claude OAuth refresh requests with the current beta header, default Claude Code scopes,
  and clearer local validation before hitting the token endpoint.
- Show the panel's `Auth` action only for profiles that actually need reauthorization.
- Improved CLI discovery, Windows command quoting, and troubleshooting for login and warmup flows.

## 0.2.1

- Fixed token refresh to use the current Claude Code OAuth token endpoint and include saved scopes
  in the refresh request.

## 0.2.0

- Added independent account windows. Each account can now open the current project in a separate
  VS Code window with its own isolated `CLAUDE_CONFIG_DIR` and `.credentials.json`.
- Added "Say Hi" warmups for inactive saved accounts using `claude -p "Hi"` with `haiku` by default,
  without switching the active account.
- Added a login helper command that opens `claude auth login` in an integrated terminal.
- Documented that Claude Code CLI is required for correct operation.
- Documented the privacy and security model: no telemetry, no data collection, no custom backend,
  and credentials are used only locally or with Anthropic/Claude Code endpoints required for the
  selected feature.
- Added Claude Code CLI auto-detection and clearer Say Hi troubleshooting when `claude` is not in
  the VS Code extension host PATH.
- Fixed Windows Say Hi launcher quoting for full `claude.exe` paths.
- Made the active account marker workspace-scoped, so separate VS Code windows can track different
  active accounts independently.
- Added cross-window locking around token refreshes to reduce intermittent login failures from
  rotating refresh tokens.
- Avoided overwriting saved profiles when an unknown account is detected in the credentials file.
- Added settings for the Claude CLI command, Say Hi model, Say Hi prompt, and Say Hi timeout.

## 0.1.0

- Initial release.
- Save the currently logged-in Claude account as a profile (tokens stored in SecretStorage).
- Fast account switching (panel, status bar, QuickPick) by swapping `~/.claude/.credentials.json`,
  with a `.bak` backup and an undo command.
- Live usage limits (5-hour and weekly windows) from the `/api/oauth/usage` endpoint,
  with auto-refresh, backoff on 429, and manual refresh.
- Automatic refresh of expired tokens (refresh token flow).
