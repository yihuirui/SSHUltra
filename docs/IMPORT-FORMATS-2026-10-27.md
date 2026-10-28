# 0.2.3 多格式连接导入

开发与源码验证：2026-10-27。中断后恢复并完成成品验收：2026-10-28。

用户授权增加 Excel、CSV、TXT、Markdown 导入。主 Agent 直接实现解析、预览和模板，保持新增连接、原生确认和私有备份边界。未读取或修改实际业务清单、凭据、Keychain 或服务器，未推送 GitHub。无实际移动、无删除用户项目资产；只清理测试自身临时夹具。旧版成品保留。

## 可用功能

- Excel XLSX／Excel 97–2003 XLS：选择工作表，首张为说明页或空页时仍可切换其他表。
- CSV／TSV：逗号、分号、Tab、带引号和转义引号的字段、CRLF，以及 Excel sep 行。
- TXT：分隔表格或一行一个 host、host:port、user@host:port；保留 TXT 中显式 OpenSSH 配置的兼容性。
- Markdown：第一张带表头和分隔行的表格，多表会提示。
- 中文／英文列名，UTF-8／带 BOM 的 UTF-16／GB18030/GBK；端口默认 22，缺失用户名可在预览统一补齐。
- 前 8 行预览及总数，错误行提示，同批唯一名称的单级跳板引用，确认后整批新增，原连接保留。
- 导入页保存 Excel、CSV、TXT、Markdown 模板；示例地址为文档用途地址，使用前需替换。

密码／口令列明确忽略，不导入安全凭据、信任信息和自动日志设置。宏拒绝导入，连接字段中的公式、错误和日期值需先转成普通数据；不会执行公式、宏、配置命令或打开外部链接。

## 代码与边界

`desktop/tabular-import.cjs` 处理表头、编码及文本格式；`desktop/import-parser.cjs` 分派原有格式和 Excel，并检查 XLSX 实际解压大小；`desktop/import-service.cjs` 与 `import-worker.cjs` 管理独立解析线程、截止和取消。主进程仅从原生文件选择器读取文件，renderer 无文件系统权限。

每文件 5 MiB、每批 1000 连接、每表 64 列；Excel 最多 20 张表，所选表最多 1001 行（含表头及格式化行）。解析 8 秒截止、128 MiB JS 堆；XLSX 最多 2000 条目、总解压内容 32 MiB、单条目 16 MiB。线程限制不等于整个应用物理内存的硬上限。

文本解析后不保留原始内容；Excel 原始 Buffer 仅用于工作表切换。预览 10 分钟后实际清除，换文件清旧预览，换表生成新 token，关闭／渲染异常／退出中止解析。最终确认继续使用快照检查和原子存储／私有备份。

依赖：SheetJS CE 0.20.3 按[官方安装与 vendoring 指引](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)从官方 HTTPS 发布地址获取并固定到 vendor，文件哈希记录于 vendor/README.md 和 npm lockfile；yauzl 3.4.0 检查压缩内容。新增许可已包含在 THIRD_PARTY_NOTICES.txt。首次下载遇到失效的本地代理端口；单次直接 HTTPS 重试成功，未修改代理设置。

## 实际验收

环境为 macOS x64、Node 24、Electron 45，所有输入均为隔离合成数据。

- TypeScript／Vite 构建、依赖许可生成通过；既有 Lucide use-client 和 bundle 大小提示仍在。
- 完整后端 54/54 通过，新增 13 项覆盖格式、编码、引号、错误行、行数限制、跳板引用、公式、宏、解压限制、取消／超时、模板和 TXT 原配置兼容。
- 源码和最终安装包的 imports-ui 各 4 项检查通过，涵盖全部新格式、四种模板私有保存、工作表切换、预览、原生取消不写入、追加保留旧连接、默认用户名、忽略密码、错误后旧 token 失效。renderer pageErrors 均为空。
- 原有 workflows-ui 通过：MFA、跳板、日志、批量修改和 JSON 导入保持正常。
- 包内版本、真实第二进程单实例、多窗口共享配置与许可检查通过。
- 最终包 16 个 Mach-O 均为目标 x64；19 个主进程／构建／模板文件与当前源码逐字节一致，运行时元数据一致。模板生成诊断文件留在原处并忽略，未随包分发。
- Excel 模板使用 bundled artifact-tool 生成、检查、渲染并导出；A1:H2 表头／示例值已核对，公式错误扫描为零，四种模板均经真实导入校验。

第一轮新测试有一项报错文案断言过窄：包含分号的无效 TXT 被识别为分隔表后，以缺少表头拒绝，而测试要求地址格式报错。已修正断言，拒绝行为未放宽。源码与包内测试均未部分写入。文本模板的行尾／空字段写法已规范化，最终 diff 空白检查通过。

详细日志位于 `.codex-adaptive-agents/processes/a40b63631cf848feaa7ad053ddcbe546/`，结构化证据和截图位于 `test-results/imports-20261027/`。CI 已增加源码与包内导入回归，远端 GitHub CI 尚未运行。

## 交付

应用：`release/0.2.3/mac/SSHUltra.app`。

ZIP：`release/0.2.3/SSHUltra-0.2.3-mac-x64.zip`。同目录提供校验值和全部本地修改补丁。先正常退出旧版，再打开新版，避免单实例锁唤起旧进程。

尚未 Developer ID 签名／公证；未做 Apple Silicon、Windows、Linux、真实业务服务器或实际用户 Keychain 验收。格式具体要求见 README 的 0.2.3 章节。

包内基线 SSH／分屏／批量／SFTP 冒烟 13 项检查通过，renderer pageErrors 为空。ZIP 全条目 CRC 校验通过，大小 134,431,839 字节，SHA-256：

```text
dd0f6a5f49c6ade5ce8c99805e2347e911aa21992196985bf7e541fedc4ae261
```

0.2.2 ZIP 哈希确认未变。登记批次已依次独立检查、清理封闭、再次检查，均为 CLEAN，active／retained／issues 均为空，无保留服务；仅证明登记范围内进程已停止。最终验收结构化结果位于 test-results/imports-20261027/verification.json。
