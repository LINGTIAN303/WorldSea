# dsh 对话区设计基线（性能与渲染）

> status: 已完成
> 范围：对话区「性能」与「渲染架构」两面——界定为「会话事件窗口 → 组装 → 视图 → 输入/外壳」的整条前端链路。
> 关联：[02-dsh提问工具设计基线](02-dsh提问工具设计基线.md)（交互 seam 独立成文）；dsh 逐工具全清单见 [三域基线·附录](../2026-09-17-三域对齐dsh/01-dsh三域设计基线.md#五附录逐工具全清单2026-09-18-补录)。
> 取证口径：结论均带路径（dsh 根 = `.独立项/【参考项】deepseek-harness/`，以下路径相对该根）。四路只读探索汇总；`assembly.ts` 发布节流与 `tool-ask-user` schema 已逐行抽查复核。

## 零、先读：一句总判断

对话区的底座是「**事件窗口 + 增量组装 + 按 key 订阅**」三件套：**不变量都压在组装层**（keyed 身份、热路径常数复杂度、target 惰性激活），渲染层刻意**不做虚拟滚动**，改用「只渲染已加载窗口 + memo seat + 过程行折叠」控成本；性能由 5 个 benchmark 目录在 CI 里以硬预算压住（源码常量、环境变量不可覆盖）。

---

## 一、性能门禁（benchmarks）

### 1.1 通用规则与校准

- 规则：一个用户路径一目录；Host 侧 `*.bench.ts`、Client 侧 `*.bench.client.ts`；预算为**源码常量**、环境变量不可覆盖；禁止录制会话/网络（`benchmarks/AGENTS.md:5-15`）。
- 校准公式：`ceil(expected × 2 × 1.25)`（`benchmarks/support/calibration.ts:4-15`）——CI 预算 = 实测期望 × 2（环境波动容差）× 1.25（CI 余量）。
- 主线程指标用 CDP `TaskDuration`；浏览器 heap / DOM 节点数只作诊断、无泄漏预算（`benchmarks/long-session-browser/long-session.bench.ts:36-41`、同目录 `README.zh.md:13`，实测约 53MiB / 17,064 节点）。

### 1.2 五个基准

| 基准 | 规模与形态 | 关键预算 / 断言 |
|---|---|---|
| `session-open` | 200 轮 × 500 文本 delta = 127,400 事件；5 样本取中位数 + 128MB old-space 完成性检查（`session-open.bench.ts:33,39`） | first-open 550ms / **reopen 63ms** / read 20ms / restore 60ms / projection 35ms / agent-resume 562ms / GC 后堆 33MB（:292,298,397-399,442-443） |
| `long-session-browser` | 240 轮；120 delta × 16ms 节奏；浏览器内 3 样本（`synthetic-history.ts:9-20`） | 参考值 open200 / page260 / trajectory160 / first1100 / streamTask1800 / input500 / streamWall1000（`long-session.bench.ts:15`）；CI 预算 open1125 / page875 / trajectory625（:19-21）；**输入重叠断言：流式中必须为真、DONE 后必须为假**（:203,222） |
| `active-stream-reconnect` | 10 万 delta 断线重连 | replace 50→63ms / 保留堆 24→30MiB / **下一帧仍是 transient**（`reconnect.bench.client.ts:8-10,37,44`） |
| `conversation-fold` | 200 轮；大小窗口 delta 100 vs 2000（50 万 delta 压成 1600 记录） | 大窗口折 16→40ms、缩放比 2.5→3.125（`conversation-fold.bench.client.ts:31-40,75-76`） |
| `terminal-io` | 终端 I/O 路径（本轮未展开） | 见 `terminal-io/terminal-io.bench.ts` |

校准实测表：`.agents/notes/implemented/testing/2026-09-04-session-open-performance-gate.zh.md:63-79`、`2026-09-06-frontend-performance-budgets.zh.md:27-37`；`session-open` 与 `conversation-fold` 目录无 README，决策记录在 notes 内。

---

## 二、窗口与分页

- 页大小：`PAGE_MESSAGES=50`、跳转 `JUMP_PAGE_MESSAGES=200`（`packages/api/session-controller/src/client/sessions/session.ts:53,56`）。
- open 拉尾页（:606-633）；`loadOlder` 以 `beforeSeq=baseSeq` 向前 prepend（:391-407）；`loadThrough` 循环后翻、取最小目标、无进展即停、带 stale-generation 守卫（:410-453）；`resync()` 作废 generation 后重开（:458-470）。
- 底层 `RemoteJournalStream`：**snapshot-first**；prepend 连续性校验失败即判协议违规并发布空页（`packages/api/gateway/src/client/journal-stream.ts:188-212`）；append 不连续时用 `replaceThrough` 读页重发 `replace` 完成 **gap repair**（:305-395）。
- assistant 流 revision 跳号 → carrier 错误重连（`transport.ts:206-215`）；rebaseline → `events.restart()`（`session.ts:677-684`）。

---

## 三、增量组装热路径（源码已核对）

`packages/client/ui-conversation/src/client/conversation/assembler.ts`：

- `dispatchInput` 只对**当前 input** 遍历全部 Definition（注册 D 个 = D 次 `match`），`acceptMatch` 按 `(kind,id)` Map 常数时间定位 Context（:452-478、:504-549）；`append()` 不扫已有 Context（:221-243）；`prepend` 只处理新增更早条目并按 seq 合并（:292-317）。
- 前序查询走 `contextsByKind` 的二分索引（:719-727）；`flush` 对每个 active target 只调一次 builder `apply/replace`（:332-377）。
- 契约要求（`docs/subsystems/conversation.zh.md:241`）：正常 append 热路径**不得**遍历完整事件窗口、所有 Context、`context.matches` 或已渲染 Node 集合——累计事实进 State、共享信息进 Location data。
- **两处例外（文档未提及，源码实况）**：① location 边界事件会 `locationIndex.appendBoundary` 并重放受影响 Context（:227-235）；② `settleAssistant` 用 `[...this.inputs.values()]` 做全窗口过滤（:256-259，不在普通 append 热路径上）。是否有意为之源码无注释 → 见 §八。

---

## 四、发布节流

- 契约三档：`immediate`（结构/终结变化）/ `animation-frame`（高频可见 delta）/ `none`（只积累 State），同批按 rank 取大（`assembler.ts:54-58,66-71`）。
- 实况（`assembly.ts:130-147`，已逐行复核）：`none` 直接返回；`animation-frame` 若已排帧则忽略，否则**三层嵌套 `requestAnimationFrame`** 后才 flush——源码注释原文 "Cross three paint opportunities before publishing high-frequency stream updates"（:134），是**刻意的跨 3 帧去抖**；其它档取消帧同步 flush。
- 口径注记：中文文档「每帧最多发布一次」（`conversation.zh.md:243,253`）是测试要求的简化措辞，实现实际是「跨三个绘制机会至多发布一次」。
- 用量：assistant delta → `animation-frame`，usage/finish → `none`（`ui-chat/src/client/conversation-nodes/assistant.ts:321-325`）；inbox → `none`（`inbox.ts:125`）。

---

## 五、流式与重连

- 瞬态 `assistant/live-chunk` 用**分数 seq**（`durableCursor + 1 - 1/(n+1)`）排在持久事件之间，**不落日志、不污染持久序**（`assistant-stream.ts:81,148`）。
- settlement 先入 pending，待 attempt `end` 对齐后才 `settleAssistant`：删除 transient、应用持久 entry（:102-113,160-182；`assembler.ts:251-284`）。
- 重连 baseline 把活跃的紧凑 stream **展开为逐 chunk transient**（:52-95）；紧凑流按 record 读、可提前退出 O(records)，仅在持久边界才 `expandAssistantStream`（`docs/subsystems/llm-streaming.zh.md:220-228`）。
- 基准断言「重连后下一帧仍是 transient」（见 §1.2），即重连路径不把临时流固化成持久形态。

---

## 六、渲染侧成本控制（虚拟滚动之问）

**结论：dsh 的 Chat 不做虚拟滚动。**

- `ChatView` 把全部 `order` key 映射为 keyed `<ChatNodeSeat>`（`ui-chat/src/client/chat/ChatView.tsx:207-211`）；Seat 是 `memo` 并按 nodeKey 单键订阅（`ChatNodeSeat.tsx:38-43`）；`ui-chat/README.zh.md:60` 称「稳定 Chat Node Seat 让每个 renderer 保持挂载」。
- `.flowItem` 的 CSS 注释明说它是「虚拟化器的天然测量/挂载单元」但**尚未启用**（`ChatView.module.css:54-56`）。
- 长会话成本靠四条控制：① 只渲染已加载窗口（分页见 §二）；② keyed 身份跨 prepend 稳定（§三）；③ memo seat + 单键订阅（React 重渲染隔离）；④ 过程行折叠隐藏（`turn-process`，见 §7.3）。
- **Trajectory 才虚拟化**：初始 50 节点 + 可见窗口 + overscan（`ui-trajectory/README.md:58`、`trajectory-virtual-rows.ts`）。
- Markdown 流式路径**不重解析已完成前缀**；代码高亮由单一 IntersectionObserver 按视口触发（`ui-primitives/README.zh.md:148`、`useViewportHighlighting.ts:8-43`）。

---

## 七、渲染架构

### 7.1 分层数据流（一个事件到像素）

单向依赖：Host 状态 → Remote 传输 → Client model → UI adapter → Conversation/presentation → Slots → React（`docs/subsystems/web-client.zh.md:18`）。完整链路：

1. Host session log 经 packed Remote `follow`/`page` 帧到达；Client `Session` 持有连续 window，每条 `SessionEventLikeEntry` 外层判别 `{type:'event'}`（持久）或 `{type:'transient'}`（Client-only `assistant/live-chunk`），内部统一暴露 `type/seq/time/data`（`web-client.zh.md:44-46`、`conversation.zh.md:11`）。
2. `BoundConversation` 订阅 feed，revision 变化 → `replace` / `prepend` / `append` / `settle-assistant`（`ui-conversation/src/client/conversation/assembly.ts:101-128`）。
3. append → `ConversationNodeAssembler.append` → `dispatchInput`（每 Definition 一次 `match`）→ `acceptMatch` 以 `key=conversationContextKey(kind,id)` 定位 Context 并 fold `update`（`assembler.ts:221,452-478,504-549`；key 生成 `contract/conversation.ts:295`）。
4. `flush` 对每个 **active target** 调 builder 的 `apply/replace`，节点由 `Definition.buildViewNode` 物化（`assembler.ts:332,816-868`）。
5. Chat builder 产出 `ChatSnapshot` → 写入 `MutableChatNodeStore` → `publish()` 触发 per-key `MutableChatSource`（`ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts:153-160`）。
6. `ui-chat` 把 `nodes.source(key)` 作为 keyedHooks 投给 slot（`ui-chat/src/client/apply.ts:115-119`）。
7. `ChatView` 读 `order` map 出 `ChatNodeSeat`（§六）；Seat `renderSlot('conversation.chat.node', owner, {entryKey: kind})`（:137-147）→ keyed 分派（`ui-renderer/src/client/scoped-slots.tsx:806-813`），原语绑定用 `useSyncExternalStore`（:701-704）。
8. 具体组件返回 React 元素，完成像素。

### 7.2 组装层核心概念（`contract/conversation.ts`）

| 概念 | 要点 |
|---|---|
| Definition | `match`（身份提取器，只收单个 event，返回内部 id + start/update 角色）+ `start` / `update`（返回引擎采用的 State）+ `publication` + `buildLocationData` + `buildViewNode` + `target`（:185-245） |
| Context | 一个 `(kind,id)` 的有序 Match 与 State：`key/kind/id/matches/start/state/current`（:147-155） |
| Location | Session/Turn/Step 坐标 + 类型化 Location data 只读仓储（:80-107），由 `location-index.ts` 维护；同 Location 内其它 Node 用受限 hook（如 `useTurnData(key)`）读取，无须扫全量 |
| View Definition / Builder | 每 Session 一个增量 builder，拥有该 target 的最终 snapshot 类型（:254-287） |
| target 激活 | 创建/读取 source **不激活**；shell 显式选择或首个订阅才激活，首次激活做一次完整 `replace`，之后 `apply`；取消订阅不移除 target（`assembler.ts:385-393`、`assembly.ts:66-83`） |
| View 选择 | shell 解析「有效持久偏好 → 已注册 `chat` 兜底」，**绝不选第一个 View**（`ui-conversation/src/client/apply.ts:155-207`、`view-selection.ts`） |
| registry 重建 | roster 变化 → 微任务批量 `rebuildRegistry`（`assembly.ts:192-212`） |
| predecessor | `start` 收到 `reader.previous(kind)` 做严格向前的只读前序查询，依赖变化会自动重跑（`conversation.ts:168-176`、`assembler.ts:691-727`） |

### 7.3 视图层（ui-chat / ui-trajectory）

- Chat 最终 snapshot：`{order, nodes, locations, navigation, timeline, legacy}`（`ui-chat/src/client/contract/snapshot.ts:92-99`）；`order` 会把 `turn-process` 折叠控件重排到 opening human 之后（`chat-snapshot-builder.ts:400-413`）。
- 行渲染器按 kind 注册：user / steering / context / system-prompt / assistant-step / command / manual-compaction / compaction / model-retry / turn-error / turn-max-tokens / turn-process / turn-tail / unknown（`register-node-renderers.ts:17-56`；对应 Definition `conversation-nodes/register.ts:21-36`）。
- Trajectory 是**纯投影**：以 target `'trajectory'` 注册自己的 Definition 与 snapshot，不读也不改 Chat 快照；按轮记录表 + 时间概览 + 虚拟行（`trajectory-contract.ts:57,79`、`ui-trajectory/README.zh.md:47-62`）；要求 shell 把 composer 作浮层。Chat 与 Trajectory 可解释同一 event family，但各自持有 State 与 payload、互不导入（`conversation.zh.md:21`）。

### 7.4 渲染器与设计系统

- React 18（`ui-primitives/package.json:29`）。
- Markdown 管线：micromark + mdast 双语法（流式无 math、定稿加 TeX）（`ui-primitives/src/markdown/parse.ts:26-43`）；**自研 mdast→React renderer，明确取代 react-markdown/remark-rehype**（`render.tsx:1-17`）；安全策略 = 协议白名单、图片仅绝对 HTTP(S)、raw HTML 当纯文本、KaTeX 无 trusted 命令（:8-16）。
- 代码高亮 Shiki + 流式增量复用 grammar state（`markdown/highlight.ts`、`README.zh.md:108`）；终端 ANSI 用 anser（:100）；diff 用 `diff` 库（`package.json:31`）。
- `ui-primitives` 是**零 Cordis 的共享设计系统**：纯 props-in React 原子；所有面向用户文案必须由调用方以 label prop 注入；主题只走 `--dsw-*` token；跨包禁止复制控件，第二个包需要同一控件即迁入本包（`README.zh.md:12,30-35,66,92,153`）。
- 输出卡片共享几何模型：`white-space:pre` + 横向滚动，超 `maxLines`（默认 16）折成头尾两段（`README.zh.md:112`）。

### 7.5 工具卡片渲染链路

- Conversation Node `kind='tool-call'` → `ToolCallTree`；root 块已含递归 `subCalls`，root 与任意深度 child 走同一 keyed 分派路径（`ui-tool/src/client/tool/ToolCallTree.tsx:55-93`）：`renderSlot('tool.call.toolview', owner, {entryKey: toolName, fallback: GenericToolCard})`（:44-49），Auto-review 拒绝优先覆盖按名视图（:34-37）。
- 业务包按 wire 工具名注册视图（`toolviews/read-row.tsx:23-28`）；内置模板由纯 `toolRowModel` 分类 variant（bash/read/search/write/edit/code/others）落 primitives 的 ReadBlock / DiffBlock / SearchBlock / TerminalBlock / WebBlock（`models/tool-call-model.ts:47-94,237`）。
- **命名口径澄清**：Client 侧**不存在** `presentationMeta` 命名；Host 侧 `presentCall`/`presentResult` 明确**不进入 Client**（`ui-tool/README.zh.md:46`）。模板化 UI 的实际契约是 `ToolCallBlock`（`RunningToolCall | ToolResultNode`，`ui-chat/src/client/contract/chat-nodes.ts:45-48,118-129`）+ `ToolCallOwnerProps`，display 转换完全在 Client 的 card model 中派生。三域基线 §1.1 的 `presentationMeta` 属 Host `ToolDefinition.output` 字段，两层不混（精确消费路径见 §八）。

### 7.6 外壳 / 输入区 / 右栏

- `ui-layout`：三栏 AppFrame，`main` 为 root keyed slot、`conversation` 是保留 key；面板几何/主题呈现（`ui-layout/README.zh.md:12,28-34`）。
- `ui-dockkit`：右栏内部的纯布局引擎，非稳定接口（`sidebar-right.zh.md:18`）。
- 右栏定位：每会话一个「停靠面」——并排的资源/文档查看列；tab 类型注册表 + `ctx.sidebarRight` 导航；内容以 `dsh-resource://<type>/…` 寻址、tab 身份为 `(kind, address)`（`sidebar-right.zh.md:5-11,24-33`）。
- 输入区：`SessionInputShell` 用 **Lexical** 编辑器，slash 命令高亮 + 引用 chip 原子装饰节点（`ui-conversation/README.zh.md:41-53`）；`ui-input-trigger` 提供光标处 `/`、`@` 触发候选菜单（`ui-input-trigger/README.zh.md:12,44`）。
- `conversation.composer` 是 chain：业务包仅可在 Remote waterfall request pending 期间临时接管（`ui-conversation/README.zh.md:63-109`）——提问工具即此机制的首个产品消费者。

### 7.7 技术栈

- React 18 + Cordis client 插件体系；状态管理 = Cordis Service 单例 + 自研 observable snapshot store（`@deepseek-ai/dsh-client-store` 的 `createSnapshotStore`/`notifySubscribers`）；React 侧唯一绑定点是 `ui-renderer` 的 `useSyncExternalStore`（`ui-renderer/README.zh.md:47-48`、`scoped-slots.tsx:701`）。
- 样式 = **CSS Modules**（满目录 `*.module.css`）+ `--dsw-*` design token；**无 Tailwind、无 CSS-in-JS**。
- 关键依赖：micromark/mdast、KaTeX、Shiki、anser、diff、clsx（`ui-primitives/package.json:25-49`）；编辑器 Lexical。
- 设计决策文档：`.agents/notes/implemented/architecture/2026-08-09-client-conversation-node-assembly.zh.md`（Conversation Node 组装的设计理由）。

---

## 八、不确定点（供后续复核）

1. **组装热路径两处 O(window) 例外**（§三）：location 边界重放、`settleAssistant` 全窗口过滤——是否有意为之，源码无注释，待判定是否影响超长会话。
2. **`presentationMeta` 的精确消费路径**：Host `ToolDefinition.output` 字段与 Web Client card model 的边界未逐步取证（三域基线仅记「UI 专用，仅顶层调用计算」）。
3. **Chat 虚拟化**：CSS 注释称 `.flowItem` 为「虚拟化器的天然单元」但未启用——是未来计划还是废弃意图，未见决策记录。
4. **Trajectory 虚拟化参数**：overscan 具体值与触发阈值未取证（只确认「初始 50 节点 + 可见窗口」）。
5. `terminal-io` 基准与 ui-dockkit 的 `LayoutState/LayoutOp` 细节未展开（后者文档自述非稳定接口）。
6. Chat 与 Trajectory 各自 `next-step` / 分类邀请状态机的内部差异只读到 contract 层，未逐行核对。

---

## 九、长会话流式专项（2026-09-20 补录，源码逐行取证）

> 补录缘由：§五/§六 只记了结论级事实；本侧「长会话 + 流式同时发生」的帧率修复（见 [03 §九 批次 D 走查后修复](03-对照与建议清单.md)）需要机制级对照，故按「数据结构 → 渲染手段 → 基准 → 重连」四层重新取证。

### 9.1 瞬态流的数据结构（分数 seq）

- **事件定义**：`AssistantLiveChunkEvent = { type:'assistant/live-chunk'; seq:number; time:number; data:{ attemptId; turn; step; chunk } }`，JSDoc 原文「Client-only live chunk presentation; `seq` orders the transient row between durable Session seqs」（`packages/api/session-controller/src/client/contract/events.ts:6-17`）。
- **判别联合**：`SessionEventLike = SessionEvent | AssistantLiveChunkEvent`（`:19-20`）；`SessionEventLikeEntry = {type:'event', event} | {type:'transient', event}`（`:22-25`）。派生别名 `SessionLiveEventEntry` / `SessionAssistantSettlementEntry` / `SessionTransientEventEntry`（`:27-35`）。
- **分数 seq 公式**：`durableCursor + 1 - 1/(transientInGap + 1)`，两处实现——重连基线展开 `assistant-stream.ts:81`（每展开一个 chunk 就 `transientInGap += 1`，见 `:76`）与实时逐帧 `:148`（`acceptFrame` 的 `'chunk'` 分支 `:141`）。`durableCursor` 是已见 durable 最大 seq（初始化 `:43`、`replace()` 用 `reduce(Math.max)` `:71`、`acceptDurable` 推进 `:104`）；`transientInGap` 在 durable 到达时归零（`:105`）。**第 1 个瞬态落 `cursor+1-1/2`、第 2 个落 `cursor+1-1/3`……单调递增且恒小于 `cursor+1`**——严格插在「最后一个 durable」与「下一个 durable」之间。
- **排序即数值比较**：没有独立比较器，就是 `left.event.seq - right.event.seq`（`ui-conversation/.../assembler.ts:424-426`；`replaceWindow` `:204`、`prepend` `:298` 同）。追加路径另有单调性校验：`acceptMatch` 要求 `previous.event.seq < input.event.seq`，否则抛 `received non-Appended Match`（`:522-525`）；`mergeMatches` 同 seq 抛 `duplicate Match`（`:112-114`）。
- **transient 的删除与取代（settlement）**：`assembler.settleAssistant(attemptId, entry?)`（`:251-284`）——扫描 `inputs.values()` 筛 `type==='transient' && data.attemptId===attemptId`（`:256-259`）→ 从 `inputs`/`contextsBySeq` 删除并从各 Context 的 `matches` 过滤（`:260-269`）→ `locationIndex.removeAssistantTransients`（`:270`）→ 有 durable `entry` 则插入并 `replayContexts`（`:273-280`）。返回 `'immediate'` 表示有瞬态退役（`:272`）。窗口层等价实现见 `MutableSessionEventSource.settleAssistant`（`events.ts:181-196`）。
- **何时 settle**：durable `assistant/message`/`assistant/attempt` 先被 `acceptDurable` 暂存进 `pending`（`assistant-stream.ts:102-113`）；收到 `end` 帧且 committed → 从 `pending` 取出返回 `{type:'settlement'}`（`:160-181`）；abandoned → `{type:'abandonment'}`（`:167-170`）。上层接线 `session.ts:617-636` / `:658-683`。
- **不落日志的边界**：`assistant/live-chunk` 只在 client 侧构造并进入内存事件窗口（`events.ts:120-204`）；durable 日志里 assistant 输出以**紧凑流**嵌在 `assistant/message`/`assistant/attempt`（`packages/llm/llm/src/assistant-stream.ts:1-6`、`docs/subsystems/conversation.md:45`）。

### 9.2 长会话流式的性能手段（四层）

**① append 热路径的常数复杂度契约（源码级硬约束）**

- `assembler.append(record)` JSDoc 原文「Add one contiguous live tail event **without scanning existing Contexts**」（`assembler.ts:216-221`）；实现只有 `inputs.has(seq)` 去重（`:223`）、边界/非边界分流（`:227-238`）、对 D 个 Definition 各 match 一次（`:239`）、`replayRevisedDependents`（`:240`）。边界识别仅 `turn/start|turn/end|step/start|step/end`（`:945-947`）。
- 非边界走 `locationIndex.appendNonBoundary`，JSDoc「Index one non-boundary tail event **without rescanning the window**」（`location-index.ts:502-526`）；边界才 `appendBoundary` 且**只重访所属 Turn 的 seq 集合**（`:412-500`，`:485` 处遍历 `seqsByTurn.get(turnNumber)`）。
- 文档化契约：`docs/subsystems/conversation.md:239,241` 明确「不得在正常 append 路径上遍历完整事件窗口 / 每个 Context / `context.matches` / 已渲染 Node 集合」。
- **唯一 O(window) 例外**：`settleAssistant` 全量扫描 `inputs.values()`（`:256`）——但每次 attempt 只发生一次，不在逐 chunk 热路径上。

**② 发布节流三档 + 跨三帧去抖**

- 档位与 rank：`PUBLICATION_RANK = { none:0, 'animation-frame':1, immediate:2 }`（`assembler.ts:54-58`），同批取大 `maximumPublication`（`:66-71`）。
- 跨三帧实现：`BoundConversation.publish`（`ui-conversation/src/client/assembly.ts:131-148`）——`animation-frame` 且已有 pending frame 则直接返回（`:134`），否则**嵌套三层 `requestAnimationFrame`**（`:136-143`，注释「Cross three paint opportunities before publishing high-frequency stream updates」）；`immediate` 则 `cancelFrame()` + 同步 `flush()`（`:146-147`）。
- 分档规则（assistant）：`step/start` → `none`；非 `live-chunk` → `immediate`；`live-chunk` 且 chunk 为 `usage`/`finish` → `none`，否则 → `animation-frame`（`ui-chat/.../conversation-nodes/assistant.ts:321-326`）。

**③ Markdown 流式「不重解析已完成前缀」（算法级）**

- 文件头自述「每 chunk 全量重解析是二次复杂度」，方案 = **冻结除尾部 `UNSTABLE_TAIL_BLOCKS`（=2）外的块**，只重解析尾部；未闭合顶层围栏走「第二前沿」（只回退最后一行已完成行 + 当前部分行）（`ui-primitives/src/markdown/incremental.ts:1-29,38`）。
- `IncrementalMarkdownParser.update()`（`:310-359`）：`startsWith(prevText)` 判 append vs reset（`:318-324`）；冻结切点取最后一个冻结块的 `position.end.offset`（`:338-351`）；块 key 用**绝对源偏移**（`blockKey` `:70-73`）。
- **围栏增量**：`OpenFenceState` + `openFenceState()`（`:75-86,196-253`）与 `updateOpenFence()`（`:256-301`）——未闭合代码围栏只重新 token 化「追加文本」，已完成行前缀不重解析。
- **元素级缓存**：`StreamingRenderer` 缓存已冻结块的 React 元素（`frozenElements` `MarkdownText.tsx:70`），`generation` 变化才丢弃（`:88-96`），每帧只渲染新增冻结块 + 尾部（`:97-145`）。注意 labels 必须引用稳定，否则「discards the streaming render cache mid-message」（`:154-158`）。
- **已知取舍**：跨冻结边界的引用式链接/脚注在流式期间按字面渲染，settle 时全量解析自愈（`incremental.ts:24-28`、`MarkdownText.tsx:8-11`）。

**④ 代码高亮按视口触发**

- 单例 `HighlightViewport` 持有一个 document-wide `IntersectionObserver`（`useViewportHighlighting.ts:8-45`）；元素**首次相交即激活并 `unobserve`**（`:17-28`）；无 IO 环境立即激活（`:13-16`）；`useViewportHighlighting` 返回 `activated && supported`（`:55-72`）。消费点 `CodeBlock.tsx:72`。
- 流式围栏另有 `StreamingHighlightSession`：按 **32 行分组**复用已完成 DOM（`STREAMING_LINE_GROUP_SIZE=32` `CodeBlock.tsx:52-53`；`:115-144` 只重排追加行）。
- 全仓检索确认：client 包中 `IntersectionObserver` 仅出现于该 markdown 高亮与侧栏 PDF 预览。

### 9.3 长会话流式基准（`benchmarks/long-session-browser/`）

- 目录：`long-session.bench.ts` / `synthetic-history.ts` / `README.md` / `README.zh.md` / `README.i18n.yaml`。
- **合成规模**：`HISTORY_TURNS=240`（`synthetic-history.ts:9`）、`DELTAS=120`（`:18`）、`PACE_MS=16`（`:20`）、`FIRST='SYNTHETIC_REPLY_FIRST'`（`:14`）、`DONE='SYNTHETIC_REPLY_DONE'`（`:16`）。`syntheticHistory()` 每轮含 `turn/start`+`step/start`+`user/message`+`assistant/message`（内嵌 `AssistantStreamAccumulator` 生成的紧凑流），**每 6 轮带 tool call、每 12 轮带 60 行 TS 代码围栏、reasoning 重复 40 次**（`:25-87`）。`syntheticReply()` = `block-start` + 120 个 `text-delta`（首带 FIRST、末带 DONE）+ `block-end` + `usage` + `finish`（`:92-94`）。
- **输入重叠断言的实现**（这是 dsh 最值得学的语义断言）：
  - 安装 `watchInputOverlap(composer)`：composer 上挂**一次性** `input` 监听，判定式原文 `event.isTrusted && transcript.includes(FIRST) && !transcript.includes(DONE)` → 写 `data-benchmark-input-overlap`（`long-session.bench.ts:71-83`，判定在 `:78`）；同时写 witness / timing 属性（`:79-80`）。
  - `transcript` 只读**最新一条 Assistant step** 的文本（`:77`，取法见 `:57`），不扫整段历史。
  - 正向断言：流式中打字必须 `overlap === true`（`:204`）。反向断言：DONE 后再打字，witness 必须是 `{trusted:true, first:true, done:true}` 且 overlap 断言**必须抛错**（`:218-223`）。
- **指标与预算**：`REFERENCE = { open:200, page:260, trajectory:160, first:1100, streamTask:1800, input:500, streamWall:1000 }`（`:15`）；CI 预算另设 open 1125 / page 875 / trajectory 650（`:19-21`，单测固化于 `:95,102-104`）。

| 指标 | 含义 | 取证 | 参考机 | CI 预算 |
|---|---|---|---|---|
| open | 打开 240 轮会话至 tail + composer 出现 | `:157-161` | 200ms | 1125 |
| page | 最慢一次 Load earlier 分页 | `:167-173,216` | 260ms | 875 |
| trajectory | 切 Trajectory 至末行 | `:174-178` | 160ms | 650 |
| first | Enter → 首个 marker 可见 | `:191-194` | 1100ms | 2750 |
| input | 流式中输入一句话的耗时 | `:196-199` | 500ms | 1250 |
| streamTask | **CDP `Performance.getMetrics` 的 `TaskDuration` 增量（主线程任务时间）** | `:36-41,211` | 1800ms | 4500 |
| streamWall | Enter → DONE + settlement + 两帧绘制（墙钟） | `:205-210` | 1000ms | `ciTimeBudget(1000)+REPLAY_DURATION_MS(1984)=4484` |

- `REPLAY_DURATION_MS = (DELTAS+4)*PACE_MS = 124*16 = 1984`（`:22`）；聚合取样本中位数逐 key 断言（`:237-243`）；另断言无 page errors / warnings（`:224-225`）。
- **注意**：`streamTask`（主线程任务时间）与 `streamWall`（墙钟）**分开度量**——前者是「主线程被占多少」的直接证据，后者含回放节奏，两者混用会掩盖真实卡顿。

### 9.4 重连路径（紧凑流 → 逐 chunk transient）

- 展开函数 `expandAssistantStream(stream)`（`packages/llm/llm/src/assistant-stream.ts:196-232`）：把 compact records（`text-chunks`/`reasoning-chunks`/`tool-call-chunks`/`chunk`，定义 `:19-44`）还原为**精确的逐成员 timed chunk 序列**，用 `dt` 数组重建每个 delta 的时间戳（`:210-229`），JSDoc「with every original delta boundary preserved」；校验 `validateRecord`（`:456-505`）。
- 消费点 `ClientAssistantStream.replace(entries, baseline)`（`assistant-stream.ts:52-95`）：先取 `durableCursor`（`:71`）→ 对展开的每个成员构造分数 seq 的 transient（`:72-93`）→ 在 `index+1 >= opening.nextIndex` 处**截断**（`:91`），即只展开到重连基线记录的 `nextIndex`。
- **设计意图**：让「重连后的一帧」仍被识别为 transient 而非 durable——基准断言 `expect(run.report.nextFrame).toBe('transient')`（`benchmarks/active-stream-reconnect/reconnect.bench.client.ts:37`；worker 构造 10 万 delta 基线后 `replace([], baseline)` 再 `acceptFrame`，报告 `nextFrame = next?.type`，`reconnect.worker.client.ts:23-48`）。若把展开结果当 durable 直接追加，会破坏 `durableCursor` 代数并可能触发 `{type:'rebaseline'}` 重开流。
- **渲染侧影响**：`replace` 返回含 transient 的 `SessionEventLikeEntry[]` 经窗口进入组装层，仍按 seq 排序——**Chat 无需区分「历史紧凑流」与「实时流」**，两者折叠为同一 `assistant-step` 状态，只是来源不同。
- 预算：`EXPECTED_REPLACE_CI_MS=50`、`REPLACE_BUDGET_MS=63`、`REFERENCE_RETAINED_MB=24`（`reconnect.bench.client.ts:8-10,21`；README 记 30 MiB 上限）。

### 9.5 与本侧的对照结论（不重复 §六，只列差异）

| dsh 机制 | 本侧现状 | 判定 |
|---|---|---|
| 瞬态事件分数 seq 插在 durable 之间、不落日志 | 本侧流式 delta 直接进 `turnModel` 归约（无 transient/durable 双轨）；`msg.thinking` 全文双写为已登记挂账 | **架构不同**：本侧归约器天然「只增不改段」，无需分数 seq；但「流式内容不落盘」这一原则本侧已满足（落盘的是工具调用与结果消息） |
| append 热路径常数契约（D 次 match + key 查，禁遍历窗口） | 本侧 `reduceEvent` 为 O(1) 追加（`replaceTurn`/`replaceSegment` 只拷贝受影响层）；**但下游「每 delta 全窗口派生」多处存在**（本轮已修 3 处） | **已对齐归约层，派生层需持续治理**——本轮教训：契约要覆盖「归约 → 展平 → 分组 → DOM 查询」整条链，而非只归约 |
| 发布节流三档 + rank 取大 | 本侧四处各自节流（markdown rAF / 滚动 debounce / 窗口 rAF / 折叠 rAF），**无统一档位契约** | **可借鉴**（C6 挂账）：统一档位可避免「某条路径漏节流」 |
| Markdown 冻结前缀 + 只重解析尾 2 块 + 未闭合围栏第二前沿 | 本侧批次 A 已落地同构内核（`markdownStream.ts`：最后一个内容 token 为判定线、def/html 保守回退） | **已对齐**；差异：dsh 冻结「尾 2 块」、本侧冻结「尾 1 token」，且 dsh 有围栏内第二前沿（本侧未闭合围栏降级为尾块纯文本） |
| 代码高亮视口触发（单例 IO + 首交即 unobserve） | 本侧 Prism **同步逐块高亮**（`codeHighlight.ts`） | **未对齐（可借鉴）**——本侧高亮仍在流式同步热路径上 |
| 流式围栏按 32 行分组复用 DOM | 无对应实现 | 未对齐（本侧代码块高亮为整块重渲） |
| 输入重叠语义断言（流式中必须真 / DONE 后必须假） | 无 | **可借鉴**：作为「流式期间输入不被阻塞」的端到端验收项（需 Playwright） |
| CDP `TaskDuration` 主线程指标与墙钟分开 | 本侧门禁为 Node/jsdom 计时（无主线程指标） | **可借鉴**（需 Playwright，已登记待拍板） |
| 重连把紧凑流展开为逐 chunk transient | 本侧无 transient 概念，无对应路径 | **不适用**（架构差异） |

> 本轮（帧率修复）与 dsh 的最大共识：**「归约层常数复杂度」不等于「渲染层不卡」**——dsh 用「append 契约 + 三档节流 + 冻结前缀 + 视口高亮」四条同时压住；本侧此前只有归约层契约，派生层（折叠控制器视口探测、DotNav 扫描、每 delta 重分组）缺契约，故同一份「归约 O(1)」的代码仍会掉帧。