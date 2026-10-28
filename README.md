# SSHUltra

An open-source SSH workspace for everyday operations, built for macOS first.

面向日常运维的 SSH 桌面工具：保存连接、稳定分屏、明确目标的批量命令，以及图形化 SFTP。

**Preview 0.2.3 · macOS · MIT**

## Download and run / 下载与启动

The current source preview is 0.2.3. The verified local archive is `release/0.2.3/SSHUltra-0.2.3-mac-x64.zip`; source updates and tagged binary releases are published separately. Download published builds from [GitHub Releases](https://github.com/yihuirui/SSHUltra/releases), extract it, then drag **SSHUltra.app** into Applications. No Node.js installation is required for the packaged app. Compare its SHA-256 against `SHA256SUMS.txt` attached to the same release.

本预览版尚未使用 Apple Developer ID 签名、尚未公证，macOS Gatekeeper 可能阻止打开。请先核对来源与校验值；也可自行从源码构建。不要关闭系统 Gatekeeper 或对不明来源文件绕过保护。0.2.3 本次验证平台为 macOS x64；Apple Silicon、Windows 和 Linux 未在本轮验收。

添加服务器时选择密码、私钥文件或系统 SSH Agent，首次连接前核对主机指纹。连接多台服务器后选择双栏／四宫格，底部勾选批量目标、输入命令并预览确认。

## Features / 功能

- Grouped, searchable connection profiles. Ephemeral credentials by default; optional shared credentials encrypted with a macOS Keychain-protected key.
- Password, private-key file, system SSH Agent and multi-round keyboard-interactive authentication. Leave the password blank to enter it securely inside the terminal pane when connecting.
- Single SSH jump host per connection, with separate credentials and fingerprint validation for both endpoints.
- Searchable command library with folders and `{{parameter}}` templates; commands fill the composer before preview and send.
- Opt-in timestamped terminal output logs, daily/10 MiB rotation, manual start/stop and per-profile retention.
- Bulk profile editing with a native before/after confirmation.
- Selective sanitized JSON export and previewed imports from Excel XLSX/XLS, CSV/TSV, TXT, Markdown tables, SSHUltra JSON, explicit OpenSSH Host entries and individual SecureCRT SSH2 INI files.
- Multiple windows and tabs; stable two-column/four-pane layouts. Up to 12 sessions per window and 4 visible terminals.
- Explicit batch command targets and a native confirmation dialog showing every destination and the complete command.
- SFTP directory browsing and single-file upload/download; same-name uploads never silently overwrite.
- Terminal search, font sizing, scrollback export and manual reconnect while preserving the existing terminal.
- Host-key fingerprint checks; a changed trusted key is rejected.

## Safety and limitations / 使用边界

Batch commands are sent to the **current terminal program**. Check the prompt before sending: the remote program may be a shell, editor or database client. A successful send is not proof that a command executed successfully. Multi-host sends are not atomic.

单次终端输入上限为 64 KiB；超限会提示，可分多次输入或使用 SFTP 上传脚本文件。滚屏最多 10,000 行，导出不等于完整审计日志。上传失败可能留下远端部分文件，请检查后处理。

尚未包含多级跳板、独立端口转发管理、目录递归传输、自动重连、脚本引擎、SSH CA 信任或自动更新。本版采用真实 SSH/SFTP 协议；测试只连接本机隔离服务，尚未对用户业务服务器验收。

## Develop / 开发

Node.js **24+**, npm, and macOS are the verified development environment. Dependency versions are pinned in `package-lock.json`.

```sh
npm ci
npm run build
npm test
npm run test:ui
npm run test:reliability-ui
npm run test:workflows-ui
npm run test:fixes-ui
npm run test:password-ui
npm run test:imports-ui
npm start
```

`npm ci` downloads the Electron runtime from its official distribution. If the Node downloader cannot use your network proxy, `node scripts/install-electron.cjs` is an optional macOS ARM64 fallback using the official GitHub release and the checksum included in the Electron npm package.

```sh
npm run package:mac
```

The default package targets the current Node host architecture and is built into `release/0.2.3/mac/SSHUltra.app` (x64) or `release/0.2.3/mac-arm64/SSHUltra.app` (ARM64). Explicit scripts are `npm run package:mac:x64` and `npm run package:mac:arm64`. The installed Electron runtime and native modules must match the target; the script checks every Mach-O binary before and after packaging and rejects mismatches before creating output. A target flag alone does not install a cross-architecture runtime. Artwork is included; only run `node scripts/package-icon.cjs` if you change the icon (requires Apple's Swift tools). `npm run build` regenerates third-party notices and fails if a required runtime license is missing.

## Architecture

Electron's main process owns SSH/SFTP and local files. A sandboxed React/TypeScript renderer uses xterm.js through a narrow preload API. Node.js is unavailable to the renderer. Each window has its own SSH manager; one main process owns the saved workspace.

See [Architecture](docs/ARCHITECTURE.md), [Security](SECURITY.md), [Contributing](CONTRIBUTING.md), and [Changelog](CHANGELOG.md).

## Local data / 本地数据

Profiles and trusted fingerprints are stored in `~/Library/Application Support/SSHUltra/workspace.json`. Passwords and private-key contents are not stored in workspace.json. Optional saved passwords/passphrases are encrypted in credentials.enc.json using Electron safeStorage; its encryption key is protected by macOS Keychain. Secret values are never returned to the renderer. Private-key paths are saved, so treat exported profiles as private infrastructure information.

早期本地版本暂名 HarborSSH。新名称不会自动移动或删除旧配置。如需迁移：退出两个版本，分别备份旧目录 `~/Library/Application Support/HarborSSH/` 与新目录 `~/Library/Application Support/SSHUltra/`，再将旧 `workspace.json` 复制到新目录；如目标已有连接，请先保留备份并手动合并，避免覆盖。旧版名称仅用于迁移说明。

## License and attribution

Original code and artwork are [MIT licensed](LICENSE). Dependencies retain their own terms; complete notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), with Electron/Chromium notices included in the app bundle.

SSHUltra is an independent project. It is not affiliated with SecureCRT, VanDyke Software, the CNCF Harbor project, or other similarly named products. Workflow references informed the design; their source code or branding was not copied.

## Project status

- **Goal:** a practical SSH workspace emphasizing split terminals and deliberate batch commands.
- **Status:** 0.2.3 source preview implemented and validated on macOS x64; binary release status is listed in GitHub Releases. This preview covers selected SecureCRT workflows.
- **Decisions:** local profiles, opt-in OS-protected credentials, explicit batch confirmation, single main process with multiple windows; SecureCRT 9.6 workflow reference.
- **Constraints:** no business-server testing; no Developer ID signing/notarization yet.
- **Next actions:** business-server acceptance, signing/notarization, broader terminal compatibility; consider multi-hop, tunnels and workspace restoration after usage feedback.
- **Last update:** 2026-10-28.

## 0.2 工作流与迁移

- **命令库**：底部“命令库”或 ⌘⇧P；保存前移除密码、令牌。`{{path}}` 形式的参数会先要求填写，之后仅填入命令栏。最近发送只保留在当前窗口内存。
- **跳板与 MFA**：先保存跳板连接，再在目标连接里选择它。两端独立核对主机指纹；跳板可引用安全凭据，也可每次输入。验证码／交互认证通过单独窗口回答，单轮 60 秒超时。当前仅支持一个跳板。
- **持续日志**：在连接设置里选择自动记录，或点击终端标题的圆点开始／停止。日志仅记录服务器输出，去除常见 ANSI/OSC 控制序列，时间戳采用 UTC；服务器回显仍可能包含敏感信息。保留期限默认永久，选择 7/30/90 天后，在该连接下次开始日志时清理本应用为同一连接创建的过期日志；活动日志不清理。目录为 userData 下 `logs/`。日志不等于完整终端回放或不可篡改审计。
- **配置管理**：侧栏“连接批量管理”；修改前原生窗口显示旧值与新值，仅影响下次连接。批量修改或导入前会创建 `workspace-backup-*.json` 私有备份。回滚时退出应用、保留当前文件，再使用对应备份恢复 workspace.json。
- **导入导出**：导出默认排除用户名和私钥路径，始终排除凭据、主机信任与自动日志设置；服务器地址仍属基础设施信息。导入会新增独立 ID，保留现有连接。跳板引用需同时导入／导出。OpenSSH 仅支持显式 Host、HostName、User、Port、IdentityFile 和引用同批 Host 的单级 ProxyJump。整个文件含通配 Host、Match、ProxyCommand 或 Include 时拒绝导入；首个 Host 之前的继承连接设置也拒绝，不将不支持的代理配置误转成直连。SecureCRT 仅导入单个 SSH2 INI 的地址、端口、用户名和私钥路径，不解密密码、不执行脚本。跨平台私钥路径需先校正；XML 暂不支持。
- **安全凭据**：侧栏“安全凭据”中显式保存，并在连接里引用。同一凭据更新后，所有引用它的连接下次使用新值。密文与 Keychain 密钥必须配套；该文件不是可跨机器恢复的凭据备份。未签名构建更换时可能再次提示 Keychain 访问；未在真实用户 Keychain 上保存测试凭据。

## 0.2.1 修复与升级

- 所有表单使用原生模态窗口，自动聚焦并限制 Tab 范围；打开期间阻止背景终端输入。关闭后恢复焦点。连接编辑器内的 ⌘N 仍可重置为新建连接。
- 手动重连读取最新保存配置。已打开的旧编辑器遇到其他窗口或批量修改时拒绝覆盖，需关闭并重新打开；已删除的连接不会被重连重新创建。
- 首次读取 v1 工作区会先创建原字节的 `workspace-v1-backup-*.json` 私有备份，再原子升级为 **格式 v2**，保留连接、指纹和命令。旧版应用会拒绝 v2，避免静默丢字段。降级前退出应用并备份当前目录，再恢复该 v1 备份；升级后新增的数据不会出现在旧备份中。不要手工把版本号改回 1。
- 配置、凭据、备份和导出采用同目录临时文件写入、同步后替换；失败保留已有目标。覆盖已有导出也使用 POSIX 0600 权限。
- 损坏的可选凭据库保留原文件并显示提醒，其他功能仍可使用。在连接表单把安全凭据切换为“本次输入”后可临时登录；修复密文备份前先退出应用，不要直接覆盖损坏文件。
- SFTP 初始化和目录读取最多等待 15 秒；传输连续 30 秒无数据进展会取消。文件面板可取消当前会话的全部文件操作，再手动重试；不会自动重发命令。已建立的 SFTP 通道取消时保留 SSH 终端；初始化尚未完成时，受底层接口限制，会断开该 SSH 连接释放资源，保留终端内容供重新连接。失败上传可能留下远端部分文件，需自行检查。

本次修复与验收见 [0.2.1 修复记录](docs/FIXES-2026-10-27.md)。

本次实现与验证记录见 [0.2 验证记录](docs/IMPLEMENTATION-96.md)。

## 0.2.2 终端密码提示

密码认证可在连接设置中留空。连接后先核对主机指纹；服务器支持密码认证时，对应终端区域会显示 `Password:` 隐藏输入框，输入后按 Enter 或“继续连接”。跳板和目标机分别显示名称与 `用户名@主机:端口`。输入不会进入远端 shell、滚屏、日志、连接配置或安全凭据库；提交／取消后清空。Esc 或“取消连接”终止本次认证，60 秒未提交自动过期。手动重连会再次提示。已填写密码和已选择安全凭据仍按原方式使用；服务器仅支持 keyboard-interactive 时沿用交互认证窗口。

验证与交付见 [终端密码提示记录](docs/PASSWORD-PROMPT-2026-10-27.md)。

## 0.2.3 Excel 与文本连接清单

“连接批量管理 → 导入连接”支持下列格式，也可在同一页面保存 XLSX、CSV、TXT 或 Markdown 模板。模板中的示例地址需替换为自己的服务器。

| 格式 | 内容要求 |
| --- | --- |
| Excel `.xlsx/.xls` | 第一行是表头，可选择工作表。XLS 为 Excel 97–2003 格式。文件密码、宏和连接字段中的公式／错误／日期单元格需先移除或转成普通值。 |
| CSV / TSV | 逗号、分号或 Tab 分隔，支持双引号、转义引号、CRLF，以及 Excel 的 `sep=;` 行。 |
| TXT | 表头加分隔列，或每行一个 `host`、`host:port`、`user@host:port`。IPv6 加方括号，如 `ops@[2001:db8::1]:22`。 |
| Markdown `.md/.markdown` | 带表头和 `---` 分隔行的表格；只读取第一张表格，发现多表时提示。支持转义竖线与简单行内代码。 |

常用列：`名称/name`、`分组/group`、`主机地址/host/IP`、`端口/port`、`用户名/username/user`、`认证方式/authType`、`私钥路径/keyPath`、`跳板/jump`。主机地址必填，端口默认 22；缺失用户名可在预览时统一补齐。认证方式支持密码、私钥、Agent、交互认证；未填写则默认为密码，有私钥路径时默认为私钥。跳板填写同批表格内唯一的连接名称，且需一起导入；只支持单级。

密码／口令列始终忽略并提示，不导入凭据、主机信任或自动日志设置。编码支持 UTF-8（含 BOM）、带 BOM 的 UTF-16；非 UTF-8 文件尝试 GB18030/GBK 并提示核对中文。推荐保存为 UTF-8。Excel 中用户名等标识应按文本填写，避免丢失前导零。

先预览前 8 行及总数，无效行会报行号，整批不写入。最终原生确认后创建私有备份并新增独立连接，现有连接保留。限制：每文件 5 MiB、每批 1000 个连接、每表 64 列；Excel 最多 20 张表，选中表最多 1001 行（含表头），请清理多余格式化行。解析线程 8 秒截止、128 MiB JS 堆；XLSX 解压内容最多 32 MiB、单条目 16 MiB、最多 2000 条目。

实现、依赖来源与验收见 [多格式导入记录](docs/IMPORT-FORMATS-2026-10-27.md)。
