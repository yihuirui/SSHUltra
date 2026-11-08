# Contributing

SSHUltra is a macOS-first preview. Keep pull requests focused and describe the concrete user behavior changed.

## Local checks

Use Node.js 24+ and `npm ci`. Run `npm run build` and `npm test`. Changes to terminals, connection dialogs, split layouts, batch commands or reconnect also require `npm run test:ui` and `npm run test:reliability-ui` on macOS. Workflow, storage and modal changes also require `npm run test:workflows-ui` and `npm run test:fixes-ui`. Authentication changes also require `npm run test:password-ui`. Import changes also require `npm run test:imports-ui`, including the packaged executable. Package changes must verify the app with `npm run package:mac` and `HARBOR_PACKAGED_APP=/absolute/path/to/SSHUltra.app/Contents/MacOS/SSHUltra node tests/package-verify.cjs`. UI tests create temporary profiles and loopback SSH servers; they must never use a contributor's saved servers or credentials.

Add regression coverage for data loss, lifecycle or protocol changes. Describe platform coverage honestly; do not label an untested platform supported.

## Boundaries

- Never commit credentials, private keys, access tokens, workspace.json, server inventory, `.env` files or real session output.
- Keep host-key verification and renderer isolation enabled. Batch sends must keep explicit target confirmation.
- Preserve third-party licenses. Regenerate `THIRD_PARTY_NOTICES.txt` after dependency changes.
- Do not commit `node_modules`, `dist`, `release`, test artifacts or machine-specific logs. Release binaries belong in GitHub Releases.

By submitting a contribution, you agree that your original contribution is available under this repository's MIT license. Do not submit material you do not have permission to redistribute.

## Continuous integration

Pushes to `main`, pull requests and manual `workflow_dispatch` runs execute `.github/workflows/ci.yml` on macOS with `contents: read`: build, the full test set, macOS packaging, packaged-app verification and a `THIRD_PARTY_NOTICES.txt` consistency check. Runs are grouped per ref with `concurrency`, so a newer push cancels an in-progress run for the same branch instead of queuing several 15-minute macOS jobs.

The workflow installs the Electron runtime explicitly with `node node_modules/electron/install.js` before running tests. If you install dependencies with `npm ci --ignore-scripts`, the architecture-verification test will fail with a missing `Electron.app`; that is an incomplete local runtime, not a source defect.
