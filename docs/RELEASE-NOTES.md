# SSHUltra 0.1.1 Preview

SSHUltra is an independent, MIT-licensed SSH workspace for everyday operations on macOS. This is the first public preview, renamed from a local prototype to avoid confusion with an existing SSH product.

## Included

- Connection groups, multiple windows/tabs, stable split terminals and explicit batch-command confirmation.
- Password/private-key/SSH Agent login, first-use fingerprint confirmation and changed-key rejection.
- SFTP directory browsing, single-file transfers, terminal search and scrollback export.
- Reliability fixes for connection editor state, split focus, reconnect retention, input errors, shell setup timeout and single-process workspace ownership.

## Download

Use `SSHUltra-0.1.1-mac-arm64.zip` for Apple Silicon Macs. Extract and move SSHUltra.app to Applications. Compare the ZIP's SHA-256 with `SHA256SUMS.txt` from this release.

**This preview is not Apple Developer ID signed or notarized.** Gatekeeper may block launch. Check the source and checksum first, or build locally. Do not disable Gatekeeper. Intel macOS, Windows and Linux have not been validated.

## Known limitations

No jump hosts, MFA keyboard-interactive, port forwards, recursive directory transfers, full persistent logging, auto-reconnect or permanent credential storage yet. Terminal input over 64 KiB is visibly rejected. Failed uploads can leave a partial remote file. A successful batch send does not mean remote execution succeeded.

Saved profile migration from the old local prototype is manual; see README. Existing user data is not automatically moved or deleted.

## Verification

15 core/backend tests and six targeted UI checks passed against isolated loopback SSH services. The packaged build is separately verified for application identity, actual second-process rejection, multi-window profile sharing and included license notices. See README and SECURITY.md for security and platform boundaries.
