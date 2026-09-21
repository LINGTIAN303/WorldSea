# 详细注释文档索引

> 承载代码内注释分层后的「详细」层（why/how）：设计决策、整体思路、模块职责、事件协议、踩坑约束。
> 代码文件内仅保留一行简要注释 + 本目录相对路径；此处按模块与代码文件一一对应。
> 配套规则见【[2026-08-06-comment-hierarchy-plan.md](../../plans/已完成/2026-08-06-comment-hierarchy-plan.md)】。
> 代码变更影响注释含义时，必须同步更新本目录对应文档。

## 模块清单

### agent-runtime（crates/：agent-runtime 聚合壳 → agent-kernel 底座 + agent-patterns 扩展）

> **2026-08-25 crate 拆分**：`agent-runtime` 已转聚合壳（转发两子 crate，对外路径不变），代码物理位于
> `crates/agent-kernel/src`（底座）与 `crates/agent-patterns/src`（扩展模式）。以下代码文件列按新物理路径标注。

#### agent-kernel（底座，`crates/agent-kernel/src`）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| kernel/agent/（AgentLoop 最小闭环） | [agent.md](agent-runtime/agent.md) | AgentLoop ReAct 核心循环：配置、主循环、工具执行、记忆注入、织入点 Hook 协议 |
| kernel/node.rs | [node.md](agent-runtime/node.md) | 节点接口与上下文（OrchestratorNode + NodeType 10 变体） |
| kernel/orchestrator.rs | [orchestrator.md](agent-runtime/orchestrator.md) | 编排器接口与执行（DefaultOrchestrator 图宿主） |
| kernel/backend.rs | [backend.md](agent-runtime/backend.md) | LLM 后端访问器（NodeBackendAccessor） |
| kernel/tool.rs + tool_context.rs + tool_hook.rs | [tool.md](agent-runtime/tool.md) | 工具调用抽象：ToolBus/白名单/上下文/生命周期钩子 |
| kernel/memory.rs | [memory.md](agent-runtime/memory.md) | 记忆访问器（MemoryAccessor 横切服务） |
| kernel/event.rs | [event.md](agent-runtime/event.md) | 编排事件模型与序列化契约 |
| kernel/types.rs | — | 编排状态与消息共享类型（含 PlanItem/ReflectionResult 等） |
| kernel/confirmation.rs | — | 权限确认策略（治理层） |
| kernel/loop_control.rs | [loop_control.md](agent-runtime/loop_control.md) | LoopController 限流/超时/看门狗自动控制（工程横切） |
| kernel/long_task.rs | [long_task.md](agent-runtime/long_task.md) | 长任务管理器（检查点/心跳/看门狗） |
| kernel/llm/ | [llm.md](agent-runtime/llm.md) | LLM 通信层（Provider 配置/清单/流式/GenaiBackend） |
| kernel/alias.rs / mcp.rs / a2ui.rs / deep_phases.rs / scenario.rs | alias.md / [mcp.md](agent-runtime/mcp.md) / [a2ui.md](agent-runtime/a2ui.md) / [deep_phases.md](agent-runtime/deep_phases.md) | 工具别名 / MCP 适配 / A2UI 渲染 / 深度任务层 / 场景上下文（可承载类层锚点） |
| kernel/router_decider.rs（2026-08-25 新增） | — | RouterDecider trait + Pipeline/RouterDecision（消除 kernel→patterns 反向依赖） |
| kernel/sub_agent_pool.rs（2026-08-25 新增） | — | SubAgentSpec +SubAgentPool 共享运行时（Supervisor 与命令层双池统一，§7 待决 7） |
| kernel/lib.rs | [lib.md](agent-runtime/lib.md) | 底座内核导出与架构总览 |

#### agent-patterns（扩展模式，`crates/agent-patterns/src`）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| patterns/supervisor/ | [supervisor.md](agent-runtime/supervisor.md) | 监督者：子 Agent 显式调度（池已下沉 SubAgentPool） |
| patterns/router/ | [router.md](agent-runtime/router.md) | 模型路由选择 / A3 四管线 |
| patterns/multi_agent/ | [multi_agent.md](agent-runtime/multi_agent.md) | 去中心化多 Agent 协作模式 |
| patterns/tot/（原 tree_of_thoughts） | [tree_of_thoughts.md](agent-runtime/tree_of_thoughts.md) | ToT 思维树 |
| patterns/got/（原 graph_of_thoughts） | [graph_of_thoughts.md](agent-runtime/graph_of_thoughts.md) | GoT 思维图谱 |
| patterns/plan_execute/（原 plan.rs） | — | Plan-and-Execute 节点（plan.rs 拆分目录） |
| patterns/reflective/（原 reflection.rs） | — | Reflection + Self-Refine（ReflectionNode/RefineNode 同域） |
| patterns/shared/（thoughts.rs + json.rs） | — | 跨模式共享类型与 JSON 工具（GoT/ToT 解耦落点） |
| 拆分记录（2026-08-06） | — | 测试已分离：agent/supervisor/tree_of_thoughts/multi_agent/router/long_task/graph_of_thoughts 的测试模块迁出至对应 `*_tests.rs`（`#[path]` 引入） |

### agent-commands（crates/agent-commands）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/lib.rs | [lib.md](agent-commands/lib.md) | 命令层服务：AgentLoop 封装、会话管理、Phase 5.1/5.4 演进说明 |
| src/loop_control.rs | [loop_control.md](agent-commands/loop_control.md) | Loop Control 注册表：task_id 管理、事件广播、与 Tauri 命令映射 |
| src/subagent.rs | [subagent.md](agent-commands/subagent.md) | 子 Agent 编排：委派工具、懒加载实例池、事件广播器注入 |
| src/subagent_store.rs | [subagent_store.md](agent-commands/subagent_store.md) | 子 Agent 规格 SQLite 持久化（JSON 整条存储，启动加载/写穿） |
| src/long_task_store.rs | [long_task_store.md](agent-commands/long_task_store.md) | 长任务 SQLite 持久化（表结构 + 仓库 API） |
| src/sandbox/{mod.rs, win.rs} | [sandbox.md](agent-commands/sandbox.md) | E3 真沙箱：受限令牌 + ACL 授予 / 会话级 temp 生命周期 / 撤销口径与边界登记（E3-1..E3-4） |
| src/terminal.rs | [terminal.md](agent-commands/terminal.md) | 终端工具：execute_command / 持久化 Shell 会话设计；E3 沙箱接线与文案口径（2026-09-18 补充） |
| src/{timers.rs, timer_tools.rs} | [timers.md](agent-commands/timers.md) | 定时唤醒（批次 C·S1）：`session_timers` 状态机 + 认领幂等 / 载荷与来源标记跨层契约 / 护栏与失败语义 / 已知边界 |
| src/session_store.rs（+ session_branch.rs / session_fork.rs 同域） | [session_store.md](agent-commands/session_store.md) | 会话族：不可变日志 / 活跃视图 / 事件流三层 + 请求快照结构级重建链 + 分叉与装载期冷修复（S3 会话族；2026-09-21 补写——代码内指针原为悬空） |
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

### cli（apps/cli，已删除 2026-08-08）

> TS 版 `apps/cli` 已随 web-to-tauri 迁移删除，由 `crates/cli`（Rust binary `worldsea`）接管；**`crates/cli` 亦于 2026-08-08 移除**（chat / 文件读写 / 命令执行能力由 Tauri 端 `agent-commands` 覆盖）；原注释文档（serve / node-adapter / python-routes）已同步删除，git 历史可找回。

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
| src/core/coreBackend.ts | [coreBackend.md](tauri/coreBackend.md) | coreBackend Phase 3 端分离：移除 WASM、纯 invoke 路径、签名兼容；2026-08-06 收敛为 api/ 领域拆分聚合（re-export） |
| src/main.ts | [main.md](tauri/main.md) | Tauri 端入口：端分离策略、Phase 3/4 演进说明 |
| src-tauri/src/commands.rs | [commands.md](tauri/commands.md) | Tauri 命令层：Agent 主链路 14 命令（薄包装 AgentCommandService）、事件名协议（含 agent:event:deep_phase_changed:{session_id} 后缀） |
| vite.config.ts | [vite-config.md](tauri/vite-config.md) | Tauri 端 Vite 配置：IPC 直连设计原则、WASM 算法降级、端口与构建触发 |
| src/memory-archive/adapters/TauriFsOperations.ts | [TauriFsOperations.md](tauri/TauriFsOperations.md) | FsOperations 的 Tauri 实现：cmd_fs_* 命令映射 |
| src/plugins/workflow/api/workflowApi.ts | [workflowApi.md](tauri/workflowApi.md) | Workflow 引擎命令调用层：28 个命令镜像、设计要点 |
| src/plugins/workflow/composables/useWorkflowEngineRun.ts | [useWorkflowEngineRun.md](tauri/useWorkflowEngineRun.md) | 直接 Dispatch 兜底通道运行控制器：工作机制与注意 |
| 拆分记录（2026-08-06） | — | coreBackend.ts 按领域拆为 src/core/api/（schema / retrofit / entity / algo / health / runtime + index 聚合），coreBackend.ts 保留 `export * from './api'`，类型统一来自 @worldsea/core-api-types，公共导出签名不变，原 import 处无需改动；各新文件无 ≥ 10 行连续注释块，未生成新文档 |

### web（apps/web，已删除 2026-08-08）

> TS 版 `apps/web` 已随 web-to-tauri 迁移删除（原 Web 主应用：27 插件 + 空间 + 设置已全部迁入 `apps/tauri`）；原注释文档（约 60 个，覆盖 agent/governor/memory-archive/plugins/space/stores/ui 等）已同步删除，git 历史可找回。

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
| src/skills/platform-adapters.ts | [skills-platform-adapters.md](packages/agent-runtime/skills-platform-adapters.md) | 多平台技能格式双向转换（Claude Code/Cursor/WorldSea） |
| src/skills/plugin-bridge.ts | [skills-plugin-bridge.md](packages/agent-runtime/skills-plugin-bridge.md) | 插件能力桥接：Skill 系统 ↔ 插件系统 |
| src/skills/registry.ts | [skills-registry.md](packages/agent-runtime/skills-registry.md) | Skill 注册中心：工具白名单/合并/提示词生成/一致性校验 |
| src/skills/data/*.ts | （无独立注释文档，见 skills-registry.md 拆分记录） | SKILL_REGISTRY 静态数据（批 3 后仅存 communication.ts 的 creation-orchestrator）+ visibility 辅助 |
| src/skills/skills-store.ts | [skills-skills-store.md](packages/agent-runtime/skills-skills-store.md) | 技能写入封装：安装/卸载/本地导入（SKILL.md + sidecar）/ 创建入口（不触发重扫，S2 更新） |
| src/skills/creator.ts | [skills-creator.md](packages/agent-runtime/skills-creator.md) | 创建/导入组装层：规范 SKILL.md + 可选 sidecar 生成（回读自检，S2 管理面） |
| src/skills/validator.ts | [skills-protocol.md](packages/agent-runtime/skills-protocol.md) | Skill 协议校验器：规范规则集（name/description/compatibility）+ 私有键 warn（S1 协议基座） |
| src/skills/sidecar.ts | [skills-protocol.md](packages/agent-runtime/skills-protocol.md) | Skill sidecar（worldsea.skill.json）：D2 私有字段承载，宽容解析降级 |
| src/skills/__tests__/*.spec.ts | [skills-protocol.md](packages/agent-runtime/skills-protocol.md) + [skills-creator.md](packages/agent-runtime/skills-creator.md)（测试说明见文内「设计要点」） | 协议基座契约测试：解析器（flow/分隔符/metadata/缩进）+ 校验器 + sidecar + 创建模板/导入组装/合并策略（46 用例） |
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
| src/tools/retrofit-tools.ts | [tools-retrofit-tools.md](packages/agent-runtime/tools-retrofit-tools.md) | 安全改造工具集：Negotiate→Apply 五阶段工作流 |
| src/tools/schema-tools.ts | [tools-schema-tools.md](packages/agent-runtime/tools-schema-tools.md) | Schema 管理工具集（Tauri 后端，注册/验证/导出） |
| src/tools/task-tools.ts | [tools-task-tools.md](packages/agent-runtime/tools-task-tools.md) | task_complete 工具：显式完成声明（Anthropic 三原则） |
| src/tools/terminal-launcher-tools.ts | [tools-terminal-launcher-tools.md](packages/agent-runtime/tools-terminal-launcher-tools.md) | 终端启动器：模式检测 + worldsea-server 自动启动 |
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
| src/core/io/ExportController.ts | [ExportController.md](packages/entity-core/core/io/ExportController.md) | 统一导出调度器（Serializer 遍历组装 WorldSeaPack） |
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
| src/components/settings/panels/BuiltinToolsPanel.vue | [builtin-tools-panel.md](packages/ui-kit/builtin-tools-panel.md) | 内置工具面板（只读目录：20 分类折叠 + 权限徽标） |
| src/components/settings/panels/AgentPluginsPanel.vue | [agent-plugins-panel.md](packages/ui-kit/agent-plugins-panel.md) | Agent 插件面板（能力打包分发层，空状态占位 + 术语界定） |
| src/components/settings/panels/SproutsPanel.vue | — | 芽管理面板（27 个世界观芽开关 + 分类筛选 + 拖拽排序；2026-09-10 由 PluginsPanel 更名） |
| src/components/settings/settings-panels.css | [settings-panels-convention.md](packages/ui-kit/settings-panels-convention.md) | 设置面板统一约定（三契约/基座样式/scoped 陷阱/卡片清单） |
| src/index.ts | [index.md](packages/ui-kit/index.md) | ui-kit FACADE 包说明（聚合/委托导出） |

### packages/shared-ui（packages/shared-ui）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/agent/blocks/interactive-tool/utils.ts | [utils.md](packages/shared-ui/agent/blocks/interactive-tool/utils.md) | InteractiveToolCall 共享工具函数（标签/格式化/截断） |
| src/agent/bubbles/codeHighlight.ts | [codeHighlight.md](packages/shared-ui/agent/bubbles/codeHighlight.md) | Prism 语法高亮 + **内容键 memo**（C7：消除「内容未变却重复高亮」两条热路径；参考实现供门禁判别力自证） |
| src/agent/bubbles/markdownStream.ts | [markdownStream.md](packages/shared-ui/agent/bubbles/markdownStream.md) | 流式 Markdown 内核（C2）：分块判定线（最后一个内容 token）+ 保守回退（def/html）+ 增量渲染器（token 缓存，增量 ≡ 全量契约） |
| src/agent/bubbles/useMarkdownRender.ts | [useMarkdownRender.md](packages/shared-ui/agent/bubbles/useMarkdownRender.md) | Markdown 渲染 composable（Vue 接线：rAF 节流 + 字体段 + JSON 剥离；增量内核见 markdownStream.md） |
| src/agent/message-list/useMessageWindowing.ts | [useMessageWindowing.md](packages/shared-ui/agent/message-list/useMessageWindowing.md) | 消息列表窗口化 + 滚动锚定 composable |
| src/agent/stream/rows/thinkSummary.ts | [thinkSummary.md](packages/shared-ui/agent/stream/rows/thinkSummary.md) | 推理行摘要（C1 推理流式专项）：定向扫描替代全文逐行切分（等价性契约 + 判别力自证；参考实现留在源码供门禁对照） |
| src/agent/stream/groupTurns.ts | [groupTurns.md](packages/shared-ui/agent/stream/groupTurns.md) | 事件行流 → 轮次分组 + **整组复用**（帧率修复③：源行引用全等则复用分组对象，使流式每 delta 只重渲被触及的轮次） |

### packages/perf-kit（packages/perf-kit）

| 代码文件 | 详细注释文档 | 摘要 |
|---|---|---|
| src/reactive/batchedUpdates.ts | [batchedUpdates.md](packages/perf-kit/reactive/batchedUpdates.md) | 批量更新合并器（解决 PERF-03 更新风暴） |
| src/render/idleRaf.ts | [idleRaf.md](packages/perf-kit/render/idleRaf.md) | 空闲 RAF 管理器（解决 PERF-22 常驻 CPU） |
| src/render/virtualList.ts | [virtualList.md](packages/perf-kit/render/virtualList.md) | 通用虚拟滚动 hook（前缀和 + 二分定位） |

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
