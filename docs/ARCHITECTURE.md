# SSHUltra 首版架构与边界

## 实现

- `desktop/main.cjs`：Electron 窗口生命周期、原生确认与文件对话框、IPC 来源验证。每个窗口独享一个 SSHManager；共享 Store 负责已保存的连接与信任指纹。
- `desktop/preload.cjs`：只暴露明确的方法，不暴露 ipcRenderer、文件系统或任意进程执行。
- `desktop/ssh.cjs`：ssh2 客户端、终端输出流控、SFTP 流式传输及生命周期管理。
- `desktop/store.cjs`：白名单字段校验，临时文件＋rename 的配置写入；连接配置不接受密码／口令字段。
- `src/App.tsx`：连接管理、标签、分屏、批量目标、文件面板。终端组件始终挂载，切换标签时不重建连接。
- `src/TerminalPane.tsx`：xterm.js 实例、Fit/Search addons、输入及窗口大小、渲染完成后 ACK。

## 连接与凭据

本次输入的密码、私钥内容和口令只在运行内存中用于连接。用户可显式选择将共享密码／口令通过 macOS Keychain 保护的 Electron safeStorage 加密后保存到 credentials.enc.json；配置仅引用 ID，不向 renderer 回读秘密。留空密码使用 ssh2 异步 authHandler：先验证主机指纹并协商服务器方法，再通过原有 token／60 秒认证 IPC 请求终端内隐藏输入；密码直接用于 SSH 认证，不经过 xterm 或会话日志。仅该终端暂停普通输入，其他会话可继续使用；跳板和目标各自请求，取消／过期／关闭释放等待。服务器 keyboard-interactive 仍用原认证窗口。保存私钥路径，不复制私钥。没有云服务、遥测、后台 HTTP 服务或自动命令执行。持续日志由用户在连接配置或终端标题中选择启停。

首次主机连接展示 SHA256 指纹，默认取消。信任按 `[host.toLowerCase(), port]` 保存；已信任指纹变化时拒绝，不展示忽略按钮。合法换钥需向管理员核实后，备份并人工修改本地工作区中的对应 knownHosts 项。当前未实现 OpenSSH known_hosts 的导入、SSH 证书 CA 信任与多密钥轮换。

配置位置由 Electron 的 `app.getPath('userData')` 决定，macOS 通常为 `~/Library/Application Support/SSHUltra/workspace.json`。配置、密文、备份与导出通过同目录 0600 临时文件、fsync 和 rename 替换；写入失败保留原目标。格式 v1 在首次读取时先保留原字节私有备份，再升级为 v2，使旧版拒绝打开。连接 revision 防止旧编辑器或会话快照覆盖新配置。测试通过 `HARBOR_TEST_MODE=1` 与 `HARBOR_DATA_DIR` 切换到临时目录；测试不会读取用户现有配置。

## 批量操作

没有隐式的键盘广播。用户勾选已连接会话并输入命令后，主进程显示每个目标的连接名、用户、地址、端口和完整命令，默认取消。确认之后再次验证全部目标仍然有效，然后使用与普通输入相同的积压限制及异步写入回调向终端 channel 写入。写入成功只表示已交给 SSH 通道，不表示远程命令执行成功。网络可以在发送过程中断开，不能保证多台服务器之间原子执行。

批量命令输入的是当前终端程序，可能是 shell、vim、数据库客户端等。界面明确提示核对当前提示符。复杂脚本、多行 shell 语法或需要事务的变更应另行处理。关闭或断开的会话从已选目标中移除。

## SFTP

支持浏览目录、单文件上传和下载，每窗口最多 4 个并行传输。上传使用 `wx` 独占创建，禁止隐式覆盖；如果远程服务不支持所需语义则返回错误。失败上传可能留下部分文件，界面提示检查远端，不自动删除远端文件。下载到随机名称临时文件，成功后 rename 到用户在保存对话框选择的位置；失败清理本次部分下载。初始化／目录操作截止时间 15 秒，传输连续 30 秒无数据进展中止；取消会中止该会话全部文件请求并重置共享 SFTP 通道。已初始化通道的取消保留 SSH shell；ssh2 在初始化完成前不提供可单独取消的通道句柄，此时取消／超时断开当前 SSH 以释放资源，保留滚屏供手动重连。迟到回调不得复用已取消通道。

## 进程隔离与资源边界

启用 contextIsolation、renderer sandbox、webSecurity，关闭 nodeIntegration；CSP 仅允许打包资源；拒绝窗口打开、导航和权限请求。IPC 只接受登记窗口的主 frame 与准确的本地页面 URL。

每窗口最多 12 个会话，分屏最多显示 4 个；每个终端回滚缓存 10000 行。终端数据按字节 ACK，超过 512 KiB 暂停 SSH channel，低于 128 KiB 恢复。应用退出、窗口关闭、渲染进程异常与手动关闭会话时释放相应连接；关闭有活动连接的窗口要求确认。应用使用单实例锁，多个窗口共享同一主进程中的 Store，避免不同进程以旧快照覆盖配置。

## 参考与依赖

工作流参考 electerm、Tabby、Termora 和 SecureCRT；应用实现为原创，未复制其源码或品牌素材。React、xterm.js、Lucide 与 Electron 使用其各自开源许可；ssh2 使用 MIT 许可。发行保留依赖自带的许可文件，具体版本锁定于 package-lock.json。

## 0.2 工作流模块

- `desktop/logging.cjs`：UTF-8 流式输出日志、常见 ANSI/OSC 过滤、UTC 时间戳、按日及大小轮转；保留期限显式选择，仅清理同一 profile 的非活动日志。退出前等待日志流关闭。
- `desktop/vault.cjs`：macOS safeStorage 密文及非秘密名称列表；不可用时拒绝持久化，不回退明文。密文文件损坏时保留源文件并禁用凭据库，不阻止主窗口启动，用户可显式选择本次输入。
- `desktop/migration.cjs`：白名单连接导入导出。导入仅新增 ID，不迁移信任、凭据和自动日志；批量／导入操作展示原生确认，确认后再校验快照，防止覆盖同时发生的变更，并保留私有工作区备份。
- SSHManager 的跳板仅建立认证与 direct-tcpip 通道，不请求跳板 shell；两端独立验证指纹。交互认证使用每窗口随机 token，回答由主 frame 校验；每轮 60 秒过期，断开／窗口退出取消等待。
- `src/WorkflowTools.tsx`：命令模板、批量配置、导入预览、凭据维护及认证表单。收藏命令只填入 composer，最近发送只保留内存。所有对话框通过 `src/Modal.tsx` 使用原生 showModal 隔离背景焦点；终端同时检查输入阻断状态。

## 当前未覆盖

多级跳板、SOCKS/HTTP/本地代理命令、独立端口转发、串口、SSH CA 信任、自动重连、脚本引擎、目录递归传输、文件编辑、拖动分屏比例、自动更新与签名公证。macOS 以实际测试为准，Windows/Linux 尚未验收。

## 打包校验

`scripts/package-mac.cjs` 默认使用宿主架构，输出到按版本区分的 release 目录；打包前检查 Electron 运行时，打包后递归验证所有 Mach-O（包括 framework 和原生模块），拒绝目标架构不匹配。签名／公证仍未完成。

## 0.2.3 清单导入

`desktop/tabular-import.cjs` 负责列别名、分隔文本、编码、Markdown 与地址列表；`desktop/import-parser.cjs` 分派原格式及 Excel，并检查 XLSX 的实际解压数据量。`desktop/import-worker.cjs` 只返回白名单连接和提示，`desktop/import-service.cjs` 管理 8 秒截止、128 MiB JS 堆和取消；文件读取仍仅来自主进程原生文件选择器。

预览在窗口上下文中保存，10 分钟后实际清除；仅 Excel 为切换工作表暂存原始 Buffer，文本解析后不保留原文件内容。换文件清除旧预览，换表产生新 token；退出／渲染异常中止解析并清空。最终导入沿用原生确认、确认期间快照校验、全批校验及私有备份，不局部写入。模板为 `templates/` 静态资产，通过原子私有文件写入保存。

SheetJS CE 0.20.3 使用官方发布 tarball 并在仓库 vendor 中固定，yauzl 3.4.0 检查 ZIP 条目和实际解压大小。两者只用于主进程导入工作线程，许可随包分发；不是联网服务，解析不执行宏、公式、导入配置中的命令或打开外部链接。
