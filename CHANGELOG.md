# Changelog

## 0.2.3 — 2026-10-27

- Import Excel XLSX/XLS with sheet selection, CSV/TSV, TXT address lists/tables and Markdown tables.
- Recognize Chinese/English headers, common encodings and default usernames; preview rows before native confirmation.
- Add four private, saveable import templates; exclude password columns and reject formula/macro workbook content.
- Parse in bounded cancellable workers; retain additive imports, snapshot checks and private backups.


## 0.2.2 — 2026-10-27

- Prompt for missing passwords inside the corresponding terminal pane after host verification and method negotiation.
- Keep password input masked and separate from shell input, scrollback, logs and stored profiles.
- Support separate gateway/target prompts, cancellation, expiration and reconnect; retain prefilled credentials and keyboard-interactive authentication.


## 0.2.1 — 2026-10-27

- Isolate modal focus and block background terminal input; restore focus on close.
- Reconnect with current saved profiles and reject stale or deleted-profile saves.
- Migrate workspaces to format v2 with an exact private v1 backup; older readers fail closed.
- Write exports, settings and credentials through synced private atomic replacement.
- Reject unsupported OpenSSH inheritance/proxy/include scopes instead of silently importing direct connections.
- Keep profiles usable when the optional encrypted credential file is damaged, preserving that file.
- Bound SFTP negotiation/listing and idle transfers; add cancel and resource cleanup.
- Verify runtime and packaged Mach-O architectures, and default packaging to the host architecture.
- Align security guidance with optional encrypted password storage and add regressions.

## 0.2.0 — 2026-10-27

- Add command folders, search, parameter forms and fill-before-send flow.
- Add single-hop SSH and multi-round keyboard-interactive authentication.
- Add opt-in continuous output logs with UTC timestamps, rotation, start/stop and retention.
- Add bulk profile confirmation, private backups, selective exports and previewed imports.
- Add optional shared credentials protected by macOS Keychain-backed safeStorage.
- Report asynchronous batch write failures per destination using the terminal input flow-control path.
- Preserve profile format version 1 and existing connections. New optional fields default to disabled/empty.


## 0.1.1 — 2026-10-27 (preview)

- Rename the project to **SSHUltra**, avoiding confusion with an existing SSH client using the original working name.
- Reset connection editor state correctly when starting a new connection.
- Keep visible split terminals stable while focus changes.
- Preserve tabs and scrollback when reconnecting or canceling the reconnect form.
- Show terminal input errors, including oversized pastes; bound pending input under backpressure.
- Add an independent timeout for shell setup after SSH authentication.
- Keep multiple windows in a single application process to protect workspace updates.
- Add targeted regressions, contribution/security guidance and complete runtime dependency notices.

## 0.1.0 — 2026-10-25 (local prototype)

SSH profiles, multi-window/tab terminal workspaces, split layouts, explicit batch commands, SFTP browsing and transfers, host fingerprint checks, search and scrollback export. Distributed locally under a temporary working name; not published as a GitHub release.
