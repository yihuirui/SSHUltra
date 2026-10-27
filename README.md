# SSHUltra

An open-source SSH workspace for everyday operations, built for macOS first.

面向日常运维的 SSH 桌面工具：保存连接、稳定分屏、明确目标的批量命令，以及图形化 SFTP。

**Preview 0.1.1 · Apple Silicon macOS · MIT**

## Download and run / 下载与启动

Download the Apple Silicon ZIP from [GitHub Releases](https://github.com/yihuirui/SSHUltra/releases), extract it, then drag **SSHUltra.app** into Applications. No Node.js installation is required for the packaged app. Compare its SHA-256 against `SHA256SUMS.txt` attached to the same release.

本预览版尚未使用 Apple Developer ID 签名、尚未公证，macOS Gatekeeper 可能阻止打开。请先核对来源与校验值；也可自行从源码构建。不要关闭系统 Gatekeeper 或对不明来源文件绕过保护。仅验证了本机 Apple Silicon macOS，Intel macOS、Windows 和 Linux 尚未验收。

添加服务器时选择密码、私钥文件或系统 SSH Agent，首次连接前核对主机指纹。连接多台服务器后选择双栏／四宫格，底部勾选批量目标、输入命令并预览确认。

## Features / 功能

- Grouped, searchable connection profiles. Passwords and private-key passphrases are not persisted.
- Password, private-key file and system SSH Agent authentication.
- Multiple windows and tabs; stable two-column/four-pane layouts. Up to 12 sessions per window and 4 visible terminals.
- Explicit batch command targets and a native confirmation dialog showing every destination and the complete command.
- SFTP directory browsing and single-file upload/download; same-name uploads never silently overwrite.
- Terminal search, font sizing, scrollback export and manual reconnect while preserving the existing terminal.
- Host-key fingerprint checks; a changed trusted key is rejected.

## Safety and limitations / 使用边界

Batch commands are sent to the **current terminal program**. Check the prompt before sending: the remote program may be a shell, editor or database client. A successful send is not proof that a command executed successfully. Multi-host sends are not atomic.

单次终端输入上限为 64 KiB；超限会提示，可分多次输入或使用 SFTP 上传脚本文件。滚屏最多 10,000 行，导出不等于完整审计日志。上传失败可能留下远端部分文件，请检查后处理。

尚未包含跳板机、端口转发、keyboard-interactive MFA、目录递归传输、完整持续日志、自动重连、永久凭据保存或自动更新。本版采用真实 SSH/SFTP 协议；测试只连接本机隔离服务，尚未对用户业务服务器验收。

## Develop / 开发

Node.js **24+**, npm, and macOS are the verified development environment. Dependency versions are pinned in `package-lock.json`.

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run test:reliability-ui
npm start
```

`npm ci` downloads the Electron runtime from its official distribution. If the Node downloader cannot use your network proxy, `node scripts/install-electron.cjs` is an optional macOS ARM64 fallback using the official GitHub release and the checksum included in the Electron npm package.

```sh
npm run package:mac
```

The app is built into `release/mac-arm64/SSHUltra.app`. Artwork is included; only run `node scripts/package-icon.cjs` if you change the icon (requires Apple's Swift tools). `npm run build` regenerates third-party notices and fails if a required runtime license is missing.

## Architecture

Electron's main process owns SSH/SFTP and local files. A sandboxed React/TypeScript renderer uses xterm.js through a narrow preload API. Node.js is unavailable to the renderer. Each window has its own SSH manager; one main process owns the saved workspace.

See [Architecture](docs/ARCHITECTURE.md), [Security](SECURITY.md), [Contributing](CONTRIBUTING.md), and [Changelog](CHANGELOG.md).

## Local data / 本地数据

Profiles and trusted fingerprints are stored in `~/Library/Application Support/SSHUltra/workspace.json`. Passwords and private-key contents are not stored there. Private-key paths are saved, so treat exported profiles as private infrastructure information.

早期本地版本暂名 HarborSSH。新名称不会自动移动或删除旧配置。如需迁移：退出两个版本，分别备份旧目录 `~/Library/Application Support/HarborSSH/` 与新目录 `~/Library/Application Support/SSHUltra/`，再将旧 `workspace.json` 复制到新目录；如目标已有连接，请先保留备份并手动合并，避免覆盖。旧版名称仅用于迁移说明。

## License and attribution

Original code and artwork are [MIT licensed](LICENSE). Dependencies retain their own terms; complete notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), with Electron/Chromium notices included in the app bundle.

SSHUltra is an independent project. It is not affiliated with SecureCRT, VanDyke Software, the CNCF Harbor project, or other similarly named products. Workflow references informed the design; their source code or branding was not copied.

## Project status

- **Goal:** a practical SSH workspace emphasizing split terminals and deliberate batch commands.
- **Status:** public preview, macOS ARM64 first; not a complete SecureCRT replacement.
- **Decisions:** local profiles, in-memory credentials, explicit batch confirmation, single main process with multiple windows.
- **Constraints:** no business-server testing; no Developer ID signing/notarization yet.
- **Next actions:** gather terminal compatibility feedback, then consider jump hosts, persistent logs and workspace restoration.
- **Last update:** 2026-10-27.
