<!-- HIPPOCAMPUS:SECTION:project_memory START -->
# WorldSmith 项目记忆文档

> 本文档由主要执行 Agent 维护，记录项目概况、架构、任务状态与关键决策。
> 任务路线独立维护于 docs/ROADMAP.md，防止本文档反复更新导致任务丢失。
> 最后更新：2026-07-08

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
| Agent | @earendil-works/pi-ai 框架 + 自定义 ToolBus（工具总线）|
| 图表 | ECharts、Sigma.js、D3、Graphology |
| 编辑器 | TipTap 3 |
| 数据库 | IndexedDB（Dexie）/ SQLite（Tauri）|
| 构建 | pnpm monorepo（packages/ 下 11 个子包）|

## 三、四层后端架构

> 2026-07-05 调研结论（hippocampus 记忆 305b700e / 847beb6f）

1. **worldsmith-core**（Rust → WASM）：约 70 个导出方法 — 存储、校验、图布局、迁移
2. **tactical-engine**（Rust → WASM）：18 个导出方法 — 寻路、战斗 AI
3. **worldsmith-server**（Node.js）：7 个 HTTP 端点 — crawl/convert/vector-search（含 3 个 Python 微服务，前端零调用）
4. **src-tauri**（Rust）：约 150 个 Tauri 命令 — 工作流引擎、文件系统、命令注册

**覆盖度结论**：约 40-45% 后端功能尚未触达前端 UI；CRDT 协同算法全套（15 个函数）未接入前端。

## 四、Monorepo 子包（packages/）

agent-core / canvas-engine / entity-core / font-kit / governor-core / memory-archive / motion-kit / perf-kit / plugin-sdk / theme-kit / ui-kit（共 11 个）

## 五、当前任务状态

- **ROADMAP**：28 条任务方向，分 8 大类别（详见 docs/ROADMAP.md；任务 1 已完成，任务 4 P1-P4 + task 模式方向 A/B 已完成，其余待启动）
- **实际文档**：docs/ROADMAP.md（任务路线）、docs/perf-kit-plan.md（性能规划）、docs/superpowers/specs/（记忆归档设计 3 篇）
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
<!-- HIPPOCAMPUS:SECTION:decisions END -->
