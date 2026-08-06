# 详细注释文档索引

> 承载代码内注释分层后的「详细」层（why/how）：设计决策、整体思路、模块职责、事件协议、踩坑约束。
> 代码文件内仅保留一行简要注释 + 本目录相对路径；此处按模块与代码文件一一对应。
> 配套规则见【[2026-08-06-comment-hierarchy-plan.md](../../plans/2026-08-06-comment-hierarchy-plan.md)】。
> 代码变更影响注释含义时，必须同步更新本目录对应文档。

## 模块清单

### agent-runtime（crates/agent-runtime）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/agent/（mod.rs + config/state/error/loop_control/memory/llm/tools/interaction/long_task/backend_bridge，原 agent.rs 2026-08-06 拆分） | [agent.md](agent-runtime/agent.md) | AgentLoop ReAct 核心循环：配置、主循环、工具执行、记忆注入 |
| src/event.rs | [event.md](agent-runtime/event.md) | AgentEvent 事件模型与序列化契约 |
| src/loop_control.rs | [loop_control.md](agent-runtime/loop_control.md) | LoopController 限流/超时/看门狗自动控制 |
| src/supervisor.rs | [supervisor.md](agent-runtime/supervisor.md) | 子 Agent 委派监督器 |
| src/router.rs | [router.md](agent-runtime/router.md) | 模型路由选择 |
| src/multi_agent.rs | [multi_agent.md](agent-runtime/multi_agent.md) | 去中心化多 Agent 协作模式 |
| src/long_task.rs | [long_task.md](agent-runtime/long_task.md) | 长任务管理器 |
| src/graph_of_thoughts.rs | [graph_of_thoughts.md](agent-runtime/graph_of_thoughts.md) | GoT 思维图谱 |
| src/tree_of_thoughts/（mod + node/strategies/config/error，原 tree_of_thoughts.rs 2026-08-06 拆分） | [tree_of_thoughts.md](agent-runtime/tree_of_thoughts.md) | ToT 思维树 |
| src/a2ui.rs | [a2ui.md](agent-runtime/a2ui.md) | A2UI 界面渲染事件 |
| src/tool.rs | [tool.md](agent-runtime/tool.md) | 工具调用抽象 |
| src/deep_phases.rs | [deep_phases.md](agent-runtime/deep_phases.md) | 深度思考阶段 |
| src/memory.rs | [memory.md](agent-runtime/memory.md) | 记忆访问器 |
| src/orchestrator.rs | [orchestrator.md](agent-runtime/orchestrator.md) | 编排器接口与执行 |
| src/node.rs | [node.md](agent-runtime/node.md) | 节点接口与上下文 |
| src/alias.rs | [alias.md](agent-runtime/alias.md) | 工具名别名系统 |
| src/mcp.rs | [mcp.md](agent-runtime/mcp.md) | MCP 工具适配器 |
| src/llm/（mod/config/error/model/manifest/stream/genai_backend） | [llm.md](agent-runtime/llm.md) | LLM 通信层（Provider 配置/清单/流式/GenaiBackend） |
| src/backend.rs | [backend.md](agent-runtime/backend.md) | LLM 后端访问器（NodeBackendAccessor） |
| tests/deep_phases_parity.rs | [deep_phases_parity.md](agent-runtime/deep_phases_parity.md) | Deep Phases 跨语言一致性测试 |
| src/lib.rs | [lib.md](agent-runtime/lib.md) | crate 导出与架构总览 |
| 拆分记录（2026-08-06） | — | 测试已分离：agent/supervisor/tree_of_thoughts/multi_agent/router/long_task/graph_of_thoughts 的测试模块迁出至对应 `*_tests.rs`（`#[path]` 引入） |
| 拆分记录（2026-08-06） | — | agent.rs 按职责拆为 src/agent/ 目录（config/state/error/loop_control/memory/llm/tools/interaction/long_task/backend_bridge + tests.rs），对外 API 不变，cargo test 170 + 5 全绿 |

### agent-commands（crates/agent-commands）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/lib.rs | [lib.md](agent-commands/lib.md) | 命令层服务：AgentLoop 封装、会话管理、Phase 5.1/5.4 演进说明 |
| src/loop_control.rs | [loop_control.md](agent-commands/loop_control.md) | Loop Control 注册表：task_id 管理、事件广播、与 Tauri 命令映射 |
| src/subagent.rs | [subagent.md](agent-commands/subagent.md) | 子 Agent 编排：委派工具、懒加载实例池、事件广播器注入 |
| src/subagent_store.rs | [subagent_store.md](agent-commands/subagent_store.md) | 子 Agent 规格 SQLite 持久化（JSON 整条存储，启动加载/写穿） |
| src/long_task_store.rs | [long_task_store.md](agent-commands/long_task_store.md) | 长任务 SQLite 持久化（表结构 + 仓库 API） |
| src/terminal.rs | [terminal.md](agent-commands/terminal.md) | 终端工具：execute_command / 持久化 Shell 会话设计 |
| tests/e2e_llm.rs | [e2e_llm.md](agent-commands/e2e_llm.md) | 真实 LLM 端到端实测：运行方式/设计约束/Provider 选择、Router 与 ToT 编排模式链路 |
| src/lib_tests.rs | （无） | 2026-08-06 拆分的测试模块（#[path] 引用），无 ≥ 10 行连续注释块 |
| src/loop_control_tests.rs | （无） | 2026-08-06 拆分的测试模块（#[path] 引用），无 ≥ 10 行连续注释块 |
| src/subagent_tests.rs | （无） | 2026-08-06 拆分的测试模块（#[path] 引用），无 ≥ 10 行连续注释块 |
| src/terminal_tests.rs | （无） | 2026-08-06 拆分的测试模块（#[path] 引用），无 ≥ 10 行连续注释块 |

> src/error.rs、src/mock_backend.rs 无 ≥ 10 行长注释块，未生成文档。
> src/lib_tests.rs、src/loop_control_tests.rs、src/subagent_tests.rs、src/terminal_tests.rs 为 2026-08-06 自对应源文件迁出的测试模块（`#[path]` 方式），均无 ≥ 10 行连续注释块，未生成文档。

### agent-memory（crates/agent-memory）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/lib.rs | [lib.md](agent-memory/lib.md) | MemoryAccessor 适配层：方法映射、线程安全设计 |

### agent-core（packages/agent-core）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/agent-descriptor.ts | [agent-descriptor.md](packages/agent-core/agent-descriptor.md) | 库描述符：LibraryDescriptor 约定、Phase 2 工具去重演进 |
| src/guard/index.ts | [index.md](packages/agent-core/guard/index.md) | 统一权限守卫：元数据自动解析、5 级优先级、用法示例 |
| src/index.ts | [index.md](packages/agent-core/index.md) | Agent 运行时核心库 barrel 导出与设计原则 |
| src/orchestrator/default-orchestrator.ts | [default-orchestrator.md](packages/agent-core/orchestrator/default-orchestrator.md) | 阶段 0 简单编排器：特性边界、中继事件注入 |
| src/orchestrator/nodes/execute-node.ts | [execute-node.md](packages/agent-core/orchestrator/nodes/execute-node.md) | ExecuteNode：Plan 逐步执行、动态新任务标记、事件流 |
| src/orchestrator/nodes/memory-node.ts | [memory-node.md](packages/agent-core/orchestrator/nodes/memory-node.md) | MemoryNode：recall/inject/archive/auto 四动作、典型用法、占位符 |
| src/orchestrator/nodes/plan-node.ts | [plan-node.md](packages/agent-core/orchestrator/nodes/plan-node.md) | PlanNode：JSON 计划格式约定、容错策略、与 ExecuteNode 协作 |
| src/orchestrator/nodes/react-node.ts | [react-node.md](packages/agent-core/orchestrator/nodes/react-node.md) | ReactNode：ReAct 设计理念、prompt 占位符、工作记忆集成 |
| src/orchestrator/nodes/refine-node.ts | [refine-node.md](packages/agent-core/orchestrator/nodes/refine-node.md) | RefineNode：Self-Refine 编排图、收敛条件、修正策略 |
| src/orchestrator/nodes/reflection-node.ts | [reflection-node.md](packages/agent-core/orchestrator/nodes/reflection-node.md) | ReflectionNode：评审维度、JSON 输出协议、ReAct 集成 |
| src/orchestrator/short-term-memory.ts | [short-term-memory.md](packages/agent-core/orchestrator/short-term-memory.md) | 短期记忆 trim 策略：三类记忆关系、保留策略、使用示例 |
| src/orchestrator/types.ts | [types.md](packages/agent-core/orchestrator/types.md) | Orchestrator 抽象：三层架构、Node/State/事件契约、记忆与工作记忆类型 |
| src/orchestrator/working-memory.ts | [working-memory.md](packages/agent-core/orchestrator/working-memory.md) | 工作记忆工具类：观察缓冲、容量 trim、合并策略、使用示例 |
| src/registry/skill-registry.ts | [skill-registry.md](packages/agent-core/registry/skill-registry.md) | 技能注册中心：声明式技能管理、按激活技能合并工具集 |
| src/registry/tool-registry.ts | [tool-registry.md](packages/agent-core/registry/tool-registry.md) | 工具注册中心：元数据查询、别名解析、平台过滤、始终可用聚合 |
| src/types/index.ts | [index.md](packages/agent-core/types/index.md) | 核心类型定义：权限/分类/元数据/技能/事件契约 |

> src/bus/index.ts、src/execution/index.ts、src/factory/index.ts、src/registry/index.ts、src/orchestrator/index.ts 无 ≥ 10 行长注释块，未生成文档。

### governor-core（packages/governor-core）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/governor.ts | [governor.md](packages/governor-core/governor.md) | 调控器核心实现：createGovernor 工厂、单模块激活 5 步流程、分级降级策略 |
| src/index.ts | [index.md](packages/governor-core/index.md) | 调控器核心包 barrel 导出与子路径说明 |

> src/environment.ts、src/registry.ts、src/types.ts 无 ≥ 10 行长注释块，未生成文档。

### cli（apps/cli）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/commands/serve.ts | [serve.md](cli/serve.md) | CLI Agent Server 模式：HTTP API 清单 + WebSocket 事件 + Python 微服务桥接、鉴权 |
| src/cli/node-adapter.ts | [node-adapter.md](cli/node-adapter.md) | Node.js 原生执行适配器：child_process 直连避免 WS 自连、shell 会话、简化 PTY |
| src/serve/python-routes.ts | [python-routes.md](cli/python-routes.md) | Python 微服务路由：express → 原生 http 迁移、7 个端点清单 |

> src/index.ts、src/env.d.ts、src/cli/*、src/cli/stores/*、src/python/bridge.ts 无 ≥ 10 行长注释块，未生成文档。

### tauri（apps/tauri）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/agent/composables/useAgentRust.ts | [useAgentRust.md](tauri/useAgentRust.md) | Agent Backend 适配器：Rust 命令映射、事件协议、ProviderConfig 镜像 |
| src/agent/composables/useLoopControlRust.ts | [useLoopControlRust.md](tauri/useLoopControlRust.md) | Loop Engineering 适配层：命令映射、事件/配置/状态序列化契约、使用示例 |
| src/agent/composables/useLongTaskRust.ts | [useLongTaskRust.md](tauri/useLongTaskRust.md) | 长任务管理器（Rust SQLite）：状态机/心跳/checkpoint/协作式取消 |
| src/agent/components/LoopControlStatus.vue | [LoopControlStatus.md](tauri/LoopControlStatus.md) | Loop 实时状态条：数据来源、展示内容与设计原则 |
| src/agent/components/SubAgentSection.vue | [SubAgentSection.md](tauri/SubAgentSection.md) | 子 Agent 委派过程展示（running/completed/error 三态） |
| src/subagent/composables/useSubagentRust.ts | [useSubagentRust.md](tauri/useSubagentRust.md) | 子 Agent 规格管理：subagent_* 命令封装、snake_case 参数契约 |
| src/subagent/components/SubAgentView.vue | [SubAgentView.md](tauri/SubAgentView.md) | 子 Agent 规格管理界面：列表 + 新增/编辑表单交互 |
| src/subagent/templates.ts | [templates.md](tauri/templates.md) | 子 Agent 预设模板：前端预填、后端零默认规格 |
| src/terminal/composables/useTerminalRust.ts | [useTerminalRust.md](tauri/useTerminalRust.md) | 终端服务适配器：terminal_* 命令参数约定、模块级单例 |
| src/terminal/components/TerminalView.vue | [TerminalView.md](tauri/TerminalView.md) | 终端界面：单次命令 + 持久化会话 + Shell 检测交互 |
| src/core/coreBackend.ts | [coreBackend.md](tauri/coreBackend.md) | coreBackend Phase 3 端分离：移除 WASM、纯 invoke 路径、签名兼容 |
| src/main.ts | [main.md](tauri/main.md) | Tauri 端入口：端分离策略、Phase 3/4 演进说明 |
| src/memory-archive/adapters/TauriFsOperations.ts | [TauriFsOperations.md](tauri/TauriFsOperations.md) | FsOperations 的 Tauri 实现：cmd_fs_* 命令映射 |
| src/plugins/workflow/api/workflowApi.ts | [workflowApi.md](tauri/workflowApi.md) | Workflow 引擎命令调用层：28 个命令镜像、设计要点 |
| src/plugins/workflow/composables/useWorkflowEngineRun.ts | [useWorkflowEngineRun.md](tauri/useWorkflowEngineRun.md) | 直接 Dispatch 兜底通道运行控制器：工作机制与注意 |
| src/plugins/mindmap/composables/useRustGraphAnalysis.ts | [useRustGraphAnalysis.md](tauri/useRustGraphAnalysis.md) | Rust 图分析算法桥接：算法清单与 Web 回退策略 |

### web（apps/web）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/agent/AgentChat.vue | [AgentChat.md](web/agent/AgentChat.md) | Rust 批次4 思维引擎（Router 路由决策）会话生命周期与命令处理；Loop/ToT/GoT/MA/Supervisor 已拆至 useSessionStatusBars |
| src/agent/AgentMessageBubble.vue | [AgentMessageBubble.md](web/agent/AgentMessageBubble.md) | 消息气泡路由分发器（4 分支 + 子组件目录） |
| src/agent/archive/MergeView.vue | [MergeView.md](web/agent/archive/MergeView.md) | 待合并钩子管理视图（emit merged 刷新） |
| src/agent/archive/StatsView.vue | [StatsView.md](web/agent/archive/StatsView.md) | 记忆库统计视图（纯 UI，props 传入） |
| src/agent/archive/TrashView.vue | [TrashView.md](web/agent/archive/TrashView.md) | 回收站视图（自包含逻辑） |
| src/agent/ArchiveConfigPanel.vue | [ArchiveConfigPanel.md](web/agent/ArchiveConfigPanel.md) | 归档参数配置面板（8 组配置项 + localStorage 持久化） |
| src/agent/ArchivePanel.vue | [ArchivePanel.md](web/agent/ArchivePanel.md) | 记忆库管理面板（7 子视图拆分，父组件职责） |
| src/agent/chat/useChatMetrics.ts | [useChatMetrics.md](web/agent/chat/useChatMetrics.md) | 聊天上下文用量/成本/归档阈值计算 |
| src/agent/chat/useChatPanel.ts | [useChatPanel.md](web/agent/chat/useChatPanel.md) | 聊天面板状态管理（位置/大小/最小化/折叠） |
| src/agent/chat/useChatSession.ts | [useChatSession.md](web/agent/chat/useChatSession.md) | 会话 drawer 列表/切换/删除/新建（依赖注入） |
| src/agent/chat/useChatSettings.ts | [useChatSettings.md](web/agent/chat/useChatSettings.md) | 聊天设置 state/回调/持久化（options 注入解耦） |
| src/agent/chat/useLongTaskProgress.ts | [useLongTaskProgress.md](web/agent/chat/useLongTaskProgress.md) | 长任务进度反馈（计时器 + 心跳提示） |
| src/agent/chat/useManuscriptActions.ts | [useManuscriptActions.md](web/agent/chat/useManuscriptActions.md) | 文境 Block 本地操作（仅内存持久化） |
| src/agent/chat/useSettingsPanel.ts | [useSettingsPanel.md](web/agent/chat/useSettingsPanel.md) | 设置浮窗位置/拖拽/开关 |
| src/agent/chat/useChatAttachments.ts | （无） | 聊天附件分类与 vision 提示构建（短注释，未生成文档） |
| src/agent/chat/useVisionAgent.ts | （无） | vision 子 Agent 初始化与执行（短注释，未生成文档） |
| src/agent/chat/useSessionStatusBars.ts | [useSessionStatusBars.md](web/agent/chat/useSessionStatusBars.md) | 命令状态栏生命周期管理（Loop/ToT/GoT/MA/Supervisor，自 AgentChat 拆分） |
| src/agent/composables/useAgent.ts | [useAgent.md](web/agent/composables/useAgent.md) | Web 端 Agent Backend 入口（端分离 P3-W5 功能退化版） |
| src/agent/composables/useGroupChat.ts | [useGroupChat.md](web/agent/composables/useGroupChat.md) | 群聊生命周期管理（阶段 2.0 后暂不可用） |
| src/agent/composables/useMessageSpeaker.ts | [useMessageSpeaker.md](web/agent/composables/useMessageSpeaker.md) | 统一消息 speaker 信息（群聊/单聊数据流统一） |
| src/agent/preview/resultRenderer.ts | [resultRenderer.md](web/agent/preview/resultRenderer.md) | AgentPreview 工具结果 HTML 渲染器（DOMPurify 消毒） |
| src/App.vue | [App.md](web/App.md) | 调控器启动（priority + 依赖拓扑，分级降级策略） |
| src/composables/useAvatarImage.ts | [useAvatarImage.md](web/composables/useAvatarImage.md) | avatar 字段解析为图片 src（object URL 生命周期） |
| src/composables/useFileExtract.ts | [useFileExtract.md](web/composables/useFileExtract.md) | 文档内容提取（docx/pdf/text，pdfjs 改 Web Worker） |
| src/composables/useProjectSwitcher.ts | [useProjectSwitcher.md](web/composables/useProjectSwitcher.md) | 项目切换编排器（Web 端迁移版，6 步流程） |
| src/core/coreBackend.ts | [coreBackend.md](web/core/coreBackend.md) | Web 端 coreBackend（Phase 3 端分离，API 兼容） |
| src/core/FacetMigrator.ts | [FacetMigrator.md](web/core/FacetMigrator.md) | weapon/apparel → item+facet 结构迁移（7 步） |
| src/core/ProjectFS.ts | [ProjectFS.md](web/core/ProjectFS.md) | 向后兼容 re-export（依赖注入说明） |
| src/core/wasmWorkerPool.ts | [wasmWorkerPool.md](web/core/wasmWorkerPool.md) | WASM Worker 池（懒初始化/队列/回退/可取消） |
| src/governor/adapters.ts | [adapters.md](web/governor/adapters.md) | 官方插件/自定义模块 → ModuleDescriptor 适配 |
| src/governor/api.ts | [api.md](web/governor/api.md) | GovernorAPI 实现（包装 pluginAPI + 环境上下文） |
| src/governor/bootstrap.ts | [bootstrap.md](web/governor/bootstrap.md) | 调控器启动配置（critical/normal/lazy 三级分层） |
| src/governor/governor.ts | [governor.md](web/governor/governor.md) | 主应用调控器入口（包装 governor-core） |
| src/main.ts | [main.md](web/main.md) | Web 端入口（WASM 硬编码 + CLI serve 代理） |
| src/memory-archive/adapters/AgentBridgeImpl.ts | [AgentBridgeImpl.md](web/memory-archive/adapters/AgentBridgeImpl.md) | AgentBridge 宿主实现（6 项关键设计） |
| src/memory-archive/adapters/ChineseTokenizerAdapter.ts | [ChineseTokenizerAdapter.md](web/memory-archive/adapters/ChineseTokenizerAdapter.md) | 中文分词器宿主实现（H2.2，未装库自动降级） |
| src/memory-archive/adapters/HostEmbeddingAdapter.ts | [HostEmbeddingAdapter.md](web/memory-archive/adapters/HostEmbeddingAdapter.md) | EmbeddingAdapter 宿主实现（复用 embedding service） |
| src/memory-archive/adapters/HostLlmAdapter.ts | [HostLlmAdapter.md](web/memory-archive/adapters/HostLlmAdapter.md) | LlmAdapter 宿主实现（OpenAI 兼容，失败自动降级） |
| src/memory-archive/archiveToolsRegistry.ts | [archiveToolsRegistry.md](web/memory-archive/archiveToolsRegistry.md) | 归档工具注册表（useMemoryArchive ↔ useAgent 传递） |
| src/memory-archive/useArchiveTriggers.ts | [useArchiveTriggers.md](web/memory-archive/useArchiveTriggers.md) | 5 种归档触发机制（观察者模式，最小侵入） |
| src/memory-archive/useMemoryArchive.ts | [useMemoryArchive.md](web/memory-archive/useMemoryArchive.md) | 记忆库集成 composable（生命周期管理） |
| src/modules/registry.ts | [registry.md](web/modules/registry.md) | 模块注册表（Web 端迁移版核心调度器） |
| src/plugins/official/mindmap/composables/useAgentBridge.ts | [useAgentBridge.md](web/plugins/official/mindmap/composables/useAgentBridge.md) | Mindmap ↔ Agent 通信桥（CustomEvent + Action 协议） |
| src/plugins/official/mindmap/composables/useMindmapContextActions.ts | [useMindmapContextActions.md](web/plugins/official/mindmap/composables/useMindmapContextActions.md) | 右键菜单/内联编辑/边操作/实体表单 |
| src/plugins/official/mindmap/composables/useMindmapLayout.ts | [useMindmapLayout.md](web/plugins/official/mindmap/composables/useMindmapLayout.md) | 思维导图布局逻辑（Rust 布局/持久化） |
| src/space/group-chat/composables/useStreamingMessages.ts | [useStreamingMessages.md](web/space/group-chat/composables/useStreamingMessages.md) | 流式消息显示 composable |
| src/space/group-chat/engine/GroupChatEngine.ts | [GroupChatEngine.md](web/space/group-chat/engine/GroupChatEngine.md) | 群聊引擎（提示词分层注入 + 工具集解析） |
| src/stores/archiveStore.ts | [archiveStore.md](web/stores/archiveStore.md) | 归档边界状态管理（Pinia + sessionStorage，P13） |
| src/ui/avatar.ts | [avatar.md](web/ui/avatar.md) | 统一头像工具函数（图片/文字/背景色规则） |
| src/ui/AvatarBadge.vue | [AvatarBadge.md](web/ui/AvatarBadge.md) | 统一头像组件（渲染规则 + avatar:// 解析） |
| src/ui/boot/splash-canvas.ts | [splash-canvas.md](web/ui/boot/splash-canvas.md) | 启动页 Canvas 动效引擎（双 Canvas 分层） |
| src/ui/layout/sidebar/useSidebarDragHandler.ts | [useSidebarDragHandler.md](web/ui/layout/sidebar/useSidebarDragHandler.md) | 侧边栏拖拽处理（拖视图到看板） |
| src/ui/layout/sidebar/useSidebarInteraction.ts | [useSidebarInteraction.md](web/ui/layout/sidebar/useSidebarInteraction.md) | 侧边栏交互处理（点击 vs 拖拽判定修复） |
| src/ui/layout/sidebar/useSidebarPhysics.ts | [useSidebarPhysics.md](web/ui/layout/sidebar/useSidebarPhysics.md) | 侧边栏轮播物理引擎（RAF + 弹簧吸附） |
| src/ui/settings/panels/CompanionPanel.vue | [CompanionPanel.md](web/ui/settings/panels/CompanionPanel.md) | re-export 兼容层（实现迁移 ui-kit） |
| src/ui/settings/panels/PluginsPanel.vue | [PluginsPanel.md](web/ui/settings/panels/PluginsPanel.md) | re-export 兼容层（实现迁移 ui-kit） |
| vite.config.ts | [vite-config.md](web/vite-config.md) | Web 端 Vite 配置：CLI serve 中转设计原则、端口 5174、别名解析与 manualChunks |
| 拆分记录（2026-08-06） | — | tactical-board 的 boardDraw.ts 按绘制主题拆为 boardCoordinates（坐标/命中测试）/boardColors（颜色表）/boardTerrain（地形）/boardUnits（单位）/boardOverlay（高亮/网格/坐标/awareness），boardDraw.ts 保留 BoardRenderData 与分层绘制入口并 `export *` 聚合，公共导出签名不变，原 import 处无需改动；各文件无 ≥ 10 行连续注释块，未生成文档 |

> 索引随整改批次持续推进，未整改模块完成后再补充登记。

### agent-runtime（packages/agent-runtime，TS 共享包）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/index.ts | [index.md](packages/agent-runtime/index.md) | 包入口：端无关 Agent 运行时导出汇总与端特定代码注入说明 |
| src/bridge.ts | [bridge.md](packages/agent-runtime/bridge.md) | 阶段 2.0 批次3 重写：移除 CoreBackend，仅保留类型重导出 |
| src/governor.ts | [governor.md](packages/agent-runtime/governor.md) | Agent 包轻量调控器入口 + bootAgentGovernor 幂等语义 |
| src/governor-modules.ts | [governor-modules.md](packages/agent-runtime/governor-modules.md) | Agent 包模块描述符：critical/normal/lazy 分层激活 |
| src/context/injector.ts | [context-injector.md](packages/agent-runtime/context-injector.md) | 系统提示词注入器 + 共享基础层构建 |
| src/context/summary.ts | [context-summary.md](packages/agent-runtime/context-summary.md) | 消息截断策略（保留 system，截断非系统消息） |
| src/execution/index.ts | [execution-index.md](packages/agent-runtime/execution-index.md) | ExecutionAdapter 工厂注册模式 + WS URL/Token 获取优先级 |
| src/group-chat/flow-control.ts | [group-chat-flow-control.md](packages/agent-runtime/group-chat-flow-control.md) | 群聊三级限流 + 通用退避重试层 |
| src/group-chat/moderator.ts | [group-chat-moderator.md](packages/agent-runtime/group-chat-moderator.md) | 群聊主持 Agent：调度 + 参与双职责 |
| src/group-chat/provider-pool.ts | [group-chat-provider-pool.md](packages/agent-runtime/group-chat-provider-pool.md) | Provider 池管理：ProviderSlot 间接层 + 负载均衡 |
| src/group-chat/speaking-desire.ts | [group-chat-speaking-desire.md](packages/agent-runtime/group-chat-speaking-desire.md) | 群聊发言欲望概率引擎参数映射 |
| src/group-chat/turn-engine.ts | [group-chat-turn-engine.md](packages/agent-runtime/group-chat-turn-engine.md) | 群聊发言策略：mention 优先 + 三主策略 + 执行模式 |
| src/kb/kb-decay.ts | [kb-kb-decay.md](packages/agent-runtime/kb-kb-decay.md) | 记忆衰减与压缩：时间衰减/摘要压缩/软淘汰/定期整理 |
| src/kb/kb-entity-link.ts | [kb-kb-entity-link.md](packages/agent-runtime/kb-kb-entity-link.md) | 实体-记忆图谱打通（知识条目 ↔ 实体联动） |
| src/kb/kb-extractor.ts | [kb-kb-extractor.md](packages/agent-runtime/kb-kb-extractor.md) | 自动记忆提取器：对话分析 + 分类 + 去重 + 写入 |
| src/kb/kb-store.ts | [kb-kb-store.md](packages/agent-runtime/kb-kb-store.md) | 知识库存储层：IndexedDB + global/project 双作用域 |
| src/orchestrator/pi-backend-accessor.ts | [orchestrator-pi-backend-accessor.md](packages/agent-runtime/orchestrator-pi-backend-accessor.md) | CoreBackend → NodeBackendAccessor 适配（签名/事件/消息） |
| src/orchestrator/pi-backend-memory-accessor.ts | [orchestrator-pi-backend-memory-accessor.md](packages/agent-runtime/orchestrator-pi-backend-memory-accessor.md) | localStorage KV 记忆 → MemoryAccessor 适配（阶段 0.7） |
| src/providers/key-store.ts | [providers-key-store.md](packages/agent-runtime/providers-key-store.md) | API Key 加密存储：Keyring 优先 + AES-GCM 降级 |
| src/providers/model-fetcher.ts | [providers-model-fetcher.md](packages/agent-runtime/providers-model-fetcher.md) | 动态模型拉取服务（/v1/models + 24h 缓存） |
| src/providers/model-registry.ts | [providers-model-registry.md](packages/agent-runtime/providers-model-registry.md) | 模型注册表：静态元数据，与 RuntimeModelInfo 语义区分 |
| src/providers/provider-registry.ts | [providers-provider-registry.md](packages/agent-runtime/providers-provider-registry.md) | 供应商统一注册表：单一数据源 + 声明式 + 可扩展 |
| src/session/manager.ts | [session-manager.md](packages/agent-runtime/session-manager.md) | Dexie 会话持久化 + 删除时级联清理图片 |
| src/skills/manifest.ts | [skills-manifest.md](packages/agent-runtime/skills-manifest.md) | 已安装技能 Manifest 解析器（skill.yaml 优先/SKILL.md 降级） |
| src/skills/parser.ts | [skills-parser.md](packages/agent-runtime/skills-parser.md) | SKILL.md/skill.yaml frontmatter 行级解析器 |
| src/skills/platform-adapters.ts | [skills-platform-adapters.md](packages/agent-runtime/skills-platform-adapters.md) | 多平台技能格式双向转换（Claude Code/Cursor/WorldSmith） |
| src/skills/plugin-bridge.ts | [skills-plugin-bridge.md](packages/agent-runtime/skills-plugin-bridge.md) | 插件能力桥接：Skill 系统 ↔ 插件系统 |
| src/skills/registry.ts | [skills-registry.md](packages/agent-runtime/skills-registry.md) | Skill 注册中心：工具白名单/合并/提示词生成/一致性校验 |
| src/skills/data/*.ts | （无独立注释文档，见 skills-registry.md 拆分记录） | SKILL_REGISTRY 静态数据按类别拆分：creation/analysis/development/communication/worldbuilding/other + visibility 辅助 |
| src/skills/skills-store.ts | [skills-skills-store.md](packages/agent-runtime/skills-skills-store.md) | 本地导入技能：写 skill.yaml + SKILL.md（不触发重扫） |
| src/skills/__tests__/manifest.spec.ts | [skills-tests-manifest-spec.md](packages/agent-runtime/skills-tests-manifest-spec.md) | frontmatterToSkillMeta 转换逻辑单元测试 |
| src/skills/__tests__/platform-adapters.spec.ts | [skills-tests-platform-adapters-spec.md](packages/agent-runtime/skills-tests-platform-adapters-spec.md) | 多平台技能格式互通单元测试 |
| src/stores/image-persistence.ts | [stores-image-persistence.md](packages/agent-runtime/stores-image-persistence.md) | 图像 IndexedDB 持久化（虚拟路径格式） |
| src/stores/image-store.ts | [stores-image-store.md](packages/agent-runtime/stores-image-store.md) | 内存级图像缓存（30 分钟 TTL） |
| src/stores/video-persistence.ts | [stores-video-persistence.md](packages/agent-runtime/stores-video-persistence.md) | 视频 IndexedDB 持久化（元数据 + Blob） |
| src/toolbus/toolbus.ts | [toolbus-toolbus.md](packages/agent-runtime/toolbus-toolbus.md) | 激活技能 → 工具集解析（三层数据源） |
| src/utils/smart-fetch.ts | [utils-smart-fetch.md](packages/agent-runtime/utils-smart-fetch.md) | 统一网络请求：Tauri plugin:http 绕过 CORS / Web fetch |
| src/tools/a2ui-helpers.ts | [tools-a2ui-helpers.md](packages/agent-runtime/tools-a2ui-helpers.md) | A2UI 辅助渲染：Surface-Component-DataModel 三层模型 |
| src/tools/algo-tools.ts | [tools-algo-tools.md](packages/agent-runtime/tools-algo-tools.md) | 算法工具集：Rust 引擎（R-Tree/几何/图/CRDT/地形等） |
| src/tools/coding-agent-tools.ts | [tools-coding-agent-tools.md](packages/agent-runtime/tools-coding-agent-tools.md) | 编码 Agent 标准工具集：对齐 Claude Code/Cline/Cursor |
| src/tools/content-search.ts | [tools-content-search.md](packages/agent-runtime/tools-content-search.md) | 内容搜索：keyword/semantic/hybrid 三种模式 |
| src/tools/crawl-tool.ts | [tools-crawl-tool.md](packages/agent-runtime/tools-crawl-tool.md) | 深度网页爬取：Crawl4AI 优先 + Jina Reader 降级 |
| src/tools/entity-context.ts | [tools-entity-context.md](packages/agent-runtime/tools-entity-context.md) | 实体上下文聚合：七种 scope 粒度 |
| src/tools/entity-crud.ts | [tools-entity-crud.md](packages/agent-runtime/tools-entity-crud.md) | 实体 CRUD 全生命周期 + Embedding 索引同步 |
| src/tools/file-tools.ts | [tools-file-tools.md](packages/agent-runtime/tools-file-tools.md) | 文件管理工具集：工作区文件完整生命周期 |
| src/tools/kb-tools.ts | [tools-kb-tools.md](packages/agent-runtime/tools-kb-tools.md) | 知识库工具集（write/read/list/search/delete/extract/reflect/link） |
| src/tools/memory.ts | [tools-memory.md](packages/agent-runtime/tools-memory.md) | 长期记忆模块：双层存储 + 检索评分规则 + 混合召回 |
| src/tools/native-tools.ts | [tools-native-tools.md](packages/agent-runtime/tools-native-tools.md) | 桌面原生能力工具集（Tauri 插件，Web 降级） |
| src/tools/orchestrator-tools.ts | [tools-orchestrator-tools.md](packages/agent-runtime/tools-orchestrator-tools.md) | Agent 调度器：CustomEvent 调度 9 种子 Agent |
| src/tools/output-tools.ts | [tools-output-tools.md](packages/agent-runtime/tools-output-tools.md) | 输出块工具集：13 个交互式 UI 组件渲染 |
| src/tools/pipeline-tools.ts | [tools-pipeline-tools.md](packages/agent-runtime/tools-pipeline-tools.md) | 创作编排工具集：9 工具管理创作 Pipeline |
| src/tools/plugin-backend-tools.ts | [tools-plugin-backend-tools.md](packages/agent-runtime/tools-plugin-backend-tools.md) | 插件后端工具集（域级合并版，CustomEvent 通信） |
| src/tools/plugin-tools.ts | [tools-plugin-tools.md](packages/agent-runtime/tools-plugin-tools.md) | 通用插件操作工具集：跨插件统一操作接口 |
| src/tools/retrofit-tools.ts | [tools-retrofit-tools.md](packages/agent-runtime/tools-retrofit-tools.md) | 安全改造工具集：Negotiate→Apply 五阶段工作流 |
| src/tools/schema-tools.ts | [tools-schema-tools.md](packages/agent-runtime/tools-schema-tools.md) | Schema 管理工具集（Tauri 后端，注册/验证/导出） |
| src/tools/task-tools.ts | [tools-task-tools.md](packages/agent-runtime/tools-task-tools.md) | task_complete 工具：显式完成声明（Anthropic 三原则） |
| src/tools/terminal-launcher-tools.ts | [tools-terminal-launcher-tools.md](packages/agent-runtime/tools-terminal-launcher-tools.md) | 终端启动器：模式检测 + worldsmith-server 自动启动 |
| src/tools/tool-meta-registry.ts | [tools-tool-meta-registry.md](packages/agent-runtime/tools-tool-meta-registry.md) | 工具元数据注册中心：全局 ToolRegistry + 别名解析 |
| src/tools/video-gen-tools.ts | [tools-video-gen-tools.md](packages/agent-runtime/tools-video-gen-tools.md) | 视频生成：供应商协议统一抽象（提交/轮询） |
| src/tools/vision-tools.ts | [tools-vision-tools.md](packages/agent-runtime/tools-vision-tools.md) | 视觉分析：OpenAI/Anthropic/Gemini 三套 API 格式 |
| src/__tests__/always-available-verify.spec.ts | [tests-always-available-verify-spec.md](packages/agent-runtime/tests-always-available-verify-spec.md) | alwaysAvailable meta 等价性回归测试 |

### packages/entity-core（packages/entity-core）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/composables/useFileSystemProject.ts | [useFileSystemProject.md](packages/entity-core/composables/useFileSystemProject.md) | 项目目录绑定与导出（对接 FileStorageBackend 体系） |
| src/composables/useFsWatcher.ts | [useFsWatcher.md](packages/entity-core/composables/useFsWatcher.md) | 文件系统变更监听（模块级单例 + 引用计数） |
| src/composables/useImageResolver.ts | [useImageResolver.md](packages/entity-core/composables/useImageResolver.md) | 图片解析重试管理（事件优先 + 退避兜底） |
| src/core/FileStorageBackend.ts | [FileStorageBackend.md](packages/entity-core/core/FileStorageBackend.md) | 本地文件系统存储后端（JSON 落盘 + 降级 fallback） |
| src/core/ProjectFS.ts | [ProjectFS.md](packages/entity-core/core/ProjectFS.md) | 项目文件系统导出/导入（目录结构规范） |
| src/core/ProjectMigration.ts | [ProjectMigration.md](packages/entity-core/core/ProjectMigration.md) | 一次性数据迁移（全局库 → 项目库，增量拷贝/分批） |
| src/core/ProjectSwitcherApi.ts | [ProjectSwitcherApi.md](packages/entity-core/core/ProjectSwitcherApi.md) | 项目切换服务接口（依赖注入解耦） |
| src/core/RelationshipRegistry.ts | [RelationshipRegistry.md](packages/entity-core/core/RelationshipRegistry.md) | 全局关系注册中心（集中声明 + source/target 索引） |
| src/core/TraitRuntime.ts | [TraitRuntime.md](packages/entity-core/core/TraitRuntime.md) | Trait/EntitySchema 运行时（compileEntitySchema 编译逻辑） |
| src/core/events.ts | [events.md](packages/entity-core/core/events.md) | 事件总线 + 生命周期事件（跨模块通信基础设施） |
| src/core/formula-auto.ts | [formula-auto.md](packages/entity-core/core/formula-auto.md) | Formula 自动重算（监听 field:change） |
| src/core/formula.ts | [formula.md](packages/entity-core/core/formula.md) | 轻量公式引擎（四则/比较/逻辑/聚合，无 eval 沙箱） |
| src/core/io/ExportController.ts | [ExportController.md](packages/entity-core/core/io/ExportController.md) | 统一导出调度器（Serializer 遍历组装 WorldSmithPack） |
| src/core/io/ImportController.ts | [ImportController.md](packages/entity-core/core/io/ImportController.md) | 统一导入调度器（拓扑排序恢复，overwrite/merge） |
| src/core/io/PackageBuilder.ts | [PackageBuilder.md](packages/entity-core/core/io/PackageBuilder.md) | .ws 包构建器（ZIP 归档 + 媒体内嵌） |
| src/relations/index.ts | [index.md](packages/entity-core/relations/index.md) | 全局关系定义 v1.0（20 插件提取/去重/合并） |
| src/traits/index.ts | [index.md](packages/entity-core/traits/index.md) | 原子 Trait 定义 v1.1（13 个原子 Trait） |
| src/types/trait.ts | [trait.md](packages/entity-core/types/trait.md) | Trait 类型系统 v1.0（字段最小语义集 + 设计决策） |

### packages/shared-composables（packages/shared-composables）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/agent/deps.ts | [deps.md](packages/shared-composables/agent/deps.md) | Agent UI 端依赖注入契约（provide/inject） |
| src/agent/long-task/longTaskStore.ts | [longTaskStore.md](packages/shared-composables/agent/long-task/longTaskStore.md) | 长任务持久化层（Dexie/IndexedDB + checkpoint 快照） |
| src/agent/long-task/useLongTask.ts | [useLongTask.md](packages/shared-composables/agent/long-task/useLongTask.md) | 长任务管理器（状态机/心跳/checkpoint/协作式取消） |
| src/agent/useAgent.ts | [useAgent.md](packages/shared-composables/agent/useAgent.md) | 端无关 Agent Backend 注入层（注入契约） |
| src/agent/useAgentEvents.ts | [useAgentEvents.md](packages/shared-composables/agent/useAgentEvents.md) | Agent 事件处理（事件流 → toolCalls/进度/计划同步） |
| src/agent/useCliAgent.ts | [useCliAgent.md](packages/shared-composables/agent/useCliAgent.md) | CLI Agent 连接管理 |
| src/agent/useEntityMentionIndex.ts | [useEntityMentionIndex.md](packages/shared-composables/agent/useEntityMentionIndex.md) | 实体名反向索引（文本匹配） |
| src/agent/useManuscriptAnimation.ts | [useManuscriptAnimation.md](packages/shared-composables/agent/useManuscriptAnimation.md) | 手稿块打字机动画（自适应延迟 + 降低动效） |
| src/agent/useMcpConnections.ts | [useMcpConnections.md](packages/shared-composables/agent/useMcpConnections.md) | MCP 连接管理（options.getAgent 注入解耦） |
| src/agent/useMessageSpeaker.ts | [useMessageSpeaker.md](packages/shared-composables/agent/useMessageSpeaker.md) | 消息发言者信息（依赖注入 + 数据流统一） |
| src/agent/useOrchestrator.ts | [useOrchestrator.md](packages/shared-composables/agent/useOrchestrator.md) | 子 Agent 长任务跟踪（checkpoint + 心跳） |
| src/agent/useSkillsStore.ts | [useSkillsStore.md](packages/shared-composables/agent/useSkillsStore.md) | 技能商城状态管理（非 Tauri 降级） |
| src/entity/useEntityMiniPanel.ts | [useEntityMiniPanel.md](packages/shared-composables/entity/useEntityMiniPanel.md) | 实体卡片小窗状态管理（模块级单例） |

### packages/ui-kit（packages/ui-kit）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/components/entity/map/useAdjoin.ts | [useAdjoin.md](packages/ui-kit/components/entity/map/useAdjoin.md) | 接壤模式 composable（borders 关系 + 合并逻辑） |
| src/components/entity/map/useBorderErase.ts | [useBorderErase.md](packages/ui-kit/components/entity/map/useBorderErase.md) | 抹除/移动边境线 composable（偏移/重划模式） |
| src/components/entity/map/useDrawing.ts | [useDrawing.md](packages/ui-kit/components/entity/map/useDrawing.md) | 绘制模式 composable（手绘 + Alt 边境线） |
| src/index.ts | [index.md](packages/ui-kit/index.md) | ui-kit FACADE 包说明（聚合/委托导出） |

### packages/shared-ui（packages/shared-ui）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/agent/blocks/interactive-tool/utils.ts | [utils.md](packages/shared-ui/agent/blocks/interactive-tool/utils.md) | InteractiveToolCall 共享工具函数（标签/格式化/截断） |
| src/agent/bubbles/useMarkdownRender.ts | [useMarkdownRender.md](packages/shared-ui/agent/bubbles/useMarkdownRender.md) | Markdown 渲染 composable（消毒 + mention 注入 + rAF 节流） |
| src/agent/message-list/useMessageWindowing.ts | [useMessageWindowing.md](packages/shared-ui/agent/message-list/useMessageWindowing.md) | 消息列表窗口化 + 滚动锚定 composable |

### packages/perf-kit（packages/perf-kit）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/reactive/batchedUpdates.ts | [batchedUpdates.md](packages/perf-kit/reactive/batchedUpdates.md) | 批量更新合并器（解决 PERF-03 更新风暴） |
| src/render/idleRaf.ts | [idleRaf.md](packages/perf-kit/render/idleRaf.md) | 空闲 RAF 管理器（解决 PERF-22 常驻 CPU） |
| src/render/virtualList.ts | [virtualList.md](packages/perf-kit/render/virtualList.md) | 通用虚拟滚动 hook（前缀和 + 二分定位） |

### packages/theme-kit（packages/theme-kit）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/motion-override.ts | [motion-override.md](packages/theme-kit/motion-override.md) | Motion Override Engine：覆盖缓动/时长/motion-scale、注入关键帧、设置交互模式 |

### packages/plugin-sdk（packages/plugin-sdk）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/components/EntityFormModal.vue（2026-08-06 script 拆分） | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | 实体表单弹窗：模板 + 编排，五类逻辑拆为 4 个 composable（行为不变） |
| src/components/entity/useFieldPresets.ts | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | 字段合并（SYSTEM_KEYS + fieldRegistry）、预设管理、拖拽排序、字段增删 |
| src/components/entity/useDynamicForm.ts | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | formData 状态与初始化、输入事件（name/text 事件总线）、ghost 500ms 防抖 |
| src/components/entity/useEntityRefSearch.ts | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | entityRef 类型字段的搜索下拉状态与交互 |
| src/components/entity/useEntityFormSave.ts | [entity-form-modal.md](packages/plugin-sdk/entity-form-modal.md) | save 校验/收集（properties/tags/entityRef/autoLink/封面）、实体引用关系同步 |

> packages/canvas-engine、packages/font-kit、packages/motion-kit 的 src/ 下无 ≥ 10 行长注释块，未生成文档。
> plugin-sdk 本次拆分：4 个 composable 均为短注释（<10 行连续块），详细说明统一登记于 entity-form-modal.md。
