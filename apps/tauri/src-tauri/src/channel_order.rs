// F4（2026-09-30）：Channel 投递全序修复——Tauri Channel 双路径乱序的根治。
//
// 背景（真机取证；证据链见 `.workbuddy/memory/2026-09-30.md` §十六 与项目记忆
// `worldsea-channel-order-facts`）：Tauri Channel 对 <8192B 的 JSON 走同步 `webview.eval`
// （有序），对 ≥8192B 走异步 `plugin:__TAURI_CHANNEL__|fetch`（`invoke(...).then(runCallback)`）——
// 两条路径混用时**不保序**：长会话的 428KB 开局快照会被紧随其后的 240B 流式小帧超车。
// dsh 客户端流协议要求全序（assistant 帧 revision 连续）；乱序触发其流拆毁修复，修复流又撞上
// 「快照 vs 实时帧」竞态 → 会话事件流终止（`session assistant stream skipped revision 1`）→
// 前端冻结（后台照常；切会话/刷新才「接上」）。
//
// 修法：装官方扩展点 `Builder::channel_interceptor`，让**全部** JSON 消息走与 Tauri 小载荷分支
// 同形的同步 eval 直投；Raw 交回默认（本壳未用 Raw 通道）。代价：大消息（快照级，每流一次）不再
// 享受异步 fetch —— 实测反而更快（同窗口 fetch 比 eval 迟 ~27ms）；正常小帧路径零改动。
//
// 反证开关：`WORLDSEA_NO_CHANNEL_ORDER_FIX=1` → 不接管（交回默认双路径；
// 「流式进行中刷新页面」确定性复现应再红）。

use std::sync::OnceLock;

use tauri::ipc::{CallbackFn, InvokeResponseBody};
use tauri::{Runtime, Webview};

/// 反证开关（进程内只读一次）。
fn disabled() -> bool {
    static DISABLED: OnceLock<bool> = OnceLock::new();
    *DISABLED.get_or_init(|| std::env::var_os("WORLDSEA_NO_CHANNEL_ORDER_FIX").is_some())
}

/// 有序直投脚本（与 Tauri 小载荷分支 `{ message, index }` 同形）。
/// U+2028/U+2029 转义：JSON 字符串内合法、JS 源码里是行终止符——不转义会破坏脚本。
pub(crate) fn direct_js(callback_id: u32, index: usize, json: &str) -> String {
    let escaped = json.replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029");
    format!(
        "window.__TAURI_INTERNALS__.runCallback({callback_id}, {{ message: {escaped}, index: {index} }})"
    )
}

/// 拦截器：接管 Json 体（返回 true = 已消费）；Raw 与反证模式交回默认（false）。
pub(crate) fn interceptor<R: Runtime>(
    webview: &Webview<R>,
    callback: CallbackFn,
    index: usize,
    body: &InvokeResponseBody,
) -> bool {
    if disabled() {
        return false;
    }
    match body {
        InvokeResponseBody::Json(json) => {
            if let Err(error) = webview.eval(direct_js(callback.0, index, json)) {
                eprintln!("[DSH-SHELL] channel: eval 直投失败：{error}");
            }
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 形状锁定：与 Tauri 默认小载荷分支逐字同形（页面的 Channel 回调据此取 `event.message`）。
    #[test]
    fn direct_js_matches_the_default_shape() {
        let js = direct_js(7, 3, r#"{"type":"item","value":42}"#);
        assert_eq!(
            js,
            r#"window.__TAURI_INTERNALS__.runCallback(7, { message: {"type":"item","value":42}, index: 3 })"#
        );
    }

    /// JS 行终止符必须转义（否则脚本被截断）——JSON 允许原文，JS 源码不允许。
    #[test]
    fn direct_js_escapes_js_line_separators() {
        let js = direct_js(1, 0, "{\"t\":\"\u{2028}\u{2029}\"}");
        assert!(!js.contains('\u{2028}') && !js.contains('\u{2029}'));
        assert!(js.contains("\\u2028") && js.contains("\\u2029"));
    }
}
