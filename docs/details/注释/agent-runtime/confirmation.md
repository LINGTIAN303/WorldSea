# 交互协调器与确认族详细注释文档（agent-kernel）

> 来源：`crates/agent-kernel/src/interaction_broker.rs`（协调器）与 `crates/agent-kernel/src/confirmation.rs`
> （策略与守卫面）的模块级长注释块。代码内保留简要说明 + 本文件相对路径；
> **设计事实源**见 [12-S5施工计划 §二](../../../plans/已完成/2026-09-21-ZCode能力内化方向探究/12-S5施工计划-交互三型.md)。

---

## 一、为什么需要（S5 立项）

S5 前，交互面是**两条平行通道 + 一条缺席**：

| 型 | 内核入口 | 事件 | 回传命令 |
|---|---|---|---|
| permission | `ConfirmationBroker::request` | `confirmation_requested/resolved` | `cmd_agent_confirm` |
| userInput | `ConfirmationBroker::ask` | `ask_requested/resolved` | `cmd_agent_ask_answer` |
| hookReview | 无 | — | — |

三个缺口：① 无统一模型（新增一型 = 新事件对 + 新命令 + 新前端监听，三处并改）；
② **取消语义不一致**——提问有随轮取消，确认没有（abort 后待确认工具须等满 60s）；
③ 钩子决策面窄（既有 A6 钩子仅 `Allow/Deny`，ZCode 为三值 `allow|deny|ask`——缺「转人工复核」）。

S5-a 把三型收为**单注册表 + 单 resolve + 单取消**；S5-b 再切协议面（统一事件 + 单命令 + 前端单监听）。

## 二、分层（S5 后）

```
agent-engine::contracts::interaction   ← 契约单点：InteractionKind / InteractionRequest /
                                        HookReviewOutcome / InteractionOutcome + AskAnswer/AskOutcome
        ▲
crates/agent-kernel/src/interaction_broker.rs（本族协调器）
        三级入口 request_permission / request_user_input / request_hook_review
        单注册表 pending: id → Pending { kind, tx }
        单 resolve（kind 校验）/ cancel_all（随轮取消）
        终态广播映射 request_event / resolved_event（S5-a 过渡：两旧型走旧事件）
        ▲
crates/agent-kernel/src/confirmation.rs ← 策略与守卫面（ConfirmationPolicy / tool_permission /
                                        guard_fs_path / rule_content_subject）+ 类型再导出
```

`ConfirmationOutcome` 自 S5 起**定义处只在 engine**（此前 kernel 持有副本——冻结名义单点、事实双份；
S5-a 顺带收口），kernel 以 `pub use` 保持 `agent_runtime::confirmation::*` 下行路径不变。

## 三、关键语义（易错点）

1. **kind 错配即拒**：`resolve(id, outcome)` 要求 `outcome.kind()` 与请求 kind 相符，否则
   **不唤醒、不移除**（等待方仍可被正确结果唤醒）。反证见
   `interaction_broker_tests::resolve_rejects_kind_mismatch_without_waking`。
2. **每型超时各自独立**（构造器可分别缩短供测试）：
   permission 60s / user_input 600s / **hook_review 300s**（S5 Q4 用户拍板）。
3. **终值表**（内核侧，fail-closed 收口）：

   | 型 | 超时 | 取消 / 发送端丢失 | 说明 |
   |---|---|---|---|
   | permission | `Timeout` | `Timeout` | 四值冻结无「取消」值——收口为「未执行」 |
   | user_input | `TimedOut` | `Cancelled` | 工具侧按「跳过」/ `ASK_CANCELLED` 分流 |
   | hook_review | `TimedOut` | `Cancelled` | 一律按拒绝（工具不执行） |

4. **终态必广播**：resolve（`AgentLoop::resolve_interaction`）、超时（协调器内）、取消
   （`cancel_pending_interactions`）三路都广播 resolved 事件——前端据此清理面板（幂等）。
5. **随轮取消**：`abort` / `dispose` → `cancel_pending_interactions` → `cancel_all()` 唤醒三型
   （S5 修复：此前确认型不在取消面内）。`AgentLoop::cancel_pending_interactions` 据此广播。
6. **id 前缀 `ix-`**：三型统一（旧 `confirm-` / `ask-` 前缀随 S5 退役）；前端只做原样回显。

## 四、hookReview 生产路径与边界（S5-a）

- **生产方**：`ToolHookAction::Review { reason }`——既有 A6 生命周期钩子（`tool_hook.rs`）可返回，
  内核在 `run_tool_with_retry` 的 pre 阶段升级为 hookReview 交互请求（**位次在权限门之后**：
  `maybe_require_confirmation` → `execute_tool_with_retry` → 钩子）。
- **放行** = 继续执行（沿原 args）；**拒绝/超时/取消** = fail-closed：
  `ToolError::HookReviewDenied`（`HOOK_REVIEW_DENIED`）/ `ToolError::HookReviewTimeout`
  （`HOOK_REVIEW_TIMEOUT`），工具不执行、跑全部 `on_error` 钩子。
- **无确认通道**（未注入 broker）→ 按既有归一化**降级放行**（对齐「Ask 无通道降级 Allow」）。
- **边界（不做项）**：hooks 体系本身（workspace hooks / trust 记录 / revoke / 单调性）属 C7；
  本批**无默认钩子**使用 Review ⇒ 真机走查随 C7 首个真实钩子（Q2 裁定，不造演示钩子）。

## 五、S5-a 过渡态与 S5-b 切换点

S5-a 的线面**零变更**（B7 零风险）：`request_event` / `resolved_event` 两个映射函数把
permission / user_input 仍映射到旧事件对；hook_review 无旧事件、直接发族事件
（`interaction_requested` / `interaction_resolved`，keys 62→64 增补）。

**S5-b 切换点**（一次提交，与前端同批）：这两个函数 + `AgentLoop::resolve_interaction` 的
映射改为统一族事件；旧 4 key + 旧 4 事件变体 + 旧 2 命令 + 旧 2 前端监听随批删除
（Q3 裁定：切换即删旧；07 冻结按「族级处置另行报告」登记修订）。

## 六、已知边界

- 前端的 kind 分派渲染（permission → `useConfirm` / userInput → `useAsk` / hookReview → 复核面板）
  属 S5-b；S5-a 期间 hookReview 事件无前端消费方（无生产方，不影响既有流程）。
- 会话级授权（S4-b `SessionPermissionGrants`）与本族**不同层**：那只服务 alwaysAsk gate，
  不做 hookReview 的信任记忆（trust 属 C7）。
