# Tauri HTTP 桥接层（临时·开发验证用）范围与移除契约

> 状态：临时启用 · 2026-08-20
> 目的：让**浏览器（vite dev）直连 Tauri 进程内的真实 Rust 后端**，实现真实调试/测试/验证与持续开发。
> **本质**：HTTP 服务跑在 Tauri 进程内（桌面窗口照常），浏览器经 `POST /rpc` 调命令、`GET /events`(SSE) 收事件。
> 桌面端（Tauri IPC）行为**零改动**；浏览器仅在「非 Tauri 且配置了后端地址」时切到 HTTP。
> ⚠️ 这是**临时方案**。达到目的后由用户指示移除，本文档提供精确移除清单。

---

## 1. 机制

```
┌─ 浏览器（vite dev）──┐        ┌─ Tauri 桌面进程 ──────────────────────┐
│ transport.ts          │  HTTP  │ axum server (127.0.0.1:8787)          │
│  invoke → POST /rpc   │───────▶│  POST /rpc {cmd,args} → 调命令 fn      │
│  listen → EventSource │        │  GET  /events (SSE) ← 全局事件广播 hub  │
└───────────────────────┘        │  （桌面窗口仍走 Tauri IPC，不变）        │
                                 └──────────────────────────────────────────┘
```

- **命令调用**：RPC handler 用 `app.state::<X>()` 取 managed state，直接调用 `#[tauri::command]` 函数（`app` 参数传 `app.clone()`）。
- **命名参数约定**：桌面命令签名为 `params: SomeStruct` 时（如 `send_message`/`update_model`），前端 invoke 用 `{ params: {...} }` 包裹；RPC handler 反序列化前先经 `unwrap_params` 解包（见 `rpc.rs`），保持桌面/HTTP 双端一致。
- **事件**：commands.rs 的 4 个发射 funnel（`TauriAgentEventEmitter`/`emit_orch`/`emit_orch_supervisor`/`emit_orch_multi`）额外向全局 `EVENT_HUB`（`tokio::sync::broadcast`）发布一份；SSE handler 订阅推送。桌面端原有 `app.emit` 保留（多发一份到 hub 无害）。
- **前端切换**：浏览器模式（无 `__TAURI_INTERNALS__`）且配置了后端地址（`localStorage['worldsmith_backend_url']` 或 `VITE_BACKEND_URL`，默认 `http://127.0.0.1:8787`）→ 走 HTTP；否则回退原 `mockInvoke`。桌面端不变。

## 2. 边界（明确「完整」的范围）

### 2.1 已桥接（Agent 产品面核心 · 2026-08-20 已编译通过）

**会话/场景**：new_session / list_scenarios / list_sessions / delete_session / update_session_title / set_session_pinned / set_session_router_enabled
**对话主链路**：send_message / abort / steer / clear_history / trim_context / get_state / get_messages / is_streaming / get_heartbeat
**模型/供应商/安全**：update_model / update_thinking_level / get_provider_config / set_provider_config / set_api_key_pool / cmd_agent_confirm / cmd_agent_set_security_level
**编排**：orchestrator_run_plan / orchestrator_run_tot / orchestrator_run_got / orchestrator_run_supervisor / orchestrator_run_multi
**记忆**：memory_list / memory_recall / memory_archive / memory_load_chunk / memory_boundary
**终端**：terminal_execute_command / terminal_detect_shells / terminal_create_session / terminal_exec_session / terminal_input_session / terminal_destroy_session / terminal_list_sessions

> 以上覆盖「浏览器真实对话 + 编排 + 记忆 + 终端」核心闭环。注册模式见 `http_bridge/rpc.rs`（`app.state::<X>()` + 直接调命令 fn），补注册其余命令只需照抄模式加 handler。

### 2.2 已补齐（2026-08-20 第二批，编译通过）

router_create / router_route / router_set_targets / router_get_state / router_list_sessions / router_destroy
subagent_list_specs / subagent_register_spec / subagent_remove_spec / subagent_export_specs / subagent_import_specs / subagent_list_instances / subagent_clear_instance / subagent_clear_instances
cmd_loop_control_create / check / record_turn / record_tool_call / record_tokens / update_activity / reset_counters / get_config / get_status / destroy / list_tasks
cmd_long_task_save / load / list_running / list_all / update_heartbeat / update_status / delete
cmd_secure_store / cmd_secure_load / cmd_secure_delete
set_search_config
create_group_session_participant / list_group_session_participants / delete_group_session_participants
cmd_agent_tool_result / cmd_diag_log
entity·relation·kv·file 全命令（cmd_get/put/update/delete/import/clear + kv_* + file_*，共 28 个）

### 2.4 已实现（2026-08-20 第三批：cmd_algo_* 真实 Rust 命令）

此前 cmd_algo_* 在 Rust 端从未注册（mindmap 一直走 JS 降级）。本批新增 `src-tauri/src/algo_commands.rs`
薄封装 worldsmith-core::algo::graph 算法，注册 lib.rs invoke_handler + rpc.rs：
cmd_algo_force_layout / radial_layout / tree_layout / grid_layout / layout_unified（MindmapTree）/ dijkstra_path / connected_components / pagerank / community_detection（Louvain）
tauri app Cargo.toml 新增 `worldsmith-core = { path = "../../../worldsmith-core" }`（默认 features，无 wasm）。
浏览器实测 9 命令全部 ok:true（connected_components 返回真实分量、force_layout 收敛 26 轮等）。

> ⚠️ workflow_*（workflowApi.ts 28 命令）在 Rust 端从未实现，属未建功能（worldsmith-core 仅 parser/validator/storage，
> 无 executor/runs/dispatch 命令层），保持现状待单独规划；transcribe_media 属桌面-only 不桥接。

### 2.3 不桥接（纯桌面 OS 集成，浏览器无意义）

tray / system(notify/autostart) / whisper(转录) / fs_watch(原生文件监听) / cmd_diag_log。HTTP 模式下返回「desktop-only」错误。

## 3. 新增文件（移除时直接删）

| 文件 | 作用 |
|---|---|
| `apps/tauri/src-tauri/src/http_bridge/mod.rs` | axum server 装配 + `/rpc` + `/events`(SSE) |
| `apps/tauri/src-tauri/src/http_bridge/events.rs` | 全局 `EVENT_HUB`（broadcast）+ `publish` |
| `apps/tauri/src-tauri/src/http_bridge/rpc.rs` | 命令注册表（`HashMap<&str, RpcHandler>`）+ RPC 分发 |
| `apps/tauri/src/agent/composables/transport.ts` | 前端 transport：`invokeRpc` / `listenSse` / 地址解析 |
| `docs/details/注释/tauri/http-bridge-scope.md` | 本文档（移除后一并删除） |

## 4. 修改文件（移除时按 `// [HTTP-BRIDGE]` 标记还原/删除）

| 文件 | 改动 |
|---|---|
| `apps/tauri/src-tauri/Cargo.toml` | 新增 axum/tower（`// [HTTP-BRIDGE]` 注释标记） |
| `apps/tauri/src-tauri/src/lib.rs` | `// [HTTP-BRIDGE]`：run() 内 spawn HTTP server + hub→SSE 装配 |
| `apps/tauri/src-tauri/src/commands.rs` | `// [HTTP-BRIDGE]`：4 个发射 funnel 增加 `EVENT_HUB.publish` |
| `apps/tauri/src/agent/composables/useAgentRust.ts` | `// [HTTP-BRIDGE]`：safeInvoke 走 transport；listen 走 SSE |
| 前端其余直接 `invoke`/`listen` 处 | `// [HTTP-BRIDGE]`：接入 transport（如有） |

> 移除口诀：删 5 个新文件 → 还原 Cargo.toml 依赖 → `git diff` 找 `// [HTTP-BRIDGE]` 标记逐处还原。所有桥接代码均有此标记。

## 5. 启动方式（临时）

```bash
# 终端1：启动 Tauri（真实后端 + HTTP 服务 + 桌面窗口）
cd apps/tauri && cargo run
# 终端2：浏览器前端
cd apps/tauri && npm run dev   # 打开 http://localhost:5175
```
浏览器控制台设置后端地址（或直接 `VITE_BACKEND_URL=http://127.0.0.1:8787`）：
```js
localStorage.setItem('worldsmith_backend_url', 'http://127.0.0.1:8787')
```

## 6. 验证清单（验收 HTTP 桥）

- [x] `POST /rpc new_session` 返回真实 session id；`list_sessions` 返回真实会话（2026-08-20 浏览器实测，返回真实落库会话）
- [x] 第二批新桥命令浏览器实测（2026-08-20）：subagent_list_specs（返回真实 sandbox spec）/ cmd_get_all_entities / router_list_sessions / cmd_loop_control_list_tasks / cmd_long_task_list_all / cmd_kv_get_all 均 `ok=True`；cmd_kv_set→cmd_kv_get→cmd_kv_delete 写入闭环通过
- [x] 浏览器 RPC 直达真实后端：terminal_execute_command 返回真实 stdout（`bridge-sse-test`）
- [x] SSE：浏览器 EventSource 连接 `/events` 成功建立（空闲期无事件属正常，事件仅在 AgentLoop/编排发射时经 hub 推送）
- [x] 前端切换 HTTP 模式：`isHttpBackend()` 判定正确，UI 正常渲染，控制台无报错
- [x] 浏览器发消息 → 真实 Agent 回复（2026-08-20 TRAE 浏览器实测：发「介绍一下自己」→ 真实回复 + 活动记录按序还原完整 trace 链：AgentStart→UserMessage→StreamStart→StreamEnd→AgentEnd；模型 sensenova-6.7-flash-lite，key 注入正常）
- [x] 编排桥接 + SSE 事件实时（2026-08-20 TRAE 浏览器实测 ToT）：`orchestrator_run_tot` RPC 成功执行，SSE 实时收到 `orch:node_created`→`orch:node_scored` 事件（带 kind + 会话隔离）；ToT 并发扩展触发 sensenova「速率限制」，编排返回结构化 error（`ToT 层扩展失败: …速率限制`）不崩溃，`abort` 有效——编排命令桥接/事件流/错误路径均正常；`orchestrator_run_plan` 命令同样被接收执行（因持续限流未完成）。限流为 LLM 提供方限制，建议 beam_width=1 或换模型规避
- [ ] 编排（ToT/GoT/Supervisor/Multi）在浏览器低并发下完整跑完并前端思维树可视化（需 LLM Key + 规避限流）
- [x] 前端 HTTP 模式修复（2026-08-20）：①Router/终端面板 invoke 崩溃——useRouterRust/useTerminalRust 的 `@tauri-apps/api/core` invoke 改走 transport；②terminal_* 命令 `{ args: {...} }` 包裹在 rpc.rs 加 `unwrap_args` 解包（此前报「缺少 command 参数」）；③ToT tab 不切换——useSessionViewState 的 SessionViewState 对象 reactive 化（原先普通对象字段修改不触发 computed 依赖），修复后 execTab 响应式、tab 切换/面板渲染正常。浏览器实测：终端 echo 执行成功、Router 关键词路由出决策「代码专家(coder)」、ToT/GoT/委派/多Agent tab 切换正常
- [x] 剩余 10 个前端模块统一接入 transport（2026-08-20）：useSubagentRust / useLongTaskRust / useLoopControlRust / useKbRust / RustGroupChatBackend / useOrchestratorRunner / workflowApi / useWorkflowEngineRun / useRustLayout / useRustGraphAnalysis / useSystemBridge / ChatInput.vue 全部由 `@tauri-apps/api/core|event` 改走 `agent/composables/transport`；useRustLayout/useRustGraphAnalysis 的 `isTauriAvailable()` 追加 `|| isHttpBackend()` 以便 HTTP 模式直达真实 Rust 命令。typecheck 通过；浏览器实测子Agent（subagent_list_specs 返回真实 sandbox）/ Router / 终端 / ToT / GoT / 委派 / 多Agent / 活动面板全部正常，控制台无 invoke 崩溃。
  > ⚠️ 已知缺口（2026-08-20 已收窄）：workflow_*（workflowApi.ts 28 命令）在 Rust 端从未实现，属未建功能，保持现状待单独规划；transcribe_media（ChatInput.vue 语音转录）属桌面-only 不桥接。cmd_algo_* 已在本批实现并注册（见 2.4）。
- [x] cmd_algo_* 真实 Rust 命令实现并注册（2026-08-20）：新增 algo_commands.rs 薄封装 worldsmith-core 算法，注册 lib.rs + rpc.rs，tauri Cargo 依赖 worldsmith-core。浏览器实测 9 命令全 ok:true（connected_components 真实分量、dijkstra 路径、force_layout 收敛、pagerank、community_detection、radial/tree/grid/unified 布局），mindmap 布局/图分析首次真正走 Rust（桌面 IPC 同步生效）。
- [x] 执行面板 tab 初始不可点修复（2026-08-20）：根因是 SessionSidebar 由 `v-if="sessionOpen"` 控制默认不挂载，其「恢复上次会话」逻辑（refresh→switchSession）在加载时从不执行 → activeSessionId 恒为 null → setExecTab 静默 return。修复：恢复逻辑提升到 useAgentRust.restoreLastSession()（幂等：已活跃则跳过），AgentSpace onMounted（chat 模式）调用；SessionSidebar 原逻辑保留（有守卫不重复）。浏览器实测：加载后不点新建/不点会话，8 个执行子 tab 均可直接切换，activeSessionId 自动恢复为 LAST_SESSION_KEY 会话且 execTab=multi 恢复。
- [ ] 会话切换/删除/记忆真实落库；重启后端后会话仍在
- [ ] 桌面端（Tauri IPC）行为与桥接前一致（回归）
