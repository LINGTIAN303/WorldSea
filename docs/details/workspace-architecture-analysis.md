# Agent Workspace 架构诊断 — WorldSmith 通往通用 Harness 的文件系统底座评估

> 状态：已沉淀 · 2026-08-22
> 定位：基于代码链路逐层走查（非 README）产出的架构诊断，回答「WorldSmith 的 Agent 文件系统作为通用 Harness 底座是否达标」，并记录随后落地的「实体 + 边界加固」。

---

## 一、核心结论

> **WorldSmith 的 Agent 架构已具备「Agent + Workspace + Tool + Session + Execution」雏形，作为 Worldbuilding 产品的 Agent 文件系统：合格且相当不错。**
> **但作为通用 Harness 的文件系统底座：尚未完全达标。**
>
> 最大瓶颈不是「有没有文件系统」，而是 **Workspace 在架构中还不是一等公民。**

---

## 二、拆解：Harness 应如何理解 Workspace

成熟 Harness 不是「Agent → file_read/file_write/shell → 某个目录」，而是：

```
                    Harness
                       │
             ┌─────────┴─────────┐
             │                   │
          Agent Runtime       Workspace
             │                   │
       ┌─────┼─────┐       ┌─────┼─────┐
       │     │     │       │     │     │
     Model  Tool  Memory   Files  State  Artifacts
       │     │     │       │     │     │
       └─────┴─────┴───────┴─────┴─────┘
                       │
                  Execution
                       │
              OS / Container / VM
```

**Workspace ≠ 文件夹。** Workspace 是 Agent 的「工作世界」，需回答：Agent 在哪 / 看到什么 / 改什么 / 产物放哪 / 临时文件在哪 / 长期知识在哪 / session 状态在哪 / 工具 cwd 是哪 / 多 Agent 是否共享 / 能否进他人空间 / 能否恢复·checkpoint·fork·diff·回滚。

---

## 三、WorldSmith 实际存在「三种文件系统」

```
                    WorldSmith
                        │
          ┌─────────────┼─────────────┐
          │             │             │
      Project DB    Project Files   Agent FS
          │             │             │
      entities.db     用户目录/文档   shell / file
      sessions.db     实体关联
      memory
```

三套**尚未统一成一个 Workspace 模型**：

| 层 | 实现 | 数据源 | 边界 |
|---|---|---|---|
| Project Storage | 应用数据目录 db | SQLite | 独立，不污染项目目录（合理） |
| Project File | `file-tools.ts` → `ctx.stores.file`（metadata/mimeType/tags/entityId） | 实体关联文档库 | 无 OS 路径概念 |
| Coding OS FS | 前端 `coding-agent-tools.ts` → `cmd_fs_*` | 绝对路径 → Tauri | 曾直传绕过（本诊断后已加固） |
| Rust FS 工具 | `fs_tools.rs` → ToolContext | 相对路径基于 workdir | 写/搜强制，读后收敛 |

### 第一层 Project Storage（合理）
Agent session / memory / API key / long task checkpoint / sub-agent spec 存应用数据目录，**不污染用户项目目录**——正确拆分「Agent 运行状态 ≠ 用户项目文件」。

### 第二层 Project File（产品合理）
`ctx.stores.file` 是「Project Asset / Document Store」——文件带 entityId/mimeType/tags/updatedAt 语义，与世界观实体关联（角色→portrait/game/voice/notes），是普通 Coding Harness 不会考虑的。

### 第三层 Coding OS Filesystem（本次重点加固对象）
`read_file/write_file/edit_file/search_files/list_directory/execute_command/shell_session` 经 `ExecutionAdapter` 连 Tauri/Node/WebSocket，是标准 Harness 思路。

---

## 四、ToolContext：已踩到 Harness 核心，但层级需再升

Rust `ToolContext { workdir, project_id }` + `resolve_path` / `is_within_workdir` 意味着「Tool 意识到自己属于某个 Workspace」。方向正确。

关键区分（本诊断的修正点一）：

- **Rust 原生 FS 工具写/搜索类**：`ensure_within_workdir` 越界**拒绝**（早已强制）。
- **前端 coding 工具链**：曾直传 `/etc/passwd` → `cmd_fs_read`，**绕过 workdir**。
- **读类**（read/list）：曾放行绝对路径。
- **execute_command**：cwd 可自填、默认无 workdir。

→ 准确表述：**workdir 边界当初只覆盖「Rust 写工具」一条链；前端 coding 链 + 读类 + shell 均绕过。**（本诊断后已用「实体 + 边界加固」收敛。）

---

## 五、Workspace 实体缺失（本次修复的核心）

- `SessionRecord.workdir` 原为 `Option<String>`，**无独立 Workspace 表/实体**。
- 无 `WorkspaceManager`；workspace 目录由前端 `ensureWorkspaceDir` 建，生命周期/幂等/checkpoint/fork 均无。
- 多 Agent（supervisor/multi_agent）共享主会话 workdir，子 Agent 无独立 workspace。

---

## 六、能力评分

| 能力 | 加固前 | 加固后 |
| --- | ---: | ---: |
| Project 文件管理 | 8/10 | 8/10 |
| Agent 文件工具 | 8/10 | 9/10（边界注入） |
| Shell / Execution | 8.5/10 | 8.5/10 |
| Session | 8.5/10 | 8.5/10 |
| Agent Runtime | 9/10 | 9/10 |
| Memory | 8/10 | 8/10 |
| Workspace 实体 | 6.5/10 | **8/10**（新增实体） |
| Workspace 隔离（边界） | 5.5/10 | **7.5/10**（三链收敛） |
| Multi-Agent Workspace | 6/10 | 6/10 |
| VFS / Projection | 4/10 | 4/10（未来项） |
| Checkpoint Workspace | 6/10 | 6/10（未来项） |
| Workspace fork / snapshot | 4/10 | 4/10（未来项） |
| Workspace 生命周期 | 5.5/10 | 6.5/10（实体+幂等） |

---

## 七、已落地：「实体 + 边界加固」

### Phase A — Rust Workspace 实体
- `workspaces` 表（id/root UNIQUE/label/created_at），`SessionRepository` 增 `upsert_workspace/list_workspaces/get_workspace_by_id`。
- `sessions` 表增 `workspace_id` 列；`SessionRecord`/`SessionInfo` 增 `workspace_id`（`workdir` 字符串保留做向后兼容）。
- `AgentCommandService.ensure_workspace`：按 root 幂等 upsert。
- `new_session` 自动 `ensure_workspace` 并把 community_id+root 写入；`restore_sessions`/`list_sessions` 用 workspace root 兜底 workdir。
- `ToolContext` 增 `workspace_id`；`AgentLoopConfig` 增 `workspace_id`。

### Phase B — 前端 coding 工具链接入 workdir 边界
- `IToolContext.workspace { id?, workdir? }`；`buildBridgeContext` 注入当前会话 workdir。
- `resolveWithinWorkspace(ctx, path)` 纯字符串归一（相对 path join workdir；绝对路径越界拒绝）。
- `read/write/edit/search/list/execute_command` 接入；execute_command cwd 缺省 = workdir，越界 cwd 拒绝。
- **无 workdir（旧会话/preview）→ 放行**（保持现状，不破坏功能；有 workdir 才启用边界）。

### Phase C — 读类收敛 + shell cwd 注入（Rust）
- `read_file`/`list_directory`：workdir 存在时越界绝对路径 → 拒绝（对齐写类收紧）。
- `ExecuteCommandTool.execute_with_ctx`：cwd 缺省 = ctx.workdir；显式 cwd 越界拒绝。
- workdir=None → 完全保持现行为（向后兼容）。

### Phase D — 本诊断文档入库

---

## 八、后续路线图（本次未做，未来方向）

1. **Workspace 生命周期管理**：WorkspaceManager 完整化（create/close/recover/checkpoint/fork/diff/rollback）。
2. **Multi-Agent Workspace**：subagent/supervisor 独立 workspace（shared/ + agents/<id>/private + scratch）。
3. **VFS / Projection**：把 project/artifacts/memory/tmp 投影成虚拟 Workspace 视图，Agent 只见 `/project /artifacts /memory /tmp`。
4. **Project File 与 Coding OS FS 统一**：`ctx.stores.file` 与 `cmd_fs_*` 两套世界拉到同一 Workspace VFS / Adapter 下。
5. **读类确认放行**：越界读经 `allow_sensitive_with_confirm` 门禁（已有）可确认放行，替代默认拒绝。

---

## 九、跨链调用链（下一步最值得画全）

`session → workdir → project switcher → AgentLoop → ExecutionAdapter → Tauri fs_commands` 这一整条链，决定「Agent 住哪 / Workspace 谁创建 / 生命周期谁管 / 多 Agent 能否共享隔离」。本诊断已从代码层面确认其两端（Project Storage 与 Agent Runtime），但完整时序图与生命周期归属仍是后续精读对象。