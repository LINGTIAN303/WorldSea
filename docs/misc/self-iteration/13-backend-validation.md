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
