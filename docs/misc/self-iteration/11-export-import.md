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
