// host 侧发起能力调用（**路径 A**，2026-11-17）。
//
// 修的病：能力桥两端都建好了——Rust 侧有注册表 / ACL / 超时 / 回执认领，提供方窗有
// `__WORLDSEA_CAPABILITY_CALL__` 伺服——但 **Agent 的工具跑在 dsh 的 host 进程**（Node），
// 它既没有通往 webview 的 IPC 通道，也没有窗口身份（ACL 按窗口 label 判）。
// 于是 `cmd_capability_invoke` 全仓零调用点：桥建好了，但没人能从 Agent 侧打。
//
// 链路（四段，每段都有既有机制，本模块只补第一段的接线）：
//   dsh 插件工具 `world_capability`
//     → host 的 fetch 打壳的 loopback 端点（`capability_host_call.rs`）
//     → Rust 校验令牌后调本模块的 `invoke_from_host`
//     → emit `worldsea:capability-call` 给主窗（`main`，它有 ACL 身份）
//     → 主窗注入脚本执行 `cmd_capability_invoke` → 提供方窗（工作台）执行 → 回执
//
// 为什么绕「主窗代发」这一圈：`check_acl` 拿的是**窗口 label**，host 进程没有 label。
// 主窗本来就在 `PROVIDERS` 里、且 `worldsea-shell.toml` 两窗共用，由它代发既过 ACL
// 又符合语义——动作的意图方本来就是 Agent 面。

use serde_json::Value;

use crate::capabilities::{complete, find, next_call_id, park_pending, spawn_timeout, CALL_TIMEOUT, PROVIDERS};

/// host 侧请求一次能力调用的**事件名**（Rust → 主窗注入脚本）。
pub const HOST_CALL_EVENT: &str = "worldsea:capability-call";

/// 由 host 发起的调用（供 `capability_host_call` 的端点处理函数调）。
///
/// 与 `cmd_capability_invoke` 的差异只有一处：`caller` 不是从窗口取，而是显式传入。
/// 其余（登记查找、ACL 校验、派发、超时、回执认领）全部复用同一套实现。
pub async fn invoke_from_host(
    app: &tauri::AppHandle,
    caller: &str,
    id: &str,
    args: Option<Value>,
) -> Result<Value, String> {
    if !PROVIDERS.contains(&caller) {
        return Err(format!(
            "CAPABILITY_FORBIDDEN: 未知发起方窗口 {caller}（可用：{}）",
            PROVIDERS.join(" / ")
        ));
    }
    // 前置校验：不通过就不必惊动主窗（也给出比超时更准确的错误）
    let record = find(id).ok_or_else(|| {
        format!("CAPABILITY_UNKNOWN: 能力未登记（{id}）——提供方窗口未就绪或未登记该能力")
    })?;
    crate::capabilities::check_acl(&record, caller)?;

    use tauri::Emitter;
    let call_id = next_call_id(id);
    let rx = park_pending(&call_id, &record.provider);
    spawn_timeout(call_id.clone(), record.provider.clone(), CALL_TIMEOUT);

    let payload = serde_json::json!({
        "callId": call_id,
        "id": id,
        "args": args.unwrap_or(Value::Null),
    });
    if let Err(error) = app.emit_to(caller, HOST_CALL_EVENT, payload) {
        let message = format!("CAPABILITY_UNAVAILABLE: 事件派发到 {caller} 失败：{error}");
        let _ = complete(&call_id, &record.provider, Err(message.clone()));
        return Err(message);
    }

    match rx.await {
        Ok(Ok(value)) => {
            println!("[WORLDSEA-CAP] host 调用：{caller} → {}::{id} ok", record.provider);
            Ok(value)
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err(format!(
            "CAPABILITY_UNAVAILABLE: 提供方 {} 的回执通道中断（窗口关闭？）",
            record.provider
        )),
    }
}

/// 命令：**host 侧**发起能力调用（Tauri 命令形态）。
///
/// 不在任何 ACL 白名单里——页面无从调起；只有 Rust 内部（`capability_host_call` 的
/// 端点线程）能触达。保留命令形态是为了让它出现在 `generate_handler!` 里可被单测覆盖，
/// 也让 `tauri::test` 一类工具能直接驱动。
#[tauri::command]
pub async fn cmd_capability_invoke_from_host(
    app: tauri::AppHandle,
    id: String,
    args: Option<Value>,
    caller: Option<String>,
) -> Result<Value, String> {
    let caller = caller.unwrap_or_else(|| "main".to_string());
    invoke_from_host(&app, &caller, &id, args).await
}
