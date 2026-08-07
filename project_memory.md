<!-- HIPPOCAMPUS:SECTION:project_memory START -->
# WorldSmith 项目记忆文档

> 本文档由主要执行 Agent 维护，记录项目概况、架构、任务状态与关键决策。
> 任务路线独立维护于 docs/plans/ROADMAP.md，防止本文档反复更新导致任务丢失。
> 最后更新：2026-08-02

## 一、项目概况

- **项目名**：WorldSmith
- **定位**：AI 驱动的世界观构建平台（worldbuilding platform）
- **仓库**：https://github.com/LINGTIAN303/WorldSmith.git
- **许可证**：MIT
- **版本**：0.0.0（开发中，启动页显示 v0.1.0-alpha）
- **部署**：单二进制部署（Tauri），Web 模式可独立运行
- **项目状态**：本地开发，暂不上线与推送

## 二、技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + TypeScript 6 + Vite 8 + Pinia + Naive UI |
| 桌面 | Tauri 2（Rust 后端）|
| WASM 核心 | Rust（worldsmith-core、tactical-engine）|
| Agent (TS) | @earendil-works/pi-ai 框架 + 自定义 ToolBus（工具总线），核心在 `packages/agent-runtime` |
| Agent (Rust) | `crates/agent-runtime`（genai LLM 层 + tokio 编排），Tauri 命令桥接，主应用默认后端 |
| 编排模式 | Rust：ToT / GoT / Multi-Agent / Supervisor / Router / Loop Engineering |
| 图表 | ECharts、Sigma.js、D3、Graphology |
| 编辑器 | TipTap 3 |
| 数据库 | IndexedDB（Dexie）/ SQLite（Tauri）|
| 构建 | pnpm monorepo（packages/ 下 13 个子包 + apps/ 三端骨架）|

## 三、后端架构（2026-08-04 更新，端分离后结构）

> 2026-07-05 调研结论（hippocampus 记忆 305b700e / 847beb6f），2026-08-04 对齐端分离实际结构

1. **worldsmith-core**（Rust → WASM）：约 70 个导出方法 — 存储、校验、图布局、迁移
2. **tactical-engine**（Rust → WASM）：18 个导出方法 — 寻路、战斗 AI
3. **crates/agent-runtime**（Rust，2026-07-25 起新增）：Rust Agent 后端 — AgentLoop/GenaiBackend/ToolBus/ToT/GoT/Multi-Agent/Supervisor/Router/Loop-Engineering/LongTask，经 Tauri 命令层暴露
4. **apps/tauri/src-tauri**（Rust）：Tauri 桌面端命令层 — 工作流引擎、文件系统、agent_bridge（14 agent 命令 + session 6 命令 + long_task/loop_control 等）
5. **worldsmith-skills-store**（Rust，2026-07-07 起新增）：Skills Store 独立 crate（19+ 单测，无 Tauri 依赖）
6. **apps/cli**（Node.js）：CLI 端（commander：chat / serve，HTTP+WS 服务），python-services 微服务（crawl/convert/vector-search 能力已从旧 worldsmith-server 迁入）
7. **packages/agent-runtime**（TS）：端无关 Agent 运行时（Agent 核心、工具、技能、会话、ExecutionAdapter）— 原 worldsmith-agent 核心已下沉至此

**覆盖度结论**：约 40-45% 后端功能尚未触达前端 UI；CRDT 协同算法全套（15 个函数）未接入前端。Rust Agent 编排模式（ToT/GoT/Multi-Agent/Supervisor/Router/Loop）已有前端 composable，但 UI 端到端实测待补。

## 四、Monorepo 子包（packages/）

agent-core / agent-runtime / canvas-engine / entity-core / font-kit / governor-core / memory-archive / motion-kit / perf-kit / plugin-sdk / shared-composables / theme-kit / ui-kit（共 13 个）

## 五、当前任务状态

- **ROADMAP**：28 条任务方向，分 8 大类别（详见 docs/plans/ROADMAP.md；任务 1 ✅、任务 3 ✅、任务 4 ✅（P1-P4 + task 模式方向 A-D）、任务 24 进行中（阶段 1-4 完成，待桌面端 UI 实测），其余待启动）
- **Rust Agent 后端**：阶段 1.1-1.5 ✅、阶段 2.0（UI 集成）✅、阶段 2.5（会话持久化）✅、Phase 2 Loop Engineering（long_task/loop_control）✅；待办：failTask 终态闭环重测、深度模式/A2UI/终端/子 Agent 补齐
- **端分离**：✅ **全部完成（2026-08-04）**。Phase 1-6 全落地，根级 `src/`、`src-tauri/`、`worldsmith-server/`、`worldsmith-agent/` 已删除，业务 UI 全部迁入 `apps/web`（主应用入口）、`apps/tauri`、`apps/cli`；提交 `980385c`（重构主体）+ `c08c235`（文档同步）。docs/details/端分离/ 作为历史迁移记录归档
- **工作区收敛**：@agent 统一到 packages/agent-runtime 单轨（c3856de），worldsmith-agent 冻结为端适配器宿主
- **实际文档**（2026-08-06 四类结构）：docs/index/README.md（文档索引，摘要层）、docs/plans/（计划类：ROADMAP / agent-e2e-closure-plan / agent-orchestration-roadmap / perf-kit-plan / skills-store-spec / rust-backend-completion-plan / phase4-scheduler-plan）、docs/details/（详情类：ARCHITECTURE.md、端分离/ 迁移文档库 11 份、memory-archive/ 设计 3 份）、docs/misc/（其他：self-iteration-decisions、skills-store-test-source）
- **注意**：docs/replication-wiki/ 目录当前不存在（会话初读到的 README 为工具缓存旧内容）；项目结构以源码与 README.md 为准
- **任务类别**：Agent 系统增强 / 编辑器与内容创作 / 插件系统与实体详情 / AutoLink 与关系系统 / 图谱与可视化 / UI 视觉字体 / 商城与外部集成 / 系统功能

## 六、hippocampus 记忆配置

- **session_id 约定**：catpaw-worldsmith-{日期}（当前：catpaw-worldsmith-20260707）
- **project_id**：worldsmith
- **历史 session**：a3f7b2c1-4d5e-4f6a-8b9c-0d1e2f3a4b5c（2026-07-05 调研；retrieve 旧记忆需用此 session_id）
- **规则文件**：.catpaw/rules/hippocampus-archive.md（归档触发）、AGENTS.md（协议总览）、.catpaw/rules/architecture-quickref.md（架构速查）

## 七、历史记忆索引

| hook_id | 摘要 | 日期 |
|---|---|---|
| 305b700e | WorldSmith 后端架构与前端覆盖度调研总结 | 2026-07-05 |
| 847beb6f | 项目后端逻辑前端覆盖度调研结论 | 2026-07-05 |
| 5b30a117 | 项目后端逻辑前端覆盖度分析与记忆归档 | 2026-07-05 |
| 53aa6dc4 | retrieve 接口 session_id 参数一致性测试结论 | 2026-07-05 |
| 2d07a5ff | 验证 archive 保留 tool_calls 与 thinking 字段实验 | 2026-07-05 |
| c1081d29 | Hippocampus MCP v2.30.1 更新及 install_rules 影响分析 | 2026-07-05 |
| acbb2474 | WorldSmith Task 模式迭代 B 实现与代码清理 | 2026-07-07 |

## 八、关键决策记录

（详见下方 decisions 章节，hippocampus 同步）

<!-- HIPPOCAMPUS:SECTION:project_memory END -->

<!-- HIPPOCAMPUS:SECTION:decisions START -->
## Agent 系统增强 4 任务现状评估（2026-07-06）

### 任务 1：实体卡片小窗 — ✅ 已完成（2026-07-06 验证）
- 经验证已完整实现，无需补全。ROADMAP 状态已更新为已完成
- 完整链路：
  - EntityMiniPanel.vue（加载/不存在/详情三态；描述+属性可编辑；关联+标签只读；openInMainPanel 跳主面板）
  - useEntityMiniPanel.ts（模块级单例 open/close/visible/triggerRect/currentState）
  - 触发入口①：BlockEntityCard"详情"按钮 → emit open-detail → AgentMessageBubble emit blockAction → AgentChat onBlockAction(line 458-466) → miniPanel.open（return 不发回 Agent）
  - 触发入口②：消息 mention 点击 → AgentMessageBubble onMentionClick(line 938-952，事件委托 .ws-entity-mention) → miniPanel.open
  - FloatingPanel 浮窗(width=340/height=420) 基于 triggerRect 定位，不挤占消息列表
- 7点检查清单代码审查通过

### 任务 19：头像信息卡 — 部分实现（工作量小-中，下一个）
- SpaceNavbar.vue 已有 PersonaMirror（Agent 身份）+ UserProfilePopover（用户身份）弹出
- AgentMessageBubble.vue 消息气泡头像仅 WsIcon 图标（msg-icon，role==='user'?'character':'profile'），无信息卡
- 缺口：将 PersonaMirror/UserProfilePopover 下沉到消息气泡头像（悬停/点击）

### 任务 3：技能工具更新 — 需架构讨论（工作量中-大）
- 两套 ToolBus：旧 worldsmith-agent/src/toolbus/（InternalChainRegistry）+ 新 packages/agent-core/src/bus/（ToolRegistry+SkillRegistry）
- governor-modules.ts toolMeta 验证-only（activate 只验证 getToolMeta 不实际注册）
- 缺口：真实技能注册与动态加载；需先讨论两套 ToolBus 整合方向

### 任务 4：长任务能力 — 需详细设计（工作量大）
- 现有零散超时（orchestrator SubAgentTask.timeout、src-tauri workflow Timeout），无系统化长任务
- useAgent.ts 有 abort() 但无心跳/进度反馈/6小时机制
- 缺口：6h 无中断、心跳、进度反馈、资源占用；需外部资料 + 详细设计

### 推进顺序
1. 任务 1 ✅ → 2. 任务 19（下一个）→ 3. 任务 3 → 4. 任务 4


### 任务 4 P1：Agent 长任务能力 — 核心管理器完成（2026-07-06）

**已实现**：
- LongTaskStore（`src/agent/composables/longTaskStore.ts`）：Dexie 持久化 LongTaskRecord，CRUD + 清理
- useLongTask（`src/agent/composables/useLongTask.ts`）：状态机(running/completed/failed/cancelled) + 心跳(5s) + checkpoint + 协作式取消
- IAgentBackend.getRuntimeMessages()（`worldsmith-agent/src/bridge-types.ts` + `bridge.ts`）：暴露 pi-ai 内部 messages（checkpoint 用，区别于 state.messages UI 快照）
- useAgent.ts 接入（12 处）：sendMessageInternal 启动任务 / turn_end+tool_execution_start+end 事件 checkpoint / agent_end 终态(complete/cancel) / beforeToolCall 协作式取消检查 / abort 协作式取消 / newSession+switchSession 清理防泄漏

**关键决策**：
- 存储：IndexedDB/Dexie（前端通用，复用 workflow 引擎设计模式而非存储后端）
- 中断语义：不设硬超时，协作式取消（beforeToolCall 检查 cancelFlag）
- checkpoint：事件驱动（turn_end + tool_execution_end），节流持久化（5s 心跳 flush）
- 恢复交互：弹出横幅（P2 实现）

**P2-P4 待办**：P2 恢复机制 / P3 进度反馈 UI / P4 子 Agent 接入

**推进顺序更新**：任务 1 ✅ → 任务 4 P1 ✅ → 任务 19（下一个）→ 任务 3 → 任务 4 P2-P4


### 任务 4 P2：断点恢复机制完成（2026-07-06）

**已实现**：
- IAgentBackend.setRuntimeMessages()：写回 pi-ai 内部 messages（恢复核心）
- useLongTask.resumeActiveTask()：接管持久化任务（重启心跳 + 恢复 activeTask，复用 taskId 不新建）
- useAgent.ts 恢复逻辑：detectAndOfferResume() / resumeTask(taskId) / discardTask(taskId) / sendMessageInternal 复用恢复任务 taskId
- AgentChat.vue 恢复横幅 UI：`v-if="resumableTasks.length > 0"` 显示"恢复/放弃"按钮

**恢复流程**：应用重载 → ensureInitialized → detectAndOfferResume → 横幅显示 → 用户点"恢复" → 重建 agent + 写回 messages + 接管长任务 → 用户发消息（复用 taskId）→ agent loop 继续 → agent_end completeTask

**自检修复**：sendMessageInternal 原逻辑总 startTask 新任务会 failTask 恢复任务（抢占）。已改为 `if (!currentLongTaskId)` 才 startTask。

**验证**：P1 核心 + P2 检测/横幅/放弃全部实测通过（IndexedDB 记录正确）。修复 detectAndOfferResume 只在发消息时调用的问题（AgentOverlay.vue onMounted 也调用）。

**AgentChat 入口**：F1 快捷键唤起/隐藏 AI 助手

**推进顺序**：任务 1 ✅ → 任务 4 P1 ✅ → 任务 4 P2 ✅ → 任务 19（下一个）或 任务 4 P3-P4


### 任务 4 P3：进度反馈 UI 完成（2026-07-06）

**已实现**：
- useAgent 透传：activeTask/heartbeatStatus/hasActiveTask 从 useLongTask 暴露给 UI
- AgentChat.vue 进度条 UI（面板底部，v-if="hasActiveTask && activeTask"）：
  - 心跳指示器：alive 绿色脉冲(1.5s) / stale 黄色脉冲(2.5s) / dead 红色常亮
  - 运行中标签 + 实时时长 + 第 N 轮 + 当前 tool（ellipsis 截断）
  - 停止按钮（调用 abort()，红色描边，右对齐）
- 时长计时器：watch(hasActiveTask) 控制 setInterval 启停，无泄漏
- 样式：绿色主题 区别于恢复横幅靛蓝

**关键决策**：进度条位置面板底部（展开/最小化都显示）；不做任务管理面板（MVP）；停止按钮用 abort()（UX 优先）

**推进顺序**：任务 1 ✅ → 任务 4 P1 ✅ → P2 ✅ → P3 ✅ → P4（待办）或 任务 19


### 任务 4 风险点修复 + P4 子 Agent 接入完成（2026-07-06）

**风险点修复**：
- 风险点1（bridge.ts beforeToolCall id 类型）：移除多传的 id 字段
- 风险点3（abort 销毁重建 → abort+waitForIdle 不重建）：Agent.abort() 中断 run，waitForIdle() 等 agent_end listener settle 后释放锁，agent.state.messages 保留复用。带 fallback
- 风险点2（unused 变量）：20+ 文件 unused 错误全预存在，本次不修复

**P4 子 Agent 接入**（最小 MVP，不做恢复）：
- useOrchestrator.ts 新增 trackSubAgentLongTask/untrackSubAgentLongTask（多任务 Map + 模块级统一定时器心跳 5s）
- ExecuteFn 去超时：timeout 从必填改为可选（已废弃）
- AgentChat.vue executeFn 集成：track → prompt → untrack
- 子 Agent 独立于 useLongTask（主 Agent），复用 longTaskStore 持久层

**实测验证**：风险点3 abort+再发消息正常；P4 2 并发子 Agent IndexedDB 记录正确，心跳 hbAge=4s，终态 completed

**推进顺序**：任务 1 ✅ → 任务 4 P1-P4 ✅（任务 4 整体完成）→ 任务 19 或 任务 3


### 任务 4 迭代：新增"任务执行"模式（agentic loop）— MVP 完成（2026-07-07）

**背景**：用户要求"单轮次中 Agent 持续执行步骤，类似外部编码代理工具"。参考 Anthropic "Building effective agents" 三原则：保持简单、优先透明、精心打造 ACI

**实现内容**（方向 A + 小范围 MVP）：
- ChatMode 新增 'task'（bridge-types.ts + session/types.ts + session/manager.ts）
- 新建 task-execution skill（SKILL.md）：自主任务执行，工作流 理解目标→plan_create→逐步执行→遇错重试→完成验证。visibility:hidden，task 模式自动激活
- registry.ts 注册 task-execution skill；bridge.ts 接入 thinkingLevelMap['task']='high' + modeSkillMap['task']='task-execution'
- UI 入口 4 处加 task 选项（AgentChat/SpaceNavbar/SpaceAgentSettingsPanel/ChatInput）
- icon: 'play'

**实测验证**：模式切换成功；agentic loop 自主多步骤执行；遇错重试调整策略；透明性显示推理链 + tool call；权限确认协作式；无 JS 错误

**设计决策**：task 模式 MVP 走普通消息流（不复用 deep 深度段），thinkingLevel='high'，不做 agent_end 自动继续（方向 B 留待迭代）

**下一步迭代方向**：B. agent_end 自动继续 / C. 强化步骤可见性 / D. normal 模式 agentic


### 任务 4 方向 B：task 模式 agent_end 自动继续 — MVP 完成（2026-07-07）

**背景**：task 模式 MVP（方向 A）每轮 agent loop 结束后需用户手动发消息继续。方向 B 让 Agent 在单任务内自主多轮推进直到完成，类似 Claude Code/Cursor 的 agentic loop。

**方案**（用户确认：方案 C 混合 + 200 轮上限）：
- 显式停止：Agent 调用 `task_complete` 工具声明完成（首选）
- 兜底停止：本轮无 tool call（纯文本轮 = 交还控制权）
- 硬上限：MAX_AUTO_TURNS=200（防死循环）

**实现内容**：
1. 新建 `worldsmith-agent/src/tools/task-tools.ts`：`task_complete` 工具（permission=safe, alwaysAvailable=true），参数 summary
2. `agent.ts` 注册 taskTools（import + registerAllTools + ALL_TOOLS 三处）
3. `registry.ts` task-execution 的 baseTools + allowedTools 加 `task_complete`
4. `useAgent.ts` 核心逻辑：
   - 状态变量：`MAX_AUTO_TURNS=200` / `autoContinueCount` / `taskCompletedFlag` / `taskHadToolCalls`
   - `checkShouldAutoContinue()`：5 条件（task 模式 + 未 task_complete + 有 tool call + 未达上限 + 未取消 + backend 可用）
   - `autoContinueTask()`：复用 currentLongTaskId（不启动新长任务），递增计数，push 透明 user message（metadata.autoContinued），backend.prompt 继续
   - `agent_end` 分支：shouldAutoContinue 时不置 isStreaming=false / 不终结长任务 / 不清 lockedChatMode，触发 autoContinueTask；非继续时正常终结
   - `agent_start` 重置 taskHadToolCalls/taskCompletedFlag
   - `tool_execution_start` 标记 taskHadToolCalls=true
   - `tool_execution_end` 检测 task_complete 设 taskCompletedFlag=true
   - `sendMessageInternal` 重置 autoContinueCount=0（新任务）
   - `abort` 清理所有状态
   - 解构 `failTask: longTaskFail`（自动继续失败时标记长任务 failed）
5. `SKILL.md` 更新：task_complete 工具说明 + "自主执行循环"引导段落 + 第四步完成收尾加 task_complete

**自主执行循环链路**：
agent_end → checkShouldAutoContinue=true → autoContinueTask → backend.prompt(继续指令) → agent_start → tool calls → agent_end → ... 直到 task_complete 或无 tool call 或达 200 轮

**验证**：
- linter 零错误
- vue-tsc 零新增错误（task-tools.ts/agent.ts/registry.ts 零错误；useAgent.ts 错误全预存在：ALL_PHASE_TOOLS/session/id 等）
- 修复 autoContinuing 未使用变量（删除，shouldAutoContinue 已控制 isStreaming 防闪烁）
- dev server 实测未完成：pnpm 卡在 resolved 693 阶段（环境问题非代码问题，之前能正常启动），需用户手动验证

**风险点**：
- autoContinueTask push 的 user message（"自主继续 · 第 N 轮"）进入 agent message 历史，可能影响 agent 上下文理解。透明性必要，metadata.autoContinued 标记供后续优化。MVP 先用 user message，观察效果
- 200 轮上限较高，长任务可能消耗较多 token。用户可通过 P3 进度条轮次显示 + 停止按钮监控

**推进顺序**：任务 1 ✅ → 任务 4 P1-P4 ✅ → task 模式方向 A ✅ → 方向 B ✅ → 方向 C/D（待办）或 任务 19 / 任务 3


### 任务 4 方向 B 风险点处理（2026-07-07）

**风险点 1：continuePrompt 上下文污染** — 已优化
- 调研：bridge.ts prompt(text) 让 text 进 pi-ai user message + 重新构建 system prompt（含 skill 全文重新激活）+ 重新查询 memory/kb。发现 pi-ai 有 followUp/steer/trimContext 方法，但 followUp 语义不明有行为风险
- 决策：确定性优化——continuePrompt 极简化，继续用 prompt 方法（不用 followUp）
- 实现：
  - continuePrompt 从 60 字 → 16 字（`继续执行。若任务已完成，调用 task_complete。`）
  - 每轮省 ~44 token，200 轮省 ~8800 token
  - UI message 保持 `（自主继续 · 第 N 轮）`（友好显示，不进 agent 上下文——agent_end 只同步 assistant 消息，UI push 的 user message 与 agent 收到的 continuePrompt 独立）
  - 补充注释说明 UI message 与 agent 上下文独立性
  - SKILL.md 新增"收到继续信号时如何处理"引导（检查 plan 状态 + 继续执行 + 不重复 plan_create）

**风险点 2：dev server 卡住** — 已修复
- 根因 1：孤儿进程（之前 Stop-Process 杀父进程但子进程未清理，PID 11592/31808 持续高 CPU 7000+s 占用资源）
- 根因 2：`pnpm dev` 在 hoisted 模式 link 阶段卡住（node_modules 已存在但 pnpm 尝试重建时挂在 `resolved 693 reused 693`）
- 修复：杀孤儿进程 + 直接用 `node_modules/.bin/vite.cmd` 启动绕过 pnpm 依赖检查，VITE v8.1.3 ready in 1028ms，5173 在 IPv6 `[::1]` LISTENING
- 注意：netstat 检查 5173 时需注意 IPv6 绑定（`[::1]:5173` 而非 `127.0.0.1:5173`）
- **dev server 启动方式**：优先用 `.\node_modules\.bin\vite.cmd` 而非 `pnpm dev`，避免 pnpm hoisted link 卡住

**验证**：
- linter：useAgent.ts 零错误（SKILL.md 28 个 markdownlint WARNING 全预存在的表格/列表空行风格，不影响功能）
- vue-tsc：零新增错误（autoContinueTask 改动区域零错误，useAgent.ts 错误全预存在：ALL_PHASE_TOOLS/session/id/totalTokens）
- dev server：5173 健康运行（PID 25028，877MB，有 ESTABLISHED 浏览器连接）
- 功能实测：交用户手动（需 AI 助手配置 + 浏览器交互发任务观察自主继续）


### 任务 4 方向 C：强化步骤可见性 — MVP 完成（2026-07-07）

**背景**：task 模式方向 B 实现自主继续后，步骤可见性有缺口：plan 进度只在右侧 PlanPanel（主聊天区看不到）、自主继续每轮 push user message 刷屏（200 轮=200 条淹没真内容）、P3 进度条缺 plan 维度。参考 Anthropic《Building effective agents》透明性原则原文 "Prioritize transparency by explicitly showing the agent's planning steps"。

**方案**（用户确认：完整方案 1+2+3）：
- 改进点 1：进度条叠加 plan 进度（`3/5 步`，数据源 usePlanStore.progress）
- 改进点 2：自主继续不刷屏（删除 autoContinueTask 的 push user message）
- 改进点 3：当前 plan 步骤高亮（in_progress item title 优先于 currentTool 显示）

**实现**：
- `AgentChat.vue`：import usePlanStore + planProgress/currentPlanStep computed + 进度条 template 加 plan 进度块 + 当前步骤块（v-if/v-else-if 优先级）+ ltp-plan/ltp-step 样式（ellipsis 截断）
- `useAgent.ts`：autoContinueTask 删除 push user message 代码块（保留 checkpoint + backend.prompt），透明性改由进度条 activeTask.turnCount + plan 进度/当前步骤保证

**验证**：
- linter：零错误
- vue-tsc：零新增错误（AgentChat.vue 6 处全预存在 MCP 类型+unused imports；useAgent.ts 6 处全预存在 ALL_PHASE_TOOLS/session/id/totalTokens）
- dev server：vite v8.1.3 编译通过（5174 端口，5173 被占）
- 功能实测：交用户手动（task 模式发任务观察进度条 + 自主继续不刷屏）

**设计决策**：
- currentPlanStep 优先于 currentTool（v-if/v-else-if）：有 plan 步骤时显示步骤标题，无则回退 tool 名
- 自主继续轮次通过 activeTask.turnCount 显示（turn_end 递增，含首条用户消息轮），不再单独 push 消息
- 删除的 metadata.autoContinued 无其他依赖（grep 确认仅 useAgent.ts 引用，AgentMessageBubble 未处理）

**风险点**（已列出不自动修复）：
- 进度条信息密度：plan 进度+轮次+步骤 同时显示时较挤，小窗口下步骤标题截断（tooltip 补全，可接受）
- currentPlanStep 与实际执行可能短暂不同步：依赖 Agent 按 SKILL.md 顺序先 plan_update(in_progress) 再调 tool
- 自主继续在消息列表无痕迹：设计权衡（不刷屏），透明性靠进度条轮次+plan 进度保证

**推进顺序**：任务 1 ✅ → 任务 4 P1-P4 ✅ → task 模式方向 A ✅ → 方向 B ✅ → 方向 C ✅ → 方向 D（待办）或 任务 19 / 任务 3


### 任务 4 方向 D：normal 模式 agentic — MVP 完成（2026-07-07）

**背景**：normal 模式此前"软禁用"工具（system prompt 加"不要调用任何工具"指令），用户简单查询也需切 task/explore。方向 D 让 normal 也能按需用工具（单轮 agentic），与 task（多轮自主继续）区分。

**方案**（用户确认：方案 A 最小 agentic）：
- 去掉 normal 工具禁令，允许按需调用 ALWAYS_AVAILABLE_TOOLS 查询信息
- thinkingLevel: off → low（工具调用需轻度推理）
- 不自主继续（保持单轮，与 task 区分）
- 不加 skillIndex/memory/kb（保持简单）

**实现**（bridge.ts 两处）：
- thinkingLevelMap: normal 'off' → 'low'
- normal 分支 prompt 指令改写：`不要调用任何工具` → `简洁直接回答；需要时可调用工具查询信息（如读取实体、搜索内容、读写文件）；不要进行长流程多步骤任务；复杂任务提示切换 task/deep`

**验证**：
- linter：零错误
- vue-tsc：bridge.ts 零错误，总错误 645（与基线一致，无新增）
- UI 层：grep 确认无"normal 禁用工具"硬编码（isDeepMode 只对 deep 特殊处理），工具调用正常显示
- dev server HMR 自动应用
- 功能实测：交用户手动

**设计决策**：
- normal/task 区分：normal=单轮agentic（快答+按需工具），task=多轮自主继续（200轮）
- thinkingLevel low：支持工具调用轻度推理，不过度思考
- 不加 skillIndex：normal 用 ALWAYS_AVAILABLE_TOOLS 已够（entity/content/file/memory），不激活 skill

**风险点**（已列出不自动修复）：
- normal 可能过度用工具（简单问题也查实体增延迟），靠 prompt 引导
- thinkingLevel low 可能改变回答风格，需实测确认符合"快答"定位
- normal 与 explore 边界稍模糊（但 explore 有专门 skill+多源搜索+更高 thinkingLevel，定位仍不同）

**推进顺序**：任务 1 ✅ → 任务 4 P1-P4 ✅ → task 模式方向 A ✅ → B ✅ → C ✅ → D ✅ → 任务 3 P1-P4 + 收尾 ✅（任务 19 待启动，经核查未实现，之前误标 ✅ 已纠正）


### 任务 3：Agent 技能工具更新 — P1-P3 声明式 registry 接线完成（2026-07-07）

**状态**：P1-P3 接线完成（commit 88735cd，未 push）

**核心决策**（用户确认）：
- scope = 仅接线（让 agent-core 的 ToolRegistry/SkillRegistry 从死代码变为运行时可用，淘汰硬编码留待后续）
- compat = 保留 InternalChainRegistry（capabilities 逻辑不变）
- rollback = main 直接累积不 push

**关键架构发现**：
- bridge.ts 只用 `toolBus.register` + `toolBus.getAll`，**从不调用 `resolve`** → resolve 路径是死代码，P3 改造零运行时风险
- 新 agent-core registry 此前是死代码：`getGlobalToolRegistry`/`getGlobalSkillRegistry`/新 `DefaultToolBus` 从未被消费方调用
- LEGACY_TOOL_META 已淘汰（P4 完成）：所有静态工具补全声明式 meta（Batch 1-7 + skills/meta-tools），注册到 ToolRegistry；旧工具名通过 ALIAS_MAP/meta.aliases/LEGACY_ALGO_MAP/LEGACY_PLUGIN_MAP 解析。LEGACY_TOOL_META 清空为 {}，buildMetaCache 不再从中收集

**接线点（3 处）**：
1. P1 `tool-meta-registry.ts`：`initToolMetaRegistry` 同步注册工具到全局 ToolRegistry；`buildMetaCache` 从 ToolRegistry 收集；移除 `_toolsSource` 变量
2. P2 `skills/registry.ts`：模块加载时自动 `registerSkillsToGlobalRegistry()`；SkillMeta→SkillDeclaration 声明式子集转换
3. P3 `toolbus/toolbus.ts`：`resolveLegacyNames` 优先用 `SkillRegistry.resolveToolNames` 声明式解析

**验证**：lints 零错误；vue-tsc 改动 3 文件零新增错误；agent-tools 测试 12 通过 1 预存失败（git stash 确认与本次无关）

**P4 完成（补 meta 淘汰 LEGACY_TOOL_META）**：
- ✅ 给所有静态工具补 `meta` 字段（Batch 1-7：entity/relation/search/output/memory/kb/file/project/schema/git/pkg/sys/terminal/web-cli/crawl/native/vision/session/image-gen/video-gen/a2ui/plan/persona/daily-task/orchestrator/pipeline/algo/plugin/retrofit/module-builder + skills/meta-tools）
- ✅ 淘汰 LEGACY_TOOL_META（清空为 {}，buildMetaCache 删除 step 3，getToolMeta 仅依赖 ToolRegistry + 别名映射 + 兜底）
- ✅ agent-tools.spec.ts 加测试"所有 ALL_TOOLS 声明 meta"

**未完成（待后续）**：
- 切换 `resolveToolNames` 到 SkillRegistry（需先补 `alwaysAvailable` meta）
- 任务24 Skills 商城依赖本任务完成
### 全项目体检与整改决策（2026-07-13）

**背景**：放弃 OpenWorld Rust 重构路线，回到 worldsmith 本项目整改。先做全项目体检。

**5 维度评分**：架构 C+ / 性能 C / Bug B+ / 代码质量 C- / 后端覆盖度 D+

**42 条问题聚类为 14 主题**：
- P0（5 项）：后端 40-45% 僵尸（Workflow 28 命令/CRDT 15 函数/server 7 端点/MCP-PTY-KV 25+ 命令零调用）、lib.rs 165 命令巨型文件、Tauri unwrap panic 风险、ui-kit↔plugin-sdk 循环依赖、WS/长任务生命周期
- P1（6 项）：首屏 bundle 膨胀、无 ESLint/Hook、151 处 as any、11 个 Vue > 800 行、WsTable/WsTree 无虚拟化、PluginManager 双源清单
- P2（7 项）：插件模板重复 / 命名不一致 / 测试覆盖不均 / composables 越层 / CustomEvent 绕过 EventBus / WASM critical 下载 / 字体串行 restore

**切入点**：用户确认从严重 BUG 开始修
- 本轮修复：P0-3（Tauri unwrap）+ P0-5a（WS 超时定时器）+ P0-5c（longTaskTimer 复查）
- 列为风险点交用户决定：P0-5b（WS 重连机制，属新功能非 bug 修复）
- 后续推进：P0-1/P0-2/P0-4 按主题分批


### 阶段 1.5 Tauri 集成完成（2026-07-25）

**背景**：将 `crates/agent-runtime` 接入 Tauri 应用，实现前端与 Rust Agent 的 IPC 通信通道。这是阶段 2（前端 UI 集成）的前置条件。

**实现内容**：

1. **Tauri 命令层**（[src-tauri/src/commands/agent.rs](../src-tauri/src/commands/agent.rs)）：
   - 创建 14 个 agent 命令对应 `IAgentBackend` 接口：`agent_prompt` / `agent_steer` / `agent_follow_up` / `agent_abort` / `agent_update_model` / `agent_update_thinking_level` / `agent_clear_history` / `agent_subscribe` / `agent_dispose` / `agent_state` / `agent_is_streaming` / `agent_trim_context` / `agent_get_runtime_messages` / `agent_set_runtime_messages`
   - `TauriEventListener`：实现 `agent_runtime::EventListener` trait，把 `OrchestratorEvent` 转为 `AgentEventPayload` 并通过 `app.emit` 推送到前端

2. **Payload 类型**（[src-tauri/src/agent_bridge/payload.rs](../src-tauri/src/agent_bridge/payload.rs)）：
   - 定义 `AgentEventPayload` 结构（type/sessionId/chatMode/具体事件字段）
   - 实现 `OrchestratorEvent → AgentEventPayload` 转换逻辑

3. **多实例管理**：`AgentRegistry`（`tokio::sync::RwLock<HashMap<String, Arc<AgentLoop>>>`）支持会话级 Agent 实例的注册、查询、中断、销毁，支持多会话并发

4. **集成接入**：
   - [src-tauri/src/lib.rs](../src-tauri/src/lib.rs)：声明 `agent_bridge` 模块，注册 `agent_registry` 到 `AppState`，14 个 agent 命令注册到 `invoke_handler`
   - [src-tauri/src/state.rs](../src-tauri/src/state.rs)：添加 `agent_registry` 字段
   - [src-tauri/src/commands/mod.rs](../src-tauri/src/commands/mod.rs)：声明 `agent` 子模块
   - [src-tauri/Cargo.toml](../src-tauri/Cargo.toml)：添加 `tracing` 依赖

5. **前端通信层**（[src/agent/composables/useAgentRust.ts](../src/agent/composables/useAgentRust.ts)）：
   - `RustAgentBackend` 类封装 Tauri `invoke` + 事件监听
   - 流式事件订阅：监听 `agent_event` 事件，按 type 路由 `stream_start` / `stream_delta` / `stream_end` / `tool_call_start` / `tool_call_end` / `agent_start` / `agent_end`
   - 状态同步：从 `backend.state` 同步 `model` / `messages` / `isStreaming` 等到 ref

**验证**：`cargo check` 通过 ✅，0 errors / 0 warnings

**关键决策**：
- **多实例而非单例**：用 `AgentRegistry` 按 sessionId 管理，支持多会话并发，对齐前端 `useAgent` 多 session 设计
- **事件桥接而非轮询**：通过 `EventListener` trait + Tauri `app.emit` 实现事件推送，避免前端轮询
- **Payload 类型独立**：不复用 agent-runtime 原始事件类型，单独定义 `AgentEventPayload` 保证序列化稳定，解耦前后端

**风险点**：
- 端到端验收推迟到阶段 2.0 前端 UI 集成完成（需在浏览器实际跑通 Rust Agent 流式响应）
- `TauriEventListener` 在锁竞争时丢弃事件（用 `try_read`），高并发场景可能丢失事件，待实测验证


### 阶段 2.0 前端 UI 集成完成（2026-07-25）

**背景**：阶段 1.5 完成 Tauri 命令层后，前端需要接入 `useAgentRust`，让用户能在 TS / Rust 两种 Agent 后端之间切换。这是端到端验收 Rust Agent 的前置条件。

**方案选择**：用户确认采用 **方案 B（开关切换）** 而非方案 A（彻底替换）
- 理由：Rust 后端尚未实现深度模式 / 长任务 / A2UI / 终端 / 子 Agent 等高级能力，直接替换会丢失功能；开关切换让用户按需试用 Rust 后端，TS 后端作为兜底
- 验证范围：SpaceChat 轻量验证 + AgentChat 完整验证 + Provider 三模式验证 + 工具调用验证

**实现内容**：

1. **设置层**（[src/stores/settingsStore.ts](../src/stores/settingsStore.ts)）：
   - 新增 `STORAGE_KEY_AGENT_BACKEND = 'worldsmith_agent_backend'`
   - 新增 `agentBackend` 字段（`persistedRef` 类型，默认 `'ts'`，可选 `'ts' | 'rust'`）
   - 在 return 中导出

2. **Rust 后端适配层**（[src/agent/composables/useAgentRust.ts](../src/agent/composables/useAgentRust.ts)）：
   - 新增 `useAgentRustAdapter()` 函数，补齐与 `useAgent.ts` 完全一致的返回字段
   - 占位策略：Rust 未实现的能力用空 ref + no-op 方法占位（如 `a2uiSurfaces` / `resumableTasks` / `activeTask` / `terminalVisible` 等返回空 ref，`createSubBackend` / `resumeTask` / `discardTask` 等返回 no-op）
   - 类型修复：
     - `_pendingToolCalls` 类型改为 `NonNullable<AgentMessage['toolCalls']>` 解决索引访问 possibly undefined
     - `event.model` 不存在，改为从 `backend.state.model` 同步（`agent_start` 事件未携带 model 字段）
     - `PromptOptions` 类型加 `| undefined` 解决可选参数类型不匹配
     - 移除未使用的 `ComputedRef` / `Ref` 类型导入
     - 移除 `messages` 的 `readonly` 包装，避免与 `useAgentTs` 返回类型不兼容

3. **路由层**（[src/agent/composables/useAgent.ts](../src/agent/composables/useAgent.ts)）：
   - 原 `useAgent` 重命名为 `useAgentTs`（保留原实现不变）
   - 新增 `useAgent` 路由函数：根据 `settingsStore.agentBackend` 字段条件返回 TS 或 Rust 实现
   - 类型兼容：Rust 适配层与 TS 实现存在 `deepSegments` / `finalOutput` 等字段类型差异，使用双重断言 `as unknown as ReturnType<typeof useAgentTs>` 解决

4. **UI 入口**（[src/agent/panels/ProviderPanel.vue](../src/agent/panels/ProviderPanel.vue)）：
   - 供应商配置下方新增「Agent 后端」select（TS 默认 / Rust 实验性）
   - 切换到 Rust 时显示提示信息：「实验性 Rust Agent：仅支持核心对话与工具调用，深度模式/长任务/A2UI/终端等高级功能暂不可用」

5. **UI 适配**：
   - [src/space/chat/SpaceChat.vue](../src/space/chat/SpaceChat.vue)：添加 `isRustBackend` 计算属性，聊天消息区上方显示「Rust 实验模式」横幅
   - [src/agent/AgentChat.vue](../src/agent/AgentChat.vue)：添加 `isRustBackend` 计算属性，ChatHeader 下方显示横幅，提示深度模式/长任务/A2UI/终端/子 Agent 等暂不可用

**类型错误修复过程**（共 31 个错误，全部修复）：

| 错误 | 修复方式 |
|------|----------|
| `useSettingsStore` 未导入 | 在 `useAgentRust.ts` 顶部添加 import |
| `_pendingToolCalls` 索引访问 possibly undefined | 类型改为 `NonNullable<AgentMessage['toolCalls']>` + 非空断言 |
| `event.model` 不存在 | 从 `backend.state.model` 同步 |
| `PromptOptions` 类型不匹配 | 改为 `PromptOptions \| undefined` |
| `ComputedRef` / `Ref` 未使用 | 从 import 中移除 |
| `messages` readonly 导致类型不兼容 | 移除 readonly 包装，返回 mutable ref |
| `useAgentRustAdapter` 返回类型不兼容 | 双重断言 `as unknown as ReturnType<typeof useAgentTs>` |
| `AgentChat.vue` CHAT_MODES readonly 不匹配 | const 数组改为 let 数组 |
| `AgentMessageList.vue` AgentMessage 类型冲突 | 统一 `role` 字段为 `"user" \| "assistant"` |

**验证**：
- 基线对比：`git stash` 创建干净工作区，确认 main 分支 typecheck 无错误，定位所有 31 个错误均为本次阶段 2.0 引入
- 修复后 `npx vue-tsc -b` 通过 ✅，仅剩 `src/ui/entity/RegionMap.vue` 中 `confirmOffset` 未使用警告（与阶段 2.0 核心工作无关，预存在）
- `cargo check` 通过 ✅（阶段 1.5 已通过）

**关键决策**：
- **方案 B 开关切换**：保留 TS 后端为默认，Rust 作为实验性选项，避免功能回退
- **空 ref 占位 + no-op 方法**：Rust 未实现的能力用空值占位而非抛错，UI 用 `v-if` 隐藏未实现功能入口，保证用户能切换且不报错
- **双重断言而非补字段**：Rust 适配层不强行补齐所有 TS 字段（如 `deepSegments` / `finalOutput`），用 `as unknown as` 断言绕过，避免占位代码膨胀
- **横幅提示而非禁用切换**：切换到 Rust 时显示能力限制横幅，不禁用切换按钮，让用户明确知道限制

**风险点**（已列出不自动修复）：
- Rust 后端尚未实测端到端流程（需在浏览器实际切换到 Rust 后端并发消息验证流式响应），阶段 2.0 完成的是 UI 通道，端到端验收推迟到下一阶段
- `useAgentRustAdapter` 双重断言掩盖了真实类型差异，未来 Rust 后端补齐能力后需移除断言改回正确类型
- Rust 后端的事件订阅基于 Tauri `listen`，如果 Tauri 事件系统在高频流式 delta 时丢事件，UI 可能出现内容截断，待实测验证
- `RegionMap.vue` 的 `confirmOffset` 未使用警告为预存在问题，与阶段 2.0 无关

**推进顺序**：阶段 0 ✅ → 阶段 1.1-1.4 ✅ → 阶段 1.5 Tauri 集成 ✅ → 阶段 2.0 前端 UI 集成 ✅ → 阶段 2.1+ Rust 后端能力补齐 / 端到端实测（待办）

## 三端分离工作启动 — Phase 0 文档库搭建完成（2026-07-29）

### 背景
项目需要将 Web 端、CLI 端、Tauri 端彻底分离，三端前端也需移除关联入口。因会话上下文限制，先搭建 plan 文档库保障持续迁移。

### 关键决策
1. **分离策略**：物理目录彻底分离 — 创建 `apps/web`、`apps/cli`、`apps/tauri` 三个独立子项目
2. **共享代码层**：`worldsmith-agent/src/` 端无关逻辑抽离到 `packages/agent-runtime`；端无关 composables 抽离到 `packages/shared-composables`；共享 UI 到 `packages/shared-ui`
3. **后端能力重叠处理**：CLI `serve` 模式替代 `worldsmith-server`；Tauri 保留 Rust 命令；Web 通过 HTTP/WS 连 CLI serve
4. **前端入口清理**（基于代码扫描实际结果）：
   - 18 文件 import `@tauri-apps/api`（8 个 Rust composables + coreBackend + ProjectFS + 终端 + 插件等）
   - 4 文件检测 `__TAURI__`（coreBackend、mindmap×2、global.d.ts）
   - `coreBackend.ts` 移除 `detectBackend()` 运行时检测，改为端编译期硬编码
   - `useAgent.ts` 移除 TS/Rust 后端路由层，改为 `IAgentBackend` 接口注入
5. **迁移路线**：6 个 Phase（共享层抽离 → 目录骨架 → 前端清理 → 后端整合 → 构建独立 → 验收清理）

### 产出
- `docs/details/端分离/` 文档库（11 份文档：README + 00-10）
  - 00-overview：总览与目标
  - 01-current-state：三端现状分析（技术债清单 TD-01~TD-10）
  - 02-target-architecture：目标目录结构
  - 03-shared-code-layer：共享代码层规划
  - 04/05/06：Web/CLI/Tauri 端分离计划
  - 07-frontend-entry-cleanup：前端关联入口移除计划（含 12 步清理顺序）
  - 08-migration-phases：分阶段迁移路线（6 Phase + 任务拆解 + 里程碑）
  - 09-risk-mitigation：风险与回滚策略（R-01~R-11）
  - 10-verification-checklist：验证清单（含快速验证脚本）

### Phase 1 完成记录（2026-07-29）

**完成内容**：
- `packages/agent-runtime` 包创建完成，包含 Agent 核心、工具（46+ tools）、技能、会话、上下文、Provider、ToolBus 等端无关逻辑
- `ExecutionAdapter` 工厂注册模式：`registerExecutionAdapterFactory()` + `createExecutionAdapter()`，三端适配器（Node/Tauri/WebSocket）在 `worldsmith-agent/src/execution/index.ts` 自动注册
- `IAgentBackend` 接口定义：`packages/agent-runtime/src/bridge.ts`
- 向后兼容层：`worldsmith-agent/src/index.ts` 重导出 `@worldsmith/agent-runtime` 全部 API，现有调用方零修改
- 配置更新：vite.config.ts alias + 3 个 tsconfig（root.app / worldsmith-agent / worldsmith-agent.cli）的 paths 映射

**关键文件**：
- `packages/agent-runtime/src/index.ts` — 端无关 API 公共出口
- `packages/agent-runtime/src/execution/{adapter,index,env}.ts` — ExecutionAdapter 接口 + 工厂注册
- `worldsmith-agent/src/execution/index.ts` — 向后兼容层（re-export + 自动注册三端适配器）
- `worldsmith-agent/src/index.ts` — 薄包装层（re-export agent-runtime + 端特定实现）

**验证结果**：
- `agent-runtime/src/` 自身无类型错误
- `worldsmith-agent/src/` 的 Phase 1 重构错误已全部修复
- 预存问题（非本次引入）：`@types/ws` 未安装（网络超时）、canvas-engine/plugin-sdk/ui-kit 预存类型错误

**下一步**：Phase 2 — 三端目录骨架建立（`apps/web`、`apps/cli`、`apps/tauri`）

### Phase 2 完成记录（2026-07-29）

**完成内容**：
- 创建 `apps/web/` 骨架：package.json + vite.config.ts（端口 5174）+ tsconfig.json + index.html + src/{main.ts, App.vue, env.d.ts}
- 创建 `apps/cli/` 骨架：package.json + tsconfig.json + bin/cli.mjs（tsx loader）+ src/index.ts（commander --help/chat/serve 占位）
- 创建 `apps/tauri/` 骨架：package.json + tauri.conf.json（端口 5175）+ vite.config.ts + src/{main.ts, App.vue} + src-tauri/{Cargo.toml, build.rs, src/{main.rs, lib.rs}, capabilities/default.json}
- 更新 `pnpm-workspace.yaml`：添加 `apps/*`
- 更新根 `package.json`：添加 `dev:web`、`dev:cli`、`dev:tauri` 分端脚本
- 三端 vite.config.ts 和 tsconfig.json 配置 `@worldsmith/agent-runtime` alias

**关键设计决策**：
- 端口分离：Web 5174，Tauri 5175（避免与主项目 5173 冲突）
- 三端通过 `file:../../packages/agent-runtime` 依赖共享层
- Tauri Rust 骨架最小化（仅 main.rs + lib.rs + Cargo.toml），实际命令层在 Phase 3 迁入
- 此阶段 src/ 仅为骨架，不迁移业务代码；原 `src/` 目录保持不变

**验证结果**：
- ✅ pnpm workspace 正确识别三端包（`@worldsmith/web`、`@worldsmith/cli`、`@worldsmith/tauri`）
- ✅ 所有 JSON 配置文件语法正确
- ✅ CLI 端 `--help` 正常运行（通过 tsx）
- ⚠️ Web/Tauri 端 Vite 启动受阻（`@rolldown/binding-win32-x64-msvc` 下载超时，网络问题）

**下一步**：Phase 3 — 前端入口分离与清理（共享 composables 抽离 + Tauri/Web 专用文件迁移 + coreBackend/useAgent/main.ts 改造）

### 端分离真实状态复核 + 检查点提交（2026-07-31）

**检查点提交**：`5c32c78`（825 文件，+121k/-38k）——自 2dfa0f8（2026-07-13）以来所有未提交工作入库，建立回滚点。

**真实状态复核**（修正此前文档误标）：
- Phase 1/2/4/5 完成 ✅（共享层抽离、三端骨架、后端整合、CI 独立）
- Phase 3 **部分完成**：P3-T1~T9 ✅（共享 composables 下沉 + Tauri/Web 专用文件迁移 + coreBackend/useAgent/main.ts 硬编码后端）；**P3-T10 未完成——业务 UI（根 src/ 数百文件）未迁入三端**
- 根 `src/` 仍是主应用（根 `vite` dev 入口 + 全部业务 UI），`apps/web`/`apps/tauri` App.vue 仍为占位骨架
- 证据：[apps/web/src/main.ts](../apps/web/src/main.ts) 注释"Phase 3 阶段：业务 UI 仍在 src/，本入口仅做端初始化"

**安全清理**：移除 ui-kit 死导出 SettingsDialog/CustomModuleView（全库 grep 无消费方，消除 ui-kit 对根 src/ 的最后 2 处引用）

**决策（2026-07-31）**：暂停端分离业务 UI 大迁移（数十万行工程），**回到主应用开发（根 src/）**。端分离按 ROADMAP 单独排期，三端骨架保留。

**当前主应用任务线**：Rust Agent 长任务前端对接（useLongTaskRust 对接 + 长任务 UI 集成 + 端到端实测）→ 深度模式/A2UI/终端/子 Agent 补齐

### 端分离业务 UI 迁移启动决策（2026-08-02）

**背景**：复核迁移前置条件（grep/构建验证）：ui-kit / shared-composables / worldsmith-agent 与根 src/ 已完全解耦（0 引用）；@agent 单轨收敛；三端独立构建通过。根 src/ 733 文件（378 .vue + 355 .ts）待迁移；shared-ui 包不存在。

**三个决策（用户确认）**：
1. **共享 UI 方案**：不新建 packages/shared-ui，继续用 ui-kit（已解耦、已承担 30+ Ws* 组件），迁移时根 src/ 新增共享组件直接下沉 ui-kit
2. **迁移策略**：渐进式分模块迁移（先骨架+路由+核心页面，再逐插件/面板），每模块独立验证可回滚，不做一次性全量迁移
3. **启动节奏**：**先收尾主应用 Rust 后端工作线**（failTask 终态实测、深度模式/A2UI/终端/子 Agent 补齐），再启动迁移，不双线并行

**结论**：迁移启动条件已具备，但**暂不启动**；待主应用 Rust 后端收尾后，按渐进式分模块策略启动。

### Rust 端到端实测通过 + 前端高级能力补齐（2026-08-03）

**背景**：端到端实测"消息发送无反应"排查 + 深度模式/A2UI/终端/子 Agent 补齐评估（commit 5fd166e、c0d2cff）。

**消息不渲染排查结论（4 层根因叠加）**：
1. `readonly(backend)` 深代理 → 适配器 subscribe/subscribeDeepPhase 的 Set 变只读，注册失败
2. payload 序列化 snake_case（message_id/full_text）vs 前端 camelCase（messageId/fullText）→ 字段全 undefined（payload.rs 加 `rename_all_fields = "camelCase"`）
3. agent.rs 会话级 + genai_backend 每 LLM 级双广播 StreamStart/End → 同 message_id 重复消息（删除会话级广播）
4. **最终根因**：消息原地修改（target.content=...）不改变对象引用 → AgentMessageBubble.hasVisibleContent computed 依赖 props.msg 不失效 → 缓存 false 永不重算 → 气泡渲染为空（新增 updateMessage 不可变更新替换全部 6 处原地修改点）

**补齐评估结论**（三路代码核查）：
- Rust 端：深度模式 DeepPhaseChanged 主聊天必经广播 ✅；ToT/GoT/Multi-Agent/Supervisor/Router/Loop 引擎完成（独立 cmd_*_run 命令可达）✅；长任务 SQLite 状态机完整 ✅；**A2UI Rust 端空壳**（无工具实现/无事件广播，实际链路走 TS 工具桥 emitA2UI）；**PlanCreated/PlanStepUpdate 无广播点**；agent-runtime 无 PTY（Tauri 命令层 cmd_pty_* 完整）
- 前端：6 编排状态栏（Loop/ToT/GoT/MA/Supervisor/Router）订阅与 Rust 广播一一对应已接通；缺口集中在 4 点（深度模式主聊天被 use-deep-layout=false 切断 / finalOutput 无赋值 / 终端 stub / createSubBackend 抛错）

**实施（4 批，c0d2cff）**：
- 批次1：AgentChat `use-deep-layout` 按 `activeChatMode==='deep'` 动态传；agent_end 从消息列表回填 finalOutput 结论；resolveToolConfirmation 降级（Rust 无挂起-恢复机制，记录日志）
- 批次2：终端 4 个 stub 替换为真实实现（openTerminal/writePtyInput/resizePty/closeTerminal → cmd_pty_spawn/write/resize/kill；TerminalPanel 已支持 pty-output-{id} 渲染）
- 批次3：子 Agent 方案 A——createSubBackend 创建独立 Rust 会话（createRustAgent），prompt 包装层先注册监听再触发，等 agent_end/error 后返回末条 assistant 内容
- 批次4：三处过时横幅文案统一（AgentChat/SpaceChat/ProviderPanel）+ 契约注释清理（useAgent.ts/useAgentRust.ts）
- **明确不做**：thinking 段（Rust 无 thinking 事件流，thinkingLevel=off）、plan 进度（Rust 端 PlanCreated 无广播点）——无数据源不造死代码

**验证**：vue-tsc 改动文件 0 错误（存量错误与本次无关）；CDP 端到端实测消息链路完整（assistant 完整回复渲染 + 新横幅文案生效）

**关键决策**：
- 子 Agent 走方案 A（独立 Rust 会话）而非方案 B（事件桥接展示）
- A2UI 维持 TS 工具桥路径（已验证可用），Rust 端事件通道作预留不开发
- GitHub 仓库：https://github.com/LINGTIAN303/WorldSmith（私有，gh repo create 创建，原 origin URL 仓库不存在）

**待办**：长任务全链路实测（心跳/checkpoint/取消/恢复/失败 5 项）；端分离业务 UI 迁移启动

### 风险点处理（2026-08-03）

**风险点 1（终端/子 Agent 未实测）→ 已实测通过 ✅**
- 终端：CDP 直测 invoke 链路（等价 openTerminal/writePtyInput 代码路径）——cmd_pty_spawn 启动 cmd.exe → 终端控制序列输出推送（pty-output-{id} 事件）→ echo 命令回显成功 → cmd_pty_kill 关闭。验证脚本 scripts/cdp-pty-diag.mjs
- 子 Agent：动态 import 直测 createRustAgent（等价 createSubBackend 核心逻辑）——独立会话创建 → prompt → agent_end → 返回末条 assistant 内容。验证脚本 scripts/cdp-subagent-diag.mjs
- 注意：裸 PTY 链路需手动回复 DSR 光标位置（\x1b[6n），xterm.js 前端会自动处理，真实 UI 无此问题

**风险点 2（A2UI Rust 端空壳）→ 已决策维持 TS 桥 ✅**
- A2UI 走 TS 工具桥路径（emitA2UI → a2uiSurfaces → A2UIRenderer）已验证可用；Rust 端 A2UIEvent 通道作预留不开发

**风险点 3（循环控制双轨）→ 决策保持现状 + 记录为已知限制**
- 主聊天自实现重试/限流（call_llm_with_retry/execute_tool_with_retry/last_llm_call_time）已工作正常，不产生 LoopEng 事件
- LoopEng 状态栏（LoopControlStatusBar）在独立 pattern 会话（cmd_loop_control_*）正常工作
- 完整接入 LoopController 需：主聊天创建控制器实例 + LoopEng 事件通道（loop_control:event:{taskId}）+ 前端 taskId 关联，工作量中-大且改动主聊天核心循环，风险高；当前主聊天限流/重试行为正确，**不做过度工程**，后续如需主聊天展示限流/超时状态再评估

### 长任务全链路实测通过（2026-08-03）

**5 项全链路实测（CDP 脚本：cdp-lt-real / cdp-lt-state）全部 PASS**：
- 心跳：5s 推进（Δ~4994ms）+ SQLite lastHeartbeatAt 落库 ✅
- checkpoint：turnCount/currentTool 生效并持久化 ✅
- 取消：requestCancel 协作式 flag → cancelTask → SQLite status=cancelled ✅
- 失败：failTask → SQLite status=failed ✅
- 恢复：running 记录 detectResumableTasks → resumeActiveTask 接管（turn 保留、心跳重启）→ completeTask 清理 ✅

**实测发现并修复竞态 bug**：
- `useLongTaskRust.startTask` 初始 `saveTask` 是 fire-and-forget（不 await），紧接的 cancelTask/failTask 的 `cmd_long_task_update_status` 可能先落库，初始 running 记录（upsert 整条）后到**覆盖终态为 running**（实测 T2 取消后 SQLite 仍 running）
- 修复：startTask 改 async + `await saveTask`；useAgentRust.ts 调用处加 await（仅 1 处）

**清理**：4 个历史遗留无主 running 任务（刷新/中断未终结的僵尸记录）已标记 cancelled 清理

**Phase 2 收尾完成**：Rust 长任务工作线（消息渲染/深度模式/终端/子 Agent/长任务 5 项）全部实测通过，可启动端分离业务 UI 迁移
<!-- HIPPOCAMPUS:SECTION:decisions END -->

<!-- MemoryCenter:SECTION:task_state START -->
## 当前任务
Tauri 端 UI/UX 全维度优化（视觉 + 交互事件 + 键盘可达性）——批次 87-90 完成，视觉审查报告 27 项全部闭环

## 已完成步骤
- [x] 阶段 1.5 Tauri 集成：14 个 agent 命令 + 事件桥接 + 多实例管理 + 前端通信层
- [x] 阶段 2.0 前端 UI 集成（方案 B 开关切换）：useAgentRustAdapter + 路由层 + UI 横幅 + 31 个类型错误修复
- [x] 阶段 2.5 会话持久化（批次1-4）：commands/session.rs（6 个 Tauri 命令）+ persistence.rs + useAgentRust.ts 对接
- [x] Phase 2 Loop Engineering 批次1-6：Rust 长任务持久化（LongTaskManager + SQLite LongTaskRepository）+ 循环控制 + Tauri 命令层（7 个命令）全部完成
- [x] 端分离检查点提交（5c32c78）：825 文件入库，回滚点建立
- [x] 端分离真实状态复核：Phase 3 部分完成，根 src/ 仍是主应用，P3-T10 未做
- [x] 安全清理：ui-kit 死导出 SettingsDialog/CustomModuleView 移除（消除 ui-kit→根 src/ 最后 2 处引用）
- [x] AgentChat.vue 40 个 TypeScript 错误修复（2026-07-31）
- [x] 工作区收敛（2026-08-02，c3856de）：@agent 统一到 packages/agent-runtime 单轨；worldsmith-agent 冻结为端适配器宿主；vite build 两次通过
- [x] 文档全量同步（2026-08-02）
- [x] Rust 端到端实测通过（2026-08-03，5fd166e）：消息渲染 4 层根因修复
- [x] 前端高级能力补齐 4 批（2026-08-03，c0d2cff）
- [x] **批次 87 视觉审查收尾**（f086759 后）：#14 空态图标浅色对比度（新增 --empty-icon 令牌 #c7cad3/dark rgba(139,135,248,0.4)）；#4 终端会话面板改 flex 布局消除 sticky 遮挡（header/create 固定、列表区独立滚动）；#5 SubAgentView submit-row sticky 吸底（错误条不挤出主按钮）；#18 遮罩 0.38→0.45；#22 io-msg 间距 8→12px；#23 记忆标题 pulse 圆点空态隐藏；#25 表单帮助小字 muted→secondary
- [x] **批次 88 #15 checkbox 自定义**：TerminalView `.toggle input` 改 appearance:none 自绘（accent 底 + on-accent 对勾），修复 WebView2 accent-color 勾选不可靠
- [x] **批次 89 交互反馈语言收敛**（60c43f9）：新增 --press-scale:0.96 令牌统一按压反馈（rail-item/msg-copy/input-clear/error-dismiss/chip/scroll-bottom/new/del/destroy/search-clear/mp-search-clear/collapse/modal-close/toast-close/select-trigger/seg-item/tpl-li）；hover 收敛（列表=背景+标题accent、卡片=边框accent）；TuiButton loading 语义修正（is-loading 不降透明度 cursor:progress）；各视图异步按钮改 :loading（TerminalView 执行/MemoryPanel 归档/SubAgentView 提交导入/TuiConfirm）；PhaseSection 折叠过渡修复（TransitionGroup v-show→外层 Transition + v-if）；phase-item 状态切换 transition；App 删除确认 deleting 防双击
- [x] **批次 90 焦点/语义/键盘增强**（d23d861/0103849/55b1ed9）：TuiModal 弹窗栈（唯一 id + 仅栈顶响应 Esc/Tab 防全关）+ 聚焦首控件 + aria-describedby；全局快捷键检测 aria-modal 弹窗互斥；下拉菜单（TuiSelect/tpl-menu）关闭回焦 trigger；tpl-menu aria-selected 改绑编辑态；四列表（SessionList/MemoryPanel/SubAgentView/TerminalView）方向键导航；TuiSelect Tab 关菜单；错误条 role=alert；展开按钮 aria-expanded/controls；phase-bar aria-controls；rail aria-current=page；表单 label for/id 关联（SubAgentView + ModelSettingsDialog）；记忆 list/detail 视图淡入过渡；加载态 pulse 圆点；启用 --dur-lg 于弹窗/视图切换；msg-stream position:relative；toast move 重排；终端高频输出降级直接滚动；tpl-menu 菜单过渡；TuiSegmented radiogroup 语义；模型配置弹窗模式切换淡入过渡

## 进行中步骤
- Tauri 端 UI/UX 持续优化（批次推进模式：审计 → 修复 → Playwright 验证 → 截图归档 → 提交）

## 下一步
- 视觉审查报告（docs/details/visual-review-2026-08-07.md）27 项全部闭环 ✅
- 交互事件审计 20 项 P2 全部处理 ✅（派 search 子代理全端审计 8 维度产出）
- 可继续：桌面端窗口级体验（拖拽/托盘）、长对话性能（虚拟滚动）、剩余 P3 打磨

## 本次进展（2026-08-01）
- 检查点提交 5c32c78 + 端分离状态复核 + ui-kit 死导出清理（见 decisions 段）
- **Rust 长任务生命周期接入完成**（src/agent/composables/useAgentRust.ts）：
  - 缺口确认：cmd_agent_prompt 未接线 Rust 端 LongTaskManager（内部空转），长任务需前端驱动
  - sendMessage → longTask.startTask（type=main-agent）+ 断点恢复后复用 taskId（防抢占）
  - tool_execution_start → checkpoint(currentTool)；异步 refreshRuntimeMessages（Rust OrchestratorMessage 真实结构）
  - agent_end → isCancelRequested ? cancelTask : completeTask；error → failTask
  - abort 包装：requestCancel 协作式 + cmd_agent_abort
  - newSession/dispose 清理 currentTaskId
  - resumeTask 的 getCheckpointData 统一用 lastRuntimeMessages
  - 验证：vue-tsc useAgentRust.ts 零错误；全项目 122 条错误均为预存（graph/StatusBar/entity-core 迁移遗留）

## 本次进展（2026-08-02）— 工作区收敛 + 环境修复 + 端到端实测
- **检查点提交 20a3933**：WORLDSMITH_DATA_DIR、custom-protocol feature、vite noDiscovery、nodejieba 间接 require、shared-composables 依赖声明恢复、cdp-helper 脚本
- **环境修复**（TRAE 沙箱 + dev 链路）：
  - cookie 沙箱拦截（AppData\Local\com.worldsmith.app\.cookies 致 exe 退出）→ tauri.conf.json `dataDirectory: "../.webview2-data"` 重定向
  - ui-kit exports 通配符 bug（`*/index.vue` → `*`）
  - CJS interop：noDiscovery 下显式 include dexie/jszip/events/vuedraggable/等 9 个包
  - worldsmith-agent/index.ts 静态 re-export child_process → 移除（浏览器链加载失败）
- **工作区收敛（路线 A，消除双轨）**：
  - `@agent/*` 统一指向 `packages/agent-runtime/src`（vite/tsconfig/vitest 三处配置；alias 12 条子路径精简为 1 条裸 @agent 前缀匹配）
  - ui-kit agent-descriptor.ts 4 处 `@agent/` → `@worldsmith/agent-runtime/`（agent-runtime exports 补全 toolbus/tools 等 12 个通配子路径）
  - 主应用 main.ts 显式 registerExecutionAdapterFactory（替代 worldsmith-agent/index.ts 的 import './execution' 副作用）
  - worldsmith-agent 冻结为"端适配器宿主"（仅 tauri/ws/node adapter 被显式引用）
  - 验证：vite build 两次通过（33.6s / 31.0s），依赖图单轨
- **端到端实测状态**：startTask/心跳/checkpoint/SQLite 持久化已验证 ✅；failTask 终态未闭环（待收敛后干净环境重测）
- **文档同步**：README（技术栈双后端/13 子包/Project Structure/编排模式）、project_memory（日期/后端架构 7 项/子包 13/任务状态）、ROADMAP（任务19 前置完成+变更记录补全 07-07~08-02）、agent-orchestration-roadmap（状态改为阶段1/2完成+里程碑 M0-M2 更新+待办清单）、perf-kit-plan（包已建成/store 改造未落地）、rust-backend-completion-plan（P0 完成+P1-5 更彻底实现）、skills-store-spec（Task 24 状态）、端分离文档库（README 进度表/01 快照标注/02 已实施/07 执行状态/08 最新进展/10 状态说明）

## 本次进展（2026-08-07）— Tauri 端 UI 审计批次 52/54/55（未提交工作区）
- **批次52**：TerminalView `.entry-cmd` 补复制命令行为（`copyCommand` → `navigator.clipboard.writeText` + toast 反馈），消除"hover 暗示可复制但无行为"的误导性 affordance
- **批次54**：死设计令牌清理（grep 验证零引用后删除，主题完好）
- **批次55**：三个清空按钮统一为同一视觉语言——对话输入清空 `.input-clear` / 记忆检索清空 `.mp-search-clear` / 会话搜索清空 `.search-clear`（20×20 弱化圆形、`bg-active` 弱底、`text-muted` 弱色、hover 渐显）
- **验证**：vue-tsc typecheck 通过；Playwright 冒烟验证（输入清空 + 记忆检索清空运行时样式一致，会话搜索清空 CSS 静态确认）；截图归档 `docs/details/截图/`（b52-terminal-view / b55-input-clear-button / b55-memory-search-clear）

## 本次进展（2026-08-07）— 批次56 表单输入控件统一 + 错误提示形态统一
- **表单输入控件统一**（基准：8px 12px / radius-sm / focus ring）：SubAgentView `.field` 从 radius-md + 10px 12px + 无 ring 对齐；ModelSettingsDialog 输入 padding 8px 10px→12px
- **错误提示形态统一**（基准：8px 12px / radius-sm / danger-soft 弱底 + 边框）：TerminalView `.error`（无圆角 6px 16px）与 ModelSettingsDialog `.error` / SubAgentView `.form-error` 三处对齐
- **验证**：typecheck 通过；Playwright 运行时验证表单输入 ring 生效 + 表单错误提示弱底边框；截图 b56-subagent-form-inputs / b56-form-error-unified 归档

## 本次进展（2026-08-07）— 批次57 列表语言统一
- **来源**：派 search 子代理全端视觉审计（8 项发现），选选中态分叉 + 缺 hover 两项
- **选中态统一**（accent-soft 底 + 主文字 accent，无指示条）：TerminalView `.session-list li.active` 移除 inset 3px accent 左色条；SessionList `.list li` 圆角 radius-md→sm
- **补 hover**：SubAgentSection `.entry` 补 border-color 加深（卡片语言）；`.entry.running:hover` 保持强调边框
- **验证**：typecheck 通过；Playwright 编译验证选中态无色条 + hover 规则生效；截图 b57-list-language-unified 归档

## 本次进展（2026-08-07）— 批次58 主视图头部标题字号统一
- **统一基准** `--fs-lg`（16px）+ 600：MemoryPanel `.mp-title` 15px 硬编码→fs-lg（消除非令牌值）；TerminalView `.bar .title` fs-base→fs-lg；SubAgentView `.list-header h2` fs-base→fs-lg（保留 secondary 弱化色区分主次）
- **验证**：typecheck 通过；Playwright 运行时五处标题均 16px（对话/记忆/终端/子Agent左右栏）；截图 b58-heading-fontsize-unified 归档

## 本次进展（2026-08-07）— 批次59 提示/反馈形态统一（审计#4+#5）
- **审计#4 语义修复**：MemoryPanel `.mp-notice` 同时承载错误/成功，此前错误以 accent 蓝渲染（与全身 danger 冲突）。`flash(msg, type='success'|'error')` 类型化 + `noticeType`，4 处错误调用标 error；`.mp-notice` 由全宽 accent bar → 统一 box（margin 8px 16px 0），`.mp-notice.error` 走 danger
- **审计#5 三形态收敛**：SubAgentView 成功/资讯提示由三形态（`.list-msg` success box / `.instances-msg` 纯文本 accent / `.io-msg` 纯文本 accent）收敛为统一 success box（8px 12px / radius-sm / border success-soft）；`listMsgType`/`instanceMsgType`/`ioMsgType` 类型化，错误（复制/导入/清空实例失败）走 `.error` danger 变体
- **统一基准**（与批次56 form-error / TerminalView .error 同构）：错误 danger-soft 弱底+边框；成功 success-soft 弱底+边框
- **验证**：typecheck 通过；Playwright 触发导入空 JSON → `.io-msg.error` 计算样式 color #f87171 / bg+border danger-soft / radius 6px / padding 8px 12px；scoped CSS `.io-msg.error`/`.mp-notice.error` 规则编译注入确认；截图 b59-subagent-io-error / b59-memory-panel-view 归档

## 本次进展（2026-08-07）— 批次60 头部内边距统一 + 对话空状态收敛（审计#8）
- **审计#8a**：SessionList `.panel-head` padding-top 18px → 12px（对齐各面板 head 12px 垂直基准）
- **审计#8b 副本收敛**：App.vue 对话空状态手写 `.empty`（64px 徽标 / fs-lg 18px 标题）→ 统一 TuiEmpty（icon=chat / fill / 56px 徽标 / fs-md 标题）+ chips 走插槽（`.empty-chips` 保留并补 margin-top 18px）；删除 `.empty`/`.empty-mark`/`.empty-title`/`.empty-hint` 4 个手写 CSS 块；新增 TuiEmpty import
- **关键决策**：对话空状态标题从 18px 收敛到 fs-md 13px（TuiEmpty 既定语言），不特殊化对话区——统一性 > 局部大小，符合弱提示克制风格
- **验证**：typecheck 通过；Playwright 运行时 `.messages .tui-empty` fill 徽标 56×56 / radius 16px / title fs-md / chips 4 个在插槽 / chips margin-top 18px；`.panel-head` padding-top 12px；截图 b60-chat-empty-tuiempty / b60-sessionlist-head-12px 归档

## 本次进展（2026-08-07）— 批次61 icon-only 按钮尺寸令牌化（审计#6）
- **令牌新增**：theme.css 布局尺寸段加 `--icon-btn-lg: 28px`（头部主操作：新建/弹窗关闭）/ `--icon-btn-md: 24px`（标准操作：复制/删除/折叠）；20px 内嵌清空为批次55 既定弱化语言不入档；30px scroll-bottom 特殊悬浮保留
- **22px 收敛 24px**：SubAgentSection `.collapse`、TuiToast `.tui-toast__close` 改用 `--icon-btn-md`
- **7 处引用令牌**：SessionList `.new`→lg / `.del`→md；TuiModal `.tui-modal__close`→lg；App `.msg-copy`→md；TerminalView `.destroy`→md；全端 `width: 22/24/28px` 硬编码清零（grep 确认）
- **hover 语义色保留**（danger 删除 / accent 主操作 / primary 中性，语义色合理非分叉）
- **验证**：typecheck 通过；Playwright 运行时 `.new` 28×28（lg 令牌生效）、令牌值正确、7 处按钮 scoped CSS 引用 `var(--icon-btn-*)` 编译注入；截图 b61-icon-btn-tokens 归档

## 本次进展（2026-08-07）— 批次62 新一轮全端审计 + 候选队列排期
- **方式**：派 search 子代理全端审计（8 维度），产出 **13 项发现（5×P2 + 8×P3，无 P1）**
- **P2**：#1 App `.error-bar` radius-md+fs-md 偏离全端错误 box 基准（radius-sm+fs-sm）；#2 标签族圆角 pill vs radius-sm 分叉；#3 呼吸动画 6 处重复 keyframe 参数不一致（opacity 0.35/0.4/0.5、1.2s/1.4s）；#4 渐变 `#7c3aed` 硬编码 ×2 深色不同步；#5 SubAgentView 自研 .copy/.remove 与 TuiButton danger-ghost 重复
- **P3**：#6 `#fff` 硬编码 10 处；#7 非令牌圆角（头像 8px、TuiEmpty 16/12px）；#8 紧凑输入框内边距三档；#9 对话横轴 20/24px 双档；#10 disabled 透明度 0.4/0.5/0.55；#11 aria-label 覆盖不一；#12 键盘可达性两处（entry-cmd 无键盘、phase-bar 缺 space）；#13 状态圆点 6/7/8px 三档
- **排期**：批次63 可访问性补强（#12+#11）→ 64 动效统一（#3+#13）→ 65 标签族分工（#2+#7）→ 66 颜色令牌收尾（#4+#6）→ 67 尺寸间距收尾（#8+#9+#10）→ 68 SubAgentView 按钮替换（#5）
- **验证**：审计为纯研究（无代码改动），候选队列已持久化到 MemoryCenter standalone（28d65ccb）

## 本次进展（2026-08-07）— 批次63 可访问性补强（审计#12 键盘可达性 + 审计#11 aria-label）
- **#12a 键盘可达**：TerminalView `.entry-cmd`（可点击 div）补 `role="button"` / `tabindex="0"` / `aria-label="复制命令"` + `@keydown.enter.prevent` / `@keydown.space.prevent` → copyCommand——键盘用户可复制命令，消除误导性 affordance
- **#12b**：PhaseSection `.phase-bar` 补 `@keydown.space.prevent`（对齐 MemoryPanel `.mp-item` / SubAgentView `.spec-main` 的 Enter+Space 双键模式）
- **#11 aria-label 补齐 8 处**：SessionList `.new`/`.del`；App `.msg-copy`×2 / `.scroll-bottom` / `.stop-btn` / `.send-btn`；SubAgentSection `.collapse`（动态展开/收起文案）；TerminalView `.destroy`——统一与 title 文案一致
- **统一规则**：icon-only 按钮统一 `aria-label`（与 title 同文案）；`role="button"` 可交互元素键盘模式统一 Enter+Space 双键
- **验证**：typecheck 通过；Playwright 运行时 `.new`/`.send-btn` aria-label 渲染正确；`.collapse` 因 `v-if="subAgents.length>0"` 无数据不渲染（预期）；数据依赖元素由源码+typecheck 保障；截图 b63-a11y-aria-keyboard 归档

## 本次进展（2026-08-07）— 批次64 动效统一（审计#3 pulse 共享 + 审计#13 圆点令牌）
- **theme.css**：新增全局 `@keyframes pulse`（opacity 1 → 0.35，纯 opacity 呼吸无 scale，弱提示风格）+ `--dur-pulse: 1.2s` + `--dot-sm: 6px`（行内紧凑）/ `--dot-md: 8px`（独立强调）
- **6 处本地 keyframe 删除统一引用**：App `think-pulse`（1.2s/0.4/scale 0.8，取消 scale）、LoopControlStatus `lcs-pulse`（1.4s→1.2s）、SubAgentSection `chip-pulse`+`pulse`、PhaseSection `phase-pulse`、SubAgentView `pulse`（0.5→0.35）→ 全部 `animation: pulse var(--dur-pulse) ease-in-out infinite`
- **7 处状态圆点收敛两档**：6px sm（chip-dot/live-dot/phase-dot）+ 8px md（thinking-dot 7→8/lcs-dot 7→8/status-dot/mp-dot）
- **验证**：typecheck 通过；运行时令牌值正确（--dot-sm 6px/--dot-md 8px/--dur-pulse 1.2s）、`@keyframes pulse` 全局唯一（无 scoped data-v）、mp-dot 8×8px 生效；grep 确认组件内 keyframes 副本清零；截图 b64-pulse-dot-tokens 归档

## 本次进展（2026-08-07）— 批次65 标签族分工 + 非令牌圆角收敛（审计#2+#7）
- **分工规则确立**：状态/计数徽标 → pill（lcs-badge / chip / panel-count / item-count / .count）；代码标识/元信息签 → radius-sm（mp-tag / wl / id / instance-id / session-tag）
- **内边距统一**：pill 档 `1px 8px`（panel-count 7→8、item-count 0 6px→1px 8px、.count 2→1px）；sm 档 `1px 6px`（instance-id 5→6、session-tag 0→1px）
- **非令牌圆角收敛**（零新增令牌）：App `.avatar` 8px→`--radius-sm`；TuiEmpty 56px 徽标 16px→`--radius-lg`（14px）、40px compact 徽标 12px→`--radius-md`（10px）——圆角/尺寸比例统一 25%
- **验证**：typecheck 通过；运行时对话区 56px 徽标 radius 14px、SessionList compact 40px 徽标 radius 10px（令牌生效）；数据依赖标签由源码+typecheck 保障；截图 b65-tag-radius-tokens 归档

## 本次进展（2026-08-07）— 批次67 尺寸间距收尾（审计#8 紧凑输入框 + #9 对话横轴 + #10 disabled 透明度）
- **#8 紧凑输入框三档统一**（新增令牌 `--input-sm-h: 30px`）：SessionList `.search input` / MemoryPanel `.mp-search` / TerminalView `.create input` 高度统一 30px（mp-search 6px 垂直 padding→height、create input 6px→height）；水平 padding 保留 icon 占位需求（search 28/30、mp 26/10、create 8）
- **#9 对话横轴 24px 统一**（新增令牌 `--chat-gutter: 24px`）：20px 侧收敛——App `.chat-header`（12px 20px）、LoopControlStatus `.lcs`（6px 20px）、SubAgentSection `.subagent-section`（10px 20px）→ var(--chat-gutter)；24px 侧（`.messages`/`.a2ui-zone`/`.input-bar`）改 var() 引用——附属条对齐主内容区，滚动不错位
- **#10 disabled 透明度统一**（新增令牌 `--disabled-opacity: 0.5`）：App `.send-btn:disabled` 0.4、TuiButton `.tui-btn:disabled` 0.5、TuiSegmented `.tui-seg__item:disabled` 0.55 三处魔数收敛；TuiSelect 用 bg/color 弱化语言（非 opacity）不改
- **范围界定**：node_modules 第三方库 disabled opacity（0.4/0.45/0.55）与 `.create-btn:disabled 0.45` 均非自研代码，不动
- **验证**：typecheck 通过；Playwright 运行时 chat-header/messages/input-bar 均 24px、send-btn disabled opacity 0.5、TerminalView/MemoryPanel 输入框实测 30px；`.search input[data-v-943eccf0]` 等编译规则确认引用令牌；截图 b67-chat-gutter-24px / b67-memory-mp-search-30px / b67-terminal-create-input-30px 归档

## 本次进展（2026-08-07）— 批次68 SubAgentView 自研按钮替换 TuiButton（审计#5 收尾）
- **模板**：规格列表 `<button class="copy">` → `<TuiButton variant="ghost" size="sm" title="复制该规格 JSON">`；`<button class="remove">` → `<TuiButton variant="danger-ghost" size="sm" title="删除">`
- **样式**：删除自研 `.copy`（border-strong/accent 字）与 `.remove`（danger-soft 边框/danger 字）全套规则；opacity 渐显从按钮级移到容器级 `.spec-actions`（opacity 0 → `.spec:hover` / `:focus-within` → 1，键盘 Tab 聚焦整组显形，等价替代按钮级 `:focus-visible`）
- **决策**：`danger-ghost` 与自研 `.remove` 语义完全同构直接替换；`.copy` 属弱操作 → `ghost`
- **验证**：typecheck 通过；编译 CSS 确认 `.spec-actions[data-v-8d6ee633]` opacity/flex/gap 正确、`.copy`/`.remove` 选择器零残留；spec 列表无数据不渲染（预期）；截图 b68-subagent-tuibutton-actions 归档
- **里程碑**：批次 62 审计 13 项发现（#1-#13）至此全部闭环（批次 56-68）

## 本次进展（2026-08-07）— 批次69 第二轮审计批次 A+B（可访问性补强 + 视觉一致性微调）
- **来源**：批次68 完成后派 search 子代理第二轮全端审计，产出 **4×P1 + 4×P2 + 13×P3**；本轮执行批次 A（P1 全部）+ 批次 B（P2 全部 + P3 选择性 8 项）
- **P1 可访问性**：rail 两按钮补 aria-label（主题切换动态文案/模型配置）；5 处仅 placeholder 输入补 aria-label——聊天 textarea「输入消息」/终端命令「输入命令」+ Shell 路径 + 工作目录 / 会话搜索「搜索会话」/ 记忆检索「检索记忆」
- **P2**：App `.error-bar` 圆角 radius-md→sm；TuiModal dialog 补 `aria-labelledby`（标题 h2 加 id）；SubAgentView `.list-header h2` 补 font-weight 600 + 颜色 text-primary（对齐 form-header）；TuiSelect 触发钮补 `aria-haspopup="listbox"` + `aria-activedescendant`（option 加 `tui-select-opt-{i}` id）、SubAgentView tpl-menu 补 listbox/option 语义
- **P3 选择性 8 项**：计数徽标 padding 统一 8px（TerminalView/SubAgentView 7→8）；SubAgentSection `.status-dot` 补 ease-in-out；两处折叠补 `aria-expanded`（collapse/phase-bar）；tpl-menu z-index 20→`--z-dropdown`；App `.a2ui-zone`/`.error-bar`/PhaseSection 24px→`--chat-gutter`（顺带修复批次67未落地的 a2ui-zone）；`.session-list li` 移除冗余 cursor；`.chip:hover` 弱化（去 bg 只留 border+color）
- **决策（未做项）**：P3-1 输入 30px/按钮 28px 双基准接受现状（--input-sm-h 显式化）；P3-2 act-model 手写按钮与 TuiButton 重复但含截断差异留待；P3-3 tool-chip 带状态属徽标语义 pill 合理；P3-6 cursor-blink 组件专属不归档；P3-10 text-muted 对比度 2.8:1 属弱提示设计张力知会不改；P3-12 TuiEmpty 图标色刻意弱化保持
- **验证**：typecheck 通过；Playwright 实测 rail aria-label / textarea「输入消息」/ TuiSelect activeDesc 链路（ArrowDown→tui-select-opt-1 与 is-focus 一致）/ TuiModal labelledby→「模型配置」全通；截图 b69-a11y-aria-select-modal 归档

## 本次进展（2026-08-07）— 批次70 第二轮审计批次 C（P3 可选打磨收尾）
- **P3-2 act-model 替换 TuiButton（唯一代码消除项）**：App.vue 手写 `<button class="act-model">`（自研 28px secondary 形态 + icon + model-text 截断）→ `<TuiButton variant="secondary" size="sm" icon="bulb" class="act-model">`；样式仅保留 `max-width: 200px` + `:deep(.tui-btn__label)` 截断覆盖（min-width 0/ellipsis），删除全套自研规则与无引用的 .model-text——消除与 TuiButton 重复实现
- **P3-1/3/6/12 注释固化**：theme.css `--input-sm-h` 补「与按钮 sm 28px 为 2px 既定双基准」；PhaseSection `.tool-chip` 补「带状态属徽标语义 → pill」；MessageContent `cursor-blink` 补「组件专属不移入注册表」；TuiEmpty 图标色补「刻意用 accent-soft-border 保持 accent 系弱化」
- **P3-10 知会不改**：text-muted 对比度 2.8:1 属弱提示设计张力，需整体评估不做单点改动
- **验证**：typecheck 通过；Playwright 运行时 `.act-model` = BUTTON.tui-btn.is-secondary.is-sm（28px）+ max-width 200px + label ellipsis + bulb icon ✓；截图 b70-p3-polish-act-model 归档
- **里程碑**：第二轮审计（4×P1 + 4×P2 + 13×P3）全部闭环

## 本次进展（2026-08-07）— 批次71 第三轮审计 P1（深色对比度 + placeholder 叠字）
- **来源**：批次70 完成后派 search 子代理第三轮全端审计，产出 **2×P1 + 10×P2 + 14×P3**（重点转向布局/排版/反馈一致性/性能维度）
- **P1-1 深色 --on-accent 白字对比度**：theme.css dark 块补 `--on-accent: #17171b` 覆盖（原 :root #ffffff 未在 dark 覆盖）；dark 下 accent #8b87f8/danger #f87171 提亮为浅色，白字仅 2.8-3.0:1 低于 AA 4.5:1，换深字后 >7:1；TuiButton primary/danger、rail-logo、avatar、send-btn、shell-chip 全部经 var() 自动切换
- **P1-2 主输入栏叠字**：App.vue textarea 空闲态 placeholder（「输入消息，Enter 发送」）置空——.rotating-hints 绝对定位与原生 placeholder 起点完全重合，同为 text-muted 14px 叠字；轮转提示独占引导层，发送/流式时仍显示「输入引导词」
- **验证**：typecheck 通过；Playwright 实测 dark --on-accent=#17171b + primary 按钮 bg rgb(139,135,248)/文字 rgb(23,23,27)；空闲态 placeholder="" + rotating-hints 可见；截图 b71-input-hint-no-overlap / b71-dark-on-accent 归档
- **排期**：批次72 P2 字重布局类 → 批次73 反馈一致性 → 批次74 P2-10+P3
<!-- MemoryCenter:SECTION:task_state END -->
