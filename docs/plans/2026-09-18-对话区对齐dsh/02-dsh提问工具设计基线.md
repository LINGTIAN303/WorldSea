# dsh 提问工具设计基线（ask_user_question / user-questions seam）

> status: 事实基线（2026-09-18，只读探索产出；对照与本侧建议见 [03-对照与建议清单](03-对照与建议清单.md)）
> 范围：模型可见工具 → `user-questions` seam → answerer 拓扑 → 客户端 UI → `plan-review` intent → 会话日志形态的完整链路。
> 关联：[01-dsh对话区设计基线](01-dsh对话区设计基线.md)（其 §7.6 `conversation.composer` chain 即本工具 UI 的宿主机制）。
> 取证口径：路径相对 dsh 根 `.独立项/【参考项】deepseek-harness/`；`tool-ask-user/src/index.ts` schema 已逐行抽查复核；快照文件为只读引用。

## 零、先读：一句总判断

提问工具是「**工具（消费方）+ seam（协议）+ client 插件（提供方）**」三角色缝合的教科书案例：工具只负责「模型参数 → seam 请求 → 工具结果」两次翻译；**谁能答、怎么答**全在 seam 的 waterfall 与 scope 规则里；**呈现意图（intent）只改 UI 呈现、不改协议编码**——不认识 intent 的 UI 走通用列表，答案字段完全一致。

---

## 一、工具 schema（`packages/interaction/tool-ask-user/src/index.ts`）

- 工具名 `ask_user_question`（:21）；description 原文（:16-17）："Ask the user a concise question when you need confirmation, a choice, or missing information before proceeding. Send one or more questions, each with a stable id that will be echoed in the answer."
- `parameters`（:23-57）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `questions[]` | 是 | **一条请求承载整批问题**（UI 一个流程内呈现相关提示） |
| `questions[].id` | 是 | **调用方给稳定 id，随答案原样回显**（批量问题可路由） |
| `questions[].question` | 是 | 问题文本 |
| `questions[].header` | 否 | 短标题/分组标签（如 "Confirm" / "Choose Mode"） |
| `questions[].options[]` | 否 | `label`（必填，同时是面向模型选中值）+ `description`（UI 帮助文本）；**推荐项放首位并在 label 追加 "(Recommended)"**（:40） |
| `questions[].multi_select` | 否 | 默认 false；**模型侧 snake_case，seam 侧 camelCase `multiSelect`**，execute 做转换（:50,87） |

- 问题项 `additionalProperties: true`（:30）——允许扩展属性。
- output schema（:58-79）：`{ answers: [{ id, selected: string[], custom? }] }`，`additionalProperties: false`；模型侧呈现 = `JSON.stringify(value)` 单文本块（:78）。
- 并发：未声明 `isConcurrencySafe` → 按 core 规则归 `exclusive`（独占排序屏障）（`packages/core/tools/src/index.ts:1284`）。
- 挂载：`packages/preset/agent-presets/presets/{standard,ptc,cordis}/agent.cordis.yml:245,256,233` 各一行。
- 有意分层：本工具**未声明** `presentCall/presentResult`；「UI 只渲染，工具行归 preset/TUI 组装」（`packages/client/ui-user-questions/src/index.ts:1-11`）。

## 二、execute 与失败语义

- 流程（:80-98）：逐字段映射（`header`/`options`/`multiSelect` 非 undefined 才带上）→ `ctx.userQuestions.ask({ questions, agent?, signal })` → 复制 `selected` 数组回传（避免共享引用）。
- **阻塞至人工回答**；未声明 `timeoutMs`（不参与工具超时策略），取消只沿用 `exec.signal`（`tool-ask-user/README.zh.md:141`）。
- **无 answerer = 报错不降级**（fail loud，非静默跳过）（`README.zh.md:28`）。
- 错误码全集（`packages/interaction/user-questions/src/index.ts:43,91,99,105,122,127,132`）：`EMPTY_QUESTIONS` / `BAD_INTENT` / `NO_PROVIDER` / `ASK_ABORTED` / `CALLER_NOT_LIVE` / `DELEGATED_CALLER`；均继承 `HarnessError`，`ctx.tools.execute()` 保留 `{name, code}` 进面向模型的工具失败（`docs/subsystems/user-questions.zh.md:106`）。

## 三、seam 协议与 scope 规则

- `ctx.userQuestions.ask()`（:86-151）校验顺序：signal 已中止 → ASK_ABORTED；空 questions → EMPTY_QUESTIONS；给了 agent 但 `agents.get(agent.id) !== agent` → CALLER_NOT_LIVE；`!agents.roots().includes(agent)` → DELEGATED_CALLER；intent 违规 → BAD_INTENT。
- intent 校验（seam 层）：`approve` 必须指向**该问题自身**的某个 option；带 intent 的问题必须有 `detail`（`docs/subsystems/user-questions.zh.md:25`）。
- 分派：无 agent → 全局 `waterfall('user-questions/request', …)`；有 agent → Agent-scoped waterfall（`scopeTarget(agent, agent)`），链尽头 `noAnswerer` 抛 NO_PROVIDER（:134-142）。异常归一：非领域错误且 signal 已中止 → ASK_ABORTED（保留 cause）；领域错误原样抛（:143-150）。
- **scope 边界按运行时所有权，不按持久谱系**：只有「注册表中的 exact live runtime root」能提问——owned child 没有人类应答者、会永久阻塞故拒之；以谱系恢复的新 root 可正常提问（:74-78）。
- scope 派发依据 = 请求里的 `request.agent`（`packages/core/scope/src/scoped-events.generated.ts:37`；签名 `this: Scoped<Agent>`，`types.ts:85-90`）——无 agent 的请求不会投给 Agent-scoped listener。

## 四、answerer 拓扑（谁在答）

- 产品内唯一 answerer：Web client（`packages/client/ui-user-questions/src/client/index.ts:104-106`，`ctx.remote.$on('user-questions/request', …)`）。
- Host→client 转发：白名单声明 `{ event: 'user-questions/request', mode: 'waterfall' }`（`packages/api/remotes/src/remote-events.ts:37`）；Session control **不存储、不重放**；若所有已投递 client 都 `next()`，Host waterfall 继续到后续 Host listener（`.agents/notes/implemented/architecture/2026-08-18-session-history-and-event-transport.zh.md:211`）。
- CLI/TUI/headless 无 answerer：`apps/cli/composition.md:33,200` 只挂 `user-questions` 服务、不注册监听 → 顶层提问预期 NO_PROVIDER（`packages/plan/plan-mode/tests/plan-mode.spec.ts:885-889` 断言该降级）。
- 子 Agent 提问有硬证据：`snapshots/session/subagent-child-question-rejection/session.1.v3.jsonl:18` 记录 `error {name:UserQuestionError, code:DELEGATED_CALLER}` 与拒绝文案；配套 tripwire answerer 必须不可达（`packages/test-support/session-snapshot/tests/fixtures/child-question-tripwire.ts:12-14`）。

## 五、客户端 UI 行为

- 接管方式：`slots.inject('conversation.composer')` + selector 匹配 `PendingQuestion`（`client/index.ts:94-103`）；kind 权重 `plan-review=2 > question=1`，保证同时只有一个请求持有 composer（:54-93）。
- `PendingQuestion`（`contract/slots.ts:109-208`）：本地渲染 key = `question:N`；`answer()` 一次 resolve 整批；`cancel()` → `ASK_CANCELLED`；signal abort → `ASK_ABORTED`；`delegate()` 用私有 Symbol 触发 `next()`（:167-180）。
- 通用流程 `QuestionComposer.tsx`：草稿按 requestKey 存 Session-scoped store（`draft-store.ts:42-57`），drafts 与 questions 1:1；单选**点选即前进**（:198）、多选 toggle（:190-195）；「自定义」在单选下清空 selected、多选下保留（:250-258）；Enter 继续/提交、Shift+Enter 换行、IME 防误提交（:38-42,260-264）；跳过 = 空答案并前进，最后一题跳过即提交（:266-276）；提交前未答且未跳过 → `error.incomplete`（:205-211）。
- 答案组织 `submitDrafts`（:212-224）：跳过 → `{id, selected: []}`；单选有 custom → `selected: []` + `custom`；多选 → `selected` 原样 + `custom`。
- 推荐后缀 `(Recommended)` 在 UI 剥离为徽标，但**回传值仍是原 label**（:30-35,321）。
- id 配对：UI 要求 question id 唯一；重复/缺失则放弃严格配对、退回「已答 n/m」计数摘要（`ui-tool/src/client/tool/toolviews/ask-question-row.tsx:70-84,175`）。

## 六、plan-review intent（呈现与协议分离的范例）

- 声明方：plan mode 的 `exit_plan_mode`（`packages/plan/plan-mode/src/index.ts:302-318`）——单问题 id = `plan-review`（:70）、header `Plan review`、options `Approve` / `Keep planning`（:73-76）、`intent: {kind:'plan-review', approve:'Approve'}`（:315）。
- UI 消费：`planReviewOf` 仅在「单问题 + intent + 有 detail + 非多选 + options≤2 + approve 命中」时接管专用面板，否则回通用流程（`contract/slots.ts:77-96`）；`PlanReviewPanel.tsx` 以 `selected:[label]` 作答（:44-47），`Chat about it` → `pending.cancel()`（:64）。
- 答案仍是通用 label：plan-mode 只在 `selected.length===1 && selected[0]==='Approve' && custom===undefined` 时通过，否则视为 keep planning 并取 `custom` 作反馈（:336-343）；`ASK_CANCELLED` 被转译为「用户想直接说」的专用错误（:325-328）。

## 七、日志与回放形态

- 请求与答案**不落独立事件、不重放**（Session control 不存储）；落盘的是常规 `tool/call`（arguments = 模型原始 JSON，含 id/header/question）+ `tool/result`（content 为单 text 块，紧凑 JSON 或 `Error: …` 文本，带 `error:{name,code}`）（`snapshots/session/subagent-child-question-rejection/session.1.v3.jsonl:17-18`）。
- 模型下一轮看到：工具调用参数 + `{"answers":[{"id":"<id>","selected":["<label>"],"custom":"<text>"}]}`；不用 custom 时省略字段；selected 可 0/1/多个（`tool-ask-user/README.zh.md:124`）；等待期间的 UI 交互（草稿、跳过动作）**不进模型上下文**。
- 回放 UI 由 `ask-question-row.tsx:87-108,140-180` 从 argsRaw 的 questions 与结果 answers 按稳定 id 配对，区分**已答 / 跳过 / 取消(ASK_CANCELLED) / 中断(ASK_ABORTED)** 四态。

## 八、不确定点（供后续复核）

1. 本快照内 CLI/TUI 无 answerer——是否其它分支/版本存在，未穷尽。
2. `ask_user_question` 在 ptc-only 工具呈现模式下是否公布：未见显式 gate（ptc preset 已挂载该行）——与 `run_code` 保留传输的关系待核。
3. `header` 在通用 UI 的呈现细节（分组标题还是前缀）未逐行核对。
4. 「跳过」在 seam 侧只是「空 selected 且无 custom」，无独立事件标记；回放四态靠 UI 推断，模型侧无法区分「跳过」与「用户未选」。