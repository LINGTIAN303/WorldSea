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

