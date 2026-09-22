# plan 优化批施工计划（工具归一 + 引导瘦身）

> status: **执行中**（2026-09-23 拍板：工具归一+引导瘦身〔推荐〕；先于 C1-a）
> 上游：[16-C1 主循环族草案](16-C1主循环族草案.md) §四 Q2 追加意见（用户：plan 需先优化——「对比其他 Agent 产品明显看出问题」）·
> 对标：Claude Code TodoWrite（**单工具全量重写** + 状态镜像语义）
> 回归底线：**B8**（A2UI 与动作段）· 计划事件三件（`plan_created`/`plan_update`/`plan_replanned`）**名称与载荷不变**（前端 `usePlanStore`/turnModel 零改动）· 桥契约 29
> **本项目为什么需要**：plan 是三工具（create/update/replan）+ 增量 id 管理 + 长引导词强注入——协议复杂、模型易错、
> 且「严格串行仪式」把状态镜像写成了执行流程；工具归一后，plan 成为模型**自发**使用的简单工具，也是 C1-a 续跑触发的可靠基础。
> 本文只做设计与裁定点收敛，**未动任何代码**。

---

## 一、现状取证（2026-09-23）

| 面 | 现状 | 问题 |
|---|---|---|
| 工具面（Rust 主链） | **三工具**：`plan_create`（全量替换）/ `plan_update`（单步 id）/ `plan_replan`（失败重排）——无状态规范化器，位于 `apps/tauri/src-tauri/src/plan_commands.rs` | 协议复杂：模型须记住 id 并精确指定；「没 create 就 update」类失败面 |
| 后处理 | kernel `apply_plan_result`（`agent/tools.rs:347-`）按工具名分派 → 写 `state.plan` + 广播 `PlanCreated`/`PlanStepUpdate`/`PlanReplanned` | 与三工具绑定；归一后需改为 diff 发事件 |
| 引导 | `PLAN_TODO_GUIDANCE`（`agent-commands/lib.rs:391`）**强注入**：`/plan` 前缀 + LLM 判型为复杂任务（Research/Experiment/Compose）时拼到用户消息尾部 | 长文案污染消息；「严格串行：in_progress→干活→completed→下一步」是执行仪式而非状态镜像 |
| 事件与前端 | 三事件 → `useAgentRust` 监听 → `usePlanStore` + turnModel 行段归约（`plan_step_status`/`plan_zone_toggle`/`plan_restore_regroup`） | **不改**（归一后事件保持不变） |
| 标签 | `toolLabels.ts`：`plan_create: '创建计划'` / `plan_update: '更新计划'` | 随工具改名调整 |
| 白名单 | kernel `agent/memory.rs` 跨场景工具清单含 plan 三件 | 随工具改名 |
| **TS 编排线** | `packages/agent-runtime/src/tools/plan-tools.ts`（plan_create/plan_update **另一套**，编排 plan-node 用） | **不动**（D2 编排线停止演进；登记） |

---

## 二、设计

### 归一为 `todo_write`（单工具全量重写）

**参数**：`todos: [{ id?, content, status: pending|in_progress|completed|skipped|failed, description? }]`（`content`/`status` 必填）

**语义（全量重写）**：
- 带 `id` 且命中现有项 → 保留 `id` 与 `output`，更新 `content`/`status`/`description`；
- 无 `id` / id 未命中 → 新项（生成 id）；
- 现有项不在列表 → **删除**（重排 = 传新顺序，天然支持）；
- `order` = 数组序；空列表 → 报错（防误清空）；全 completed 后模型可不再调用。

**状态语义收紧（温和降级）**：超过一个 `in_progress` → 保留第一个、其余降 `pending`，返回文案提示修正（不报错，避免模型纠错死循环）。

**工具 description 承载规范**（替代长引导词）：「多步任务（3 步以上）用；每次传**完整清单**；至多一个 in_progress；完成即标；简单问答不用」。

### 后处理（kernel `apply_plan_result` → `todo_write` 分支）

- **结构变化**（增/删/重排）→ 广播 `PlanCreated { items }`（全量，前端整体刷新）；
- **仅状态变化**（同 id 同序）→ 逐项广播 `PlanStepUpdate { step_id, status }`（行段归约沿用）；
- 写 `state.plan`（唯一状态源不变）。

### 引导瘦身

- 删除 `PLAN_TODO_GUIDANCE`（长引导）与复杂判型处的注入；
- `/plan` 前缀**保留**（手动入口）→ 仅短提示（一句），或完全不注入（工具 description 自解释）——实现取短句。

### 事件契约

三事件**名称与载荷零改动**（07 冻结的增补式原则）；前端 `usePlanStore` / turnModel / 计划段渲染**零改动**。

---

## 三、批次总览（提案）

| 子批 | 内容 | 触面 | 反证注入（预告） |
|---|---|---|---|
| **P-a** | `todo_write` 工具（全量重写 + 状态收紧）+ 删三旧工具 + kernel 后处理 diff 事件 + 白名单/标签/测试 | Rust（tauri plan_commands + kernel tools/memory + 前端标签） | ① 结构变化只发 StepUpdate（不发 PlanCreated）→ 前端整体刷新用例红；② 状态收紧摘除（允许多 in_progress）→ 用例红 |
| **P-b** | 引导瘦身（删长 guidance 与判型注入；`/plan` 保留短句）+ description 定稿 | agent-commands lib.rs | ③ 摘 `/plan` 保留（前缀不再注入任何提示）→ 用例红 |
| **P-c** | 收口：B8 对账 + 全口径基线 + 真机走查 | — | — |

---

## 四、裁定记录（2026-09-23 拍板）

| # | 裁定点 | 拍板 |
|---|---|---|
| Q1 | 优化范围 | **工具归一 + 引导瘦身 + 状态语义收紧**（不含计划模式——另批） |
| Q2 | 开工顺序 | **plan 优化批先** → C1-a 目标续跑 |
| — | 自主项 | 工具名 `todo_write`；状态 5 值保留（前端已渲染）；`failed/skipped` 语义沿用；TS 编排线不动 |

---

## 四之二、落地记录（P-a + P-b 合并，2026-09-23）

**工具归一（`apps/tauri/src-tauri/src/plan_commands.rs` 重写）**
- 新 `todo_write`：**全量重写**——带 id 命中现有项 → 更新；无 id → 新建（生成 id）；未出现的旧项 → 删除；数组顺序即执行序；
- **状态语义收紧**：多个 `in_progress` → 保留第一个、其余降 `pending`（温和降级不报错）；空清单 / 空 content / 非法状态 → 拒绝；
- `plan_create` / `plan_update` / `plan_replan` **删除**（D4 切换即删）；`plan_tools()` 单工具。

**kernel 后处理（`agent/tools.rs::apply_plan_result` 重写）**
- 仅处理 `todo_write`；**合并旧项 output**（同 id 沿用——工具侧不回传 output，前端产出区不掉）；
- **结构变化**（id 序列不同：增/删/重排）→ 广播 `PlanCreated { items }`（前端整体刷新）；
- **仅状态变化**→ 逐项广播 `PlanStepUpdate`（计划段/行段归约沿用）→ **前端零改动**；
- 写 `state.plan`（唯一状态源）；`parse_plan_status` 助手删除（不再需要）。

**引导瘦身（P-b）**
- `PLAN_TODO_GUIDANCE`（长引导词）删除 → `PLAN_TODO_HINT`（一句短提示，**仅 `/plan` 前缀**注入）；
- 复杂判型（Research/Experiment/Compose）的**强注入移除**（前缀剥离保留——`/调研` 等 Chip 行为不变）；
- 「何时用 / 怎么用」写入 `todo_write` description（模型自发习惯）。

**配套**：内核跨场景白名单（`memory.rs`）/ 前端标签（`toolLabels.ts`：`todo_write: '更新任务清单'`）/ 注释同步（`state.rs` / `event.rs`〔PlanReplanned 标注为历史事件、无发射方〕/ `lib.rs`）/ `confirmation.rs` 测试改名。
**事件契约**：三事件（`plan_created`/`plan_update`/`plan_replanned`）**名称与载荷零改动**；TS 编排线 `plan-tools.ts` 不动（D2 冻结，登记两套 plan 工具的既有事实）。

**反证（留档 `证据/Plan/`）**

| # | 变异 | 结果 |
|---|---|---|
| 1 | kernel 结构变化判定恒真（`same_structure = true`） | **红**（2 例：PlanCreated 未发 / 结构变化用例）— [01](证据/Plan/01-inject-structure-always-same-red.txt) |
| 2 | 状态收紧摘除（多 in_progress 不降级） | **红**（1 例：第二个 in_progress 未降级）— [02](证据/Plan/02-inject-single-in-progress-removed-red.txt) |

**基线**：kernel **338**（-1：replan 用例删除并入全量重写用例）· commands **277** · tauri `--lib` **101/101**（含 `todo_write` 4 例）·
vitest **1049/75**（**零改动零回归**——实证「事件契约不变⇒前端不受影响」）· vue-tsc **0** ·
`arch:check` **0 违规**（2 处注释增长显式复核）· 断链 **0**。

## 四之三、收口（P-c）

**真机走查清单（用户亲测）**

| # | 项 | 预期 |
|---|---|---|
| 1 | 复杂任务**自动**建清单 | 发一条多步任务（如「调研 X 并写成文档」）→ 模型**自发**调 `todo_write`（无需 `/plan`），计划段出现并逐项推进 |
| 2 | `/plan` 仍可用 | `/plan 任务描述` → 照常建清单（注入一句短提示） |
| 3 | 简单问答不建清单 | 「今天几号」类 → 无计划段 |
| 4 | 计划段渲染不回归 | 步骤行状态推进 / 折叠区 / 产出区 / 完成收口与之前一致 |
| 5 | 全量重写正确 | 中途追加/删改步骤（模型侧）→ 计划段整体刷新且已完成项 output 不丢 |

> 走查结论由用户回填；不通过项按批次再修。

## 五、验收口径（反证式）

1. **反证**：每子批 ≥1 处变异注入看报红；留档 `证据/Plan/`。
2. **回归底线**：计划三事件载荷不变（前端零改动）· B8 动作段 · 桥契约 29 · 既有 plan 段用例全绿。
3. **真机走查**：复杂任务自动建清单并逐项推进（无需 `/plan`）；`/plan` 前缀仍可用；计划段渲染与折叠不回归；简单问答不建计划。
4. **文档同步**：index + 02-§1.4 + `.workbuddy/memory/`。

---

## 六、不做项（随批声明）

计划模式（EnterPlanMode/ExitPlanMode，另批）· TS 编排线 plan-tools（D2 冻结）· 前端计划段视觉改版 · `output` 字段的模型侧暴露（沿用系统填）。
