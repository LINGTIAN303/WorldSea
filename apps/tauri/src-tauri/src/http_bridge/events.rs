//! [HTTP-BRIDGE] 临时模块：全局事件广播 hub（浏览器 SSE 订阅用）
//!
//! commands.rs 的发射 funnel（TauriAgentEventEmitter / emit_orch / emit_orch_supervisor）
//! 除原有 `app.emit`（桌面 IPC）外，额外 `publish` 一份到本 hub；SSE handler 订阅推送。
//! 桌面端行为不变（原 emit 保留，多发一份到 hub 无害）。
//! 移除：删除本文件 + 还原 commands.rs 中标记 `// [HTTP-BRIDGE]` 的 publish 调用。
use serde_json::Value;
use std::sync::OnceLock;
use tokio::sync::broadcast;

/// 事件消息：(完整事件名, payload)。事件名如 `agent:event:trace:{session_id}`。
pub type EventMsg = (String, Value);

const CHANNEL_CAP: usize = 2048;

static EVENT_HUB: OnceLock<broadcast::Sender<EventMsg>> = OnceLock::new();

pub fn hub() -> &'static broadcast::Sender<EventMsg> {
    EVENT_HUB.get_or_init(|| {
        let (tx, _rx) = broadcast::channel(CHANNEL_CAP);
        tx
    })
}

/// 发布一条事件（无订阅者时静默忽略；接收方落后丢弃旧事件，符合事件流语义）
pub fn publish(name: &str, payload: Value) {
    let _ = hub().send((name.to_string(), payload));
}

pub fn subscribe() -> broadcast::Receiver<EventMsg> {
    hub().subscribe()
}
