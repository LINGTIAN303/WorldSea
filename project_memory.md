<!-- HIPPOCAMPUS:SECTION:project_memory START -->
# WorldSmith 项目记忆文档

> 本文档由主要执行 Agent 维护，记录项目概况、架构、任务状态与关键决策。
> 任务路线独立维护于 docs/ROADMAP.md，防止本文档反复更新导致任务丢失。
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

## 三、后端架构（2026-08-02 更新）

> 2026-07-05 调研结论（hippocampus 记忆 305b700e / 847beb6f），2026-08-02 补充新增后端

1. **worldsmith-core**（Rust → WASM）：约 70 个导出方法 — 存储、校验、图布局、迁移
2. **tactical-engine**（Rust → WASM）：18 个导出方法 — 寻路、战斗 AI
3. **crates/agent-runtime**（Rust，2026-07-25 起新增）：Rust Agent 后端 — AgentLoop/GenaiBackend/ToolBus/ToT/GoT/Multi-Agent/Supervisor/Router/Loop-Engineering/LongTask，经 Tauri 命令层暴露
4. **src-tauri**（Rust）：150+ Tauri 命令 — 工作流引擎、文件系统、agent_bridge（14 agent 命令 + session 6 命令 + long_task/loop_control 等）
5. **worldsmith-skills-store**（Rust，2026-07-07 起新增）：Skills Store 独立 crate（19+ 单测，无 Tauri 依赖）
6. **worldsmith-server**（Node.js）：7 个 HTTP 端点 — crawl/convert/vector-search（含 3 个 Python 微服务，**已标记废弃**，能力迁移至 CLI serve）
7. **worldsmith-agent**（TS）：端适配器宿主 — 核心已下沉 packages/agent-runtime，仅保留 execution adapter

**覆盖度结论**：约 40-45% 后端功能尚未触达前端 UI；CRDT 协同算法全套（15 个函数）未接入前端。Rust Agent 编排模式（ToT/GoT/Multi-Agent/Supervisor/Router/Loop）已有前端 composable，但 UI 端到端实测待补。

## 四、Monorepo 子包（packages/）

agent-core / agent-runtime / canvas-engine / entity-core / font-kit / governor-core / memory-archive / motion-kit / perf-kit / plugin-sdk / shared-composables / theme-kit / ui-kit（共 13 个）

## 五、当前任务状态

- **ROADMAP**：28 条任务方向，分 8 大类别（详见 docs/ROADMAP.md；任务 1 ✅、任务 3 ✅、任务 4 ✅（P1-P4 + task 模式方向 A-D）、任务 24 进行中（阶段 1-4 完成，待桌面端 UI 实测），其余待启动）
- **Rust Agent 后端**：阶段 1.1-1.5 ✅、阶段 2.0（UI 集成）✅、阶段 2.5（会话持久化）✅、Phase 2 Loop Engineering（long_task/loop_control）✅；待办：failTask 终态闭环重测、深度模式/A2UI/终端/子 Agent 补齐
- **端分离**：Phase 1/2/4/5 ✅、Phase 3 部分完成（业务 UI 未迁入三端）；**2026-07-31 决策暂停业务 UI 大迁移**，按 ROADMAP 单独排期
- **工作区收敛**：@agent 统一到 packages/agent-runtime 单轨（c3856de），worldsmith-agent 冻结为端适配器宿主
- **实际文档**：docs/ROADMAP.md（任务路线）、docs/端分离/（迁移文档库 11 份）、docs/agent-orchestration-roadmap.md（Rust 编排路线，阶段 1/2 完成）、docs/perf-kit-plan.md、docs/rust-backend-completion-plan.md、docs/skills-store-spec.md
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
- `docs/端分离/` 文档库（11 份文档：README + 00-10）
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
<!-- HIPPOCAMPUS:SECTION:decisions END -->

<!-- MemoryCenter:SECTION:task_state START -->
## 当前任务
端分离检查点已提交（5c32c78），Phase 3 业务 UI 迁移暂停；回到主应用开发 — Rust 长任务前端对接

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
- [x] 文档全量同步（2026-08-02）：README/project_memory/ROADMAP/agent-orchestration-roadmap/perf-kit-plan/rust-backend-completion-plan/skills-store-spec/端分离文档库（README、01、02、07、08、10）全部按实际状况更新

## 进行中步骤
- Rust 长任务前端对接（useLongTaskRust）——生命周期接入已完成，待端到端实测

## 下一步
- 端到端实测：浏览器切换到 Rust 后端，触发长任务（如 task 模式），验证心跳/checkpoint/取消/恢复全链路
- 如实测通过：Phase 2 收尾，进入下一阶段（深度模式 / A2UI / 终端 / 子 Agent）

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
<!-- MemoryCenter:SECTION:task_state END -->
