# dsh 工作区与环境设计基线

> status: 事实基线（2026-09-18，只读探索产出；本侧对照与建议见 [02-对照与建议清单](02-对照与建议清单.md)）
> 范围：工作区实体（host 侧导航层）+ 工作环境（shell / subprocess / sandbox / approval / 上下文注入）；与三域（工具 / Skill / MCP）重叠部分不重复，**沙箱归本域首次展开**。
> 取证口径：结论均带路径（dsh 根 = `.独立项/【参考项】deepseek-harness/`，以下路径相对该根）。

## 零、先读：一句总判断

dsh 把「工作区」与「执行边界」**拆成两层**：

- **工作区**（`packages/workspace`）= 宿主侧会话分组 / 导航实体，**模型不可见**（无工具、无提示词、无事件）；
- **执行边界**（`SessionHeader.cwd`）= **不可变**的会话工作目录，同时是沙箱 root、shell workdir 的解析基准。

两者靠 `session.header.cwd` 与 `workspace.path` 的 **realpath 相等性**绑定（`docs/subsystems/workspace.md:116`）——工作区是「路径的注册表」，不是「权限的载体」。

---

## 一、工作区（Workspace）

### 1.1 实体与身份

- 包：`packages/workspace/workspace`（服务名 `ctx.workspaceRegistry` → `WorkspaceRegistry`，`src/index.ts`）；消费者 `packages/api/workspace-controller`（`@Remote` CRUD + follow 流）。
- **身份**：`WorkspaceId` 是 brand 化 uuid，**从不等于路径**——注释理由：路径规范化会变（大小写 / 短名 / 符号链接），锚点需稳定（`src/types.ts:16`）。
- **实体接口** `Workspace`（`src/types.ts:31`）：`id / path / title / createdAt / updatedAt / sessionIds / setTitle / attachSession / insertSessionBefore / detachSession / status()`；实现 `WorkspaceEntity` 包内私有，所有写入走单一 `mutate()`（`src/entity.ts:69,202`）。
- **path 不变式**：创建时 `fs.realpath` 规范化一次，之后**永不改写**。

### 1.2 会话绑定

- session 创建时由 API Gateway 从所选 workspace 的 path（或显式 / 默认 cwd）决定 cwd，写入**不可变** `SessionHeader.cwd`，再 `attachSession` 复核。
- 成员资格 = 账户内 id + header 规范化 cwd 等于 workspace.path → **一个 session 至多属一个工作区**；未挂载 / 已归档会话显示为 Ungrouped（`docs/subsystems/workspace.md:116`）。

### 1.3 生命周期

- `create(path,title?)` 幂等：同规范化路径返回既有实体、不改 title（`src/index.ts:157`）。
- `delete` 只删注册，**保留目录与全部 session 日志**（`src/index.ts:198`）。
- create/delete 写 pending-mutation 标记，启动时 `recoverPendingMutation()` 恢复（`src/index.ts:430`）。
- 首次启动 `bootstrap()` 仅凭持久化 header 按目录自动分组建 workspace（`src/index.ts:448`）。

### 1.4 多 Agent

- 子 Agent **不建自己的 workspace 记录**，继承父 session 的 cwd（`packages/subagent/subagent-spawn-in-process/README.md:140`）；跨进程后端（acp / codex / claude-code）"runs in the parent's workspace"，cwd 默认父 session cwd（`packages/subagent/subagent-acp/README.md:41`）。
- **无 workspace 级 fork / snapshot / checkpoint**；"fork" 指会话历史种子（subagent-fork），compaction 的 "checkpoint" 是压缩事务——均与本域无关。

### 1.5 术语重载（读源码时注意）

`packages/context/agent-instructions` 里的 "workspace" 指**用户工作目录**，不是本注册表（`docs/subsystems/workspace.md:126`）。

---

## 二、工作环境（执行环境）

### 2.1 shell 执行基准

- seam：`ctx.shell`（`packages/shell/shell/src/types.ts`），请求可带 `workdir?`；规格 `workdir` 必填。
- `tool-bash` 的 `resolveWorkdir`（`packages/shell/tool-bash/src/index.ts:142`）：**显式 workdir（相对则按 session workspace 解析）> `sandboxPolicy root` > `session.header.cwd`**。
- 每次调用**全新 shell**，状态不跨调用。

### 2.2 环境变量

- `ctx.shellEnv`（`packages/shell/shell-env`）：每次调用重建受管 `DSH_*`（内置 `DSH_HOME` / `DSH_SHELL=1` / `DSH_SESSION_ID`），先丢弃继承的 `DSH_*` 再合并快照。`DSH_HOME` 默认 `~/.dsh`。
- **敏感变量清洗在 subprocess seam 统一做**：`scrubbedParentEnv`（`packages/subprocess/subprocess/src/index.ts`，测试 `tests/service.spec.ts:80`）按名启发式丢弃含 `*KEY* / *PASSWORD* / *SECRET* / *TOKEN*`（大小写不敏感）与 `DSH_*` 的变量，保留 `PATH`；显式 env 在清洗后合并（可覆盖）。已知局限：`*PASSPHRASE*` 等漏网（`subprocess-local/README.md:149`）。

### 2.3 沙箱

- 抽象：`ctx.sandbox`（provider）+ `SandboxMode = read-only | workspace-write | danger-full-access` + `SandboxExecutionPolicy`。
- 解析：`ctx.sandboxPolicy.resolve()`（`packages/sandbox/sandbox-policy/src/index.ts:164`）每次调用按优先级定策：**已批准显式 mode > session 的 `sandbox/mode` 事件 > 部署默认（默认 read-only，fail-safe）**；`workspaceRoot` 取 `session.header.cwd`。
- 落地后端：`sandbox-local`（bwrap/Landlock、Seatbelt、Windows ACL）与 `sandbox-windows-acl`。
- 强制器：`fs-sandbox`（写 / 改受 workspace 约束、**读不受限**、拒绝返回 `FS_SANDBOX_DENIED`）、`bash-sandbox` / `pwsh-sandbox`。
- 边界：沙箱**只管文件效应**，不含网络 / 进程可见性。

### 2.4 审批

- `ctx.approval`（`packages/interaction/user-approval`）：结果封闭且 **fail-closed**，**仅 `allowed-once` 放行**；每 session 策略 `ask | never`。
- `permission-presets`：把沙箱模式与审批策略**打包为具名预设**（默认 `workspace-write + ask`；`danger-full-access + never`）。

### 2.5 上下文注入（环境的一部分）

- `packages/context/agent-instructions`：注入用户全局 `$DSH_HOME/AGENTS.md` + **项目链** `AGENTS.md/CLAUDE.md`（项目根由 `.git` 标记，从根到 session cwd，宽→窄）；首请求注入一次、受 `maxBytes` 限制。
- 未发现独立的 `.dsh` 环境配置文件；配置统一走 Cordis 插件 config。

---

## 三、文档系统（权威来源）

- `docs/subsystems/workspace.md`（工作区契约）、`sandbox.md`、`permission-presets.md`、`approval.md`、`shell.md`、`subprocess.md`、`filesystem.md`。
- 包级 README：`packages/workspace/README.md`、`packages/sandbox/README`、`packages/shell/*/README.md`、`packages/context/agent-instructions/README.md`、`packages/api/workspace-controller/README.md`。
- 站点注册：`website/docs.ts:337,355`（sandbox / permission-presets / workspace）。
- 无单独 "environment" 文档——执行环境拆在 `shell.md` + `subprocess.md`。

## 四、与三域的边界

- 工具契约（isError / 并发声明 / 五段流水线）已在三域基线（[01-dsh三域设计基线](../2026-09-17-三域对齐dsh/01-dsh三域设计基线.md)）覆盖，本域不重复。
- 三域里的 MCP 侧 `scrubbedParentEnv`（M8）与工具审批（T6 挂账）与本域协作：M8 已对齐；审批**判定点迁移**属工具域，审批**策略打包**（presets）属本域。