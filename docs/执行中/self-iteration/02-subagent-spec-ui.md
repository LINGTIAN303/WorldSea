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

