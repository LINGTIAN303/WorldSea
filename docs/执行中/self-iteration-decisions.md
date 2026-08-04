# 自迭代决策记录（Self-Iteration Decisions）

> 创建日期：2026-08-05
> 目的：用户放开权限，允许 AI 自行对项目自迭代。凡遇到"拿捏不住、需要拍板"的选点，**不打断用户确认**，在此记录我选择的方案与理由，备查可回溯。

## 迭代主题：子 Agent 编排接入主对话循环

当前项目处于 Phase 5.4 高级能力补齐的最后一项（子 Agent 编排接入）。此前已交付：deep phases、A2UI、终端能力。本迭代把 **子 Agent 编排** 接入主对话循环。

### 决策点 1：采用「delegate 工具 + 实例池」方式，而非复用 SupervisorNode

**背景**：`agent-runtime` 已有 `SupervisorNode`（阶段 2 编排框架），但它运行在 `Orchestrator` 节点流里，与主对话使用的 `AgentLoop`（ReAct 单循环）是两套路径。主对话走 `AgentCommandService.send_message → AgentLoop.run`。

**选择**：在主 Agent 的 `AgentLoop` 工具总线上注册一个 `delegate_to_sub_agent` 工具。主 Agent 在 ReAct 循环中遇到子任务时，调用该工具把任务派发给一个专长子 Agent（也是 `AgentLoop`），等待其返回结果后继续。

**理由**：
- 复用现有 `AgentLoop` 作为子 Agent 运行时，零新运行时。
- 与主对话循环自然融合（工具调用即子任务派发），无需启动独立 Orchestrator。
- 前端看到的仍是主 Agent 的一次消息流，子任务结果作为工具结果回填，交互一致。

**代价**：子 Agent 的流式事件不直接透传前端（阶段 1.2 既定约束），仅最终结果作为工具结果返回。已在计划文档记录。

### 决策点 2：子 Agent 实例采用「按 spec.id 懒加载 + 池化复用」

复用 `SupervisorNode::get_or_create_agent` 的既有模式：`agents: Arc<RwLock<HashMap<String, Arc<AgentLoop>>>>`。首次委派时按 spec 创建并缓存，后续复用；避免每次任务都新建 AgentLoop（上下文不共享）。

**理由**：与 supervisor.rs 既有实现一致，避免重复造轮子；子 Agent 持有独立消息历史，多次委派可累积专业上下文。

### 决策点 3：子 Agent 共享主 Agent 的 backend 与 tool_bus

子 Agent 复用主 Agent 的 `Arc<dyn NodeBackendAccessor>`（同一 LLM 配置/API Key）与 `Arc<dyn ToolBus>`（同一工具集，含终端工具）。不单独创建子 Agent 的 backend/tool_bus。

**理由**：LLM 配置已在 `new_agent` 构造主 Agent 时确定，子 Agent 复用同一配置最省事；工具集共享使子 Agent 也能执行终端/文件等操作。若未来需要子 Agent 工具隔离，可在 spec 的 `tools_whitelist` 上扩展（当前 ToolBus 不支持白名单过滤，阶段 1.4 扩展点）。

### 决策点 4：子 Agent 规格由调用方提供（SubAgentSpec），通过 `register_subagent_spec` 注册

`SubAgentSpec` 复用 `agent-runtime::supervisor::SubAgentSpec`（id/name/description/system_prompt/tools_whitelist/max_iterations）。在 `AgentCommandService` 中维护一个 `RwLock<Vec<SubAgentSpec>>` 规格注册表，`delegate_to_sub_agent` 工具按 `sub_agent_id` 查找规格并创建/复用实例。

**理由**：与阶段 2 的 `SubAgentSpec` 类型完全一致，避免重复定义；规格可动态注册（前端/命令层可新增子 Agent 能力）。

### 决策点 5：规格注册表跨会话共享（单一 `Arc<RwLock<Vec<SubAgentSpec>>>`）

`AgentCommandService` 持有**一个**共享的 `subagent_specs: Arc<RwLock<Vec<SubAgentSpec>>>`，而非每个会话各持一份。`new_agent` 创建每个会话时，把该共享注册表传给 `SubAgentManager`，因此 `register_subagent_spec` 的变更对所有（已有 + 新建）会话的子 Agent 管理器立即可见。

**理由**：子 Agent 规格描述的是"系统具备哪些专长"，属全局能力，跨会话统一；避免每个会话重复注册、规格漂移。

### 决策点 6：`new_agent` 由静态关联函数改为 `&self` 方法

原 `new_agent(system_prompt, provider_config)` 是静态函数，无法访问服务级共享注册表。改为 `async fn new_agent(&self, ...)`，在内部读取 `self.subagent_specs` 并注入各会话的 `SubAgentManager`。`new_session` 相应改为 `self.new_agent(...)`。

**代价**：`new_agent` 不再是纯静态工具函数，但仅内部调用，无外部影响。

### 决策点 7：接受"子 Agent 可再委派"的递归风险（受 max_iterations 约束）

子 Agent 复用主 Agent 的 `tool_bus`，因此子 Agent 也能看到 `delegate_to_sub_agent` / `list_sub_agents` 工具，理论上可递归委派（孙 Agent）。当前接受该风险：

**理由**：
- 每个 `AgentLoop`（含子 Agent）有 `max_iterations` 上限，LLM 实际无限递归委派极难发生。
- 递归委派本身是"分层专业分工"的合理能力（主编排 → 子专家 → 更细专家），保留它反而灵活。
- 现有 `SubAgentManager` 的实例池按 `sub_agent_id` 复用，不会无限创建实例。

**若未来需限制**：可在 `SubAgentManager` 增加"委派深度"计数，超限返回错误。本迭代不实现。

## 影响范围
- 新增 `crates/agent-commands/src/subagent.rs`（子 Agent 编排工具 + 规格注册表）。
- `AgentCommandService` 增加 `SubAgentSpec` 注册表字段与 `register_subagent_spec` 方法，`new_agent` 中注册 `delegate_to_sub_agent` 工具。
- 前端后续可加子 Agent 规格管理 UI（本迭代不强制）。

## 迭代主题 2：子 Agent 规格管理 UI（前端 + 命令层）

> 基线已干净（decision 1 全链路提交）。此次自迭代补齐子 Agent 编排的**用户侧入口**：让用户在桌面端能查看/注册/删除子 Agent 规格，使 `delegate_to_sub_agent` 能力真正可配置，而非仅靠代码硬编码。

### 决策点 8：`register_subagent_spec` 修正为「同名按 id 覆盖」

**现状**：当前实现只是 `push`，注释声称"同名覆盖"但实际会重复 push，导致 `list_sub_agents` 出现重复规格。

**选择**：改为按 `id` 去重——若已存在同名 id 则替换，否则追加。

**理由**：与注释契约一致；前端多次编辑同一规格时不会产生重复项；`delegate_to_sub_agent` 按 id 查找时取到最新定义。

### 决策点 9：新增 `remove_subagent_spec(id)` 方法

**背景**：此前只有注册/列表，无删除。管理 UI 需要"删除废弃规格"能力。

**选择**：在 `AgentCommandService` 增加 `remove_subagent_spec(id) -> bool`（返回是否删除成功），并从共享注册表移除。

**理由**：规格注册表是跨会话共享的 `Arc<RwLock<Vec>>`，直接 `retain` 即可，无需动子 Agent 实例池（池中实例懒加载，下次委派按最新规格重建）。

### 决策点 10：新增 3 个 Tauri 命令（subagent_list / subagent_register / subagent_remove）

**选择**：在 `apps/tauri/src-tauri/src/commands.rs` 对齐终端命令风格，暴露：
- `subagent_list_specs` → `list_subagent_specs`
- `subagent_register_spec(spec: SubAgentSpec)` → `register_subagent_spec`
- `subagent_remove_spec(id: String)` → `remove_subagent_spec`

**理由**：`SubAgentSpec` 已 derive `Serialize/Deserialize`，可直接作命令参数/返回值，无需额外 DTO。

### 决策点 11：前端新增「子 Agent 管理」标签页（SubAgentView.vue）

**选择**：在 `App.vue` 顶部 tab 增加 `subagent` 视图，新建 `apps/tauri/src/subagent/components/SubAgentView.vue`，展示规格列表 + 新增表单 + 删除按钮，通过 `useSubagentRust.ts` 封装 3 个 invoke 调用。

**理由**：与终端标签页同一模式（组件 + composable + App.vue tab），风格统一；让子 Agent 编排能力可被用户在桌面端配置。

**待决策（本迭代按下述默认）**：预设规格（如 coder/writer/data-analyst）由前端预填表单，不写死在后端，保持后端零默认规格、纯由用户配置。

## 影响范围（迭代主题 2）
- `crates/agent-commands/src/lib.rs`：`register_subagent_spec` 改按 id 覆盖 + 新增 `remove_subagent_spec`。
- `apps/tauri/src-tauri/src/commands.rs` + `lib.rs`：新增 3 个 subagent 命令。
- `apps/tauri/src/subagent/`：`components/SubAgentView.vue` + `composables/useSubagentRust.ts`。
- `apps/tauri/src/App.vue`：新增 tab 与视图挂载。

## 验证方式（迭代主题 2）
- `cargo check`（agent-commands + tauri）通过。
- agent-commands 单元测试通过（含新增覆盖/删除用例）。
- 前端 `vue-tsc` typecheck 通过。

**实测结果（2026-08-05 收尾）**：
- `cargo check --manifest-path crates/agent-commands/Cargo.toml` 通过。
- `cargo check --manifest-path apps/tauri/src-tauri/Cargo.toml` 通过。
- `cargo test -p agent-commands --lib` 16/16 通过（含 subagent 3 个用例 + 覆盖/删除/跨会话共享 3 个用例）。
- `pnpm --filter @worldsmith/tauri typecheck` 通过。
- 修复：App.vue 初版仅 import `SubAgentView` 但模板未挂载 tab/视图，触发 `TS6133 SubAgentView declared but never used`；已补齐「子 Agent」tab 按钮 + `subagent` 视图分支 + `.subagent-holder` 样式，typecheck 复跑通过。

### 决策点 12：模块级 composable 禁止直接调用生命周期钩子（onMounted）

**实测发现**：`pnpm tauri:dev` 启动后，浏览器控制台报 Vue 警告 `onMounted is called when there is no active component instance`。根因：`useSubagentRust.ts` 在**模块顶层**（`useSubagentRust()` 函数之外）调用了 `onMounted(refreshSpecs)`——模块被 import 时即执行，此时不在任何组件 setup 上下文，且与 `SubAgentView.vue` 里 `onMounted(sub.refreshSpecs)` 重复。

**选择**：删除 composable 内模块级 `onMounted`，首次拉取规格列表统由组件 `onMounted` 触发。

**理由**：composable 的生命周期钩子只能在被组件 setup 调用时生效；模块级单例 composable 若要在 setup 外初始化，应改用显式暴露的 `refresh` 方法由组件挂载时调用，而非隐式 `onMounted`。（terminal/agent 两个 composable 均无此问题，仅新增的 subagent composable 踩坑。）

### 决策点 13：表单字段补 `name` 属性（可访问性）

**实测发现**：控制台报 `A form field element should have an id or name attribute`。`SubAgentView.vue` 的 5 个输入字段有 `<label>` 但无 `id`/`name`。

**选择**：给 5 个表单控件补 `name="spec-*"`。

**理由**：满足 WCAG 表单可访问性，消除 Lighthouse/浏览器 issue；`name` 亦便于自动化定位。

**备注（浏览器 vs Tauri 的 invoke 限制，非 bug）**：在纯浏览器（localhost:5175）打开前端时，`@tauri-apps/api/core` 的 `invoke` 为 `undefined`，故 chat 初始化与子 Agent 注册/删除等 IPC 操作在浏览器会报错——这是 Tauri 运行时边界，真实 Tauri 窗口内正常。浏览器仅用于渲染/交互/可访问性验证，IPC 全链路需在桌面窗口验证。

## 验证方式
- 单元测试：`delegate_to_sub_agent` 工具能按 spec 创建子 Agent 并返回结果；规格注册表跨会话共享。
- e2e 测试（`#[ignore]` + 真实 LLM）：主 Agent 通过工具调用把任务派发给子 Agent，子 Agent 返回专业结果并回填。
- **实测结果（2026-08-05）**：`cargo test -p agent-commands` 14 lib + 1 e2e 通过；`e2e_subagent_orchestration_deepseek` 全链路通过（主 Agent 委派给 `coder` 子 Agent，子 Agent 生成 Rust `max` 函数并回填）；agent-runtime 154 lib 测试无回归；Tauri app `cargo check` 通过。

## 迭代主题 3：子 Agent 工具白名单（工具隔离）

> 决策点 3 曾标记"若未来需要子 Agent 工具隔离，可在 spec 的 `tools_whitelist` 上扩展（阶段 1.4 扩展点）"。本轮落实该扩展点，让 `SubAgentSpec.tools_whitelist` 真正生效。

### 决策点 14：新增 `WhitelistToolBus`（ToolBus 包装器）而非改造 `SimpleToolBus`

**背景**：`SubAgentSpec.tools_whitelist: Option<Vec<String>>` 字段早已定义但一直未生效。要让子 Agent 只能看到/调用白名单内工具，有两条路线：
- **A. 改造 `SimpleToolBus`**：给总线加白名单状态，按实例过滤。侵入性大，且主 Agent 与子 Agent 共享同一份 `Arc<dyn ToolBus>`，改一处会影响所有消费者。
- **B. 新增包装器 `WhitelistToolBus`**：实现 `ToolBus` trait，内部持有 `inner: Arc<dyn ToolBus>` + `allowed: RwLock<HashSet<String>>`，仅对白名单内工具透传 `get_by_name`/`list_all`/`call_tool`/`count`，其余方法（register 等）透传内层。

**选择 B**。理由：
- 零侵入：主 Agent 的原始总线不变，仅在创建子 Agent 时用 `WhitelistToolBus::new(Arc::clone(&self.tool_bus), list)` 包一层，只影响子 Agent 的视图。
- 职责单一：过滤逻辑独立成类，`SimpleToolBus` 保持"无过滤"的通用语义，便于复用与测试。
- 白名单为空集合时等价于"无任何工具"（`Some(&[])` 也走此分支），符合"未指定白名单则共享全部工具"的原语义。

**代价**：子 Agent 实例池按 `spec.id` 懒加载缓存，白名单在实例**首次创建时**确定；若运行期 `register_subagent_spec` 覆盖了某 spec 的 `tools_whitelist`，已缓存的实例不会自动更新（下次委派仍用旧白名单）。这与"池化复用累积专业上下文"的设计一致，属已知取舍；如需热更新可删池中实例重建，本迭代不实现。

### 决策点 15：`get_or_create_agent` 按 `spec.tools_whitelist` 决定子 Agent 工具总线

**选择**：在 `SubAgentManager::get_or_create_agent` 中，`spec.tools_whitelist` 为 `Some(non-empty)` 时用 `WhitelistToolBus` 包装并传给 `AgentLoop`；否则直接用原始 `tool_bus`。`WhitelistToolBus` 从 `agent-runtime` 顶层导出（`pub use tool::{... WhitelistToolBus}`）。

**理由**：这是"白名单生效"的唯一接线点——子 Agent 的 `AgentLoop` 拿到哪个总线，决定了它 `list_all`/`call_tool` 能看到什么。放在 `get_or_create_agent` 一处，所有委派路径（`delegate`）统一受益。

## 验证方式（迭代主题 3）
- agent-runtime 新增 3 个 `WhitelistToolBus` 单元测试：白名单过滤 `list_all`/`count`、白名单外 `get_by_name`/`call_tool` 被阻断、空白名单等价无工具。
- agent-commands `subagent` 测试回归通过（6 个 lib 用例）。
- **实测结果（2026-08-05）**：`cargo test -p agent-runtime tool::tests::whitelist` 3/3 通过；`cargo test -p agent-commands subagent` 6/6 通过；agent-runtime lib 154 无回归。

### 决策点 16：白名单在管理 UI 暴露为「逗号分隔文本」，空文本 = 不设白名单

**背景**：决策点 14/15 让 `tools_whitelist` 在后端生效，但 `SubAgentView.vue` 表单只有 `tools_whitelist` 字段模型（`null`），无输入控件，用户无法配置工具隔离。

**选择**：在表单加一个文本输入 `whitelistText`（逗号分隔的工具名），提交时 `textToWhitelist` 转成 `string[] | null`（空文本→`null`，即继承全部工具）；编辑时 `whitelistToText` 反向填充。列表项加「白名单 N」徽章（有白名单时显示数量，title 展示完整列表）。

**理由**：
- 逗号分隔是最低心智负担的录入方式，与 Shell 工具名（`execute_command` 等）短名匹配。
- `null` vs `[]` 语义：留空传 `null`（不设白名单，子 Agent 共享全部工具），贴合后端 `match &spec.tools_whitelist { Some(non-empty) => 包装, _ => 原样 }` 分支。
- 徽章让用户一眼看出哪些子 Agent 被限权，避免误配。

**代价**：录入的是工具**名称字符串**，无下拉校验——若拼错工具名，白名单内无此工具，子 Agent 将"看不到任何该名工具"（正常隔离行为，但用户需自行核对工具名）。已通过 placeholder 与 hint 提示常用终端工具名。

### 决策点 17：运行期规格变更后重建已缓存子 Agent 实例（消除决策点 14 的已知取舍）

**背景**：决策点 14 曾记录"白名单在实例首次创建时确定，运行期覆盖 spec 不改已缓存实例"的取舍。本轮发现该取舍会让**热更新规格**（如前端编辑某子 Agent 的 `system_prompt` / `tools_whitelist` / `max_iterations` 后重新注册）对已缓存实例不生效——用户改了配置，但委派的仍是旧实例，行为与所见不一致。

**选择**：引入 `CachedSubAgent { spec, agent }` 结构体，`SubAgentManager.agents` 从 `HashMap<String, Arc<AgentLoop>>` 改为 `HashMap<String, CachedSubAgent>`，记录实例**来源规格快照**。`get_or_create_agent` 在读锁/写锁两道路径都做"当前规格 vs 缓存规格比对"（`&cached.spec == spec`，依赖 `SubAgentSpec` 新增的 `PartialEq` 派生）：
- 一致 → 复用池中实例（`Arc::ptr_eq` 成立，不浪费上下文）。
- 不一致 → 按最新规格重建实例并覆盖缓存。

**理由**：
- 完全消除决策点 14 的"热更新不生效"取舍，让规格变更对已缓存实例生效，行为可预期。
- 比对仅 `PartialEq`（代价极低），且只发生在委派路径，读锁快速路径在规格未变时不引入额外开销。
- 覆盖式重建天然丢弃旧实例的消息历史——规格变更即"换新身份"，符合直觉。

**代价**：
- 规格变更会丢弃该子 Agent 累积的专业上下文（新实例从零开始）。这是"规格换新"的合理副作用，若未来需保留上下文可在 `CachedSubAgent` 增加迁移逻辑，本迭代不实现。
- 需要 `SubAgentSpec: PartialEq`（已加派生，无字段类型不可比问题）。

**验证（2026-08-05）**：新增单元测试 `get_or_create_agent_reuses_or_rebuilds_by_spec`——相同规格返回同一 `Arc`（复用）、`system_prompt` 变更后返回不同 `Arc`（重建）、重配后持续复用新实例。`cargo test -p agent-commands subagent` 7/7 通过，agent-commands lib 17、agent-runtime lib 157 无回归。

### 决策点 18：子 Agent 工具白名单 e2e 实测（真实 LLM 链路）通过

**背景**：决策点 3 记录了"若未来需要子 Agent 工具隔离，可在 spec 的 `tools_whitelist` 上扩展"的扩展点，后续已实现 `WhitelistToolBus`（决策点 14 周边）。本决策点补上该能力的**真实 LLM 端到端实测**，确认隔离在真实链路（而非仅单元测试）下真正生效。

**选择**：新增 `e2e_subagent_terminal_whitelist_deepseek` 测试（`crates/agent-commands/tests/e2e_llm.rs`，`#[ignore]` 需 API Key 显式运行），分两层验证：
1. **前置确定性校验（不依赖 LLM）**：`WhitelistToolBus` 只暴露白名单内工具（`list_all` 仅返回 `execute_command`），白名单外工具（`delegate_to_sub_agent` / `shell_session_create`）不可见。
2. **真实链路**：主 Agent 委派给带白名单（仅 `execute_command`）的 `sandbox` 子 Agent，子 Agent 经 `WhitelistToolBus` 真实执行 `echo whitelist-e2e-ok` 并回填输出。

**理由**：单元测试只证明包装器逻辑正确，无法证明"LLM 在受限工具视图下仍能正确择路调用白名单内工具"。真实链路可验证端到端：主 Agent 委派 → 子 Agent 经白名单调用工具 → 结果回填 → 最终回复。

**代价**：需要真实 API Key + 网络，`#[ignore]` 不参与常规 CI，按需显式运行。

**验证（2026-08-05）**：`cargo test -p agent-commands --test e2e_llm e2e_subagent_terminal_whitelist_deepseek -- --ignored --nocapture` 通过。日志确认：主 Agent 委派给 sandbox → 子 Agent 经 WhitelistToolBus 调用 `execute_command` 成功 → 最终回复回显命令输出 `whitelist-e2e-ok`。子 Agent 工具白名单在真实 LLM 链路下隔离生效。