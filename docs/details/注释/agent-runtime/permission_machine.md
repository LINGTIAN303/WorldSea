# permission_machine.rs 详细注释文档（agent-kernel）

> 来源：`crates/agent-kernel/src/permission_machine.rs` 的模块级长注释块。
> 代码内保留简要说明 + 本文件相对路径；**位次表（事实源）**见
> [11-S4施工计划 §三](../../../plans/2026-09-21-ZCode能力内化方向探究/11-S4施工计划-权限模式机.md)。

---

## 一、为什么需要（S4 立项）

权限判定此前**散落六段**（`agent/tools.rs::maybe_require_confirmation` 内按代码顺序隐式成序）：
`guard_fs_path`（敏感目录）→ `rule_engine_verdict`（用户锁 / 白名单）→ Plan 档守卫 →
agent-tmp 免确认 → `ConfirmationPolicy::needs_confirmation`（档位短路 + 三级危险 + 危险命令模式）
→ 动态路径守卫。改一处判定要通读全链，且「alwaysAsk 不可绕过」「锁单调」两条语义**无单点声明**。

S4-a 把顺序收为**纯函数** [`decide`]：无 I/O、无全局单例——规则 / 名单 / 档位 / 命中原因
经 `PermissionCtx` 传入（调用点只负责「取证 + 执行」）。位次表见 11-§三，用例
`permission_machine_tests::pos1..pos13` **一行一例（错位即红）**。

## 二、两条不变量（反证锚点）

| 不变量 | 含义 | 用例 |
|---|---|---|
| **模式放行分支不得绕过 alwaysAsk** | alwaysAsk 位（5）先于档位闸门（11）——Autopilot（yolo）亦不可静默放行必问操作 | `pos5_always_ask_survives_autopilot`（← 05-§八.1；**本批唯一行为变化：Autopilot 下 Dangerous 级工具从静默放行改为仍弹确认，收敛方向=更严**） |
| **锁单调** | 内置锁 / 用户锁位于位次最前，任何名单 / 档位 / 项目规则不得翻案 | `locks_are_monotonic`（+ `pos1` / `pos13` 拒绝不翻案、`ask_degrades…` Deny 不降级） |

## 三、关键语义（易错点）

- **会话级授权只服务 alwaysAsk gate**：命中与否只改变位次 5 的出口（`session_grant` 允许），
  **不得**成为普通工具的通用放行（对齐 ZCode sessionRules；用例 `pos6`）。
- **用户 Allow 先于档位**（ZD2-5：名单 > 档位）：位次 3 在 Plan 守卫（8）之前——
  白名单命令在 Plan 档可执行；名单是用户的显式授权，优先级高于档位与项目规则。
- **Ask 的无通道降级**：确认通道不可用（无 broker / 无 policy）时，**任何来源的 Ask 降级为
  Allow**（现行语义——没有确认可执行）；`Deny` 不受影响（锁与 Plan 守卫仍前置于此）。
- **路径越界只升级放行**：位次 13 把 `Allow` 提升为 `Ask`（工作区外需授权）；
  不降级、不翻案拒绝；显式白名单（位次 3）不受其影响（名单即授权）。

## 四、批次边界（S4 计划）

- S4-a（已完成）：位次 1-13 与全部字段。
- S4-b（已完成）：alwaysAsk 扩四类结构化名单（`always_ask_class`：进程执行 / 未预批外发 /
  破坏性 / 数据区写删〔路径型并入 E1 位〕；**迁移点：工具族批迁 `ToolDescriptor.always_ask`**）+
  会话授权来源接入（`SessionGrant` / `SessionPermissionGrants`，`AgentLoop` 存取；
  `once` 命中即消费；匹配主体经 `confirmation::rule_content_subject` 归一化）。
- S4-c（已完成）：项目规则来源接入——独立模块 `project_rules.rs`（`{workdir}/.worldsea/permissions.json`；
  来源与匹配见 §六）。
- 位次表**不随批次改动，只换来源**；改位次须同行更新 §三 表与逐位用例。

## 五、会话级授权（S4-b）

- **作用域**：仅会话内存活、不落盘（ZD2-3）——「会话内允许」≠ 全局放行；永久授权走用户名单显式编辑。
- **只服务 alwaysAsk gate**（位次 6）：普通工具不认（用例 `pos6`、`s4b_session_grant_serves_always_ask_gate_only`… 见逐位表）。
- **条目语义**：`content=None` 全量 / `Some(pattern)` 内容包含匹配（命令=小写原文；路径=归一化路径）；
  `once=true` 命中即消费。空工具名 / 空模式被忽略（防空模式匹配一切）。
- **接口**：`AgentLoop::{grant_session_permission, consume_session_grant, session_grant_count}`；
  命令面 `grant_session_permission`（服务层 + Tauri；UI 随 UX 批）。

## 六、项目规则（S4-c）

- **文件**：`{workdir}/.worldsea/permissions.json`（`project_rules::PROJECT_RULES_REL_PATH`）——data zone 内，
  Agent 裸写受 E1 保护（**声明不可自改**）；格式 `{"deny":[...], "ask":[...], "allow":[...]}`。
- **条目**：`"tool"`（该工具全部调用）或 `"tool:content"`（工具 + 内容模式）。
- **匹配**：工具名无 `*` = 精确相等 / 含 `*` = 通配；内容无 `*` = 包含（兼容既有子串名单）/
  含 `*` = 通配（**首段锚定开头、末段锚定结尾**——路径模式写 `*entities/*` 而非 `entities/*`）。
- **优先级**：`deny > ask > allow > None`（fail-closed）→ 判定位次 4/7/10（deny 先于 alwaysAsk，Q4-B）。
- **加载**：装配期（`new_agent`）+ `reload_project_rules`（服务 / Tauri 命令）；缺文件 / 坏 JSON /
  超限（>256KB）/ 空规则 → **未声明**（坏 JSON 记 warn；权限声明绝不猜测）。
- **边界**：规则随 agent 的 workdir 加载；`update_session_workdir` 的在线传播为既有缺口（随批登记）——
  切换目录后需重开会话或经 reload 命令。
