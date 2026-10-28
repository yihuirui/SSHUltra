# SSHUltra 0.2.3 Preview

Operations workflows inspired by SecureCRT 9.6, added to the existing split-terminal SSH workspace.

## Terminal password prompt

Leave a password blank in connection settings to enter it inside the corresponding terminal pane after host verification. Passwords are masked, never written into the terminal buffer, and cleared after submitting/cancelling. Gateway and target prompts show their own endpoint. Escape cancels and requests expire after 60 seconds. Existing saved credentials and server keyboard-interactive flows remain available. See [verification](PASSWORD-PROMPT-2026-10-27.md).

## Included

- Command folders, search, parameter forms and fill-before-send behavior.
- Single SSH jump host with independent credentials and fingerprint checks at both endpoints.
- Multi-round keyboard-interactive authentication with per-window expiring prompts.
- Opt-in terminal output logs: UTC timestamps, daily/10 MiB rotation, start/stop and per-profile retention.
- Bulk configuration changes with native before/after confirmation and private workspace backups.
- Selective export; previewed additive imports from SSHUltra JSON, explicit OpenSSH Host entries and individual SecureCRT SSH2 INI files.
- Optional shared password/passphrase storage encrypted with a macOS Keychain-protected key.
- Asynchronous per-target batch send error reporting through normal input flow control.

Version-1 workspaces are backed up byte-for-byte to a private workspace-v1-backup file, then atomically upgraded to format v2. Legacy apps reject v2. See README for explicit downgrade recovery; do not change the version field manually. The old 0.2.0 archive remains available locally.

## Review fixes

Native modal focus and terminal input guards, current-profile reconnect with revision conflicts, private atomic exports, damaged-vault fallback, SFTP deadlines/cancellation and packaging architecture checks address all ten review findings. See [fix verification](FIXES-2026-10-27.md).

SFTP initialization/listing has a 15-second deadline and transfer inactivity a 30-second deadline. Cancel resets file operations; cancelling unfinished initialization disconnects that SSH session to release otherwise inaccessible resources. Existing terminal contents remain available.

## Platform and security limits

This preview is not Developer ID signed or notarized. The locally packaged build targets macOS x64, matching this validation host. Apple Silicon, Windows and Linux are not verified in this implementation run. Keychain encryption is tested with an isolated cryptographic substitute; no real user passwords were stored in the system Keychain. Unsigned builds may trigger repeated Keychain permission prompts after updates.

Only one SSH jump host is supported. SOCKS/HTTP/local proxy commands, independent tunnels, recursive SFTP, automatic reconnect, scripting engines and SSH CA trust remain future work. Any OpenSSH wildcard Host, Match, ProxyCommand or Include causes the entire import to be rejected; inherited connection settings before the first Host are also rejected. SecureCRT XML and encrypted passwords are not migrated. Cross-platform private-key paths must be corrected before use.

Logs may contain sensitive server output and are not tamper-proof audit records. A successful batch send does not establish remote execution success. See README for retention, backups and migration instructions.

## Verification

See [implementation and verification](IMPLEMENTATION-96.md) for actual commands, evidence, repaired failures and remaining limits. Tests connect only to disposable loopback fixtures, never business servers.

## 0.2.3 Import formats

Import Excel XLSX/XLS with worksheet selection, CSV/TSV, TXT tables/address lists and Markdown tables. Chinese/English headers and common text encodings are recognized. Save a template in the import panel, preview rows, fill missing usernames, then confirm additive import. Password columns are ignored with a notice. Files with macros and connection fields containing formulas must be converted to ordinary data first. Existing configuration formats and backups remain supported. See [format guide and verification](IMPORT-FORMATS-2026-10-27.md).
