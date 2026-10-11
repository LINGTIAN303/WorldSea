// dsh_bridge 的测试（桥侧：就绪 URL 解析、导航目标形态）。转发语义的测试在 dsh_proxy_tests.rs。

use super::*;

#[test]
fn port_parsed_from_ready_url() {
    assert_eq!(parse_port("http://127.0.0.1:3080/?token=abc").unwrap(), 3080);
    assert_eq!(parse_port("http://127.0.0.1:65535/?token=").unwrap(), 65535);
    assert!(parse_port("http://localhost:1/?token=x").is_err());
}

#[test]
fn app_url_uses_localhost_authority() {
    // C1-a 事实 9：wry 在 Windows 把 `worldsea://<authority>/` 落成 `http://worldsea.<authority>/`，
    // authority 必须是 localhost（写 `app` 会落到真实 TLD worldsea.app；非安全上下文 + HSTS）。
    assert!(APP_URL.starts_with("http://worldsea.localhost/"), "{APP_URL}");
    assert!(!APP_URL.contains("token"), "导航 URL 不得携带 token：{APP_URL}");
}
