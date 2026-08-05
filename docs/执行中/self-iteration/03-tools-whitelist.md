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

