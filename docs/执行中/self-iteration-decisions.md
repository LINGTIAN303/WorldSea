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

### 决策点 19：多子 Agent 编排 e2e（真实 LLM 链路）通过

**背景**：既有 `e2e_subagent_orchestration_deepseek` 只覆盖单个子 Agent。本决策点补充**多个专长子 Agent 间的择路委派**实测，验证主 Agent 在多个子 Agent 中能依据任务类型正确选择目标。

**选择**：新增 `e2e_subagent_multi_dispatch_deepseek`（`crates/agent-commands/tests/e2e_llm.rs`，`#[ignore]`），注册两个专长子 Agent（`code` 代码助手 / `write` 写作助手），主 Agent system prompt 明确择路映射（code 任务→code，写作→write）。给定一个明确的写代码任务，断言主 Agent 调用了 `delegate_to_sub_agent` 且 `sub_agent_id == "code"`（从 `ToolCall.args` 的 `serde_json::Value` 直接 `.get("sub_agent_id")` 解析，无需反序列化）。

**理由**：单子 Agent 测试无法证明"择路"能力——多子 Agent 场景下主 Agent 可能滥用任意子 Agent。本测试验证编排层在存在多个候选时仍能正确路由。

**代价**：真实 LLM 择路存在不确定性，依赖 system prompt 明确映射 + `temperature=0` 提高稳定性；`#[ignore]` 不参与常规 CI。

**验证（2026-08-05）**：通过。主 Agent 在 code/write 中正确择路委派给 code，子 Agent 返回 Rust `add(a,b)->a+b` 实现，主 Agent 汇总输出。agent-commands lib 17、agent-runtime lib 157 无回归。**附带修复**：`tool.rs` 的 `PlaceholderTool` 此前仅 struct 加 `#[cfg(test)]`，其 `impl Tool` 块未加，导致 e2e_llm 编译（agent-runtime 作为非测试依赖编译）时报"找不到类型"——给 impl 块补 `#[cfg(test)]` 修复。

### 决策点 20：规格热更新真实链路 e2e（运行期覆盖 system_prompt 后子 Agent 重建）通过

**背景**：单元测试 `get_or_create_agent_reuses_or_rebuilds_by_spec` 已证明"规格变更 → 重建实例"的内存行为，但未走真实 LLM 链路。本决策点验证：运行期 `register_subagent_spec` 覆盖某子 Agent 规格后，主 Agent 再次委派时，子 Agent **确实使用新规格**（而非沿用旧实例的旧 system_prompt）。

**选择**：新增 `e2e_subagent_spec_hot_update_deepseek`（`crates/agent-commands/tests/e2e_llm.rs`，`#[ignore]`）。用**可检测的输出标记**验证规格生效：注册 code 子 Agent v1 规格（system_prompt 要求每条回复以 `[V1]` 开头）→ 委派一次，断言 ToolResult 含 `[V1]`；随后运行期覆盖为 v2 规格（要求 `[V2]` 开头）→ 再次委派，以首次委派后的消息条数为分界点，断言**分界点之后**新产生的 ToolResult 含 `[V2]`。

**理由**：仅靠实例 `Arc` 指针比对（单元测试）无法证明"新实例承载新行为"。用 system_prompt 注入可辨识标记，让真实 llm 输出直接反映实例采用了哪个规格，是最轻量的可观测证明。分界点（按 index 过滤首次委派后的 ToolResult）避免旧消息污染断言。

**代价**：真实 LLM 对"必须带 `[Vx]` 前缀"的服从有不确定性，依赖 system_prompt 强约束 + `temperature=0`；`#[ignore]` 不参与常规 CI，稳定失败后可单独重跑。

**验证（2026-08-05）**：通过（132.06s）。日志输出 `规格热更新：v1 委派含 [V1]，热更新 v2 后二次委派重建实例含 [V2]`，消息数第一次后 7 条、第二次后 15 条。证明运行期规格热更新后，子 Agent 按新 system_prompt 重建实例并生效。agent-commands lib 17、agent-runtime lib 157 无回归。

## 迭代主题 4：子 Agent 委派过程可视化（事件广播 + 超时 + 上下文迁移）

> 前面几个主题解决了子 Agent 编排的**能力**（注册/委派/白名单/热更新），但前端对委派过程完全是"黑盒"——用户看不到主 Agent 正在委派给谁、跑没跑完、是否超时。本轮打通**委派过程的可观测链路**：Rust 广播事件 → Tauri 转发 → 前端订阅展示，并顺带补上超时控制与规格变更时的上下文迁移。

### 决策点 21：子 Agent 委派通过主 Agent 的 `EventBroadcaster` 广播 `OrchestratorEvent`，而非新建独立事件通道

**背景**：`SubAgentManager::delegate` 执行子 Agent 时，前端无感知。要让前端看到委派过程，需把委派事件推送到前端。已有两条事件通道：主 Agent 的 `EventBroadcaster`（`agent:event:*` 经 Tauri 转发）与独立的 subagent 事件集。

**选择**：在 `SubAgentManager` 注入主 Agent 的 `Arc<RwLock<EventBroadcaster>>`（新增 `set_broadcaster` 方法），`delegate` 内广播 `OrchestratorEvent::SubAgentStarted/Completed/Error`。

**理由**：
- 复用既有 `EventBroadcaster` 分发机制，零新基础设施；`OrchestratorEvent` 枚举本就是 agent-runtime 中心的跨模块事件类型，扩展它语义最自然。
- Tauri 端 `TauriAgentEventEmitter` 已订阅主 Agent 广播器，子 Agent 事件经同一 `broadcast` 路径转发到前端，无需另起炉灶。
- 前端统一通过 `agent:event:{type}:{session_id}` 模式监听，与既有的 `deep_phase_changed` / `a2ui` 监听风格一致。

**代价**：事件枚举新增 3 个变体，`matches!`/`match` 处需同步处理（本次已覆盖 commands.rs 转发）。

### 决策点 22：委派事件经 `agent:event:subagent:{session_id}` 通道透传前端

**选择**：`TauriAgentEventEmitter` 对 `SubAgentStarted/Completed/Error` 分别 `emit` 到 `agent:event:subagent:{session_id}`，payload 用 camelCase（`subAgentId`/`subAgentName`/`taskDescription`/`outputChars`/`durationMs`/`error`），`type` 字段取 `start`/`completed`/`error` 区分事件类型。

**理由**：与既有的 `agent:event:deep_phase_changed:` / `agent:event:a2ui:` 通道模式完全一致，前端 `listen` 同一命名空间，便于统一管理监听器生命周期。

### 决策点 23：委派设置超时（默认 120s），超时返回 `ToolError::Timeout` 并广播 `SubAgentError`

**背景**：子 Agent 复用主 Agent 的 backend，若 LLM 挂起或工具阻塞，`delegate` 会无限等待，阻塞主 Agent 的 ReAct 循环（`send_message` 前端等不到回复）。

**选择**：`SubAgentManager` 增加 `delegate_timeout`（默认 120s，`with_delegate_timeout` 可覆盖），`delegate` 用 `tokio::time::timeout` 包裹 `agent.run(...)`。超时则广播 `SubAgentError`（错误信息含超时时长）并返回 `ToolError::Timeout`。

**理由**：防御子 Agent 卡死对主循环的级联阻塞；超时信息随事件广播到前端，用户能看到"某子 Agent 执行超时"而非无限 loading。

**代价**：`ToolError::Timeout` 是新增变体，需在 `agent-runtime` 的 `ToolError` 中定义（已加）。

### 决策点 24：规格变更重建实例时迁移旧实例的非 system 消息，保留专业对话历史

**背景**：决策点 17 的重建策略在规格变更时**丢弃**旧实例全部上下文（新实例从零开始）。但多数规格变更只是微调 `system_prompt`/`max_iterations`，用户希望保留子 Agent 已积累的专业对话历史，仅换新"身份定义"。

**选择**：`get_or_create_agent` 重建新实例时，把旧实例消息中**非 system 角色**的消息（user/assistant/tool_result）迁移到新实例，仅替换 system_prompt 对应的 system 消息。

**理由**：保留专业上下文（历史任务、已确认的结论）能显著提升子 Agent 后续委派质量；system_prompt 是"身份"来源，规格变了就该换，但历史事实不该丢。

**代价**：迁移需在创建新 `AgentLoop` 后手动 `extend` 消息；迁移后消息条数增加，理论上更接近上下文上限（正常行为，子 Agent 亦有 `max_iterations` 约束）。

### 决策点 25：前端新增 `subAgents` 响应式状态与监听生命周期，随会话切换/删除/释放同步清理

**选择**：`useAgentRust.ts` 新增：
- `SubAgentState` 接口（`id`/`subAgentId`/`subAgentName`/`taskDescription`/`status`/`outputChars`/`durationMs`/`error`/`startedAt`）。
- `subAgents` 响应式数组 + `setupSubAgentListener`/`teardownSubAgentListener`（按 sessionId 索引，幂等）。
- 在 `newSession`/`switchSession`/`deleteSession`/`dispose` 中接入监听器的建立与清理，切换会话时清空 `subAgents`。

**理由**：与既有的 `deepPhaseUnlistenFns`/`a2uiUnlistenFns` 生命周期管理模式一致；避免会话切换后旧会话事件污染新会话视图，避免 `dispose` 后残留监听器。

### 决策点 26：前端新增 `SubAgentSection.vue` 内联展示委派过程（运行中/完成/失败）

**选择**：新建 `apps/tauri/src/agent/components/SubAgentSection.vue`，订阅 `backend.subAgents`，按状态渲染：
- `running`：蓝色脉冲指示 + 「运行中」徽章。
- `completed`：绿色 + 「已完成」+ 输出字符数/耗时。
- `error`：红色 + 「失败」+ 错误信息。

挂载到 `App.vue` 对话视图（A2UI 区与输入栏之间），随会话切换自动清空。

**理由**：对话视图是用户观察主 Agent 行为的主场景，委派过程内联展示最直观；不新增独立 tab，避免打断对话流。样式沿用现有极简风格（无 emoji 图标，纯 CSS 圆点 + 文字徽章）。

**代价**：子 Agent 规格管理（能力配置）仍在「子 Agent」tab（迭代主题 2），委派过程（运行观察）在对话视图——能力配置与运行观测分属两处，符合"配置 vs 使用"的直觉分离。

## 影响范围（迭代主题 4）
- `crates/agent-runtime/src/event.rs`：`OrchestratorEvent` 新增 `SubAgentStarted/Completed/Error` 变体。
- `crates/agent-runtime/src/tool.rs`：`ToolError` 新增 `Timeout` 变体 + `WhitelistToolBus`（决策点 14 既有）。
- `crates/agent-commands/src/subagent.rs`：`delegate_timeout` + `set_broadcaster` + `emit` + 委派事件广播 + 重建时上下文迁移。
- `crates/agent-commands/Cargo.toml`：新增 `tracing` 依赖。
- `apps/tauri/src-tauri/src/commands.rs`：`TauriAgentEventEmitter` 转发 3 个子 Agent 事件到 `agent:event:subagent:{session_id}`。
- `apps/tauri/src/agent/composables/useAgentRust.ts`：`subAgents` 状态 + 监听生命周期 + 导出。
- `apps/tauri/src/agent/components/SubAgentSection.vue`：委派过程展示组件。
- `apps/tauri/src/App.vue`：挂载 `SubAgentSection`。

## 验证方式（迭代主题 4）
- `cargo test -p agent-commands`：21 lib/e2e（非 ignore）通过，含 `delegate_broadcasts_start_then_completed`、`delegate_broadcasts_start_then_error_on_timeout`、`delegate_applies_timeout`、`get_or_create_agent_reuses_or_rebuilds_by_spec`、`spec_change_migrates_context_to_new_instance`。
- `npm run typecheck`（apps/tauri）：vue-tsc 通过。
- **实测结果（2026-08-05）**：agent-commands 21 通过（17 lib + 1 e2e + 1 loop_control + 3 subagent 事件/超时/迁移）；`useAgentRust.ts` 修复 `sessionId` 未使用（TS6133）后 typecheck 通过。

## 迭代主题 5：Rust 长任务终态闭环单测补全（fail_task / retry_task / clear_retry_marker）

> 本轮不新增功能，而是闭环 Rust 编排路线图「待办」里的 **failTask 终态闭环**（2026-08-02 标记"待收敛后干净环境重测"）。`LongTaskManager` **状态机**（running → completed/failed/cancelled）的 `fail_task`/`retry_task`/`clear_retry_marker` 三个方法此前**无任何单测覆盖**（已有 start/complete/cancel/checkpoint/resume/heartbeat 测试，唯独缺失败终态与可重试失败分支）。补测试把该待办闭环，无需用户手动跑桌面端。

### 决策点 27：补齐终态闭环单测，零生产代码改动

**选择**：仅在 `crates/agent-runtime/src/long_task.rs` 的 `mod tests` 新增 7 个测试，不改动任何生产逻辑：
1. `test_fail_task_terminal_transition`：Running → Failed（设 `ended_at`），终态清空活跃任务、重置 cancel flag、心跳回 Alive。
2. `test_fail_task_no_active_returns_none`：无活跃任务时返回 None。
3. `test_retry_task_keeps_running_and_marks_phase`：可重试失败**不设 `ended_at`**、状态保持 Running、错误记入 `current_phase`（`retry:` 前缀）、标记 checkpoint dirty、活跃任务未被清除。
4. `test_retry_task_truncates_long_error`：错误截断到 100 字符（防 `current_phase` 膨胀）。
5. `test_retry_task_no_active_returns_none`：无活跃任务返回 None。
6. `test_clear_retry_marker`：清除 `retry:` 前缀 phase，状态仍为 Running。
7. `test_clear_retry_marker_ignores_non_retry_phase`：非 `retry:` 前缀的 phase（如 `executing`）不被误清。

**理由**：
- fail_task 与 retry_task 是**语义相反**的两条终态路径（永久失败 vs 可重试失败），是 Loop Engineering 状态机正确性的关键分支，缺测试意味着回归风险无屏障。
- 用测试把 roadmap 待办「failTask 终态闭环」从"待重测"落实为"有自动化验证"，降低对用户手动重测的依赖。
- 纯测试改动零回归风险，符合协作规则"不自动修复未要求的问题"——生产逻辑本就正确，只是缺验证。

**代价**：无。

## 迭代主题 6：子 Agent 委派超时后实例状态清理

> 上一轮已实现子 Agent 委派超时（`delegate_timeout`），但超时路径**未清理子 Agent 实例状态**：`tokio::time::timeout` 超时是把 `run` future **drop**（非 abort），`run` 末尾复位 `is_streaming=false` 的语句永不执行，实例残留 `is_streaming=true`；且 ReAct 循环可能中途被丢弃，留下"含 `tool_calls` 但无配对 `toolResult` 的 assistant 消息"，污染下次复用。

### 决策点 28：超时后调 `reset_after_timeout` 复位流式 + 裁剪不完整消息，而非 `abort()`

**背景**：快捷修法是超时分支调 `agent.abort()`。但 `abort()` 置位 `state.aborted=true`，使实例**永久不可复用**（下次 `run` 开头立即返回 `AgentError::Aborted`），与"复用实例累积上下文"的目标冲突。

**选择**：在 `AgentLoop` 新增 `reset_after_timeout()` 方法：
1. 复位 `is_streaming=false`（future 被 drop 后 run 尾部不复位，需外部兜底）。
2. 裁剪尾部"含 `tool_calls` 但无配对 `toolResult` 的 assistant 消息"（被 drop 的循环大概率留下的残缺消息）。
3. **不置位 `state.aborted`**——实例保持可复用。

在 `subagent.rs` 超时分支调用 `agent.reset_after_timeout().await`，位置在广播 `SubAgentError` 之前。

**理由**：
- 目标语义是"超时但不报废实例"，`abort()` 会误伤复用；`reset_after_timeout` 精准复位，代价最小。
- `is_streaming` 是前端 `IAgentBackend.isStreaming` 与并发判断的依据，卡在 true 会导致前端误显示"流式中"、且可能误判实例占用。
- 裁剪残缺 assistant 消息避免下次 LLM 收到畸形对话（assistant 请求工具但无工具结果）。

**代价**：极少数场景（一次循环内多个并行工具调用中途被 drop）可能残留更复杂的半截消息，本方法只裁剪最常见的"尾部单条无配对 assistant"案例；极端残留仍可能影响下次上下文质量，但不影响正确性。已记录为该主题的已知残留风险。

**验证**：新增单测 `timeout_resets_subagent_streaming_state`（断言超时后 `is_streaming=false` 且 `aborted=false`，实例可复用）。`cargo test -p agent-commands subagent::` 9/9 通过；`cargo test -p agent-runtime agent::` 18/18 通过无回归。

## 迭代主题 7：子 Agent 委派深度限制（防递归委派膨胀）

> 决策点 7 曾记录"若未来需限制递归委派，可增加委派深度计数，超限返回错误。本迭代不实现"。本轮落实该扩展点：给 `SubAgentManager` 增加**最大委派深度**，防止子 Agent 复用主 Agent 工具总线后递归委派（孙 Agent）无限膨胀。

### 决策点 29：用 `tokio::task_local!` 在任务调用栈上跟踪委派深度，而非实例级计数

**背景**：子 Agent 复用主 Agent 的 `tool_bus`，因此也能看到 `delegate_to_sub_agent` / `list_sub_agents` 工具，理论上可递归委派（孙 Agent）。此前靠每个 `AgentLoop` 的 `max_iterations` 兜底，但 LLM 完全可能"迭代内无限递归委派"，撑爆调用栈/实例池。

**选择**：`SubAgentManager` 增加 `max_delegate_depth` 字段（默认 3，`with_max_delegate_depth` 可覆盖）。用 `tokio::task_local!` 定义 `DELEGATE_DEPTH: AtomicUsize`，在 `delegate` 入口通过 `try_with` 读当前深度并与上限比较，超限返回 `ToolError::Other`；委派子 Agent 时把 `agent.run(...)` 放入 `DELEGATE_DEPTH.scope(depth + 1, ...)` 执行，子 Agent 内再次委派即可读到递增后的深度。

**理由**：
- **任务本地存储天然匹配"递归调用"语义**：深度是"当前调用栈上嵌套了几层"这一**瞬时量**，随任务进出自动增/减，无需在 `SubAgentManager`/实例上维护计数器、也无需事后清理（`scope` 出栈自动还原）。若用实例级或管理器级计数器，多会话并发会互相污染，且需手动 decrement（易漏）。
- `try_with` 而非 `with`：顶层委派（主 Agent 直接调用，非 scope 内）未设置 `DELEGATE_DEPTH`，`try_with` 失败按 0 处理，避免 `with` panic。
- 深度检查放在 `delegate` **最入口**（先于规格查找）：即便规格未注册，递归委派也会先被深度拦截，且被拒委派不广播 `SubAgentStarted` 事件（不污染前端观测）。

**代价**：深度只在 `delegate` **显式调用链**内递增——若某条链路绕过 `delegate` 直接调 `agent.run`（本模块无此路径），深度不跟踪。当前所有子 Agent 执行都经 `delegate`，无遗漏。

### 决策点 30：默认 `max_delegate_depth = 3`（允许 3 层嵌套委派）

**选择**：默认 3。语义：主 Agent（depth 0）→ 子 Agent（1）→ 孙（2）→ 曾孙（3）→ 曾孙内再委派（depth 3 ≥ 3）被拒。

**理由**：3 层足够覆盖"主编排 → 专家 → 细分专家"的常见分层，同时阻断无意义的无限深挖掘；`with_max_delegate_depth` 允许调用方按需收紧（如沙箱场景设 1）。

**验证（2026-08-05）**：新增 3 个单测——`delegate_rejects_when_depth_at_limit`（手动 scope depth=3 应拒绝）、`delegate_allows_within_depth_limit`（depth=2 正常执行）、`delegate_respects_custom_max_depth`（自定义上限 1：depth=1 拒绝、depth=0 通过）。`cargo test -p agent-commands subagent::` 12/12 通过；agent-commands lib 25/25 无回归。此迭代为纯后端增强，零前端/部署改动。

## 迭代主题 8：前端流式输出（打字机效果）+ 消息区自动滚动

> 用户指示"这次看前端吧"。此前 `prompt` 是**一次性阻塞返回**（`send_message` 返回完整 `reply` 后才渲染），无打字机效果。本轮把 `genai_backend` 已广播的流式事件（`StreamStart/StreamDelta/StreamEnd`，Rust 侧早已存在）打通到前端，实现打字机效果，并补上打字机效果必需的消息区自动滚动跟随。

### 决策点 31：复用 Rust 既有 `AgentEvent::Stream*` 事件 + `agent:event:stream:{session_id}` 通道透传，而非新建流式通道

**背景**：`crates/agent-runtime/src/llm/genai_backend.rs` 在流式生成时已广播 `StreamStart/StreamDelta/StreamEnd`（含完整文本），经 `agent.rs` 的 `BackendEventBridge` 桥接到 AgentLoop 的 `EventBroadcaster`。但 Tauri 端 `TauriAgentEventEmitter::on_event` 只处理了 `DeepPhaseChanged`/`A2UI`/`SubAgent*`，**未处理 `OrchestratorEvent::Agent`**，导致前端收不到流式增量。

**选择**：在 `TauriAgentEventEmitter::on_event` 增加 `OrchestratorEvent::Agent(agent_event)` 分支，将 `StreamStart`→`{type:'start',model}`、`StreamDelta`→`{type:'delta',delta}`、`StreamEnd`→`{type:'end',fullText}`、`Error`→`{type:'error'}`、`AgentEnd`→`{type:'agent_end'}` 转发到 `agent:event:stream:{session_id}`；其余基础 Agent 事件（UserMessage/ToolCall*/A2UI）不在此通道转发。

**理由**：Rust 流式事件是**现成的唯一事实源**，前端只需补监听，不重复产生流式数据；`agent:event:{type}:{session_id}` 命名空间与既有 `deep_phase_changed`/`a2ui`/`subagent` 完全一致，监听器生命周期管理可复用同一模式。

### 决策点 32：`EMITTER_REGISTRY` 按会话复用 emitter，避免 `send_message` 重复订阅导致事件多播

**背景**：`send_message` 每次调用都 `agent.subscribe(emitter)`。虽 `EventBroadcaster::subscribe` 已按 `Arc::ptr_eq` 去重，但**每次新建 emitter 指针不同**，去重失效，导致前端重复收到同一 delta。

**选择**：新增 `static EMITTER_REGISTRY: OnceLock<StdMutex<HashMap<String, Arc<TauriAgentEventEmitter>>>>`，`send_message` 先查注册表，无则创建并 `subscribe`，有则复用。保证每会话仅订阅一次。

**理由**：按会话粒度复用 emitter 是"每会话一次订阅"的最直接实现；天然与 `deep_phase_changed`/`subagent` 等按会话索引的监听器生命周期对齐。

### 决策点 33：`send_message` 的注册表 MutexGuard 不跨 await 持有（future 非 Send 修复）

**实测修复**：初版在 `{ let mut registry = emitter_registry().lock(); ... agent.subscribe(...).await; registry.insert(...) }` 中，`MutexGuard` 跨 `await` 持有，`cargo check` 报 `future returned by send_message is not Send`。改为：先 `lock` 判断 `contains_key`（guard 随即释放）→ 在 guard 外 `agent.subscribe(...).await` → 重新 `lock` 用 `entry().or_insert()` 插入。消除跨 await 持有非 Send 锁句柄。

### 决策点 34：前端 `useAgentRust.ts` 新增流式状态与监听，`prompt` 的助手消息与流式消息去重

**选择**：新增 `RustStreamPayload` 联合类型、`streamingAssistant`/`lastStreamedMsg` 响应式状态、`setupStreamListener`/`teardownStreamListener`/`handleStreamEvent`/`upsertMsgInSession`，并接入 `newSession`/`deleteSession`/`switchSession`/`dispose` 生命周期。`prompt` 返回后：若已通过流式事件落地（`lastStreamedMsg` 非空），**复用该消息并以 `result.reply` 为最终权威内容**；否则（非流式后端）一次性创建助手消息。

**理由**：`StreamEnd` 携带完整文本，是比 delta 累积更权威的最终内容（避免截断/丢包）；`lastStreamedMsg` 标记"本回合已流式创建"，`prompt` 据此去重，不重复追加助手消息。

### 决策点 35：消息区「接近底部才跟随」的智能滚动，而非无条件置底

**背景**：打字机效果下消息内容实时变长，若滚动区不自动跟上，用户看不到实时输出；但若无条件置底，会打断用户上翻历史。

**选择**：`App.vue` 给 `.messages` 加 `ref` + `@scroll.passive`，维护 `followBottom`（`scrollHeight - scrollTop - clientHeight < 80` 时置 true）。watch 消息内容签名（`id + content.length` 拼接串）变化时，仅当 `followBottom` 为 true 才 `scrollToBottom`。

**理由**：用户在上翻（远离底部）时停止跟随，回到底部附近自动恢复；`@scroll.passive` 避免滚动阻塞；watch 用"内容签名"而非 deep watch，避免整数组深层遍历开销。

## 影响范围（迭代主题 8）
- `apps/tauri/src-tauri/src/commands.rs`：`TauriAgentEventEmitter` 新增 `OrchestratorEvent::Agent` 流式转发分支 + `EMITTER_REGISTRY` 会话级 emitter 复用 + `send_message` 多重锁不在 await 间持有。
- `crates/agent-runtime/src/event.rs`：`EventBroadcaster::subscribe` 按 `Arc::ptr_eq` 去重（既有，本轮复用）。
- `apps/tauri/src/agent/composables/useAgentRust.ts`：流式 payload 类型 + 状态 + 监听生命周期 + `prompt` 去重。
- `apps/tauri/src/App.vue`：消息区智能滚动跟随。

## 验证方式（迭代主题 8）
- `cargo check`（apps/tauri/src-tauri）：通过（修复决策点 33 后）。
- `npm run typecheck`（apps/tauri）：vue-tsc 通过。
- `npm run build`（apps/tauri）：vite build 通过（`✓ built in 6.63s`，仅既有 INEFFECTIVE_DYNAMIC_IMPORT/PLUGIN_TIMINGS 警告，非错误）。

> **备注**：打字机效果需真实 LLM 流式后端（`genai_backend`）运行于 Tauri 窗口内才能端到端观测；纯浏览器打开前端时 `invoke` 为 `undefined`（Tauri 运行时边界，非 bug）。编译链路（前端 typecheck + Rust cargo check）已闭环验证。

## 迭代主题 9：子 Agent 委派状态展示 UI 增强（分组统计 + 实时耗时 + 长错误展开）

> 承接迭代主题 4 的 `SubAgentSection.vue`（已具备 running/completed/error 三态展示）。本迭代补齐"委派进度感"与"信息可读性"：运行中条目增加实时耗时跳动、顶部增加分组统计徽标、过长错误信息支持展开/收起。

### 决策点 36：运行耗时用前端 `setInterval` 每秒刷新，而非依赖 Rust 事件流

**背景**：Rust 侧子 Agent 委派事件只有 `start`/`completed`/`error` 三态，`completed` 才带 `durationMs`，`running` 期间无任何进度/耗时推送。若要给运行中条目展示"已运行 X 秒"，需前端自行计时。

**选择**：`SubAgentSection.vue` 维护 `now = ref(Date.now())`，`onMounted` 启动 `setInterval(1s)` 刷新，`onBeforeUnmount` 清理。`elapsedLabel(startedAt)` 用 `now - startedAt` 计算实时耗时，模板仅对 `running` 条目渲染该动态值。

**理由**：纯前端展示层能力，不侵入 Rust 事件协议；每秒一次重渲染开销可忽略；`running` 条目的 `startedAt` 已在 `handleSubAgentEvent` 写入，无需新增字段。

### 决策点 37：顶部状态栏按三态分组统计，弱化视觉噪音

**选择**：列表非空时渲染一行 `bar`（标题 + 三个状态徽标：`运行中 N` / `完成 N` / `失败 N`），仅当对应计数 > 0 才显示。

**理由**：符合用户"弱提示优先"偏好——统计徽标用轻量 chip 而非强提示弹窗；一眼可知当前委派分布，且不打断消息流阅读。

### 决策点 38：过长错误信息默认两行截断 + 手动展开，而非全量堆叠

**选择**：错误文本超 120 字符时加 `-webkit-line-clamp: 2` 截断，并显示"展开/收起"按钮（`expanded` ref 按委派 id 记录状态）。

**理由**：委派失败堆栈可能很长，全量展示会挤压消息区；默认折叠保持列表紧凑，需要时再展开，兼顾可读性与信息完整。

## 影响范围（迭代主题 9）
- `apps/tauri/src/agent/components/SubAgentSection.vue`：新增 `now` 计时器 / 分组统计 `computed` / `expanded` 展开态；running 条目渲染实时耗时；error 条目超长可展开；顶部 `bar`。

## 验证方式（迭代主题 9）
- `npm run typecheck`（apps/tauri）：vue-tsc 通过（修复 filter 回调参数隐式 any：补 `SubAgentState` 类型导入与标注）。
- `cargo check -p worldsmith-tauri-app`（apps/tauri/src-tauri）：通过（承接迭代主题 8 的 Rust 改动，一并回归验证）。

## 迭代主题 10：子 Agent 规格 SQLite 持久化（重启不丢失）

> 子 Agent 规格注册表默认只在内存（`Arc<RwLock<Vec<SubAgentSpec>>>`），应用重启后用户在前端「子 Agent」标签页配置的规格会全部丢失。本轮把规格持久化到 SQLite，应用重启后自动加载，注册/删除写穿。

### 决策点 39：以 JSON 整条存规格，而非逐列拆字段

**背景**：`SubAgentSpec`（id/name/description/system_prompt/tools_whitelist/max_iterations）已 derive `Serialize/Deserialize`。持久化有两条路线：
- **A. 逐列拆字段**：`sub_agent_specs(id, name, description, system_prompt, tools_whitelist, max_iterations, ...)`。每次给 `SubAgentSpec` 增删字段都要跑一次 `ALTER TABLE` 迁移，且 `tools_whitelist`/`max_iterations` 是 Option/嵌套结构，需额外序列化。
- **B. JSON 整条存**：单表 `sub_agent_specs(id TEXT PK, spec_json TEXT, updated_at INTEGER)`，`spec_json` 存整条 `SubAgentSpec` 的 JSON。

**选择 B**。理由：`SubAgentSpec` 未来增删字段时**零 schema 迁移**——旧 JSON 反序列化缺字段走 serde 默认，新 JSON 直接入库；用 sqlx 0.8（与 agent-runtime 的可选 sqlite 特性对齐）。

### 决策点 40：存储层抽象为 `SubAgentSpecStore` trait，SQLite 实现返回 `Arc<Self>`

**选择**：定义 `SubAgentSpecStore` trait（`load_all`/`upsert`/`remove`），SQLite 实现 `SqliteSubAgentSpecStore`。`new(path)` 返回 `Arc<Self>`，用 WAL 日志模式（读写不互斥，适合"低频写 + 高频读"的规格注册表），`max_connections=5`；另提供 `new_in_memory()`（单测用，`max_connections=1` 保证同 Pool 内数据跨查询可见，模拟"重启后仍能读到"）。

**理由**：trait 抽象便于单测用内存实现验证业务逻辑、不经真实 DB；返回 `Arc<Self>` 让 `AgentCommandService` 直接持有 `Arc<dyn SubAgentSpecStore>` 共享引用。

### 决策点 41：持久化层可选（`Option<Arc<dyn SubAgentSpecStore>>`），`None` 保持纯内存

**选择**：`AgentCommandService` 新增 `subagent_store: Option<Arc<dyn SubAgentSpecStore>>`。构造提供两个入口：`default()`（`None`，行为与改造前完全一致，单测/无持久化场景）与 `with_subagent_store(store)`（`Some`，启动时 `load_all` 装入内存注册表）。

**理由**：不破坏既有构造路径；持久化是增强而非替换，纯内存模式零回归。

### 决策点 42：写穿缓存——先改内存注册表（释放锁）再写库，DB I/O 不阻塞读锁

**背景**：规格注册表是跨会话共享的 `Arc<RwLock<Vec<SubAgentSpec>>>`。若在持写锁的代码块内执行 DB I/O，写入慢时其他会话的读会被阻塞。

**选择**：`register_subagent_spec`/`remove_subagent_spec` 采用写穿模式：先在 `{ }` 作用域内改内存注册表（释放写锁），再在锁外执行 `store.upsert/remove`。DB 失败仅 `tracing::warn` 记录"仅内存生效"，不阻断主流程。

**理由**：DB I/O 是慢路径，不应阻塞高频读锁；写穿失败降级为纯内存，核心功能不受影响。

### 决策点 43：Tauri 在 `setup` 中初始化 SQLite，库文件放应用数据目录，用 `block_on` 安全初始化异步存储

**选择**：`apps/tauri/src-tauri/src/lib.rs` 的 `.setup(|app| ...)` 中：
1. `app.path().app_data_dir()` 定位应用数据目录，`create_dir_all` 确保存在。
2. `db_path = app_data.join("subagent_specs.db")`。
3. 用 `tauri::async_runtime::block_on` 包裹异步初始化（`SqliteSubAgentSpecStore::new` + `AgentCommandService::with_subagent_store`），成功后 `app.manage(svc)`。

**理由**：`setup` 是同步上下文，需 `block_on` 才能安全调用异步构造函数；库文件放应用数据目录（非临时目录）才能跨重启持久。

**代价**：`setup` 内的 `block_on` 会阻塞窗口首帧（初始化 DB + 建表极快，毫秒级，可接受）。若未来需要懒加载，可改为 `OnceLock` 延后到首个命令调用时初始化，本迭代不做。

## 影响范围（迭代主题 10）
- `crates/agent-commands/Cargo.toml`：新增 `sqlx`（sqlite + runtime-tokio）与 `tempfile`（dev）。
- `crates/agent-commands/src/subagent_store.rs`：`SubAgentSpecStore` trait + `SqliteSubAgentSpecStore` 实现 + 2 个单测。
- `crates/agent-commands/src/lib.rs`：`subagent_store` 字段 + `with_subagent_store` 构造 + 注册/删除写穿 + 持久化单测。
- `apps/tauri/src-tauri/src/lib.rs`：`setup` 初始化 SQLite 并注入服务。

## 验证方式（迭代主题 10）
- `cargo test --lib`（crates/agent-commands）：29/29 通过，含新增 `subagent_store::tests::upsert_load_remove_roundtrip`、`subagent_store::tests::persists_across_restart`、`tests::subagent_specs_persist_through_store`、`tests::remove_subagent_spec_persists_through_store`。
- `cargo check`（apps/tauri/src-tauri）：通过。
- `pnpm exec vue-tsc --noEmit`（apps/tauri）：通过（持久化对前端透明，命令层无改动）。

## 迭代主题 11：子 Agent 规格导出 / 导入（JSON 备份与跨机迁移）

> 承接迭代主题 10 的 SQLite 持久化。持久化解决了"重启不丢失"，但规格仍**绑定单机**——用户换机或想备份时无处导出。本迭代补齐**数据可移植性**：把全部规格导出为 JSON（备份/迁移），并从 JSON 恢复（按 id 覆盖）。

### 决策点 44：导出/导入走 JSON 数组字符串（`Vec<SubAgentSpec>`），pretty 打印便于人读

**选择**：`AgentCommandService` 新增：
- `export_subagent_specs() -> Result<String>`：`serde_json::to_string_pretty(&specs)`。
- `import_subagent_specs(json) -> Result<usize>`：先整数组反序列化（非法则整批拒绝、不写入任何规格），再逐条复用 `register_subagent_spec`（自动按 id 覆盖 + 写穿持久化），返回实际条数。

**理由**：
- 复用 `SubAgentSpec` 既有 `Serialize/Deserialize`，零新 DTO；数组格式与 `list_subagent_specs` 的返回结构一致，导出/导入天然对称。
- pretty 打印让导出文件可读、可手动 diff，符合"备份"定位。
- 导入先整体反序列化再逐条落库——JSON 非法时**整批拒绝**（原子性），避免"解析到一半写入一部分"的脏状态。

### 决策点 45：前端用 textarea 弹窗交互，不引入 `plugin-fs` 新依赖

**背景**：Tauri 前端已有 `@tauri-apps/plugin-dialog`，但**无 `plugin-fs`**（写文件/读文件需 fs 插件）。跨平台可靠的"保存到文件/从文件读"需新增 `plugin-fs` 依赖并改 capability 配置。

**选择**：不新增依赖，用弹窗 + textarea 完成交换：
- **导出**：拉取 JSON 填入只读 textarea，提供「复制」按钮（`navigator.clipboard.writeText`），用户自行保存。
- **导入**：textarea 粘贴 JSON，点「导入」执行，成功后提示条数并刷新列表。

**理由**：零新增依赖（符合协作规则"新增依赖需确认"；用户已放开权限但引入 fs 插件会改 Cargo.toml + package.json + capability，收益有限）；JSON 文本量小，剪贴板交换已满足备份/迁移主场景；交互与「代码助手模板」等既有轻量模式一致。

**代价**：没有"一键另存为 .json 文件"的原生文件对话框，需用户手动复制/粘贴。若未来需要原生文件 I/O，可作为独立迭代引入 `plugin-fs`。

### 决策点 46：导入按 id 覆盖，与 `register_subagent_spec` 语义一致

**选择**：`import_subagent_specs` 逐条调用 `register_subagent_spec`，因此导入同 id 规格时**覆盖**既有定义（不追加、不产生重复项），与手工逐条注册行为完全一致。

**理由**：避免"导入后出现重复规格"的直觉违和；跨机迁移时目标机已有同 id 规格应被新配置替换，覆盖语义正确。

## 影响范围（迭代主题 11）
- `crates/agent-commands/src/lib.rs`：新增 `export_subagent_specs` / `import_subagent_specs` + 3 个单测（roundtrip / 同名覆盖 / 非法 JSON 拒绝）。
- `apps/tauri/src-tauri/src/commands.rs` + `lib.rs`：新增 `subagent_export_specs` / `subagent_import_specs` 命令并注册。
- `apps/tauri/src/subagent/composables/useSubagentRust.ts`：新增 `exportSpecs` / `importSpecs`。
- `apps/tauri/src/subagent/components/SubAgentView.vue`：头部「导入/导出」按钮 + 弹窗（复制 / 粘贴 / 导入）。

## 验证方式（迭代主题 11）
- `cargo test --lib`（crates/agent-commands）：32/32 通过（新增 3 个导出/导入用例）。
- `cargo build`（apps/tauri/src-tauri）：通过（新增 2 命令）。
- `npx vue-tsc --noEmit`（apps/tauri）：通过（修复模板转义引号占位符导致的 TS1005）。

## 迭代主题 12：子 Agent 预设规格模板（一键预填常用专长）

> 承接迭代主题 2 的「代码助手模板」按钮。当时决策点 11 约定"预设规格由前端预填表单，不写死在后端"。本轮把单一模板扩展为**多模板菜单**，让用户能一键预填代码 / 写作 / 数据分析 / 终端沙箱四类常用子 Agent，再按需微调保存，降低从零配置成本。

### 决策点 47：模板定义抽到独立 `templates.ts`，前端渲染下拉菜单，不写死在后端

**背景**：列表页此前只有 `fillCoderTemplate()` 一个硬编码模板函数。要支持多模板，若继续在 `.vue` 内堆函数会膨胀且难维护。

**选择**：
- 新建 `apps/tauri/src/subagent/templates.ts`，导出 `subagentTemplates: SubAgentTemplate[]`（`label` / `hint` / `spec`），内置 4 个模板：`coder` 代码助手、`writer` 写作助手、`analyst` 数据分析助手、`sandbox` 终端沙箱（含 `tools_whitelist` 终端工具白名单）。
- `SubAgentView.vue` 右上角「模板」按钮展开下拉菜单，点击 `loadTemplate(t)` 将模板 `spec` 预填进表单。
- 模板**只在前端预填**，不改后端任何代码——保持后端零默认规格、纯由用户注册（与决策点 11 一致）。

**理由**：
- 数据与视图分离：模板定义独立成模块，新增模板只需往数组追加一项，UI 自动渲染，无需改组件逻辑。
- 符合协作规则"新增依赖需确认"——此方案零新增依赖、零后端改动、纯前端增强。
- `sandbox` 模板复用既有 `WhitelistToolBus`（决策点 14/15）已验证的工具隔离能力，用户可一键配置"受限终端"子 Agent。

**代价**：模板 id 是"建议默认值"，用户可改动；若与现有规格同 id，保存时按 id 覆盖（正常语义）。下拉菜单需点击外部关闭（已用全局 `click` 监听 + `tplWrapRef.contains` 实现，`onBeforeUnmount` 清理）。

## 验证方式（迭代主题 12）
- `npx vue-tsc --noEmit`（apps/tauri）：通过（含新增 `templates.ts` 与下拉/点击外部逻辑）。
- 后端零改动，agent-commands 32/32、tauri `cargo check` 基线保持绿色。

## 迭代主题 13：子 Agent 规格后端校验（阻止非法规格进入注册表）

> 导出/导入功能（迭代 11）上线后，导入 JSON 是外部输入，若含空 id / 空字段 / `max_iterations=0` 等非法值，会直接进入注册表并写穿 SQLite，污染共享配置。本轮在后端做**统一校验**。

### 决策点 48：新增公开 `validate_subagent_spec`，不改 `register_subagent_spec` 签名

**背景**：`register_subagent_spec` 被 ~10 处测试及内部调用直接使用，若给其加返回值连累大量调用方。

**选择**：
- 在 `agent-commands` 新增**模块级公开函数** `validate_subagent_spec(&SubAgentSpec) -> Result<(), String>`，两个入口调用：
  - 命令层 `subagent_register_spec`（`apps/tauri/src-tauri/commands.rs`）——注册前先校验，非法直接返回 `Result<(), String>` 错误透传前端。
  - 批量导入 `import_subagent_specs`——**先整体校验、再逐个写入**，保持原子性（任一非法即整体拒绝，不产生部分导入）。
- `register_subagent_spec` 签名与行为不变（内部视为"已校验过的合法输入"），避免破坏既有测试。

**校验规则**：
- `id`：非空、≤64 字符、仅允许字母/数字/`_`/`-`。
- `name` / `description` / `system_prompt`：均非空（trim 后）。
- `max_iterations`：若为 `Some(0)` 非法（迭代次数至少 1）。
- `tools_whitelist`：不能含空名称。

**理由**：
- 校验集中在服务层，命令层与批量导入复用同一规则，避免两处逻辑漂移。
- 错误信息用中文、可读，直接作为前端 `formError` / `ioMsg` 展示，无需前端二次翻译。
- 原子导入保证"要么全成功、要么全不写"，防止导入一半后用户发现某条非法、不得不手动清理。

**代价**：`register_subagent_spec` 本身仍不校验（内部调用方负责先校验），属于"约定优于强制"；若未来内部也直接接收外部输入，可再把校验下沉。

## 迭代主题 14：子 Agent 规格单条复制（复用单个子 Agent）

> 迭代 11 提供"全部导出"，但用户常只想分享/复用**某一个**子 Agent 规格。本轮在列表项增加「复制」按钮，把单条规格序列化为 JSON 写入剪贴板。

### 决策点 49：列表项悬浮按钮组「复制 + 删除」，复制写入完整 JSON

**选择**：
- 列表项原仅「删除」按钮，本轮包一层 `.spec-actions`，新增「复制」按钮（均悬浮显示，复制用蓝色、删除用红色）。
- `copySpec(spec)` 用 `navigator.clipboard.writeText(JSON.stringify(spec, null, 2))` 写入单条规格完整 JSON。
- 反馈用列表区瞬态提示 `listMsg`（绿色小条，显示"已复制「名称」的规格 JSON"），不侵入右侧表单错误区。

**理由**：
- 复用现有 `navigator.clipboard`（导出弹窗「复制」已在用），零新增依赖。
- 复制单条比"全部导出再裁剪"更贴合"复用单个子 Agent"的常见诉求。
- 弱提示（瞬态绿色小条）符合用户偏好的"弱提示优于强提示"。

**代价**：剪贴板权限在 Tauri WebView 中通常可用；若某环境拒绝，`listMsg` 会显示错误并以红色样式兜底（当前实现仅显示文本，未区分颜色——截图/可用性足够，暂不强分）。

## 迭代主题 15：子 Agent 实例管理（查看 / 清空累积上下文）

> 承接迭代主题 2/4。主 Agent 有 `clear_agent_pool` 重置上下文，但子 Agent 实例在池中**跨委派累积上下文**，此前无任何方式查看/重置——一个行为异常或上下文膨胀的子 Agent 会一直"带病"复用下去。本轮补齐：查看实例池状态 + 清空单个/全部实例。

### 决策点 50：`SubAgentManager` 新增 `list_instances` / `clear_instance` / `clear_instances`，实例池对外暴露
**选择**：新增 `SubAgentInstanceInfo`（`sub_agent_id` / `name` / `message_count` / `is_streaming`）供查询返回；`clear_instance(id) -> bool`（移除单个，不存在返回 false）、`clear_instances() -> usize`（清空全部，返回数量）。清空即从 `agents: RwLock<HashMap>` 移除，下次委派按最新规格懒加载重建（全新上下文）。
**理由**：实例池本就是 `RwLock<HashMap>`，`remove`/`clear` 是最小改动；`message_count` 用 `agent.get_runtime_messages().len()` 展示累积规模、`is_streaming` 标记流式占用，帮助用户判断"哪些实例该清"。

### 决策点 51：`list_instances` 先收集快照、释放读锁后再查询消息数，避免持锁 await 阻塞写锁
**实测发现**：初版在 `read().await` 块内逐实例 `get_runtime_messages().await`，读锁长时间不释放，会阻塞 `get_or_create_agent`/`clear_*` 的写锁路径（`delegate` 卡在 Double-check 处）。
**选择**：先 `{ let agents = read().await; ... 收集 (id,name,Arc<AgentLoop>) ... }` 释放读锁，再在锁外逐个查询消息数/流式状态。
**理由**：消除"读锁内 await 阻塞写锁"的潜在死锁窗口；快照阶段只克隆 `Arc`（零拷贝），代价可忽略。

### 决策点 52：服务级按会话隔离实例池（`subagent_managers: Mutex<HashMap<session_id, Arc<SubAgentManager>>>`），清空/列出以会话为边界
**选择**：`AgentCommandService` 新增 `subagent_managers`，`new_agent` 创建会话时把 `SubAgentManager` 存入；`list_subagent_instances(session_id)` / `clear_subagent_instances(session_id)` 从该表取管理器再操作；`delete_session` 时同步移除条目。
**理由**：子 Agent 实例按会话隔离（不同会话各自累积上下文），操作必须限定在本会话；`delete_session` 清理由既有的 `subagent_managers.remove` 承接，无泄漏。

### 决策点 53：前端复用 `useAgentRust.currentSessionId` 定位当前会话，实例管理区只在有会话时可用
**选择**：`SubAgentView.vue` 新增「子 Agent 实例」区，`hasSession()` 判断 `agent.currentSessionId?.value`：无会话则提示"先创建会话"并禁用清空按钮；有会话则 `refreshInstances(sid)` 拉取、`clearInstances(sid)` 清空（`confirm` 二次确认）。
**理由**：实例操作强依赖会话，前端必须知道当前会话 id；`useAgentRust` 已维护 `currentSessionId`，直接复用避免重复维护会话状态。

## 影响范围（迭代主题 15）
- `crates/agent-commands/src/subagent.rs`：`SubAgentInstanceInfo` + `list_instances`/`clear_instance`/`clear_instances` + 3 个单测。
- `crates/agent-commands/src/lib.rs`：`subagent_managers` 会话隔离 + `list_subagent_instances`/`clear_subagent_instances` + `delete_session` 清理 + 导出类型 + 单测。
- `apps/tauri/src-tauri/src/commands.rs` + `lib.rs`：`subagent_list_instances` / `subagent_clear_instances` 命令。
- `apps/tauri/src/subagent/composables/useSubagentRust.ts`：`SubAgentInstanceInfo` + `instances`/`instancesBusy`/`instanceMsg` + `refreshInstances`/`clearInstances`。
- `apps/tauri/src/subagent/components/SubAgentView.vue`：实例管理 UI（列表 / 流式徽章 / 清空按钮 / 空态与无会话提示）。

## 验证方式（迭代主题 15）
- `cargo test --lib`（crates/agent-commands）：41/41 通过（含 `list_instances_after_delegate` / `clear_instance_removes_single` / `clear_instances_removes_all` / `subagent_instances_empty_until_delegation` / `subagent_instances_guard_requires_existing_session` / `delete_session_removes_subagent_manager`）。
- `cargo check`（apps/tauri/src-tauri）：通过。
- `npx vue-tsc --noEmit`（apps/tauri）：通过。

## 迭代主题 16：主对话「思考级别（深度模式）」选择器

> 承接路线图「待办」中的「深度模式」缺口。Rust 侧 `update_thinking_level` 命令与前端 `useAgentRust.updateThinkingLevel` 已实现，但整个对话 UI **没有任何控件**能触发它——思考级别能力"有 API 无入口"，用户无法在界面切换深度模式。本轮补齐对话页头部选择器。

### 决策点 54：composable 新增响应式 `thinkingLevel` 状态，成功更新后同步本地值
**选择**：`useAgentRust` 新增 `thinkingLevel = ref<ThinkingLevel>('off')`，`updateThinkingLevel` 在 `invoke` 成功后同步 `thinkingLevel.value = level`；并在返回对象中导出 `thinkingLevel`。
**理由**：选择器需要展示"当前级别"，此前无任何状态可读。同步用"成功后回写"而非"乐观更新"——只有 Rust 确认成功才更新，避免界面显示与后端实际不一致。

### 决策点 55：对话页头部用原生 `<select>` 呈现思考级别，流式发送期间禁用
**选择**：在 `App.vue` 的 `chat-header` 右侧新增「思考级别」下拉（off→关闭 / minimal→极简 / low→低 / medium→中 / high→高 / xhigh→极高），`@change` 调 `backend.updateThinkingLevel(level)`；`sending` 或 `isStreaming` 时禁用。
**理由**：思考级别是会话级配置，放头部最直观；原生 `<select>` 零依赖、语义清晰，符合本项目"不新增依赖"的取向。流式中禁用避免运行期改配置导致状态漂移。

## 影响范围（迭代主题 16）
- `apps/tauri/src/agent/composables/useAgentRust.ts`：`thinkingLevel` ref + `updateThinkingLevel` 同步 + 返回对象导出。
- `apps/tauri/src/App.vue`：chat-header 新增思考级别 `<select>` + `onThinkingLevelChange` 处理 + 样式。

## 验证方式（迭代主题 16）
- `npx vue-tsc --noEmit`（apps/tauri）：通过。

## 迭代主题 17：对话侧边栏会话管理 UI（新建 / 删除会话）

> 承接迭代主题 16 的"有 API 无入口"模式。`newSession`/`deleteSession` 命令与 `useAgentRust` 封装早已实现，但对话侧边栏**没有任何控件**能触发它们——会话只能由 `onMounted` 自动建一个，`deleteSession` 完全无法在 UI 触发。本轮补齐会话管理的用户侧入口。

### 决策点 56：侧边栏头部加「新建会话」按钮，接入 `newSession`
**选择**：`sidebar` 顶部新增 `.sidebar-head`（标题 + 「＋ 新建」按钮），`onNewSession` 调 `backend.newSession('WorldSmith 桌面端测试助手')`（与 `onMounted` 自动建会话用同一签名）。
**理由**：会话是"多会话并行"的基础，必须能手动开新会话；复用既有 `newSession` 命令，零后端改动。

### 决策点 57：每条会话项改为「切换按钮撑满 + 删除按钮右对齐」，删除按钮悬浮显现
**选择**：会话项由 `li @click` 整体可点改为内部两个独立按钮——`.session-switch`（`flex:1` 撑满，点击切换）+ `.session-del`（`×`，默认 `opacity:0`，`li:hover` 时显现，hover 变红）。`onDeleteSession(id)` 调 `backend.deleteSession(id)`。
**理由**：**避免点击删除误触切换**（删除按钮若在 `li` 内，冒泡会先触发 `switchSession`，删除后还可能切到已删会话）；删除是破坏性操作，默认隐藏、hover 显现符合用户"弱提示优于强提示"偏好，降低误删率。

**代价**：`deleteSession` 删除当前会话时会把 `currentSessionId` 置 null、清空本地消息（既有行为），用户需重新新建/切换；删除无二次确认（会话 id 为短 hash，误删影响小，且列表继续展示剩余会话，符合极简取向）。

### 决策点 58：清理 `useAgentRust.ts` 第 276 行过期 TODO 注释
**选择**：会话消息缓存（`sessionMessagesCache`）其实早已完整实现（`newSession`/`switchSession`/`deleteSession`/`prompt`/`handleStreamEvent`/`upsertMsgInSession` 全部接入），原"待办：会话消息缓存"注释为过期残留，改为描述性注释。
**理由**：避免后来者误以为该能力缺失而重复实现；与代码实际状态对齐。

## 影响范围（迭代主题 17）
- `apps/tauri/src/App.vue`：`onNewSession`/`onDeleteSession` 处理函数 + 侧边栏「新建」按钮 + 会话项拆分（切换/删除）+ 样式。
- `apps/tauri/src/agent/composables/useAgentRust.ts`：过期 TODO 注释修正（无逻辑改动）。

## 验证方式（迭代主题 17）
- `npx vue-tsc --noEmit`（apps/tauri）：通过。
- 后端零改动，agent-commands / tauri `cargo check` 基线保持绿色。

---

## 迭代主题 18：对话输入/控制区补齐（停止生成 + 清空对话）

> 承接迭代主题 16/17 的"有 API 无入口"模式。`abort`（中断生成）与 `clearHistory`（清空历史）命令与 `useAgentRust` 封装早已实现，但对话区**没有任何控件**能触发——生成中只能干等 ReAct 循环跑完（`sending` 期间发送按钮禁用，无取消路径），也无法一键清空当前对话。本轮补齐对话控制入口。

### 决策点 59：输入栏发送按钮在生成中切换为「停止」按钮，接入 `abort`
**选择**：`input-bar` 的发送按钮在 `sending || backend.isStreaming` 时文案变为「停止」、样式切换为危险色，`@click` 改调 `onStop`（`backend.abort()`）；生成结束后恢复「发送」。`onStop` 内 try/catch 捕获错误写入 `error`。
**理由**：`abort` 是控制面最关键的"后悔药"——ReAct 多轮工具循环可能很长，用户需要随时中断；复用既有 `backend.abort()`（内部已把 `isStreaming` 置 false），零后端改动。发送/停止共用一个按钮位，避免在极简输入栏多塞一个按钮，符合用户"极简 + 弱提示"偏好。

### 决策点 60：对话头部新增「清空」按钮，接入 `clearHistory`，无消息时禁用
**选择**：`chat-header` 的 `.header-actions` 中新增「清空」文字按钮，`:disabled="backend.messages.length === 0"`，`@click="onClear"` 调 `backend.clearHistory()`。
**理由**：`clearHistory` 已实现但无入口；清空是低频但必要的操作，头部放文字按钮不占输入栏空间。`disabled` 空态弱化提示，符合"弱提示"偏好。**不改动 `currentSessionId`**——清空仅重置该会话消息，会话仍保留，与 Rust `clear_history` 语义一致。

### 代价（迭代主题 18）
- 「停止」仅中止当前 `run` 的循环（`abort` 语义），不重置已产生的消息；上一轮的流式内容保留在消息区，属预期行为。
- 清空对话无二次确认（复用迭代主题 17 的取舍：极简取向，误清影响可视、可重发），本轮不引入 confirm 弹窗。

## 影响范围（迭代主题 18）
- `apps/tauri/src/App.vue`：`onStop`/`onClear` 处理函数 + 输入栏发送/停止切换 + 头部「清空」按钮 + 样式。
- 后端零改动，`useAgentRust.ts` 零改动（`abort`/`clearHistory` 已暴露）。

## 验证方式（迭代主题 18）
- `npx vue-tsc --noEmit`（apps/tauri）：通过。
- 后端零改动，agent-commands / tauri `cargo check` 基线保持绿色。

---

## 迭代主题 19：模型配置弹窗（热切换 Provider / 模型，补 `updateModel`/`setProviderConfig` 入口）

> 延续"有 API 无入口"模式。`updateModel`/`setProviderConfig`/`getProviderConfig` 命令与 `useAgentRust` 封装早已实现，但对话区**没有任何控件**能切换模型——当前界面只能看到 `chat-header` 的"思考级别"，无法更换 Provider/模型/API Key。本轮补上模型配置的用户侧入口。

### 决策点 61：对话头部「模型」按钮 + 独立 `ModelSettingsDialog.vue` 弹窗
**选择**：`chat-header` 的 `.header-actions` 新增「模型」按钮，点击打开 `ModelSettingsDialog`（Teleport + Transition + overlay，复用 `ExportCorrectorDialog` 的既有弹窗模式，不引第三方 Modal 库）。弹窗内展示三模式（cloud/local/custom）切换单选框 + 对应字段表单 + 保存。
**理由**：模型配置字段多（三模式字段各异），放头部下拉会过长；独立弹窗聚焦、不占布局。复用现成 Teleport+overlay 模式，零新依赖，符合"极简 + 弱提示"。

### 决策点 62：模式切换用单选框，字段按模式条件渲染；API Key 存前端 localStorage
**选择**：模式用原生 `<select>`（cloud/local/custom）或 radio 二选一——因字段差异大，选 **radio**（视觉更直观，三选项并列）。字段按 `mode` 条件渲染：
- cloud：Provider（文本）+ model_id + api_key
- local：endpoint + api_type（ollama/lm-studio/vllm/llama-cpp）+ model_id
- custom：base_url + api_type（openai-compatible/anthropic-compatible）+ model_id + api_key + context_window + max_tokens
`api_key` 因 Rust `skip_serializing` 不回显，前端用 `localStorage` 按 `worldsmith:api_key:{provider}` 键持久化，打开弹窗时回填。
**理由**：`ProviderConfig` 是 tagged enum（`mode` 区分），字段必须按模式拼装 payload；`api_key` 反序列化必需但 Rust 不回显，只能前端本地存。

### 决策点 63：保存时按模式构造 `RustProviderConfigFull` 调 `setProviderConfig`；打开时用 `getProviderConfig` 回填当前
**选择**：保存 → `backend.setProviderConfig({ mode, ...模式字段 })`；打开弹窗 → `backend.getProviderConfig()` 回填 `provider`/`model`/`base_url`（若返回非空）。同步 `chat-header` 上用 `ref` 显示当前 `provider/model`。
**理由**：`setProviderConfig` 支持跨模式切换且不清空历史（文档明示），是三模式热切换的正门；`getProviderConfig` 回显真实运行配置（Phase 5.4 语义），避免 UI 显示与后端脱节。

### 代价（迭代主题 19）
- 当前为 Mock 后端，`getProviderConfig` 可能返回默认占位配置，回填不精确；真实 LLM 热切换需接入真实 Provider 后验证（记录待办，不阻塞 UI 交付）。
- `api_key` 明文存 localStorage（前端既有模式，非本项目新增风险）；`context_window`/`max_tokens` 仅 custom 模式可配，cloud/local 用 Rust 默认值。

## 影响范围（迭代主题 19）
- `apps/tauri/src/agent/components/ModelSettingsDialog.vue`：**新增**弹窗组件（三模式表单 + 保存）。
- `apps/tauri/src/App.vue`：`.header-actions` 加「模型」按钮 + 当前模型显示 + 打开弹窗状态。
- `useAgentRust.ts`：零改动（`setProviderConfig`/`getProviderConfig` 已暴露）。

## 验证方式（迭代主题 19）
- `npx vue-tsc --noEmit`（apps/tauri）：通过。
- 后端零改动，agent-commands / tauri `cargo check` 基线保持绿色。
- 浏览器实测：弹窗开合、三模式切换、字段编辑、保存调 `set_provider_config` 无报错（真实 LLM 验证待接入 Provider 后）。

---

## 迭代主题 20：中途引导（steer）UI 入口，补 `steer`/`followUp` 无控件

> 延续"有 API 无入口"模式。`steer`/`followUp` 命令与 `useAgentRust` 封装早已实现（`steer` 把文本写入 backend 的 `steer_buffer`，**下轮 prompt 时附加为前置 user 消息**），但对话区**没有任何控件**能触发——生成中用户只能「停止」，无法低成本纠正方向。本轮补上中途引导的输入侧入口。

### 决策点 64：生成中输入框可输入引导 + 右侧「引导」/「停止」双按钮
**选择**：`input-bar` 在生成中（`sending || backend.isStreaming`）时，输入框**不禁用**（允许输入引导词），右侧按钮区变为「引导」+「停止」双按钮；空闲时恢复「发送」单按钮。回车在生成中触发「引导」、空闲触发「发送」。
- 「引导」：`:disabled="!input.trim()"`，点击 `onSteer` → `backend.steer(text)`，清空输入，状态栏短时显示弱提示"引导已记录，本轮结束后生效"。
- 「停止」：保留 `onStop` → `backend.abort()`。
**理由**：steer 是"缓冲下轮生效"而非即时中断，需在生成中让用户能输入引导词。双按钮分离「纠正方向（steer）」与「硬中断（abort）」两种意图；弱提示明确"下轮生效"语义，避免用户误以为引导即时打断了当前轮。输入框不禁用是唯一改动点，极简不变。

### 决策点 65：引导反馈用状态栏弱提示，不引入弹窗/气泡
**选择**：`onSteer` 成功后置 `steered` ref 并在 `.status` 位置短暂显示"引导已记录…"，2.5s 后自动清除；不引入 confirm 或 toast 组件。
**理由**：steer 是低频、无破坏性的软操作，弱提示足够；复用状态栏既有位置，零新依赖，符合"极简 + 弱提示"偏好。误引导不影响当前轮，可下次发送即时纠正，无需二次确认。

### 代价（迭代主题 20）
- steer 语义为"下轮生效"，本轮内点「引导」不会有即时反馈（期望行为，弱提示已说明）。
- Mock 后端下 `steer` 仅入 buffer，无可见效果；真实 LLM 接入后验证"前置 user 消息"透传（记录待办，不阻塞 UI 交付）。
- 生成中输入框不禁用后，若用户误输入并回车在生成中会触发「引导」而非「发送」——引导语义可接受，且生成中 send 本就被 `sending` 拦截，无行为冲突。

## 影响范围（迭代主题 20）
- `apps/tauri/src/App.vue`：`onSteer` 处理 + 输入栏双按钮态 + 回车分流 + 弱提示状态。
- 后端零改动，`useAgentRust.ts` 零改动（`steer`/`followUp` 已暴露）。

## 验证方式（迭代主题 20）
- `npx vue-tsc --noEmit`（apps/tauri）：通过。
- 后端零改动，agent-commands / tauri `cargo check` 基线保持绿色。
- 浏览器实测：空闲「发送」/ 生成「引导+停止」切换、引导输入+回车、弱提示出现与自动消失（真实 LLM 待接入后验证下轮透传）。