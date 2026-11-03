// SSE 流桥——把页面的 `text/event-stream` 订阅接到管道流 lane 上。
//
// 为什么不能走 worldsea:// 协议：Tauri 自定义协议的应答是**一次性缓冲体**
// （`UriSchemeResponder::respond` 只收 `Into<Cow<'static,[u8]>>`，没有流式写回通道），
// 而 SSE 要求边收边吐。管道流 lane 却能逐项下推，故改由命令 + `Channel` 承载。
//
// 调用链：页面 `__DSH_TRANSPORT__.sse(path, signal)`（`dsh_sse_bridge.js`）→ 本文件两条命令 →
// `PipeClient` 流 lane（端点 `sse:<path>`）→ 宿主 `pipe-transport` 的 `readSseResponse`
// → 合成 req/res → `dispatch` → 真实 SSE 路由按 `data:` 分帧回推。
//
// 端点前缀 `sse:` 是与宿主约定的分流标记：宿主据此把该流交给 SSE 读取器，
// 而非 `typertGateway.wireStream`。前缀缺失或写错会让宿主退回 Gateway 通道并报端点不存在，
// 属可诊断的失败，不会静默降级。

use std::sync::Arc;

use serde_json::json;
use tauri::ipc::Channel;
use tauri::Manager;

use crate::dsh_bridge::DshBridge;
use crate::dsh_pipe::{PipeClient, StreamEvent, StreamSink};

/// 宿主侧 SSE 流端点的分流前缀（与 `pipe-transport.ts` 的 `SSE_ENDPOINT_PREFIX` 同值）。
const SSE_ENDPOINT_PREFIX: &str = "sse:";

/// 取管道客户端：非管道模式（`WORLDSEA_TCP_HOST=1`）时给出可读原因，页面据此显式降级。
fn pipe_of(app: &tauri::AppHandle) -> Result<Arc<PipeClient>, String> {
    let bridge = app
        .try_state::<DshBridge>()
        .ok_or_else(|| "壳桥未装配".to_string())?;
    bridge.pipe().ok_or_else(|| "当前非管道模式，SSE 不可用".to_string())
}

/// 打开一条 SSE 订阅：`channel` 逐条收 `data:` 载荷，返回流 id 供取消使用。
///
/// 页面侧拿到的是字符串数组的首项即一条事件，顺序与到达顺序一致；流结束时
/// `channel` 收到 `{ "type": "end" }`，失败时收到带原因的 `{ "type": "error" }`。
#[tauri::command]
pub fn cmd_sse_open(
    app: tauri::AppHandle,
    path: String,
    channel: Channel<serde_json::Value>,
) -> Result<u32, String> {
    let pipe = pipe_of(&app)?;
    // 只接受站内相对路径：绝对 URL 会把流端点指向任意主机（SSRF 面），
    // 且宿主 dispatch 只认文档相对路径。
    if !path.starts_with('/') || path.contains("://") {
        return Err(format!("SSE 路径必须是站内相对路径：{path}"));
    }
    let endpoint = format!("{SSE_ENDPOINT_PREFIX}{path}");
    let sink: StreamSink = std::sync::Arc::new(move |event| {
        let message = match event {
            StreamEvent::Item(value) => json!({ "type": "item", "value": value }),
            StreamEvent::End => json!({ "type": "end" }),
            StreamEvent::Error { kind, code, message, details } => json!({
                "type": "error",
                "failure": { "kind": kind, "code": code, "message": message, "details": details },
            }),
        };
        // 页面已取消或已关窗时发送失败无妨：流生命周期由取消路径收尾
        let _ = channel.send(message);
    });
    let id = pipe.stream_open(&endpoint, serde_json::Value::Null, sink)?;
    println!("[DSH-SHELL] sse: open id={id} path={path}");
    Ok(id)
}

/// 取消一条 SSE 订阅（页面卸载 / 消费方提前退出）。
#[tauri::command]
pub fn cmd_sse_close(app: tauri::AppHandle, id: u32) {
    if let Ok(pipe) = pipe_of(&app) {
        println!("[DSH-SHELL] sse: close id={id}");
        pipe.stream_cancel(id);
    }
}
