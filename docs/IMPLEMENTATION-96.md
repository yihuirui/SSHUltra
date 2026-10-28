# SecureCRT 9.6 工作流增强

用户已确认执行 9.6 对标建议。主 Agent 串行负责共享连接模型、IPC、界面和验证。

- 源码来源：GitHub `yihuirui/SSHUltra`，上游 `a0e3fc21909948a29bd67d7921c83552ee38ba15`。
- 本地入口：`20-Products/SSHUltra`。Git 下载受不可用代理及直连限制，使用 GitHub 连接器取得同一版本源码；本地基线提交仅用于回滚和审阅，不替代上游历史。
- 范围：命令库、持续日志、单级 SSH 跳板与 keyboard-interactive、连接批量修改、配置导入导出、macOS 安全凭据存储。脚本引擎与 SSH CA 为后续按需项。
- 边界：不连接业务服务器，不读取现有用户凭据，不自动执行收藏命令，不自动发布或改动系统网络设置。
- 验收：锁定依赖安装、构建、原有后端与 UI 测试、新功能隔离 SSH 集成测试与 UI 测试、打包验证。
- 2026-10-27：已实施并完成本机验证。首轮离线安装缺少 webcrypto-core 缓存，改为有界在线安装；尚未把安装失败计为测试结果。


## 实际交付

- 版本：0.2.0；本地分支 `codex/securecrt96-workflows`；未推送、未创建远端 PR、未发布 GitHub Release。
- 命令库：文件夹、搜索、模板参数、编辑后填入 composer；最近发送仅保留当前窗口内存。
- SSH：单级 direct-tcpip 跳板、两端独立指纹及凭据、多轮 keyboard-interactive；取消／超时释放会话。
- 日志：显式启停、UTF-8 流式写入、UTC 时间戳、常见 ANSI/OSC 过滤、按日和 10 MiB 轮转；显式选择期限后，仅清理同 profile 的非活动过期日志。
- 管理：批量配置原生差异确认、确认后快照复核、私有备份；脱敏导出和新增式导入；支持 SSHUltra JSON、有限 OpenSSH config、单个 SecureCRT SSH2 INI。
- 凭据：Keychain 保护密钥的 safeStorage 密文文件、名称列表、用户确认保存、主进程连接路径解密；不向 renderer 回读秘密。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 锁定依赖安装、TypeScript 与 Vite build | 通过；Node 24.22.1，Electron 45.0.0 |
| `npm test` | 23/23 通过，含原有 SSH/SFTP、输入流控、会话可靠性及新增工作流集成测试 |
| `npm run test:ui` | 通过：13 条记录，真实隔离 SSH、SFTP、分屏、多窗口和紧凑布局；renderer 无错误 |
| `npm run test:reliability-ui` | 通过：6 条记录，重连、滚屏保留、输入上限及分屏焦点 |
| `npm run test:workflows-ui` | 通过：命令参数、MFA 两轮、日志无认证回答、配置管理及真实跳板；renderer 无错误 |
| `npm run package:mac:x64` | 通过，产物 `release/mac/SSHUltra.app`，未签名、公证 |
| 打包成品 `tests/package-verify.cjs` | 通过：版本、隔离数据目录、真实第二进程退出、多窗口共享配置、许可文件 |
| 打包成品 `tests/ui-smoke.cjs` | 通过：真实 SSH/SFTP 等原有 UI 检查 |
| 截图检查 | 已检查命令库、连接管理、分屏工作区，修正了工具弹窗宽度的 CSS 优先级 |
| `git diff --check` | 通过 |

本次长命令批次：`041b2fcb9028463186537f7ab85b9017`。私有原始日志在项目 `.codex-adaptive-agents/processes/`，不进入 Git；UI 合成证据在 `test-results/`。构建有 Lucide `use client` 和 JS chunk 大于 500 KiB 的非阻断提示。

## 已处理的验证失败与限制

- Git 终端下载：默认代理 `127.0.0.1:12451` 不可用；绕过后获取上游历史超时。因此源文件由 GitHub 连接器按固定提交取得，本地 Git 基线用于本次审阅；正式上游提交历史未伪称已恢复。
- 离线 npm 缺少 webcrypto-core 缓存；后续有界在线安装成功。
- 第一次 UI 启动触发 Electron 运行时下载，超过 Playwright 启动期限；下载完成后继续验证。后续测试还修正了按钮快捷键文本匹配，并为认证方式添加准确可访问名称；最终全部通过。
- Keychain 使用隔离加密替身测试，没有读取或保存真实用户凭据；系统 Keychain 授权交互及不同签名构建间的持久性仍需用户环境验收。
- 未连接业务服务器；未验证 Apple Silicon、Windows、Linux；多级跳板、独立隧道、脚本引擎及 SSH CA 不在本批范围。
- 无实际移动、无删除（原有正式资产）；临时测试目录由本批测试自行清理。

进程收尾：已独立执行 process-check → process-cleanup → process-check，登记范围均为 CLEAN，无保留服务。发布 ZIP 为 release/SSHUltra-0.2.0-mac-x64.zip，SHA-256 见 release/SHA256SUMS.txt。
