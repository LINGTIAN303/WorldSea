//! # 输入模型（阶段 2 · A3：inbox 三通道 + pre-step 准入 + 取消收口）
//!
//! 对齐 dsh：`followup`（唤醒）/ `steer`（唤醒，最近 step 消费）/ `inject`（不唤醒）
//! 三语义正交；`agent/pre-step` waterfall 决定输入准入；`cancel` 保留已交付文本并
//! 记录中断锚点。落地形态：
//!
//! - **统一 inbox**：[`AgentLoop::submit_input`] 是外部输入的唯一入口，按 [`InputKind`]
//!   入队；空闲时按语义决定是否唤醒（`Inject` 恒不唤醒，`FollowUp` / `Steer` 唤醒）。
//! - **pre-step 准入**：`run_react_loop` 每轮请求构建**之前**
//!   （[`AgentLoop::consume_admitted_inputs`]）以 `waterfall` 分发
//!   [`crate::event::OrchestratorEvent::InputAdmission`]——监听器可改写 / 丢弃待准入
//!   输入，不调 `next` 即否决（输入保留到下一轮）；零监听器 = 现状行为。
//! - **取消收口**（[`AgentLoop::finalize_interrupted_turn`]）：中断时把**已交付文本**
//!   （流式已送达前端的增量）落为终稿 + 中断锚点（`meta.interrupted*`），并广播
//!   `AgentInterrupted` 与 `StreamEnd` 收口。

use std::sync::{Arc, Mutex as StdMutex};

use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::event::{AgentEvent, OrchestratorEvent};
use crate::types::{MessageRole, OrchestratorMessage};

use super::{AgentError, AgentLoop};

/// 输入语义（三通道；dsh `followup` / `steer` / `inject` 对齐）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputKind {
    /// 跟进（唤醒）：新任务周期——推入 user 消息并启动 ReAct 循环
    FollowUp,
    /// 中途引导（唤醒，最近一轮消费）：运行中入队，由下一轮请求前的准入注入；
    /// 空闲时等价于跟进（唤醒）
    Steer,
    /// 上下文注入（不唤醒）：只入队，待下一次运行时经准入注入为消息；
    /// 自身永不启动运行
    Inject,
}

impl InputKind {
    /// 稳定字符串（`meta.input_kind` / 日志口径）
    pub fn as_str(self) -> &'static str {
        match self {
            Self::FollowUp => "followup",
            Self::Steer => "steer",
            Self::Inject => "inject",
        }
    }

    /// 该语义是否可唤醒空闲会话（`Inject` 恒否）
    pub fn can_wake(self) -> bool {
        !matches!(self, Self::Inject)
    }
}

/// inbox 条目（提交顺序即消费顺序）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputItem {
    /// 输入语义
    pub kind: InputKind,
    /// 输入文本
    pub text: String,
    /// 提交时点（Unix 毫秒；诊断 / 准入裁决参考）
    pub submitted_at_ms: u64,
    /// 自定义 meta（2026-09-20，批次 C）：随准入写入 user 消息的 `meta`——
    /// 供来源标记（如定时唤醒 `input_kind = "timer"`）与前端专门行呈现。
    /// 键可覆盖/补充内建 `input_kind`（未给则维持语义串）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<std::collections::HashMap<String, serde_json::Value>>,
}

impl InputItem {
    /// 构造条目（提交时点 = 当前时刻）
    pub fn new(kind: InputKind, text: String) -> Self {
        Self {
            kind,
            text,
            submitted_at_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            meta: None,
        }
    }

    /// 附加自定义 meta（链式；来源标记等）
    pub fn with_meta(
        mut self,
        meta: std::collections::HashMap<String, serde_json::Value>,
    ) -> Self {
        if !meta.is_empty() {
            self.meta = Some(meta);
        }
        self
    }
}

/// 组装准入 user 消息的 `meta`（2026-09-20，批次 C·S1 起）
///
/// - 内建键 `input_kind` = 语义串（followup / steer / inject）
/// - 自定义 meta 可**覆盖** `input_kind`（如定时唤醒 → `"timer"`）并补充其余键
pub(super) fn assemble_input_meta(
    kind: InputKind,
    custom: Option<&std::collections::HashMap<String, serde_json::Value>>,
) -> std::collections::HashMap<String, serde_json::Value> {
    let mut meta = std::collections::HashMap::new();
    meta.insert("input_kind".to_string(), serde_json::json!(kind.as_str()));
    if let Some(custom) = custom {
        for (k, v) in custom {
            meta.insert(k.clone(), v.clone());
        }
    }
    meta
}

/// [`AgentLoop::submit_input`] 的处置结果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmitOutcome {
    /// 已入队：运行中（下一轮请求前的准入消费）或 `Inject` 不唤醒
    Queued,
    /// 已唤醒并完成一轮运行（空闲 + `FollowUp`/`Steer`；本调用同步跑完整轮）
    Started,
}

/// 已交付文本记录器（取消收口用）——累积本轮流式正文（用户已看到的增量）
///
/// 订阅本环巴士（`on_any`）：`StreamStart` 清零 → `StreamDelta` 累积 →
/// `StreamEnd` 以权威全文覆盖。`silent`（过程内决策）调用不广播，故天然不计入。
pub(super) struct DeliveredTextRecorder {
    buffer: Arc<StdMutex<String>>,
}

impl DeliveredTextRecorder {
    /// 绑定共享缓冲（AgentLoop 的 `delivered_text` 字段）
    pub(super) fn new(buffer: Arc<StdMutex<String>>) -> Self {
        Self { buffer }
    }
}

impl crate::event_bus::Listener for DeliveredTextRecorder {
    fn call(&self, event: &OrchestratorEvent) -> crate::event_bus::ListenerOutcome {
        if let OrchestratorEvent::Agent(agent_event) = event {
            if let Ok(mut buf) = self.buffer.lock() {
                match agent_event {
                    AgentEvent::StreamStart { .. } | AgentEvent::UserMessage { .. } => {
                        buf.clear();
                    }
                    AgentEvent::StreamDelta { delta } => buf.push_str(delta),
                    AgentEvent::StreamEnd { full_text } => *buf = full_text.clone(),
                    _ => {}
                }
            }
        }
        crate::event_bus::ListenerOutcome::Continue
    }
}

impl AgentLoop {
    /// 提交一条外部输入（A3 唯一入口）——入队 + 按语义决定唤醒
    ///
    /// | 语义 | 运行中 | 空闲 |
    /// |---|---|---|
    /// | `FollowUp` | 入队（等本轮结束后由下一轮准入消费？否——见下）| 唤醒：`run(text)` |
    /// | `Steer` | 入队（下一轮请求前准入注入）| 唤醒：`run(text)` |
    /// | `Inject` | 入队 | 入队（**不唤醒**） |
    ///
    /// `FollowUp` 运行中同样入队：它会在当前轮结束后被下一轮请求的准入消费
    /// （语义上等价于"补一条 user 消息"）。空文本（trim 后）静默 no-op（返回 `Queued`）。
    pub async fn submit_input(
        &self,
        kind: InputKind,
        text: String,
    ) -> Result<SubmitOutcome, AgentError> {
        self.submit_input_with_meta(kind, text, None).await
    }

    /// 提交一条外部输入（带自定义 meta）——批次 C·S1 起：定时唤醒等来源标记
    ///
    /// 与 [`Self::submit_input`] 同语义（入队 + 按语义决定唤醒）；`meta` 随准入写入
    /// user 消息的 `meta`（可覆盖内建 `input_kind`，见 [`assemble_input_meta`]）。
    pub async fn submit_input_with_meta(
        &self,
        kind: InputKind,
        text: String,
        meta: Option<std::collections::HashMap<String, serde_json::Value>>,
    ) -> Result<SubmitOutcome, AgentError> {
        if text.trim().is_empty() {
            debug!("submit_input: 空输入（{:?}），忽略", kind);
            return Ok(SubmitOutcome::Queued);
        }
        {
            let mut inbox = self
                .inbox
                .lock()
                .map_err(|_| AgentError::Other("输入队列锁中毒".into()))?;
            let item = match meta {
                Some(m) => InputItem::new(kind, text).with_meta(m),
                None => InputItem::new(kind, text),
            };
            inbox.push(item);
        }
        if self.is_streaming() || !kind.can_wake() {
            return Ok(SubmitOutcome::Queued);
        }
        // 空闲 + 可唤醒 → 唤醒：取首个可唤醒项作为本轮输入（其前的 Inject 项留给准入注入）
        let Some(wake_text) = self.take_wake_input() else {
            return Ok(SubmitOutcome::Queued);
        };
        debug!("submit_input: 空闲唤醒（{:?}），启动一轮运行", kind);
        self.run(wake_text).await?;
        Ok(SubmitOutcome::Started)
    }

    /// 从 inbox 取出首个可唤醒项（`FollowUp` / `Steer`）；`Inject` 项留在队列等待准入
    fn take_wake_input(&self) -> Option<String> {
        let mut inbox = self.inbox.lock().ok()?;
        let idx = inbox.iter().position(|item| item.kind.can_wake())?;
        Some(inbox.remove(idx).text)
    }

    /// pre-step 输入准入（`run_react_loop` 每轮请求构建之前）——**waterfall 分发**
    ///
    /// 1. 取走 inbox 全部待准入项（空则短路，零开销）
    /// 2. 以 `waterfall` 分发 `InputAdmission`：监听器可改写 `items` / 置空 = 全拒 /
    ///    不调 `next` = 否决本轮（**输入原序放回**，留待下一轮）
    /// 3. 准入项注入 `state.messages`（`meta.input_kind` 标记来源；随本轮的
    ///    `set_messages` 同步进 backend，故**对本次请求生效**）
    pub(super) async fn consume_admitted_inputs(&self, iteration: u32) {
        let pending: Vec<InputItem> = {
            let Ok(mut inbox) = self.inbox.lock() else {
                warn!("输入准入：inbox 锁中毒，跳过本轮");
                return;
            };
            if inbox.is_empty() {
                return;
            }
            inbox.drain(..).collect()
        };

        let mut event = OrchestratorEvent::InputAdmission {
            iteration,
            items: pending.clone(),
        };
        let admitted: StdMutex<Option<Vec<InputItem>>> = StdMutex::new(None);
        let outcome = {
            // 取总线句柄后于**壳锁外**分发（2026-09-17 风险点处置：链内注册/I/O 不阻滞写者）
            let bus = self.event_bus_handle().await;
            bus.waterfall(&mut event, |ev| {
                if let OrchestratorEvent::InputAdmission { items, .. } = ev {
                    if let Ok(mut slot) = admitted.lock() {
                        *slot = Some(items.clone());
                    }
                }
                crate::event_bus::Outcome::Ok
            })
        };

        // 否决：原序放回（不消费、不丢弃）
        if outcome == crate::event_bus::Outcome::Vetoed {
            let count = pending.len();
            if let Ok(mut inbox) = self.inbox.lock() {
                let mut restored = pending;
                restored.extend(inbox.drain(..));
                *inbox = restored;
            }
            debug!("输入准入：本轮被否决，{count} 条输入回退队列");
            return;
        }

        let admitted = admitted.into_inner().unwrap_or(None).unwrap_or_default();
        if admitted.is_empty() {
            debug!(
                "输入准入：{} 条待准入输入被监听器全部丢弃（轮次 {}）",
                pending.len(),
                iteration
            );
            return;
        }

        // 注入为消息（user 角色 + 来源标记；顺序 = 提交顺序）
        {
            let mut state = self.state.lock().await;
            for item in &admitted {
                // 来源标记：内建 input_kind（语义串）+ 自定义 meta 覆盖/补充
                // （批次 C：定时唤醒 → input_kind = "timer"，供前端专门行呈现）
                let meta = assemble_input_meta(item.kind, item.meta.as_ref());
                state.messages.push(OrchestratorMessage {
                    role: MessageRole::User,
                    content: item.text.clone(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: Some(meta),
                });
            }
        }
        debug!(
            "输入准入：{} 条输入已注入（轮次 {}，来源 {:?}）",
            admitted.len(),
            iteration,
            admitted.iter().map(|i| i.kind.as_str()).collect::<Vec<_>>()
        );
    }

    /// 取消收口（中断时调用）：**已交付文本终结 + 中断锚点**
    ///
    /// 1. 读取已交付文本快照（流式已送达前端的增量；空则跳过文本终结）
    /// 2. 文本终结：未落库则以 assistant 消息落 `state.messages`
    ///    （`meta.interrupted*` 即**中断锚点**：原因 / 轮次），并广播 `StreamEnd` 收口；
    ///    已落库（同文本）则只补锚点元数据
    /// 3. 广播 `AgentInterrupted`（活动日志可见；先于 `Error`/`AgentEnd`）
    /// 4. 统一清空已交付缓冲（广播的 `StreamEnd` 会被 [`DeliveredTextRecorder`] 回写，
    ///    故清空放在**广播之后**）——保证重复收口幂等（第二次读到空 → 不重复落消息）
    ///
    /// **重复气泡确认（2026-09-17，真机走查通过 + 前端语义核对）**：前端 `end` 处理器
    /// （`useAgentRust.handleStreamEvent`）**只更新已存在的流式占位**（`streamingAssistant`），
    /// 无占位时仅落一个幂等的 `round_end` 轮次事件、**不新建消息**——故本收口广播
    /// （无论中断发生在流中还是响应完成后）都不会产生重复气泡。
    pub(super) async fn finalize_interrupted_turn(&self, reason: &str, iteration: u32) {
        let delivered = self
            .delivered_text
            .lock()
            .map(|buf| buf.clone())
            .unwrap_or_default();
        let delivered_chars = delivered.chars().count();

        let mut finalized_text = false;
        if !delivered.trim().is_empty() {
            let appended = {
                let mut state = self.state.lock().await;
                let last_is_same = state
                    .messages
                    .last()
                    .map(|m| m.role == MessageRole::Assistant && m.content == delivered)
                    .unwrap_or(false);
                if last_is_same {
                    // 文本已由本轮响应落库 → 仅补中断锚点（元数据）
                    if let Some(last) = state.messages.last_mut() {
                        let meta = last.meta.get_or_insert_with(Default::default);
                        meta.insert("interrupted".to_string(), serde_json::json!(true));
                        meta.insert("interrupted_reason".to_string(), serde_json::json!(reason));
                        meta.insert(
                            "interrupted_iteration".to_string(),
                            serde_json::json!(iteration),
                        );
                    }
                    false
                } else {
                    let mut meta = std::collections::HashMap::new();
                    meta.insert("interrupted".to_string(), serde_json::json!(true));
                    meta.insert("interrupted_reason".to_string(), serde_json::json!(reason));
                    meta.insert(
                        "interrupted_iteration".to_string(),
                        serde_json::json!(iteration),
                    );
                    state.messages.push(OrchestratorMessage {
                        role: MessageRole::Assistant,
                        content: delivered.clone(),
                        tool_calls: Vec::new(),
                        tool_call_id: None,
                        meta: Some(meta),
                    });
                    true
                }
            };
            finalized_text = appended;
            if appended {
                debug!(
                    "取消收口：已交付文本（{} 字）落为终稿（轮次 {}，原因 {}）",
                    delivered_chars, iteration, reason
                );
            }
            // 前端流式气泡收口（文本已在展示中；前端 `end` 只更新已有占位，
            // 无占位时仅落幂等 round_end 事件 → 不会重复气泡）
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::StreamEnd {
                full_text: delivered,
            }))
            .await;
        }

        self.broadcast(OrchestratorEvent::AgentInterrupted {
            reason: reason.to_string(),
            iteration,
            delivered_chars,
        })
        .await;

        // 清空已交付缓冲（收口广播会被 DeliveredTextRecorder 回写 → 清空放广播之后）：
        // 重复收口读到空 → 不重复落消息（幂等）
        if let Ok(mut buf) = self.delivered_text.lock() {
            buf.clear();
        }

        // 未落库的文本应在下一步可见于 backend（state 已改；下一次 set_messages 会同步）
        if finalized_text {
            debug!("取消收口：终稿已入 state（backend 由下一次请求同步）");
        }
    }

    /// 已交付文本快照（诊断 / 测试用）
    pub fn delivered_text_snapshot(&self) -> String {
        self.delivered_text
            .lock()
            .map(|buf| buf.clone())
            .unwrap_or_default()
    }
}

// ─── 测试 ───────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// 批次 C·S1（2026-09-20）：准入 meta 组装——内建 input_kind + 自定义覆盖/补充
    #[test]
    fn assemble_input_meta_merges_custom_overrides() {
        // 无自定义：内建语义串
        let m = assemble_input_meta(InputKind::FollowUp, None);
        assert_eq!(m.get("input_kind").unwrap(), "followup");
        assert_eq!(m.len(), 1);
        // 自定义覆盖 input_kind（定时唤醒）+ 补充其余键
        let mut custom = std::collections::HashMap::new();
        custom.insert("input_kind".to_string(), serde_json::json!("timer"));
        custom.insert("timer_id".to_string(), serde_json::json!("t-1"));
        let m = assemble_input_meta(InputKind::FollowUp, Some(&custom));
        assert_eq!(m.get("input_kind").unwrap(), "timer", "自定义应覆盖语义串");
        assert_eq!(m.get("timer_id").unwrap(), "t-1");
        // InputItem 链式附加
        let item = InputItem::new(InputKind::FollowUp, "正文".into()).with_meta(custom);
        assert_eq!(item.meta.as_ref().unwrap().len(), 2);
    }

    /// 三语义的唤醒判定（`Inject` 恒不可唤醒；繁简标签稳定）
    #[test]
    fn input_kind_semantics() {
        assert!(InputKind::FollowUp.can_wake());
        assert!(InputKind::Steer.can_wake());
        assert!(!InputKind::Inject.can_wake(), "注入不唤醒");
        assert_eq!(InputKind::FollowUp.as_str(), "followup");
        assert_eq!(InputKind::Steer.as_str(), "steer");
        assert_eq!(InputKind::Inject.as_str(), "inject");
    }

    /// 条目序列化契约（前端 / 事件载荷口径：camelCase + snake_case 作用域）
    #[test]
    fn input_item_serializes_with_contract_shape() {
        let item = InputItem::new(InputKind::Steer, "换个方向".into());
        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["kind"], serde_json::json!("steer"));
        assert_eq!(json["text"], serde_json::json!("换个方向"));
        assert!(json["submittedAtMs"].as_u64().unwrap() > 0);
    }
}