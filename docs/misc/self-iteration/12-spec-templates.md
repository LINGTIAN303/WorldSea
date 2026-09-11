
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

