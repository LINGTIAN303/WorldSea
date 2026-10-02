# Agent 面冻结清单

> **status: 已收口（2026-09-27 E8：冻结面物理删除完成）** ｜ E7 删前端本体后，E8 按用户四项裁定（**记忆底座 / 产品能力四件 / 设计参考类 / 芽语义表——全部物理删除，git 历史兜底**）完成包面与 Rust 面收口：
> - **crates/ 九目录整体删除**（agent-{kernel,patterns,runtime,commands,memory,index,engine} + vendor 四子 + worldsea-skills-store），`crates/` 目录清空；
> - **src-tauri agent 命令族删除**（commands.rs 106 命令 + mcp/search/web_fetch/net_egress/skills_store/semantic/plan/tool_catalog/frontend_tool_bridge/http_bridge），lib.rs 装配段收口（`AgentCommandService`/MCP Hub/HTTP 桥/LoopControl/长任务库全摘），产品面保留（entity/fs/algo/whisper/lsp/secure_store/dsh 系/托盘系）；
> - **packages 删除**：agent-runtime（模型注册表五件打捞至 ui-kit `src/model-registry/`）、agent-core、governor-core、shared-ui/src/agent、shared-composables/src/agent；七包 agent-descriptor.ts 退役；Companion（陪伴模式）LLM 调用辅助打捞至 `shared-composables/src/companion/llm.ts`；
> - 打捞件：ui-kit model-registry（providers 五件 + smart-fetch，产品设置「视频」页消费）、`win_job.rs`（LSP Job Object，自 agent-commands::job）、companion/llm.ts；
> - **2026-10-02 附注**：打捞件 model-registry（1,674 行）与 companion/llm.ts 已随陪伴模式整体退役清退（前者经全仓复核零外部消费、用户裁定 agent-runtime 冻结项不再需要；后者见 §六.1 已结注）；`win_job.rs` 仍在产品 LSP 面在用，保留。
> - 门禁：vue-tsc 0 · vitest 59 文件/761 全绿 · cargo check 干净 · lib 测试 99/0 · 断链 0。
> 历史留档（2026-09-23 冻结登记与 §四候选评估）见下文与 git。
> 背景（2026-09-23 拍板）：dsh（deepseek-harness）以**迁文件**方式整体接管 Agent 面；壳仍用 Tauri；dsh 界面 100% 保留。准备方案见 [2026-09-23-dsh接管Agent面-大重构准备.md](../../plans/2026-09-23-dsh接管Agent面-大重构准备.md)；仓内 dsh 树的装构起口径见 [dsh 运行手册](dsh-运行手册.md)。
> 用途：① 施工时判定「哪些文件不再动、不再修」；② 替换完成后逐项回收可复用资产；③ 说明冻结后需要解开的接线。

---

## 一、冻结范围总账

口径：行数为 `wc -l` 实测（含测试文件）；「去测试」为剔除 `*_tests.rs` / `__tests__` 后的口径。

| 区域 | 文件数 | 行数 | 判定 |
|---|---|---|---|
| `crates/`（9 目录，仅 `.rs`） | 244 | 137,373（去测试 121,709） | 全冻结 |
| `apps/tauri/src-tauri/src/` | 34（含 http_bridge/） | 14,906（Agent 面 10,722 / 宿主与产品面 4,184） | 部分冻结 |
| `packages/`（Agent 面 5 包） | 285 | 57,970 | 全冻结 |
| `apps/tauri/src/`（Agent 面区域） | 159 | 45,601 | 部分冻结 |
| Tauri 命令面（Agent 面） | — | — | 129 条命令 / 20 条事件通道（§2.5） |

> 注：既有文档中「Rust 自有 crate ≈6.2 万行」「crates 约 8.4 万行」等口径为早期估算，**以本表实测为准**。

---

## 二、逐区清点

### 2.1 `crates/`（9 目录，全冻结）

| 路径 | 职责 | 文件 / 行数 | 领域资产 |
|---|---|---|---|
| `crates/agent-commands/` | 命令层：会话/回滚/终端/子 Agent/工作区回滚 | 53 / 41,574 | 部分（会话族、工作区回滚） |
| `crates/agent-kernel/` | 内核：循环/工具/权限/事件/交互 | 62 / 30,301 | 部分（权限模式机、项目规则） |
| `crates/vendor/` | MemoryCenter 四子 crate（记忆存储/检索/分词/LLM 客户端） | 38 / 25,130 | **是（核心）** |
| `crates/agent-memory/` | 记忆：raw_store / 衰减 / 淘汰 / 语义 | 15 / 15,283 | **是** |
| `crates/agent-patterns/` | ToT/GoT/Reflective/Router/Plan 编排模式 | 52 / 13,436 | 否 |
| `crates/agent-index/` | 工作区索引：chunker / index / policy | 10 / 9,736 | **是** |
| `crates/agent-engine/` | 四契约规范定义（`src/contracts/`，ZCode 内化产物） | 9 / 1,271 | 是（契约冻结） |
| `crates/worldsea-skills-store/` | skills 商城纯逻辑（sha256 / zip 穿越防护） | 1 / 536 | 是 |
| `crates/agent-runtime/` | 聚合转发壳（`agent_kernel::*` 零改动） | 4 / 106 | 否 |

- `vendor/` 四子明细：`memory-center-core-logic`(19/13,115)、`memory-center-core`(5/6,074)、`memory-center-models`(8/3,858)、`memory-center-llm`(6/2,083)。
- 测试规模：`agent-commands` 10 个 `*_tests.rs`（`lib_tests.rs` 2,337 行最大）、`agent-patterns` 11 个、`agent-kernel` 4 个；`agent-memory`/`agent-index`/`vendor`/`worldsea-skills-store` 无独立测试文件（存在内联测试，未逐文件确认）。

### 2.2 `apps/tauri/src-tauri/src/`（Agent 面模块 → 冻结；宿主/产品面 → 不冻结）

**Agent 面（全冻结）**

| 文件 | 行数 | Agent 面命令数 | 职责 |
|---|---|---|---|
| `commands.rs` | 2,604 | 106 | 主链路会话/循环/权限/终端/子 Agent 命令 |
| `http_bridge/rpc.rs` | 1,884 | 1 | axum RPC + SSE，浏览器直连后端（源码自述「临时」） |
| `mcp_client.rs` | 1,360 | 0 | rmcp Hub：stdio / streamable-http + 工具快照 |
| `search_commands.rs` | 737 | 0 | web_search Provider 降级链 |
| `mcp_commands.rs` | 322 | 7 | MCP 连接/断开/状态/持久化 |
| `frontend_tool_bridge.rs` | 470 | 0 | Rust↔前端双向工具桥 |
| `semantic_commands.rs` | 355 | 6 | 语义检索配置/索引状态 |
| `web_fetch_commands.rs` | 353 | 0 | web_fetch 原生工具（缓存/上限/围栏） |
| `net_egress.rs` | 329 | 0 | 出网收口：URL 解析 + 公网判定 |
| `search_config.rs` | 273 | 2 | 引擎偏好 JSON + Key 落 SecureStore |
| `web_fetch_text.rs` | 265 | 0 | 文本层抓取 |
| `skills_store.rs` | 262 | 6 | Skills Store 命令层 |
| `plan_commands.rs` | 239 | 0 | plan 工具（`todo_write` 归一后） |
| `web_fetch_extract.rs` | 191 | 0 | HTML 扫描器 |
| `tool_catalog_commands.rs` | 23 | 1 | 对话区行段分派工具目录 |
| `http_bridge/{mod,events}.rs` | 125 | 0 | HTTP 桥装配与事件 |
| 跨栈守卫测试（search_config / net_egress / web_fetch 组合） | 1,206 | — | Agent 面契约测试 |
| `bridge_tool_specs.json` | — | — | 前端工具规格（生成物） |
| `lib.rs`（Agent 装配段） | 639 | — | 部分冻结（装配与工具链注入中的 Agent 段） |

**宿主/产品面（不冻结）**：`entity_commands.rs`(1,222)、`whisper.rs`(570)、`fs_commands.rs`(370)、`office_commands.rs`(350)、`lsp_commands.rs`(314)、`tray.rs`(207)、`secure_store.rs`(156)、`algo_commands.rs`(144)、`fs_watch_commands.rs`(115)、`project_commands.rs`(56)、`system.rs`(36)、`main.rs`(5)。
> 注：`entity_commands.rs` 内含 `entity_read_tools` / `fs_entity_tools`（供 Agent 消费的工具源），冻结时只需摘掉「Agent 消费」这一侧，产品 CRUD 侧不动。

### 2.3 `packages/`（Agent 面，全冻结）

| 路径 | 文件 / 行数 |
|---|---|
| `packages/agent-runtime/src/tools/` | 57 / 15,550（`algo-tools.ts` 1,285 最大） |
| `packages/shared-composables/src/agent/` | 21 / 5,935 |
| `packages/shared-ui/src/agent/blocks/` | 29 / 5,647 |
| `packages/shared-ui/src/agent/stream/` | 35 / 5,364（`rows/` 8 组件 + `toolClassify`/`toolSemantics`） |
| `packages/agent-core/` | 22 / 4,879 |
| `packages/agent-runtime/src/skills/` | 20 / 3,024 |
| `packages/shared-ui/src/agent/bubbles/` + `a2ui/` | 19 / 2,969 |
| `packages/agent-runtime/src/group-chat/` | 12 / 2,803 |
| `packages/shared-ui/src/agent/message-list/` | 12 / 2,030 |
| `packages/agent-runtime/src/providers/` | 6 / 1,528 |
| `packages/governor-core/` | 5 / 1,067 |
| `packages/agent-runtime/src/embedding/` | 6 / 1,048 |
| `packages/agent-runtime/src/kb/` | 5 / 944 |
| `packages/agent-runtime/src/` 其余（context/session/stores/orchestrator/execution/mcp/toolbus/utils） | 27 / 3,161 |

### 2.4 `apps/tauri/src/`（Agent 面区域，全冻结）

| 路径 | 文件 / 行数 |
|---|---|
| `agent/**` | 72 / 22,107（去测试 20,691） |
| `space/group-chat/**` | 66 / 15,768 |
| `space/chat/**` | 10 / 4,609 |
| `space/panels/` Agent 子集（`ExecPanel`/`PersonaMirror`/`RulesPanel`/`SpaceAgentSettingsPanel`/`SemanticSearchCard`/`MemoryShelf`） | 6 / 2,828 |
| `subagent/**` | 3 / 1,676 |
| `space/AgentSpace.vue` | 1 / 793 |
| `terminal/**` | 2 / 548 |
| `space/composables/useAgentPersona.ts` | 1 / 92 |

**边界切法（不冻结）**：`sprouts/**`（358 / 55,891，含 26 个 `official.*` 芽；原 27 个——`official.module-builder` 已于 2026-09-25 随「自定义模块」整体剪除，本行数字为剪除前实测）为产品域，**仅** `sprouts/official/mindmap/agent-descriptor.ts` 冻结；`space/panels/` 的 `CreationPanel.vue`、`PreviewPanel.vue`、`UserProfilePopover.vue` 划出；`space/files/**`、`space/stores`、`space/components`、`space/workspace.ts` 视为产品域。
**部分冻结**：`sprouts/official/{drawing,graph,magic,manuscript,timeline,tactical-board,workflow}`（注册了 `useAgentPluginBridge` / 调 Agent 编排）——产品实现留存，仅摘其 Agent 接线。

### 2.5 Tauri 命名面与事件面

- Agent 面 `#[tauri::command]` 合计 **129** 条：`commands.rs` 106、`mcp_commands.rs` 7、`skills_store.rs` 6、`semantic_commands.rs` 6、`search_config.rs` 2、`tool_catalog_commands.rs` 1、`http_bridge/rpc.rs` 1。
- Agent 面事件通道（定义于 `commands.rs` 等）：`agent:event:stream|trace|deep_phase_changed`、`agent:event:orch|orch_supervisor|orchestration_trace`、`agent:event:a2ui|subagent`、`agent:event:plan_created|plan_update|plan_replanned`、`agent:event:session_branch`、`agent:session_title_updated`、`agent:interaction:{sid}`（双向）、`agent:tool_call`、`loop_control:event:{sid}`、`mcp:status`、`worldsea:agent:plugin-action` / `worldsea:agent:plugin-query-result`（DOM CustomEvent，双向）。

---

## 三、产品域 → Agent 面接线点（冻结后需解开的线）

| 引用方 | 被引用对象 | 形态 | 说明 |
|---|---|---|---|
| `apps/tauri/src/App.vue:18` | `agent/agentDataBridges.ts`（535 行） | import | App 启动即注册全局数据桥 |
| `apps/tauri/src/main.ts:23` | `internalRegistry`（`@worldsea/agent-runtime`） | import | 注册 agent-descriptor |
| `apps/tauri/src/main.ts:26,55` | `sprouts/official/mindmap/agent-descriptor.ts`（168 行） | import | 产品芽→Agent 工具目录 |
| `apps/tauri/src/plugins/bootstrap.ts:4` | `registerWorldviewSprout`（`@agent/index`） | import | 芽注册进 `worldview` 工具（剪除前芽数 27；`official.module-builder` 已于 2026-09-25 剪除，现为 26） |
| `apps/tauri/src/composables/useProjectSwitcher.ts:8` | `setAgentCurrentProjectId`（`@agent/session/manager`） | import | 切项目同步 Agent 会话 |
| 8 个 `agent-descriptor.ts`（`plugin-sdk` 380 / `canvas-engine` 357 / `entity-core` 337 / `ui-kit` 93 / `font-kit` 80 / `agent-core` 63 / `motion-kit` 46 + mindmap 168） | — | export | 产品包向 Agent 暴露规格 |
| `sprouts/official/{drawing,graph,magic,manuscript,timeline}/…View.vue`、`tactical-board/composables/useTacticalAgentBridge.ts`、`workflow/components/PipelineChat.vue` | `useAgentPluginBridge`（30 行） | 事件 | `worldsea:agent:plugin-action` UI 动作消费——**全部已退场**（E5 删 `PipelineChat`；E6 2026-09-27 删其余 6 芽监听与本 composable 本体） |
| `sprouts/official/workflow/components/{ExecutionPanel,StepConfigEditor}.vue` | `useOrchestrator` / `import('@/agent/composables/transport')` | import | 工作流调用 Agent 编排（2026-09-26 **E5 已退场**：`ExecutionPanel` 整体删除；`StepConfigEditor` 的 `subagent_list_specs` 导入段删除，不再触旧面） |
| `sprouts/official/manuscript/components/AISidebar.vue:42` | `useAgent` | import | 编辑器内嵌 Agent（2026-09-26 **E5 已退场**——源级删除，文件不存在） |
| `sprouts/official/notebook/**`、`outline/composables/useOutlineTree.ts:6` | 被 `agentDataBridges.ts` 反向 import | import（反向） | Agent→芽 的数据动作实现落在产品芽内 |
| `space/{files/*, panels/{RulesPanel,PreviewPanel,SemanticSearchCard,SpaceAgentSettingsPanel}, workspace.ts}`、`space/chat/ChatInput.vue` | `@/agent/composables/transport`（`invoke`） | import | 产品/混合 UI 复用 Agent IPC 客户端 |
| `ui/settings/SettingsDialog.vue:100` | `space/panels/SpaceAgentSettingsPanel.vue` | import | 设置页挂 Agent 配置面板 |

> `useAgentRust.ts`（3,693 行）除 Agent 面内部消费外，仅被 `space/panels/RulesPanel.vue`、`SemanticSearchCard.vue` 两处引用。

---

## 四、可留候选登记（**不在本清单内施工**，替换完成后逐项立项）

### 4.1 候选

| 候选 | 位置 | 为什么可能值得留 | 与 dsh 的重叠度 |
|---|---|---|---|
| MemoryCenter 四子 crate + `agent-memory` + `agent-index` | `crates/vendor/*`（25,130）+ `agent-memory`（15,283）+ `agent-index`（9,736） | 内容寻址 raw_store、衰减/淘汰、memory.md 契约，约 4.9 万行已验证资产 | dsh 有记忆/压缩/会话概念，机制不等价；**部分重叠** |
| 世界观芽内容 + 26 芽定义（原 27 条，`official.module-builder` 已于 2026-09-25 随「自定义模块」整体剪除） | `plugins/plugin-manifest.ts`（`OFFICIAL_SPROUTS` 实测 27 条 → 剪除后 26 条）、`agent-runtime/src/tools/worldview/{actions.ts 1,119, guides.ts 301}`（2026-09-23 实测） | 芽 id→action→参数说明表是纯领域语义，脱壳后仍服务产品 | **dsh 无对应物** |
| 出网收口与抓取 | `net_egress.rs`(329)+测试(198)、`web_fetch_*`(809)+测试(456)、`search_commands.rs`(737)、`search_config.rs`(549) | 严格 URL 解析 + 逐跳公网复校 + 跨栈守卫测试，安全语义难重建 | dsh 有 `web`/`web-fetch-http`；**重叠但守卫更严** |
| 权限四值语义 + 项目规则 | `agent-kernel/src/{permission_machine.rs, project_rules.rs}`、`.worldsea/permissions.json` | 位次单点化 `decide()` 纯函数；`SessionGrant`/`AlwaysAsk` 不可翻案不变量 | dsh 有 `permission-presets`；**语义重叠、判定表不等价** |
| 工作区文件回滚 | `agent-commands/src/{workspace_rewind.rs, workspace_rewind_tests.rs}` | before-image 内容寻址 + 请求边界倒序撤销 + 幂等，前端有契约测试 | dsh 侧**未知** |
| 会话/检查点/分叉契约 | `agent-engine/src/contracts/`、`agent-commands/src/session_{store,checkpoint,fork,branch,rewind,boundaries}.rs` | 四契约规范定义 + 已冻结的设计锚点 | dsh `session` 极成熟；**高度重叠** |
| skills 商城纯逻辑 | `crates/worldsea-skills-store/src/lib.rs`(536)、`skills_store.rs`(262) | sha256 校验 + zip slip 防护，可独立 `cargo test` | dsh 有 `skill`；**加载语义重叠、分发形式不同** |
| 前端 Agent 空间设计证据 | `docs/重构视觉稿/`（UI 矩阵 449 行 / 视觉稿 664 行）、`.trae/specs/agent-ui-matrix-audit/` | 「界面想表达什么」的直接依据 | **dsh 无对应物** |
| 流式行段渲染器 | `packages/shared-ui/src/agent/stream/`（35 / 5,364） | 行段分类/语义映射可作渲染规范参考 | dsh 有 `ui-conversation`；**前端栈不同，不可直接复用** |
| A2UI 卡片与工具目录 | `shared-ui/src/agent/a2ui/`(1,121)、`tool_catalog_commands.rs`、`useToolCatalog.ts` | 工具→卡片目录是产品级展示契约 | dsh 有 tool presenter；**重叠** |
| 跨栈守卫测试 | `apps/tauri/src/agent/__tests__/{search-config-contract,workspace-rewind-contract,interaction-metadata-contract,tool-catalog-contract}.spec.ts` | 前端侧契约测试断言 Rust 常量，可作回归基线 | **dsh 无对应物** |

### 4.2 明确不值得留（dsh 已有等价物）

| 部分 | 理由 |
|---|---|
| `crates/agent-patterns/`（13,436） | ToT/GoT/Reflective/Router 编排模式，dsh 以 `agent-loop` + 插件扩展点覆盖 |
| `packages/agent-core/src/orchestrator/`（3,433） | 与 dsh `agent-loop`/`subagent` 职责完全重叠 |
| `apps/tauri/src/agent/composables/useAgentRust.ts`（3,693） | 壳层协议封装，dsh 自带客户端契约 |
| `crates/agent-runtime/`（106） | 纯 re-export 转发壳 |
| `apps/tauri/src-tauri/src/http_bridge/`（2,009） | 自述「临时」浏览器直连方案；dsh 有 `api`/`sdk` 远程面 |
| 会话侧栏 / 消息窗口化（`space/chat/**`、`shared-ui/agent/message-list/**`） | dsh `session-query` 等价物 |
| MCP 客户端栈（`mcp_client.rs` + `mcp_commands.rs`，1,682） | dsh 有 `mcp` 组 |
| 循环/长任务守卫（`agent-kernel/src/{loop_control,long_task,retention}.rs`） | dsh `guard`/`jobs` 覆盖 |

---

## 五、配套作废的文档（2026-09-23）

以下文档即日起**作废**——不再作为任何实现的依据（保留原文供追溯；各组已置 `README.md` 作废声明）：

| 文档组 / 文档 | 处置 |
|---|---|
| `docs/plans/已完成/2026-09-16-deepseek-harness-方向探究/`（8 篇） | 作废（原为「以其为基 / 提取融合」参考探究） |
| `docs/plans/已完成/2026-09-17-三域对齐dsh/`（5 篇） | 作废 |
| `docs/plans/已完成/2026-09-18-对话区对齐dsh/`（3 篇） | 作废 |
| `docs/plans/已完成/2026-09-18-工作区与环境对齐dsh/`（3 篇） | 作废 |
| `docs/plans/已完成/2026-09-21-ZCode能力内化方向探究/`（18 篇 + `证据/`） | 作废（ZCode 内化线整体让位于 dsh 接管） |
| `docs/misc/deepseek-harness-调研与借鉴方案.md` | 作废 |

> 其余 Agent 主题的既有文档（能力面整顿审查、A1 记忆系统设计、权限分级与沙箱耦合设计、Agent 数据桥架构等）**暂不逐份作废**：它们描述的实现随之冻结，待替换完成后统一处置（本清单 §六）。

---

## 六、未定项（待替换完成后裁定，不在本期）

1. `packages/shared-composables/src/companion/`（5 / 1,312）的 Agent 面归属未查清，暂不列冻结。——**已结（2026-10-02）**：陪伴模式整体退役，该目录（含打捞件 llm.ts）、设置「视频」页、CompanionNotification 与 settingsStore 陪伴字段全部删除，未定项自然消解。
2. 产品域 UI（`sprouts/**` 等 5.6 万行）与产品侧 Rust 命令面（`entity_commands` 等 4,184 行）在新架构中的落位——**2026-09-23 已裁：本期不动、不查、不删（仅登记）**，另行立项。
3. 其余 Agent 主题文档的最终去向（保留 / 作废 / 改注记）。
4. 冻结面内资产的物理删除时机（建议：接管验收通过后统一处置，见准备方案 B3）。
