# Security

SSHUltra 0.2.x is a preview. Security fixes target the most recent preview; older builds are not separately maintained.

## Reporting

Do not post passwords, keys, access tokens, host inventories or terminal output in public issues. Use GitHub private vulnerability reporting if it is enabled in this repository's Security tab. If no private reporting channel is available, open a minimal issue requesting a private contact route without including exploit details or sensitive information.

## Current safeguards

The renderer is sandboxed and context-isolated. SSH/SFTP operations run in the main process through validated IPC. First-use host keys require explicit trust; changed trusted keys are rejected. By default, entered passwords and private-key passphrases are used only in memory. If the user explicitly saves a credential, its password/passphrase is persisted as ciphertext protected by macOS Keychain-backed safeStorage. Private-key file contents are never copied into the workspace. Batch commands require destination and command confirmation.

These controls do not make remote commands safe, provide atomic execution across hosts, or replace verifying the intended server and prompt. Scrollback can contain secrets; review it before export or sharing.

## Distribution

Download only from this repository's Releases or build from reviewed source. Check SHA-256 against the release's checksum file. Preview macOS binaries are not Developer ID signed or notarized. Checksums detect file differences; they do not independently establish publisher identity.

Optional saved credentials use macOS Keychain-backed Electron safeStorage; ciphertext remains local and plaintext is never returned via IPC. This does not protect against a compromised main process. Output logging is opt-in and may record secrets echoed by servers; inspect logs before sharing. Import never executes OpenSSH or SecureCRT commands.
