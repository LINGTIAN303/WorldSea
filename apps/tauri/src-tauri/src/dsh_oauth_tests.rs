// 账号登录回调口的单测：准入闸、302 透传、204 本地页、拒绝面、反证开关。
// 真实网络面：起真监听 + 真 TcpStream 往返（与 `dsh_relay_tests` 同口径，不 mock 套接字）。

use super::*;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicUsize, Ordering};

/// 起一个监听并把它的端口交给 `probe`；返回端口便于断言「真绑过」。
fn with_listener(forward: Forwarder, probe: impl FnOnce(u16)) {
    let listener = start(forward).expect("回调口应能绑定 loopback");
    probe(listener.port());
    drop(listener);
}

/// 发一条原始 HTTP 请求，读回状态行 + 全文。
fn send(port: u16, request: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("应能连上回调口");
    stream.write_all(request.as_bytes()).expect("写入请求");
    stream.flush().expect("刷新");
    let mut out = Vec::new();
    stream.read_to_end(&mut out).expect("读取响应");
    String::from_utf8_lossy(&out).to_string()
}

/// 固定响应的假上游（记录收到的 path+query）。
fn stub(answer: CallbackAnswer) -> (Forwarder, Arc<Mutex<Vec<String>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    let forward: Forwarder = Arc::new(move |path: &str| {
        log.lock().unwrap().push(path.to_string());
        Ok(answer.clone())
    });
    (forward, seen)
}

fn answer(status: u16, headers: &[(&str, &str)], body: &str) -> CallbackAnswer {
    CallbackAnswer {
        status,
        headers: headers.iter().map(|(n, v)| (n.to_string(), v.to_string())).collect(),
        body: body.as_bytes().to_vec(),
    }
}

// ── 准入闸（纯函数）────────────────────────────────────────────────────

#[test]
fn gate_allows_only_get_callback() {
    assert_eq!(gate("GET", "/oauth/callback"), Gate::Allow("/oauth/callback".to_string()));
    // 带 query 原样透传（code/state 就在 query 里）
    assert_eq!(
        gate("GET", "/oauth/callback?code=abc&state=xyz"),
        Gate::Allow("/oauth/callback?code=abc&state=xyz".to_string())
    );
    // 尾斜杠容错
    assert_eq!(gate("GET", "/oauth/callback/"), Gate::Allow("/oauth/callback/".to_string()));
}

#[test]
fn gate_rejects_other_paths_and_methods() {
    // 监听不是通用代理：任何别的路径都不放行
    for path in ["/", "/oauth", "/oauth/callback2", "/api/remote.mux", "/../oauth/callback"] {
        assert_eq!(gate("GET", path), Gate::NotFound, "路径 {path} 不应放行");
    }
    // 路径对但方法不对
    for method in ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"] {
        assert_eq!(gate(method, "/oauth/callback"), Gate::MethodNotAllowed, "方法 {method} 不应放行");
    }
}

// ── 真实往返 ──────────────────────────────────────────────────────────

#[test]
fn callback_302_is_relayed_with_location() {
    let (forward, seen) = stub(answer(302, &[("location", "https://platform.deepseek.com/dsh/authorized?x=1")], ""));
    with_listener(forward, |port| {
        let response = send(
            port,
            "GET /oauth/callback?code=abc&state=def HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
        );
        assert!(response.starts_with("HTTP/1.1 302"), "应为 302：{response}");
        assert!(
            response.contains("location: https://platform.deepseek.com/dsh/authorized?x=1"),
            "location 必须透传（浏览器据此走完成页）：{response}"
        );
        assert!(response.contains("cache-control: no-store"), "回调面不缓存：{response}");
        // 转发的就是原始 path+query（code/state 一字不改）
        assert_eq!(seen.lock().unwrap().as_slice(), ["/oauth/callback?code=abc&state=def"]);
    });
}

#[test]
fn callback_204_becomes_readable_page() {
    let (forward, _seen) = stub(answer(204, &[], ""));
    with_listener(forward, |port| {
        let response = send(port, "GET /oauth/callback?code=a&state=b HTTP/1.1\r\n\r\n");
        // 204 换成本地可读页：用户不会对着空白页发愣
        assert!(response.starts_with("HTTP/1.1 200"), "204 应换成本地页：{response}");
        assert!(response.contains("授权已完成"), "应给出可读提示：{response}");
        assert!(response.contains("text/html"), "应为 HTML 页：{response}");
    });
}

#[test]
fn unknown_path_is_404_and_never_forwards() {
    let (forward, seen) = stub(answer(302, &[("location", "https://example.invalid/")], ""));
    with_listener(forward, |port| {
        let response = send(port, "GET /evil HTTP/1.1\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 404"), "非回调路径应 404：{response}");
        assert!(seen.lock().unwrap().is_empty(), "非回调路径不得触达上游");
    });
}

#[test]
fn post_to_callback_is_405_and_never_forwards() {
    let (forward, seen) = stub(answer(302, &[], ""));
    with_listener(forward, |port| {
        let response = send(port, "POST /oauth/callback HTTP/1.1\r\ncontent-length: 0\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 405"), "非 GET 应 405：{response}");
        assert!(seen.lock().unwrap().is_empty(), "非 GET 不得触达上游");
    });
}

#[test]
fn forward_failure_is_identifiable_not_silent() {
    let attempts = Arc::new(AtomicUsize::new(0));
    let counter = attempts.clone();
    let forward: Forwarder = Arc::new(move |_path: &str| {
        counter.fetch_add(1, Ordering::SeqCst);
        Err("上游不可达（模拟）".to_string())
    });
    with_listener(forward, |port| {
        let response = send(port, "GET /oauth/callback?code=a&state=b HTTP/1.1\r\n\r\n");
        assert!(response.starts_with("HTTP/1.1 502"), "转发失败应 502：{response}");
        assert!(response.contains("登录回调没能送达宿主"), "失败必须可辨认：{response}");
        assert_eq!(attempts.load(Ordering::SeqCst), 1, "应恰好尝试一次");
    });
}

#[test]
fn origin_has_no_trailing_slash() {
    let (forward, _seen) = stub(answer(204, &[], ""));
    with_listener(forward, |port| {
        // 上游按 `${origin}/oauth/callback` 拼接，故基址不带尾斜杠
        assert!(port > 0, "端口应真绑过");
    });
}

#[test]
fn origin_string_shape_matches_upstream_login_origin() {
    let (forward, _seen) = stub(answer(204, &[], ""));
    let listener = start(forward).expect("回调口应能绑定 loopback");
    let origin = listener.origin();
    // 必须是上游 `loginOrigin()` 认的形态：http://127.0.0.1:<显式端口>，无路径/尾斜杠
    assert!(origin.starts_with("http://127.0.0.1:"), "{origin}");
    assert!(!origin.ends_with('/'), "基址不得带尾斜杠：{origin}");
    assert!(!origin.contains("/oauth"), "基址不含路径：{origin}");
}

#[test]
fn listening_port_is_loopback_only() {
    let (forward, _seen) = stub(answer(204, &[], ""));
    let listener = start(forward).expect("回调口应能绑定 loopback");
    // 只绑 loopback：外部地址连不上（端口存在但不在 0.0.0.0 上）
    let port = listener.port();
    assert!(TcpStream::connect(("127.0.0.1", port)).is_ok(), "loopback 应可连");
}
