# Contributing

SSHUltra is a macOS-first preview. Keep pull requests focused and describe the concrete user behavior changed.

## Local checks

Use Node.js 24+ and `npm ci`. Run `npm run build` and `npm test`. Changes to terminals, connection dialogs, split layouts, batch commands or reconnect also require `npm run test:ui` and `npm run test:reliability-ui` on macOS. UI tests create temporary profiles and loopback SSH servers; they must never use a contributor's saved servers or credentials.

Add regression coverage for data loss, lifecycle or protocol changes. Describe platform coverage honestly; do not label an untested platform supported.

## Boundaries

- Never commit credentials, private keys, access tokens, workspace.json, server inventory, `.env` files or real session output.
- Keep host-key verification and renderer isolation enabled. Batch sends must keep explicit target confirmation.
- Preserve third-party licenses. Regenerate `THIRD_PARTY_NOTICES.txt` after dependency changes.
- Do not commit `node_modules`, `dist`, `release`, test artifacts or machine-specific logs. Release binaries belong in GitHub Releases.

By submitting a contribution, you agree that your original contribution is available under this repository's MIT license. Do not submit material you do not have permission to redistribute.
