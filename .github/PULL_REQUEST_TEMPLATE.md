## What changed

<!-- Describe the concrete user behavior changed. Keep one concern per pull request. -->

## Related issue

<!-- Link the issue this addresses; open one first for larger changes. -->

## Checks

- [ ] `npm ci` succeeds with Node.js 24+
- [ ] `npm run build` passes (tsc + vite build + notices)
- [ ] `npm test` passes
- [ ] Relevant UI suites pass: `test:ui`, `test:reliability-ui`, `test:workflows-ui`, `test:fixes-ui`, `test:password-ui`, `test:imports-ui`
- [ ] CI on `macos-15` passes on this pull request, including packaging and packaged-app verification
- [ ] `THIRD_PARTY_NOTICES.txt` regenerated if dependencies changed; CI notices diff is clean
- [ ] Host-key verification, renderer isolation and explicit batch-send confirmation remain enabled
- [ ] No credentials, private keys, tokens, `workspace.json`, server inventory, `.env`, real session output, `node_modules`, `dist` or `release` artifacts included
- [ ] Platform coverage described honestly; no untested platform labelled supported

## Notes for the reviewer

<!-- Anything about terminals, connection dialogs, split layouts, batch commands or reconnect behavior. -->

By submitting this pull request I understand that out-of-scope changes may be closed with a short explanation and a reference to CONTRIBUTING.md, and that my original contribution is available under this repository's MIT license.
