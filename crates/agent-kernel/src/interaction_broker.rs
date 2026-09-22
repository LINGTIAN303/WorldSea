//! 交互协调器（S5）：三型交互请求（permission / userInput / hookReview）统一注册表
//!
//! 统一语义（[12-S5施工计划](../../docs/plans/2026-09-21-ZCode能力内化方向探究/12-S5施工计划-交互三型.md) §二.2）：
//! - **单注册表**：`id → Pending { kind, tx }`；`resolve` 按 kind 校验（错配即拒、不唤醒）；
//! - **三型入口**：`request_permission`（60s）/ `request_user_input`（600s）/ `request_hook_review`（300s，Q4 拍板）；
//! - **统一随轮取消**：`cancel_all`（abort / dispose 调用）——permission 亦被取消（**S5 修复旧缺口**：
//!   此前 abort 后确认等待方须等满 60s 超时）。
//!
//! 事件映射（S5-a 过渡态）：permission / user_input 沿用旧事件对；hook_review 无旧事件，
//! 直接发族事件 `InteractionRequested` / `InteractionResolved`——S5-b 统一切换为族事件。
//! 详细见 docs/details/注释/agent-runtime/confirmation.md。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{oneshot, Mutex, RwLock};

use agent_engine::contracts::interaction::{
    AskOutcome, InteractionKind, InteractionOutcome, InteractionRequest,
};
use agent_engine::contracts::ConfirmationOutcome;

/// 复核结果（hookReview 型；定义处 `agent-engine::contracts::interaction`——供调用点单一引用）
pub use agent_engine::contracts::interaction::HookReviewOutcome;

use crate::event::{EventBroadcaster, OrchestratorEvent};

/// 默认确认超时（60s）：超时按不执行处理，避免 Agent 无限等待
const DEFAULT_CONFIRM_TIMEOUT: Duration = Duration::from_secs(60);

/// 默认提问超时（600s，2026-09-20 用户裁定：超时按「跳过」处理）
///
/// 提问不套用确认的 60s（人工作答需要时间），但也不能无限等待（无应答者场景）；
/// 超时 → [`AskOutcome::TimedOut`]：清理 pending + 广播 resolved
/// （前端关面板 + 弱提示），工具侧按「跳过」返回空答案 + `timedOut` 标记。
const DEFAULT_ASK_TIMEOUT: Duration = Duration::from_secs(600);

/// 默认复核超时（300s，S5 Q4 用户拍板）：超时/取消均按拒绝 fail-closed（工具不执行）
const DEFAULT_HOOK_REVIEW_TIMEOUT: Duration = Duration::from_secs(300);

/// 待决交互（统一注册表条目；kind 用于 resolve 校验）
struct Pending {
    kind: InteractionKind,
    tx: oneshot::Sender<InteractionOutcome>,
}

/// 交互协调器：三型交互请求统一注册表 + 等待/唤醒/超时/取消收口
///
/// 每个 AgentLoop 会话持有一个 broker；`request_*` 广播事件并 `await` oneshot，
/// 前端经统一回传命令调用 [`Self::resolve`] 唤醒等待方。
pub struct InteractionBroker {
    pending: Mutex<HashMap<String, Pending>>,
    /// 审批超时（默认 60s）
    confirm_timeout: Duration,
    /// 提问兜底超时（默认 600s；测试可经 `with_ask_timeout` 缩短）
    ask_timeout: Duration,
    /// 复核超时（默认 300s；测试可经 `with_hook_review_timeout` 缩短）
    hook_review_timeout: Duration,
}

impl InteractionBroker {
    /// 创建交互协调器（默认：确认 60s / 提问 600s / 复核 300s）
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            confirm_timeout: DEFAULT_CONFIRM_TIMEOUT,
            ask_timeout: DEFAULT_ASK_TIMEOUT,
            hook_review_timeout: DEFAULT_HOOK_REVIEW_TIMEOUT,
        }
    }

    /// 创建并自定义确认超时（其余维持默认）
    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            confirm_timeout: timeout,
            ..Self::new()
        }
    }

    /// 创建并自定义提问兜底超时（测试用；生产维持 `DEFAULT_ASK_TIMEOUT`）
    pub fn with_ask_timeout(ask_timeout: Duration) -> Self {
        Self {
            ask_timeout,
            ..Self::new()
        }
    }

    /// 创建并自定义复核超时（测试用；生产维持 `DEFAULT_HOOK_REVIEW_TIMEOUT` = 300s）
    pub fn with_hook_review_timeout(hook_review_timeout: Duration) -> Self {
        Self {
            hook_review_timeout,
            ..Self::new()
        }
    }

    // ─── 三型入口 ─────────────────────────────────────────

    /// 发起工具调用审批（permission 型）：广播事件并等待前端回传
    ///
    /// `risk_level` / `side_effect_scope` = 工具声明元数据的线面串（UX-b：前端弹窗展示；
    /// **不参与判定**——四值与 alwaysAsk 语义不受影响；`None` = 调用方未提供）。
    ///
    /// # 返回（D8 四值，B7 语义不变）
    /// - `Approved`：用户放行；`Denied` / `Skipped`：拒绝 / 跳过（均不执行，文案区分）
    /// - `Timeout`：超时或随轮取消（内核侧产生，按不执行处理）
    pub async fn request_permission(
        &self,
        broadcaster: &Arc<RwLock<EventBroadcaster>>,
        tool_name: &str,
        args: serde_json::Value,
        risk_level: Option<String>,
        side_effect_scope: Option<String>,
    ) -> ConfirmationOutcome {
        let request = InteractionRequest::Permission {
            tool_name: tool_name.to_string(),
            args,
            risk_level,
            side_effect_scope,
        };
        let outcome = self.request(broadcaster, request, self.confirm_timeout).await;
        match outcome {
            InteractionOutcome::Permission(o) => o,
            // 不可达（kind 由构造保证）；库面不埋 panic——fail-closed 收口
            other => expect_permission(other),
        }
    }

    /// 发起提问（userInput 型）：广播事件并等待前端作答
    ///
    /// `questions` 为工具规范化后的批次载荷（camelCase：
    /// `[{ id, question, header?, options?, multiSelect? }]`）。
    pub async fn request_user_input(
        &self,
        broadcaster: &Arc<RwLock<EventBroadcaster>>,
        questions: serde_json::Value,
    ) -> AskOutcome {
        let request = InteractionRequest::UserInput { questions };
        let outcome = self.request(broadcaster, request, self.ask_timeout).await;
        match outcome {
            InteractionOutcome::UserInput(o) => o,
            other => expect_user_input(other),
        }
    }

    /// 发起钩子转人工复核（hookReview 型，S5 新增）：广播事件并等待前端回传
    ///
    /// 超时 300s / 随轮取消均产出内核侧终值（`TimedOut` / `Cancelled`），
    /// 调用方一律按拒绝 fail-closed 处理（工具不执行）。
    pub async fn request_hook_review(
        &self,
        broadcaster: &Arc<RwLock<EventBroadcaster>>,
        hook_name: &str,
        tool_name: &str,
        args: serde_json::Value,
        reason: &str,
    ) -> HookReviewOutcome {
        let request = InteractionRequest::HookReview {
            hook_name: hook_name.to_string(),
            tool_name: tool_name.to_string(),
            args,
            reason: reason.to_string(),
        };
        let outcome = self.request(broadcaster, request, self.hook_review_timeout).await;
        match outcome {
            InteractionOutcome::HookReview(o) => o,
            other => expect_hook_review(other),
        }
    }

    // ─── 解析与取消 ───────────────────────────────────────

    /// 解析一次待决交互（前端回传唯一入口）
    ///
    /// **kind 必须与请求相符**（错配即拒：不唤醒、不移除——等待方仍可被正确结果唤醒）。
    /// 返回是否成功找到并唤醒对应等待方（id 不存在 = 已超时 / 已取消 / 已处理）。
    pub async fn resolve(&self, interaction_id: &str, outcome: InteractionOutcome) -> bool {
        let mut guard = self.pending.lock().await;
        match guard.get(interaction_id) {
            Some(p) if p.kind == outcome.kind() => {}
            _ => return false,
        }
        match guard.remove(interaction_id) {
            Some(p) => {
                let _ = p.tx.send(outcome);
                true
            }
            None => false,
        }
    }

    /// 取消全部待决交互（随轮取消：`abort` / `dispose`），返回 `(interaction_id, kind)` 列表
    ///
    /// 各型以自身内核侧终值唤醒：permission → `Timeout`（四值无「取消」值，fail-closed 收口）、
    /// user_input → `Cancelled`、hook_review → `Cancelled`。调用方据此广播 resolved
    /// 供前端清理面板。
    pub async fn cancel_all(&self) -> Vec<(String, InteractionKind)> {
        let mut guard = self.pending.lock().await;
        let entries: Vec<(String, Pending)> = guard.drain().collect();
        let mut out = Vec::with_capacity(entries.len());
        for (id, p) in entries {
            let _ = p.tx.send(terminal_outcome(p.kind, false));
            out.push((id, p.kind));
        }
        out
    }

    /// 待决交互数（诊断 / 测试用）
    pub async fn pending_count(&self) -> usize {
        self.pending.lock().await.len()
    }

    // ─── 内部：注册 + 广播 + 超时 ─────────────────────────

    /// 注册等待方 → 广播请求 → 等待（resolve / 取消 / 超时三者之一唤醒）
    async fn request(
        &self,
        broadcaster: &Arc<RwLock<EventBroadcaster>>,
        request: InteractionRequest,
        timeout: Duration,
    ) -> InteractionOutcome {
        let id = Self::gen_id();
        let kind = request.kind();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id.clone(), Pending { kind, tx });
        // 广播请求（取总线句柄后于**壳锁外**分发——2026-09-17 风险点处置）
        let bus = broadcaster.read().await.handle();
        bus.emit(&request_event(&id, &request));
        // 等待前端回传；超时则清理 pending 并广播终态（前端据此清理面板）
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(outcome)) => outcome,
            // 发送端被丢弃（不应发生）→ 按取消兜底，保证工具侧不致永久挂起
            Ok(Err(_)) => terminal_outcome(kind, false),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                let outcome = terminal_outcome(kind, true);
                let bus = broadcaster.read().await.handle();
                bus.emit(&resolved_event(&id, &outcome));
                outcome
            }
        }
    }

    /// 生成交互请求唯一 ID（纳秒时间戳 + 原子计数，避免依赖额外 uuid crate）
    fn gen_id() -> String {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("ix-{nanos}-{n}")
    }
}

impl Default for InteractionBroker {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 终态与事件映射 ───────────────────────────────────────────

/// 该型的内核侧终态：`timed_out` = 超时；否则 = 取消 / 发送端丢失
fn terminal_outcome(kind: InteractionKind, timed_out: bool) -> InteractionOutcome {    match kind {
        // 审批四值无「取消」值 → 收口为 Timeout（fail-closed：仍是「未执行」）
        InteractionKind::Permission => {
            InteractionOutcome::Permission(ConfirmationOutcome::Timeout)
        }
        InteractionKind::UserInput => InteractionOutcome::UserInput(if timed_out {
            AskOutcome::TimedOut
        } else {
            AskOutcome::Cancelled
        }),
        InteractionKind::HookReview => InteractionOutcome::HookReview(if timed_out {
            HookReviewOutcome::TimedOut
        } else {
            HookReviewOutcome::Cancelled
        }),
    }
}

/// 随轮取消的终态（`cancel_all` / `AgentLoop::cancel_pending_interactions` 共用）
pub(crate) fn cancel_terminal_outcome(kind: InteractionKind) -> InteractionOutcome {
    terminal_outcome(kind, false)
}

/// 请求事件（S5-b 起统一族事件；三型共用，载荷带 kind 判别）
pub(crate) fn request_event(id: &str, request: &InteractionRequest) -> OrchestratorEvent {
    OrchestratorEvent::InteractionRequested {
        interaction_id: id.to_string(),
        request: request.clone(),
    }
}

/// 终态事件（S5-b 起统一族事件；`outcome` 判别即 kind）
pub(crate) fn resolved_event(id: &str, outcome: &InteractionOutcome) -> OrchestratorEvent {
    OrchestratorEvent::InteractionResolved {
        interaction_id: id.to_string(),
        outcome: outcome.clone(),
    }
}

fn expect_permission(outcome: InteractionOutcome) -> ConfirmationOutcome {
    match outcome {
        InteractionOutcome::Permission(o) => o,
        _ => ConfirmationOutcome::Timeout,
    }
}

fn expect_user_input(outcome: InteractionOutcome) -> AskOutcome {
    match outcome {
        InteractionOutcome::UserInput(o) => o,
        _ => AskOutcome::Cancelled,
    }
}

fn expect_hook_review(outcome: InteractionOutcome) -> HookReviewOutcome {
    match outcome {
        InteractionOutcome::HookReview(o) => o,
        _ => HookReviewOutcome::Cancelled,
    }
}

#[cfg(test)]
#[path = "interaction_broker_tests.rs"]
mod tests;
