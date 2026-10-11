// C2-b（2026-09-24）：页面流桥——把页面的 `openStream` 钩子接到管道上的 mux 流。
//
// 调用链：页面 `__DSH_TRANSPORT__.openStream(...)`（`dsh_stream_bridge.js`）→ 这里四条命令 →
// `PipeClient` 的流 lane → 宿主 `pipe-transport` 的 `stream-open` → `typertGateway.wireStream.open`。
// 下行经 Tauri `Channel` 推送（与 @tauri-apps/api 的 Channel 同构：JS 侧给 `__CHANNEL__:<id>` 字符串）。
// 反证开关：`WORLDSEA_NO_TRANSPORT_INJECT=1` 时不注入页面钩子 → 页面退到 WS（无监听可连）→ 流面显式降级。

use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::Manager;

use crate::dsh_bridge::DshBridge;
use crate::dsh_pipe::{StreamEvent, StreamSink};

/// 取管道客户端（非管道模式给出可读原因，页面侧按 carrier 失败显式降级）。
fn pipe_of(app: &tauri::AppHandle) -> Result<std::sync::Arc<crate::dsh_pipe::PipeClient>, String> {
    let bridge = app
        .try_state::<DshBridge>()
        .ok_or_else(|| "壳桥未装配".to_string())?;
    bridge
        .pipe()
        .ok_or_else(|| "当前非管道模式（WORLDSEA_TCP_HOST=1？）".to_string())
}

/// 打开一条逻辑流：`channel` 收下行（item / end / error），返回流 id 供上行与取消使用。
#[tauri::command]
pub fn cmd_stream_open(
    app: tauri::AppHandle,
    endpoint: String,
    payload: Value,
    channel: Channel<Value>,
) -> Result<u32, String> {
    let pipe = pipe_of(&app)?;
    let sink: StreamSink = std::sync::Arc::new(move |event| {
        let message = match event {
            StreamEvent::Item(value) => json!({ "type": "item", "value": value }),
            StreamEvent::End => json!({ "type": "end" }),
            StreamEvent::Error { kind, code, message, details } => json!({
                "type": "error",
                "failure": { "kind": kind, "code": code, "message": message, "details": details },
            }),
        };
        // 页面侧已取消/已关窗时发送失败无妨：流生命周期由取消路径收尾
        let _ = channel.send(message);
    });
    let id = pipe.stream_open(&endpoint, payload, sink)?;
    println!("[DSH-SHELL] stream: open id={id} endpoint={endpoint}（经管道 mux）");
    Ok(id)
}

/// 流上行一项（页面 → 宿主方法）。
#[tauri::command]
pub fn cmd_stream_send(app: tauri::AppHandle, id: u32, value: Value) -> Result<(), String> {
    pipe_of(&app)?.stream_send(id, value)
}

/// 流上行半关。
#[tauri::command]
pub fn cmd_stream_end(app: tauri::AppHandle, id: u32) -> Result<(), String> {
    pipe_of(&app)?.stream_end(id)
}

/// 取消一条流（消费方提前退出 / AbortSignal）。
#[tauri::command]
pub fn cmd_stream_cancel(app: tauri::AppHandle, id: u32) {
    if let Ok(pipe) = pipe_of(&app) {
        println!("[DSH-SHELL] stream: cancel id={id}");
        pipe.stream_cancel(id);
    }
}
