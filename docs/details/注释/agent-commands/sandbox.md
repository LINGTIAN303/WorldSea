# sandbox 模块详细注释文档（agent-commands / E3 真沙箱）

> 来源：`crates/agent-commands/src/sandbox/{mod.rs, win.rs}` 的设计决策、生命周期与边界登记
> （手工维护，与代码内简要注释配套）。机制事实源与施工时序见
> [03-E3 真沙箱设计方案](../../../plans/已完成/2026-09-18-工作区与环境对齐dsh/03-E3真沙箱设计方案.md)。

## 1. 职责与分期

- **只限【文件写效应】**：读 / 网络 / 进程可见性不在约束范围（对齐 dsh `WRITE_RESTRICTED` 语义）。
- 分期：E3-1 决议地基（kernel 纯函数 + 戳记，仅观测）→ E3-2 命令族受限 → E3-3 PTY 受限挂载 →
  E3-4 收口（拒绝提示 / 审计元信息 / 文档）。
- 平台：仅 Windows（`sandbox::supported()`）；Unix 本期不启用文件写边界（设计 §4.8）。

## 2. 机制三件套（win.rs）

| 件 | 机制 | 关键不变量 |
|---|---|---|
| 受限令牌 | `CreateRestrictedToken`（`WRITE_RESTRICTED \| DISABLE_MAX_PRIVILEGE \| LUA_TOKEN`） | 限制 SID 必须含 logon SID + Everyone（缺则子进程 `0xC0000142` 死亡）；`OpenProcessToken` 需带 `TOKEN_ASSIGN_PRIMARY` |
| 能力 SID | `sha256("worldsea-sandbox:<domain>:<tag>")` → 前 64 位 → `S-1-4-x-y`（非唯一权威，无需账户解析） | 工作区域=规范化 root（确定性）；temp 域=目录路径（随机） |
| 目录授予 | `SetEntriesInAclW`（`SET_ACCESS`，天然幂等）+ `SetNamedSecurityInfoW` | 已存在同 SID ACE 时跳过（exact-ACE skip，免重复全树传播）；撤销走 `REVOKE_ACCESS` |

- 受限 spawn（命令族）：匿名管道 stdio + **挂起创建 → 挂 Job → resume**（收口「spawn 后 assign」竞态）。
- 控制台标志定案 **flags=0**（`CREATE_NO_WINDOW` 受限下 `0xC0000142`；`DETACHED_PROCESS` 与 powershell 不兼容）。
- 命令行形态：`cmd.exe /D /S /C "<原样命令>"`（不做 `\"` 转义）或 argv 引用（powershell）；cwd 不得带 `\\?\` 前缀。

## 3. 生命周期（谁是常驻、谁可撤销）

- **工作区 SID 常驻**：跨进程复用缓存（注册表命中即复用同一 ACE，免重复传播）。
- **私有 temp 两形态**（E3-3 定案，互不包含约束：`%TEMP%/worldsea-sandbox/*`）：
  - 命令族：每工作区 `pid-hash` 目录（进程级；TMP/TEMP 重写到此）；
  - PTY 会话：每会话 `pty-<uuid>` 目录 + 独立随机 SID，**会话销毁即撤销 ACE + 删目录**。
- **失败路径回收**：PTY 会话启动失败即回收其 temp（授予不残留）；沙箱构造/授予/启动任一失败 →
  fail-closed 拒绝执行（D3），绝不静默裸跑。
- **崩溃残渣惰性无害**：随机 SID 不写入任何后续令牌 → 残留目录/ACE 不可被后续进程使用，等系统 temp 卫生回收。

## 4. 接线（谁在用）

| 通道 | 入口 | 说明 |
|---|---|---|
| 命令族 | `execute_command` / `bash` / `powershell` | Agent 路径（携带 `ToolContext.sandbox`）走 `spawn_confined_command`；`bash`（Windows 经 WSL）D9 fail-closed |
| PTY 会话 | `shell_session_create` / `exec` / `input` | create = 受限令牌挂载 ConPTY（`pty::open_pty` 受限参数，**不回落** portable-pty）；exec/input 拒绝驱动非受限会话（防「面板会话被借用」旁路）；destroy 撤销会话 temp |
| 面板 / Unix | 无 ctx 入口 | 普通通路（有意不受限——用户驱动的终端面板） |

- 审计元信息：命令族 `__meta.sandbox`（E3-1 起）；PTY create/exec（E3-4 起）；被沙箱拒绝时
  附 `__meta.sandbox_denied` + 结果 `sandbox_hint`（前端工具行显示「沙箱拒绝」徽标）。

## 5. 撤销口径（E3-4 裁定：与 dsh 对齐）

- **dsh 事实**（`packages/sandbox/sandbox-windows-acl/README.md`）：工作区 ACE 按设计**常驻**
  （跨实例复用缓存，`dispose()` 绝不撤销）；仅 temp ACE 可撤销（`dispose()` 尽力而为、失败聚合成 `AggregateError`）；
  手工 `icacls` 无法回收（非唯一 SID → `ERROR_NONE_MAPPED` 1332）；**「回收常驻工作区 ACE 的清理命令」在 dsh 属未决方向、未交付**。
- **本侧对齐**：不交付「工作区 ACE 撤销入口」（无 UI、无命令）；可撤销面已在最小单位落地——
  PTY 会话 temp 随会话销毁撤销，命令族 temp 随进程退出成为惰性残渣。
- **残留登记**：工作区目录被重命名 / 迁移后，旧路径上的 ACE 留在原地（write-SID-only、惰性）；
  如需主动清理，属未来独立立项（与 dsh 同步未决）。

## 6. 已知边界（如实登记，不对宣称「完全封闭」）

- **Everyone 保活**：授予 Everyone 写的外部对象仍可写；NTFS 硬链接是同一文件对象的别名。
- **读写不对称**：读与网络不设界（`WRITE_RESTRICTED` 只交叉写类访问）。
- **拒绝方言从简**（E3-4）：仅按四类字样识别「沙箱拒绝」（`拒绝访问` / `access is denied` /
  `access denied` / `permission denied`），不做逐后端精确分类。
- **NULL-DACL 目录**在 grant+revoke 往返下不保持身份（dsh 同登记）；本侧撤销只用于自有 temp 目录，不触用户目录。