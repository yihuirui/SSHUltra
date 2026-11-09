# Support

## Where to ask

Ask usage and setup questions in this repository's issues using an issue template. Keep the discussion in the repository rather than in private messages: a public thread becomes documentation for the next person with the same question.

Before opening an issue, check:

- The [README](README.md) and the docs directory, especially import and connection notes
- Existing open and closed issues
- [CONTRIBUTING.md](CONTRIBUTING.md) if you plan to propose a change
- [SECURITY.md](SECURITY.md) if the problem might be a vulnerability

## What to include

- SSHUltra version or commit, macOS version, and architecture (Apple silicon arm64 or Intel x86_64)
- What you expected, what happened, and concise reproduction steps
- Redacted logs or screenshots

Be honest about platform coverage: this is a macOS-first preview, and a check that was not run on a platform does not make that platform supported.

## What never belongs in an issue

Passwords, private keys, access tokens, `workspace.json`, server inventories, `.env` files, unredacted terminal output or real session transcripts. A single pasted session can leak an entire host inventory.

Suspected vulnerabilities must use private vulnerability reporting (see [SECURITY.md](SECURITY.md)) instead of a public issue.

## Response expectations

This project is maintained in spare time with limited weekly hours and no response SLA. If nothing has happened after seven days, a polite comment on the same thread is appropriate. Out-of-scope requests may be closed with a short explanation and a reference to CONTRIBUTING.md rather than left open indefinitely.
