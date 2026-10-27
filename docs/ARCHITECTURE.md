# SSHUltra 首版架构与边界

## 实现

- `desktop/main.cjs`：Electron 窗口生命周期、原生确认与文件对话框、IPC 来源验证。每个窗口独享一个 SSHManager；共享 Store 负责已保存的连接与信任指纹。
- `desktop/preload.cjs`：只暴露明确的方法，不暴露 ipcRenderer、文件系统或任意进程执行。
- `desktop/ssh.cjs`：ssh2 客户端、终端输出流控、SFTP 流式传输及生命周期管理。
- `desktop/store.cjs`：白名单字段校验，临时文件＋rename 的配置写入；连接配置不接受密码／口令字段。
- `src/App.tsx`：连接管理、标签、分屏、批量目标、文件面板。终端组件始终挂载，切换标签时不重建连接。
- `src/TerminalPane.tsx`：xterm.js 实例、Fit/Search addons、输入及窗口大小、渲染完成后 ACK。

## 连接与凭据

密码、私钥内容和口令只在本次运行的内存中用于连接。保存私钥文件路径，不复制密钥。没有云服务、遥测、后台 HTTP 服务、自动命令执行或终端输出自动持久化。

首次主机连接展示 SHA256 指纹，默认取消。信任按 `[host.toLowerCase(), port]` 保存；已信任指纹变化时拒绝，不展示忽略按钮。合法换钥需向管理员核实后，备份并人工修改本地工作区中的对应 knownHosts 项。当前未实现 OpenSSH known_hosts 的导入、SSH 证书 CA 信任与多密钥轮换。

配置位置由 Electron 的 `app.getPath('userData')` 决定，macOS 通常为 `~/Library/Application Support/SSHUltra/workspace.json`。文件以 0600 创建。测试通过 `HARBOR_TEST_MODE=1` 与 `HARBOR_DATA_DIR` 切换到临时目录；测试不会读取用户现有配置。

## 批量操作

没有隐式的键盘广播。用户勾选已连接会话并输入命令后，主进程显示每个目标的连接名、用户、地址、端口和完整命令，默认取消。确认之后再次验证全部目标仍然有效，然后向终端 channel 写入。写入成功只表示已交给 SSH 通道，不表示远程命令执行成功。网络可以在发送过程中断开，不能保证多台服务器之间原子执行。

批量命令输入的是当前终端程序，可能是 shell、vim、数据库客户端等。界面明确提示核对当前提示符。复杂脚本、多行 shell 语法或需要事务的变更应另行处理。关闭或断开的会话从已选目标中移除。

## SFTP

支持浏览目录、单文件上传和下载，每窗口最多 4 个并行传输。上传使用 `wx` 独占创建，禁止隐式覆盖；如果远程服务不支持所需语义则返回错误。失败上传可能留下部分文件，界面提示检查远端，不自动删除远端文件。下载到随机名称临时文件，成功后 rename 到用户在保存对话框选择的位置；失败清理本次部分下载。

## 进程隔离与资源边界

启用 contextIsolation、renderer sandbox、webSecurity，关闭 nodeIntegration；CSP 仅允许打包资源；拒绝窗口打开、导航和权限请求。IPC 只接受登记窗口的主 frame 与准确的本地页面 URL。

每窗口最多 12 个会话，分屏最多显示 4 个；每个终端回滚缓存 10000 行。终端数据按字节 ACK，超过 512 KiB 暂停 SSH channel，低于 128 KiB 恢复。应用退出、窗口关闭、渲染进程异常与手动关闭会话时释放相应连接；关闭有活动连接的窗口要求确认。应用使用单实例锁，多个窗口共享同一主进程中的 Store，避免不同进程以旧快照覆盖配置。

## 参考与依赖

工作流参考 electerm、Tabby、Termora 和 SecureCRT；应用实现为原创，未复制其源码或品牌素材。React、xterm.js、Lucide 与 Electron 使用其各自开源许可；ssh2 使用 MIT 许可。发行保留依赖自带的许可文件，具体版本锁定于 package-lock.json。

## 首版未覆盖

跳板机／代理、端口转发、串口、连接配置导入、永久密码保存、SSH 多因素 keyboard-interactive、自动重连、完整持续日志、脚本引擎、目录递归传输、文件编辑、拖动分屏比例、自动更新与签名公证。macOS 以实际测试为准，Windows/Linux 尚未验收。
