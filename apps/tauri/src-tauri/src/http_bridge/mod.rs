//! [HTTP-BRIDGE] 临时模块：axum HTTP 服务（浏览器直连真实后端的入口）
//!
//! - `POST /rpc`：JSON `{ cmd, args }` → 分发到 rpc::Registry 调用真实 Tauri 命令，返回 `{ ok, result | error }`
//! - `GET  /events`：SSE 流，推送全局事件广播 hub 的全部事件（`{ name, payload }`），前端按事件名过滤
//! - CORS：permissive（仅本地回环 127.0.0.1，跨端口 dev 调试用）
//! 移除：删除本文件 + events.rs + rpc.rs，还原 Cargo.toml 依赖与 lib.rs 标记处。
pub mod events;
pub mod rpc;

use std::sync::Arc;
use axum::{
    Json, Router,
    extract::State as AxState,
    response::{IntoResponse, Response, sse::{Event, Sse, KeepAlive}},
    routing::{get, post},
};
use serde_json::{Value, json};
use tauri::AppHandle;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct BridgeState {
    pub app: AppHandle,
    pub reg: Arc<rpc::Registry>,
}

/// `POST /rpc { cmd, args }` → `{ ok: true, result } | { ok: false, error }`
async fn rpc_handler(
    AxState(bs): AxState<BridgeState>,
    Json(req): Json<Value>,
) -> Response {
    let cmd = req.get("cmd").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let args = req.get("args").cloned().unwrap_or(Value::Null);
    match bs.reg.get(&cmd) {
        Some(h) => match h(bs.app.clone(), args).await {
            Ok(v) => Json(json!({ "ok": true, "result": v })).into_response(),
            Err(e) => Json(json!({ "ok": false, "error": e })).into_response(),
        },
        None => {
            let msg = rpc::desktop_only(&cmd);
            Json(json!({ "ok": false, "error": msg })).into_response()
        }
    }
}

/// `GET /events`：SSE 流（事件名 → `{ name, payload }`）
async fn sse_handler(AxState(_bs): AxState<BridgeState>) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    use tokio_stream::StreamExt;
    let stream = tokio_stream::wrappers::BroadcastStream::new(events::subscribe())
        .filter_map(|r| {
            r.ok().and_then(|(name, payload)| {
                Event::default()
                    .event("message")
                    .json_data(json!({ "name": name, "payload": payload }))
                    .ok()
            })
        })
        .map(Ok);
    Sse::new(stream).keep_alive(KeepAlive::new())
}

/// 在独立线程 + 独立 tokio 运行时启动 HTTP 服务（不干扰 Tauri 主运行时）
pub fn spawn(app: AppHandle, reg: Arc<rpc::Registry>, port: u16) {
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(e) => {
                eprintln!("[HTTP-BRIDGE] 创建运行时失败: {e}");
                return;
            }
        };
        rt.block_on(async move {
            let state = BridgeState { app: app.clone(), reg };
            let router = Router::new()
                .route("/rpc", post(rpc_handler))
                .route("/events", get(sse_handler))
                .layer(CorsLayer::permissive())
                .with_state(state);
            let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("[HTTP-BRIDGE] 绑定 127.0.0.1:{port} 失败: {e}");
                    return;
                }
            };
            eprintln!("[HTTP-BRIDGE] HTTP 服务已启动 http://127.0.0.1:{port} (rpc/events)");
            if let Err(e) = axum::serve(listener, router).await {
                eprintln!("[HTTP-BRIDGE] 服务退出: {e}");
            }
        });
    });
}
