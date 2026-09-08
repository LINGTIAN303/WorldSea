---
status: 已完成（代码全落地；浏览器模式运行时冒烟通过，遗留 R14 待修）
---

# Agent 流式区域渲染层重设计计划

> 起草：2026-08-29 · 依据：三层链路代码级走查（生成层 / 传输层 / 渲染层，关键文件全部实读，无推测）
> 定性：**渲染层数据模型重构**，非 UI 打磨。根因是「扁平数组承载层级结构」，UI 症状只是投影。
> 代码基线：`57af7e6`（工作区干净）

---

## 一、背景：为什么要重构

用户反馈：流式区域只有推理段、命令段稳定出现，中间文本段与最终输出结构段时有时无。

走查结论：**生成层是主因，传输层在浏览器模式叠加丢帧，渲染层有测量盲区**。三者叠加才表现为"段不稳定"。

最关键的发现是——**同一次对话，实时与刷新后产出两套完全不同的 DOM**（详见 §二.5）。这不是渲染抖动，是数据模型缺陷。

---

## 二、现状事实（代码级）

### 2.1 生成层：命令段没有独立事件源（主因）

权威事件其实一直存在，携带唯一 `tool_call_id`：

```365:372:../../crates/agent-kernel/src/agent/tools.rs
        for tc in tool_calls {
            // 广播 ToolCallStart
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallStart {
                tool_call_id: tc.id.clone(),
                name: tc.name.clone(),
                args: tc.args.clone(),
            }))
            .await;
```

但 Tauri 命令层转发前端时被丢弃：

```394:395:../../apps/tauri/src-tauri/src/commands.rs
                    // 其他基础 Agent 事件（UserMessage / ToolCall* / A2UI）暂不在此通道转发
                    _ => return,
```

于是前端 tool 行**寄生**在 `DeepPhaseChanged`（阶段切换的副产物）上，而该事件仅在阶段标签变化时才广播：

```905:908:../../crates/agent-kernel/src/agent/mod.rs
                if current_phase_label.as_deref() != prev_phase.as_deref() {
                    if let Some(tool_name) = &tool_name_for_checkpoint {
                        let (label, idx) = crate::deep_phases::classify_tool(tool_name);
```

三条确定后果：

1. **同一阶段内连续调工具 → 0 事件 → 命令段完全缺失**
2. 阶段切换时广播两条事件（旧阶段完成 + 新阶段进入），却携带**同一个** `trigger_tool`
3. 前端按名字匹配最后一行（`useAgentRust.ts:464 findLastToolRow`）→ 同名工具重复调用时永远只更新第一行，后续调用被吞

> ⚠️ **待留意**：`ToolCallStart/End` 实际被发**两次**——`genai_backend.rs:379/403`（其 `result` 字段实为 `fn_arguments` 参数）与 `tools.rs:367/402`（真实执行结果）。恢复命令段时**只取 `tools.rs` 那份**。

### 2.2 传输层：浏览器模式静默丢帧

SSE 用 `broadcast::channel(2048)`，`Lagged` 错误被 `.ok()` 静默吞掉：

```49:53:../../apps/tauri/src-tauri/src/http_bridge/mod.rs
    let stream = tokio_stream::wrappers::BroadcastStream::new(events::subscribe())
        .filter_map(|r| {
            r.ok().and_then(|(name, payload)| {
```

高频 delta 下中段丢字，直到 `end.fullText` 才兜底补齐（表现为"跳字后突然补全"）。桌面端走 `app.emit` 不受影响 → **同一份代码两端表现不一致**。

### 2.3 渲染层：测量盲区 + 每 delta 全量复制

**测量盲区**：`data-msg-id` 只挂在 `UserRow.vue:10` 与 `AssistantRow.vue:12`，`ThinkRow` / `ToolRow` 没有。而 ResizeObserver 只 observe 带该属性的元素（`useMessageWindowing.ts:402`）→ think/tool 行**永不被实测**，只能吃硬编码估算（think=60px / tool=32px）。流式 think 展开态实际可达数百 px → 前缀和失真 → 滚动条长度错位、视口跳动。

> 注：`AgentMessageList.vue:233` 注释称"流式展开态由 ResizeObserver 实测覆盖"，**注释与实现不符**，该实测从未发生。

**O(n·m) 复制**：`upsertAssistantStreamRow` → `streamReplace` 每个 delta 都 `findIndex` + `[...agentStream.value]`。Markdown 侧有 rAF 节流（`useStreamingRenderer`），但**事件流数组本身没有节流**。

### 2.4 根因：扁平 append-only 数组承载层级结构

`agentStream: AgentStreamItem[]` 被迫用「数组顺序」隐式表达「归属关系」，于是：

- 推理属于哪一轮？→ 靠 append 顺序猜，一打断就错
- 工具属于哪一轮？→ 按名字反查，同名必错
- 空正文行要不要渲染？→ 实时路径与回源路径判断不一致

### 2.5 决定性证据：实时与刷新是两套 DOM

一次「2 轮工具调用」的对话推演：

| 段 | 实时 DOM | 刷新后 DOM |
|---|---------|-----------|
| 中间文本段（A1/A2） | 12px 空白 ×N | **消失**（`if (m.content)` 过滤空串） |
| 推理段 | 存在 | **100% 消失** |
| 命令段 | 仅阶段变化时 0~2 行 | **N 行完整** |
| tool_result 消息 | 不存在 | **渲染成"正文行"**（raw JSON） |
| 最终输出段 | 存在 | 存在 |

**推理段消失的根因——后端零持久化**（四条独立佐证）：

| 位置 | 事实 |
|---|---|
| `crates/agent-kernel/src/types.rs:74-88` | `OrchestratorMessage` 无 thinking 字段 |
| 全仓搜索 `"thinking"` 写入 | agent-kernel / agent-commands **零命中** |
| `crates/agent-kernel/src/backend.rs:123-135` | `PromptResponse` 无 reasoning 字段 |
| `crates/agent-kernel/src/llm/genai_backend.rs:324` | `reasoning_text` 是**局部变量**，累积后丢弃 |

**tool_result 被当正文渲染的根因**：`rebuildStreamFromMessages:546` 只判 `m.role === 'user'`，其余一律走 else 分支 → `tool_result` 的 content（raw JSON）生成 assistant 行，仅靠 `stripJsonBlocks` 兜底剥顶层 JSON 对象（数组/带前缀的会泄漏）。

**行序也是反的**：实时是 `正文 → 推理`（`start` 先 append 空行），重建是 `推理 → 正文`（`:552-564`）。

---

## 三、领域模型（已拍板）

### 3.1 流区域三层结构

```
流区域
├── ① 用户消息层     UserRow（有底色气泡，天然分界）
└── ② LLM 块（一个 Turn）
    ├── 过程层  ProcessLayer   ← 所有行段；运行时展开，结果层落地后折叠
    │   ├── ThinkSegment   推理行段
    │   ├── ActionSegment  动作行段（默认折叠，点击展开参数+结果）
    │   └── TextSegment    过程文本段（无操作栏）
    └── 结果层  ResultLayer    ← 最终输出；字重/字号微调；唯一带操作栏
```

### 3.2 术语（用户定义，全项目统一）

| 术语 | 定义 |
|---|---|
| **轮次 Turn** | 用户消息 + LLM 消息（无论轮中多少次工具调用） |
| **动作 Action** | LLM 消息中一次工具调用或其他执行 |
| **行段 Segment** | 前端中 LLM 一次动作的完整执行（一步一步的行段） |
| **过程层** | 所有行段的集合；运行时展开，结果层输出完成后折叠 |
| **结果层** | 最终输出；字重/字号微调渲染 |

### 3.3 事件 → 行段 归约规则（核心）

难点：最后一轮文本与中间轮文本是**同一类数据**（都是该轮 LLM 的 `full_text`），流式期间无法预知"是不是最后一个"。

解法是一台状态机——用「LLM 后面还干不干活」反推：

| 事件 | 动作 |
|---|---|
| `prompt()` | 新建 Turn，用户消息入 ① |
| `StreamStart` | 无动作（子轮开始） |
| `ReasoningDelta` | 上一段非 Think → 新开 ThinkSegment（过程层）；否则追加 |
| `StreamDelta` | 上一段非 Text → 新开 TextSegment（`resultCandidate=true`）；否则追加 |
| `ToolCallStart` | **降级所有候选为过程段** → 新开 ActionSegment |
| `ToolCallEnd` | 按 `tool_call_id` 填 result + status |
| `StreamEnd` | 闭合当前段 |
| `AgentEnd` / `send_message` 返回 | 最后的候选正式成为结果层 → 过程层折叠 |

语义自洽：输出文本后又调工具 = 过程说明；输出文本后不再调工具 = 答案。

### 3.4 过程层折叠三条件（用户精确定义）

**前置**：结果层落地 → 进入折叠评估。**每个 Turn 只执行一次**（latch）。

1. 用户**未展开过任何行段** → 立即折叠
2. 用户展开过 && 展开项**在视口内** && **空闲 ≥5s 无操作** → 折叠（有操作则重置计时）
3. 用户展开过 && 展开项**已滚出视口** → 立即折叠

实现约定（属实现细节，可调整）：

- `userEverExpanded` 为 latch：展开了又收起仍为 true，走条件 2/3
- "操作"计入 `wheel` / `touchmove` / `scroll` / `click` / `keydown` / `selectionchange`；**不计入 `mousemove` / hover**（过频会导致计时器永不触发）
- 用户手动展开过程层后视为已执行，不再自动折叠
- 折叠行显示：`已完成 N 个动作 · M 段推理 · 查看过程 ▸`

### 3.5 动作行段类型与持久化可行性

用户明确：**动作行段不止工具调用**；且**整个会话都要持久化**（不只是推理段）。据此把动作行段扩展为 8 类，并逐类标注回源可行性：

| 动作类型 | 事件源 | 能否回源 | 说明 |
|---|---|---|---|
| `tool` | `ToolCallStart/End`（`tools.rs:367/402`） | ✅ | `assistant.tool_calls` 给 name/args，`tool_result` 按 `tool_call_id` 给 result |
| `plan` | `PlanCreated` / `PlanStepUpdate` / `PlanReplanned` | ✅ | `get_state` 快照携带 plan（`switchSession` 已在消费） |
| `subagent` | `SubAgentStarted/Completed/Error` | ❌ | 前端内存 `subAgents`，回源即失 |
| `a2ui` | `A2UIEvent` | ❌ | 前端内存 `a2uiSurfaces`，回源即失 |
| `confirm` | `ConfirmationRequested/Resolved` | ⚠️ | 交互态，历史无需完整还原 |
| `phase` | `TracePipeStarted/PhaseEntered/PhaseResult/PipeFinished` | ❌ | 前端内存 `useOrchestrationTrace`，回源即失 |
| `router` | `RouterDecisionMade` | ❌ | 未转发至前端 |
| `reflection` | `ReflectionResult` | ❌ | 前端未消费 |

**会话持久化完整性矩阵**（回源能重建什么）：

| 段 | 数据源 | 现状 |
|---|---|---|
| ① 用户消息 | `user` 消息 content | ✅ 已可回源 |
| ② 推理段 | `assistant.meta.thinking` | ✅ **T5 已补齐** |
| ② 过程文本段 | 中间轮 `assistant.content` | ✅ 已可回源 |
| ② 动作段（tool） | `tool_calls` + `tool_result` | ✅ 已可回源 |
| ② 动作段（其余 7 类） | 各自事件 | ❌ 见上表 |
| ③ 结果层 | 末轮 `assistant.content` | ✅ 已可回源 |

> 结论：**会话持久化的唯一硬缺口是 thinking，已由 T5 补齐**（入库写 `meta["thinking"]` →
> `msg_json` 整条序列化落库 → 回源 `readThinking` 读取，无需 schema 迁移）。
> 其余 6 类动作段不可回源属既有事实，若要求"整个会话完整"，需为 subagent / a2ui / phase / router
> 补持久化——这是独立于本计划的增量，已登记为 R6。

### 3.6 滚动与窗口化

- **底部跟随**：`isAtBottom=true` → `newEnd=total` → 占位高度为 0，稳定（现状已正确）
- **上滚浏览**：补 `data-msg-id` 后 think/tool 行可被实测 → 前缀和失真消失
- **折叠锚定**：过程层折叠时高度骤降数百 px，**必须以结果层顶部为锚点补偿 scrollTop**，否则引入新的视口跳动
- **可变粒度**：过程层展开时内部每行独立参与窗口化；折叠时整体算 1 行

---

## 四、后端配套：thinking 存 `meta` 扩展位

### 4.1 为什么不用独立字段

全仓 `OrchestratorMessage {` 构造点 **44 处**（agent-kernel / agent-patterns / agent-commands 及各自测试）。加必填字段需全改；用 `..Default::default()` 则需为 `MessageRole` 补 `#[default]`。

而 `meta` 字段注释原文即「元数据（**usage/thinking 等**）」，是当初就预留的扩展位，且已被成熟使用：

- 写入：`tot/mod.rs:762-784`、`supervisor/supervisor.rs:757-787`、`multi_agent/mod.rs:687-714` 均用 `meta.insert(key, json!(v))`
- 读取：`e2e_llm.rs:689` 模式 `meta.get("k").and_then(|v| v.as_str())`

**决定：`meta["thinking"]`**——零构造点改动，与既有三处模式完全一致。

### 4.2 已验证：meta 不会污染 LLM 上下文

持久化后推理文本会不会被回灌给 LLM？**不会。** `to_genai_message` 四个分支只映射 role / content / tool_calls / tool_call_id：

```161:198:../../crates/agent-kernel/src/llm/genai_backend.rs
    fn to_genai_message(msg: &OrchestratorMessage) -> Result<ChatMessage, LlmError> {
        match msg.role {
            MessageRole::System => Ok(ChatMessage::system(&msg.content)),
            MessageRole::User => Ok(ChatMessage::user(&msg.content)),
            MessageRole::Assistant => {
                // ... content + tool_calls
            }
            MessageRole::ToolResult => {
                let tool_call_id = msg.tool_call_id.clone().unwrap_or_default();
                let tool_resp = ToolResponse::new(tool_call_id, msg.content.clone());
                Ok(ChatMessage::tool(MessageContent::from(tool_resp)))
            }
```

`meta` 从不进入 LLM 请求，故不增加 token 消耗。旁证：supervisor / tot 早已往 meta 塞 node_id / round，若会污染早已出问题。

### 4.3 持久化影响（已确认安全）

- **不需要 SQLite 迁移**：`messages` 表为 `(session_id, seq, msg_json)`，整条消息序列化为 JSON blob（写入 `session_store.rs:393`，读取 `:418`）。与 `sessions` 表每列一字段需 ALTER 的机制不同。
- **旧数据兼容**：旧数据 `meta` 为 null 或不含该 key → 返回 `None` → 降级为"无推理段"（与现状一致）。
- **代价**：带推理的 assistant 消息体积增大（数百至数千字），本地 SQLite 可接受。

### 4.4 后端改动清单

| # | 改动 | 位置 |
|---|---|---|
| 1 | `PromptResponse` 加 `reasoning: Option<String>` | `backend.rs:123` |
| 2 | `reasoning_text` 写入 `PromptResponse` | `genai_backend.rs:324` |
| 3 | assistant 消息入库时 `meta.insert("thinking", json!(reasoning))` | `agent/mod.rs:819`、`:847` |
| 4 | 转发 `ToolCallStart/End`（**只取 `tools.rs` 那份**） | `commands.rs:394` |
| 5 | `rustMsgToTsMsg` 读 `meta.thinking` → `AgentMessage.thinking` | `useAgentRust.ts:254` |

---

## 五、任务清单

**执行顺序：P2 先行**（不依赖后端改动，可独立验证，风险最低）。

### P2 · 状态层turnModel（首个执行项）

- [x] T1: 定义 Turn / Segment 类型
  - goal: `Turn{ id, userMessage, segments[], resultId, candidateId, processCollapsed }`；`Segment = ThinkSegment | ActionSegment | TextSegment`；`ActionKind` 覆盖 8 类动作（§3.5）
  - files: `packages/shared-composables/src/agent/turnModel.ts`（新建）
  - acceptance: `npm run typecheck` 通过

- [x] T2: 事件归约器 `reduceEvent(turns, event) → turns`
  - goal: 按 §3.3 规则实现；同名工具按 `tool_call_id` 索引；reasoning/content 交错自动分段
  - files: `packages/shared-composables/src/agent/turnModel.ts`
  - acceptance: 单测 10/10 通过（`__tests__/turnModel.spec.ts`）
  - 实现要点：
    - `closeLastSegment` 在 `round_start` / `round_end` / `turn_end` 闭合流式中段
    - `demoteCandidate` 在 `action_start` 时降级结果层候选（O(1)，靠 `turn.candidateId` 直查）
    - `upsertTextSegment` 覆盖**无 `StreamDelta` 仅有 `StreamEnd.fullText`** 的情形（模型一次性输出 / 增量全丢）——此缺陷由端到端用例暴露后补入
    - `action_start` 按 id 幂等（应对 `ToolCallStart` 双发）

- [x] T3: 回源重建走同一归约器
  - goal: `rebuildStreamFromMessages` 改为产出 `Turn[]`；`tool_result` 按 `tool_call_id` 关联回 ActionSegment（不再生成正文行）
  - files: `packages/shared-composables/src/agent/turnModel.ts`、`apps/tauri/src/agent/composables/useAgentRust.ts`
  - acceptance: 单测 17/17 通过；`vue-tsc --noEmit` exit=0
  - 实现要点：
    - `rebuildFromMessages(msgs)` 把持久化消息翻译成 `TurnEvent[]`，喂给**同一个** `reduceEvent`
    - 翻译顺序严格对齐实时流：推理 → 正文 → 工具调用 → 工具结果
    - `parseToolResult` 对齐后端判定（`agent/mod.rs:865-876`）：结果 JSON 顶层含非 null `error` 键即 failed
    - 回源改用 **Rust 原始消息**（非 `rustMsgToTsMsg` 映射结果）——`tool_call_id` 与 `meta.thinking` 只存在于原始形态
    - `textId` 机制：回源时复用持久化消息 id 作文本段 id，保证与实时态行 id 对齐
    - `flattenTurns` 展平为 `FlatRow`，由 `flatRowToStreamItem` 映射回 `AgentStreamItem` 契约
  - ⚠️ **完成范围**：仅**回源路径**已切到 turnModel。**实时路径仍是旧逻辑**（`upsertAssistantStreamRow` 等），运行时的"实时/回源一致"要等 T4 把实时路径也切过来才真正成立

- [x] T4: 实时路径切到 turnModel，`agentStream` 降级为 flatten 兼容输出
  - goal: `AgentMessageList` / `DotNav` / `useMessageWindowing` 零改动
  - files: `apps/tauri/src/agent/composables/useAgentRust.ts`、`packages/shared-composables/src/agent/turnModel.ts`
  - acceptance: 单测 18/18 通过；`cd apps/tauri && npx vue-tsc --noEmit` exit=0
  - 实现要点：
    - `turns: ref<Turn[]>` 为事实源；`agentStream` 改为 `computed`（`flattenTurns(...).map(flatRowToStreamItem)`），外部消费者零改动
    - 六套旧流操作（`streamAppend` / `streamReplace` / `pushStreamItem` / `upsertAssistantStreamRow` / `upsertThinkStreamRow` / `findLastToolRow`）→ 统一为 `applyTurnEvent`，去重交给归约器
    - `handleStreamEvent` 六分支改为派发 `TurnEvent`；`prompt` 负责 `turn_start` 与 `turn_end`（**turn_end 唯一发送点**，避免「事件先到 + 返回值后到」两次收口造成结果层重复段）
    - `DeepPhaseChanged` 临时改用 `action_start`/`action_end`（动作段 id 含序号不再按名去重）——
      **已被 T6 取代**：该事件是「阶段切换」的副产物，同阶段内连续调用不发事件，当命令段源会漏段。
      T6 接通权威 `ToolCallStart/End` 后已移除此处双写，仅保留右侧阶段轨迹（`deepSegments`）
    - `abort` 标记轮次 `status='aborted'`，展平时补「已由用户停止」分隔行（保留 N4 反馈）
    - `messages` 与 `turns` **双轨并存**：`turns` 驱动渲染，`messages` 仅供 `lastAssistantHasContent/HasThinking` 与 `sessionTitle` 消费

### P1 · 后端供数

- [x] T5: `PromptResponse` 加 `reasoning` + 入库写 `meta["thinking"]`
  - files: `crates/agent-kernel/src/backend.rs`、`llm/genai_backend.rs`、`agent/mod.rs`、
    `crates/agent-kernel/src/agent/tests.rs`、`crates/agent-patterns/src/supervisor/supervisor_tests.rs`
  - acceptance: ✅ `cargo check --all-targets`（agent-kernel / agent-patterns）通过；
    消息以 `msg_json` 整条序列化落库（`session_store.rs:393`），`meta` 自动持久化，**无需 schema 迁移**
  - 实现要点：
    - `PromptResponse.reasoning: Option<String>`；空串不写（避免脏数据）
    - `agent/mod.rs` **两处** assistant 入库点（无工具调用轮 / 带 tool_calls 轮）都写 `meta["thinking"]`
    - 显式构造 `PromptResponse` 的测试需补 `reasoning: None`（Rust 结构体字面量必须列全字段）

- [x] T6: 转发 `ToolCallStart/End`（只取 `tools.rs` 那份，处理双发去重）
  - files: `apps/tauri/src-tauri/src/commands.rs`、`apps/tauri/src/agent/composables/useAgentRust.ts`、
    `packages/shared-composables/src/agent/turnModel.ts`
  - acceptance: ✅ `cargo check`（worldsea-tauri-app lib）通过；单测 18/18；`vue-tsc --noEmit` exit=0
  - 实现要点：
    - **移除 `genai_backend.rs` 的 `ToolCallEnd` 广播**：其 `result` 实为 `fn_arguments`（参数而非结果），
      前端会把参数当结果显示、再被真实结果覆盖，表现为命令段内容闪变。权威 `ToolCallEnd` 仅由
      `tools.rs`（真实执行后）广播，失败路径同样会广播，不会漏
    - 去重：`actions_start` 按段 id 幂等、`action_end` 按 `refId` 收敛，genai 与 tools 两份 `ToolCallStart` 天然合并
    - 新增 `parseToolResult(raw: unknown)`：**实时与回源共用同一实现**（兼容 JSON 字符串与已解析值），
      保证两条路径产出一致；失败判定对齐 `tools.rs:390-399`（顶层非 null `error` 键）
    - 新增 `actions_settle` 事件：`agent_end` / `error` 兜底收口仍 `running` 的动作段，
      避免中断/异常时命令段永久转圈；`turn_end` 同样收口

### P3 · 三层渲染

- [x] T7: 三层渲染组件 + 折叠摘要行
  - files: `packages/shared-ui/src/agent/stream/`（`StreamRow.vue`、`ProcessSummaryRow.vue` 新建）
  - acceptance: ✅ 结果层带操作栏、过程文本段无操作栏（单测 30/30 + `vue-tsc` exit=0）
  - 实现要点：
    - 未建独立 `ProcessLayer` / `ResultLayer` 组件，改用 `<template v-for>` 分组 + 容器 div
      （`.ws-turn-process` / `.ws-turn-result`）——分组不产生多余 DOM 节点，窗口化已有行为不受影响
    - 新增 `StreamRow.vue`：行类型分发器，三层与尾部行共用，避免三处重复 v-if 链
    - `AssistantRow` 加 `isResult` prop：操作栏仅结果层渲染；默认 undefined 视为 true，既有调用方行为不变
    - `AgentStreamItem` 增 `process_summary` 变体；`assistant` 变体增 `isResult?`；`user` 变体增 `turnId?`
    - 结果层与过程文本段的视觉区分**只做字重**（过程段 400 + 弱化色，结果层 500）——
      不改字号：`ws-assistant-text` 上的 `agentFontStyle` 是 inline style，CSS 覆盖不生效

- [x] T8: `AgentStreamList` 改为按 Turn 渲染
  - files: `packages/shared-ui/src/agent/stream/AgentStreamList.vue`
  - acceptance: ✅ 轮次之间仅 gap（4px 容器 gap + 4px margin），无分隔线
  - 实现要点：
    - 分组以 `user` 行为界；窗口切片从轮次中间开始时造 orphan 组承接，**保证不丢行**
    - 组结构 `{ user, process, result, tail }`：结果层之后仍属本轮次的行（如中止分隔行）入 tail，
      避免分隔行被渲染到结果层之前
    - **分组安全的前提**（已验证）：窗口化按 `data-msg-id` 的 **id 键**存高度
      （`useMessageWindowing` 的 `measuredHeights` Map），与 DOM 嵌套无关；只要渲染顺序与 items 顺序一致即可

- [x] T9: `ThinkRow` / `ToolRow` 补 `data-msg-id`
  - files: `packages/shared-ui/src/agent/stream/rows/`
  - acceptance: ✅ 两类行纳入 ResizeObserver 实测，不再吃硬编码估算（think=60/tool=32）

### P4 · 折叠与性能

- [x] T10: 三条件折叠控制器（§3.4）
  - files: `packages/shared-ui/src/agent/message-list/useProcessCollapse.ts`（新建）
  - acceptance: ✅ 单测 30/30（含三条件全分支）；`vue-tsc` exit=0
  - 实现要点：
    - 判定 `decideCollapse(turn, processVisible)` 是**纯函数，下沉在 turnModel**（与归约器同源，便于单测），
      控制器只负责 DOM 侧：视口判定、空闲计时、活动监听
    - Turn 增两个 latch 字段：`userEverExpanded`（展开了又收起仍为 true）、
      `hasAutoCollapsed`（每轮次只自动折叠一次）
    - 新增 `turn_expanded` / `auto_collapse` 两个归约事件，按 id 定位（可能操作历史轮次，不能用 lastTurnIndex）
    - 活动事件计入 wheel/touchmove/scroll/click/keydown/selectionchange，**不计入 mousemove/hover**
    - 折叠态写在 Turn 上而非组件 state：切会话回源后与用户操作一致
    - "用户曾展开行段"信号：ThinkRow / ToolRow 展开时 emit `expand` → 逐层上抛 → `markTurnExpanded(turnId)`

- [x] T11: 折叠滚动锚定补偿（以结果层顶部为锚点）
  - files: `apps/tauri/src/agent/AgentMessageList.vue`
  - acceptance: ✅ `vue-tsc` exit=0
  - 实现要点：
    - 锚点选**结果层**（`[data-result-turn-id]`）而非过程层：折叠后过程层只剩一行摘要，其位置本身在变
    - 折叠/展开**双向**都补偿（展开时高度骤增同样会跳动）
    - 按 `dataset` 遍历比对而非拼属性选择器，避免 turnId 特殊字符导致选择器注入/转义问题

- [x] T12: 增量 patch，消灭每 delta 的全量重算
  - files: `packages/shared-composables/src/agent/turnModel.ts`、`apps/tauri/src/agent/composables/useAgentRust.ts`
  - acceptance: ✅ 全量单测 261/261（turnModel 31，含"单轮展平 ≡ 全量展平"守卫）；`vue-tsc` exit=0
  - 实现要点（**与原设想不同**）：
    - 原设想 `Map<segmentId, Segment>` 改归约器内部结构——**评估后放弃**：归约器是不可变数据结构，
      O(t+m) 的对象复制在 JS 里是微秒级（t/m 均 < 100），真正的大头是
      `agentStream` computed 每个 delta 都全量 `flattenTurns` + `map` 两次 O(总行数)，
      以及行对象全部换新导致 Vue v-for 全量 patch
    - 实际做法：**两级引用缓存**（保持归约器不可变，一行不改）——
      ① 轮次级 `flatRowCache`（turn 引用未变 → 整轮 FlatRow[] 复用，为此从 `flattenTurns` 拆出 `flattenTurn`）；
      ② 行级 `streamItemCache`（row 引用未变 → 复用同一 AgentStreamItem 对象 → Vue 跳过该行 patch）。
      流式时**只有正在增长的那一段真正重建**
    - 复用判据一律 `===`（归约器不可变，未触及部分天然同引用），无需版本号/脏标记
    - 缓存清理：切会话 / clearHistory 时 `resetStreamCaches()`。
      **不能用容量上限淘汰**——超长会话会退化成"每 delta 清空重建"，比不缓存更慢；
      也不能不清理——回源行 id 形如 `msg-${i}`，**跨会话必然重复**，不清会随切换次数累积

- [x] T13: `mentionInjectCache` 加上限（FIFO 淘汰）
  - files: `packages/shared-ui/src/agent/bubbles/useMarkdownRender.ts`
  - acceptance: ✅ 上限 200，超限一次淘汰最早 20%（摊销）；`vue-tsc` exit=0
  - 关键认知：该缓存 key 是**完整 HTML 字符串**，流式时每个 delta 一个新 key 且**命中率极低**
    （HTML 每次都在变），无上限等于纯泄漏——一轮长回复即可累积数千条（key+value 都是 HTML 全文）

---

## 六、风险与待决

| # | 风险 | 处置 |
|---|---|---|
| R1 | `ToolCallStart/End` 双发（genai 侧 + tools.rs 侧），call_id 相同 | 前端用 `Map<call_id>` 覆盖；result 以 `tools.rs` 侧为准（genai 侧 result 是参数） |
| R2 | P3 折叠导致高度骤变，可能引入新的视口跳动 | ✅ T11 已实现（以结果层顶部为锚点，折叠/展开双向补偿）。跳动是否彻底消除仍需运行时实测 |
| R3 | `agentStream` 被多处消费，改动面大 | 保留为 flatten 兼容输出（T4），消费方零改动 |
| R4 | 浏览器模式 SSE 丢帧未修 | 不在本计划范围；P1 后可另立专项（合批 / 有背压 channel） |
| R5 | 编排模式 `activeRun` 抑制吞掉全部正文事件（`useAgentRust.ts:903`） | 不在本计划范围；Turn 模型落地后需重审该抑制逻辑是否仍必要 |
| R6 | 除 `tool` / `plan` 外，另 6 类动作段事件仅存前端内存，回源即失（§3.5） | 用户已明确"整个会话都要持久化"。thinking 缺口由 P1/T5 解决；subagent / a2ui / phase / router 的持久化列为 P1 之后的独立增量 |
| R7 | 并行 Agent 同时在改其他模块（如 `model-registry.ts`、模型选择器右栏） | 改动前先 `git status` 同步；本计划触及 `vitest.config.ts` / `shared-composables/package.json` 等共享文件，需留意合并冲突。已确认对方动过 `crates/agent-kernel/src/backend.rs`（P1/T5 目标文件） |
| R8 | **年龄分隔行功能移除**：原 `pushStreamItem` 在跨轮次 >30 分钟时插入时间分隔 | T4 未保留。根因是后端消息无 timestamp（`rustMsgToTsMsg` 用 `Date.now()`），回源后本就无法工作。若需恢复，须先让后端消息带 timestamp，再在 flattenTurns 层统一插入 |
| R9 | `steer` / `followUp` 不经过 `prompt`，无 `currentTurnId` → 其流式事件被归约器忽略 | 后端 `steer` 只注入引导文本、不立即产生流（待确认）；当前选择静默忽略而非造畸形轮次。若实测有内容丢失，改为在 `turn_end` 后保留 turnId 至下次 prompt |
| R10 | ~~P2/P1/P3 未做运行时验证~~ | ✅ **2026-08-29 浏览器模式冒烟通过**（HTTP 桥 localhost:5175 + DeepSeek V4 Flash）。详见 §八。静态验证仍全绿：单测 261/261 + `vue-tsc` exit=0 + cargo check（agent-kernel / agent-patterns / worldsea-tauri-app）。桌面端 webview 路径与浏览器同构（差异仅传输层），风险低 |
| R11 | 编排模式（`activeRun` 非空）下 `currentTurnId` 为空，命令段事件被守卫丢弃 | 编排路径未开轮，属 P1 之后的增量；`react` 退化 run（快问答）不受影响 |
| R12 | ~~折叠三条件运行时未实测~~ | ✅ **三条件全部实测通过**（浏览器模式）：①未展开→结果落地立即折叠（多轮复验）；②落地前展开行段→落地后 5s 空闲折叠（时序吻合 7.5s 落地/12.5s 折叠）；③展开后滚出视口→立即折叠。`hasAutoCollapsed` latch 行为：手动展开摘要行后不再自动折叠、切会话往返保留折叠态，均符合 §3.4 设计。R12 原先担心的「窗口化卸载误判不可见」未观察到负面表现 |
| R13 | 折叠使行数骤减，窗口化的占位高度需重算 | ⚠️ **条件3 触发正确，但锚定稳定性未能定论**：实测采样期间存在多处非脚本触发的滚动位置变化（用户同时在实机操作），resTop 读数被干扰。机制无异常、无报错、无永久错位；建议在无人工干扰环境下对 R2/R13 做一次干净复测（滚动锚定补偿 + 折叠瞬间高频采样） |
| R14 | ~~回源命令段全部误标「执行失败」~~ | ✅ **已修复（2026-08-29）**：turnModel.ts:564 增加 `'toolresult'` 匹配（serde lowercase 实际值）；`RustMessage.role` 类型与 `rustMsgToTsMsg` 映射同步修正；turnModel.spec.ts 补 2 条以真实序列化值为角色的回归用例（成功不误标 / 失败仍判 failed）。验证：vitest 263/263 + vue-tsc exit=0 |
| R15 | **冒烟发现的既有 BUG（非本计划引入）：模型参数刻度直传**。`agent_settings` / `agent_model_params_*` / `agent_session_window` 三个 localStorage 键存 0-100 刻度（temperature=70 / topP=100），原样进请求 → DeepSeek 400 "Invalid temperature value, the valid range of temperature is [0, 2]"；且参数在**会话创建时固化**进会话级 provider_config，改设置只影响新会话。冒烟时已临时改 localStorage 绕过（temperature 0.7 / topP 0.9 / maxTokens 8192）。属生成层/设置链路问题，建议另立专项 | 待用户决定 |
| R16 | 冒烟顺带观察（均不阻塞）：① 实时推理段计数含路由器推理（不落库），刷新后段数变少（10 段→8 段），口径不一致属 R6 范畴可接受；② `sessions.message_count` 列不更新（恒 0），前端侧边栏用实际消息数故 UI 无感，后端小瑕疵 | 记录备查 |

---

## 七、依据索引

- 诊断过程与证据：`.codebuddy/memory/2026-08-29.md`
- 事件定义：`crates/agent-kernel/src/event.rs`
- 事件转发：`apps/tauri/src-tauri/src/commands.rs`
- 前端消费：`apps/tauri/src/agent/composables/useAgentRust.ts`
- 渲染容器：`packages/shared-ui/src/agent/stream/AgentStreamList.vue`
- 窗口化：`packages/shared-ui/src/agent/message-list/useMessageWindowing.ts`

---

## 八、运行时冒烟记录（2026-08-29 · 浏览器模式）

> 环境：HTTP 桥 localhost:5175（ZCode 内置浏览器驱动），DeepSeek V4 Flash，深度思考模式，
> 新建会话实测一轮含 10 次工具调用的多轮任务。持久化事实以 SQLite（`sessions.db`）直接查证。

| # | 冒烟项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 实时流分段（推理/过程文本/命令交错） | ✅ | 推理→命令→推理→命令交错各自成段，符合 §3.3 状态机 |
| 2 | 命令段实时渲染 | ✅ | 真实命令行 + exit 码 + 耗时 + 失败徽标；失败工具按设计不可展开 |
| 3 | 结果层落地 → 条件1 立即折叠 | ✅ | 多轮复验；摘要文案「N 个步骤 · M 段推理」步骤优先 |
| 4 | 条件2（落地前展开→落地后 5s 空闲折叠） | ✅ | 7.5s 落地 / 12.5s 折叠，时序吻合 |
| 5 | 条件3（滚出视口→立即折叠） | ✅ | 折叠后 latch 保持不反弹 |
| 6 | T5 thinking 落库 | ✅ | DB 直查：8 条 assistant 消息带 `meta.thinking`，无需迁移 |
| 7 | 刷新回源重建 | ✅* | 推理段（8 段来自 meta.thinking）/ 命令段（10 个）/ 过程文本 / 结果层全部重建，无 raw JSON 正文行，结构与实时一致——§2.5「两套 DOM」运行时确认消除（*命令段状态误标见 R14） |
| 8 | 中止流 | ✅ | 「停止生成」→「已由用户停止」分隔行；中止轮无结果层、过程段保留 |
| 9 | 切会话往返 | ✅ | 23 行内容一致、折叠态保留（sessionTurnsCache）；旧格式会话（无 thinking）正确降级 |
| 10 | 锚定补偿（R2/R13） | ⚠️ | 机制触发无异常，读数受用户实时操作干扰，需干净复测 |

冒烟过程中被 R15（temperature 400）短暂阻塞，改 localStorage 参数后恢复；该 400 也解释了
最早两轮「结果为 `{}`/空且不落库」的怪象（回合实际失败，渲染层行为正常）。
