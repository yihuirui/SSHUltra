# Changelog

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
