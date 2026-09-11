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
- `cargo check -p worldsea-tauri-app`（apps/tauri/src-tauri）：通过（承接迭代主题 8 的 Rust 改动，一并回归验证）。

