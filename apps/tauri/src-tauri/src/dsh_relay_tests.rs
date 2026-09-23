// dsh_relay 的测试（拆出源码文件以满足 arch:check 的 400 行上限；路径含 tests 走 1200 行档）。
// 经 `#[path] mod tests` 挂在 dsh_relay 内，故可直接触达其私有项。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};

use super::*;

const HEAD: &str = "GET /s3cret/api/remote.mux HTTP/1.1\r\n\
Host: 127.0.0.1:55555\r\n\
Upgrade: websocket\r\n\
Connection: Upgrade\r\n\
Sec-WebSocket-Key: abc=\r\n\
Sec-WebSocket-Version: 13\r\n\
Origin: http://worldsea.localhost\r\n\
Cookie: dsh-auth-other=leak\r\n\
Sec-Fetch-Site: cross-site\r\n\
\r\n";

#[test]
fn rewrite_replaces_credential_headers() {
    let out = rewrite_head(HEAD, "GET", "/api/remote.mux", "HTTP/1.1", "127.0.0.1:3080", "dsh-auth-x=v1.a.b");
    // 请求行重写为宿主视角路径
    assert!(out.starts_with("GET /api/remote.mux HTTP/1.1\r\n"));
    // 页面自带的 host/origin/cookie/sec-fetch-site 必须被丢弃
    assert!(!out.contains("worldsea.localhost"));
    assert!(!out.contains("dsh-auth-other=leak"));
    assert!(!out.contains("cross-site"));
    assert!(!out.contains("127.0.0.1:55555"));
    // 壳侧补齐的四项凭据
    assert!(out.contains("Host: 127.0.0.1:3080\r\n"));
    assert!(out.contains("Origin: http://127.0.0.1:3080\r\n"));
    assert!(out.contains("Cookie: dsh-auth-x=v1.a.b\r\n"));
    assert!(out.contains("Sec-Fetch-Site: same-origin\r\n"));
}

#[test]
fn rewrite_keeps_handshake_headers_and_terminates() {
    let out = rewrite_head(HEAD, "GET", "/api/remote.mux", "HTTP/1.1", "127.0.0.1:3080", "c");
    for kept in ["Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Key: abc=", "Sec-WebSocket-Version: 13"] {
        assert!(out.contains(kept), "缺少握手头：{kept}");
    }
    assert!(out.ends_with("\r\n\r\n"));
    // 头部只出现一次 Host（不得重复追加成两个）
    assert_eq!(out.matches("Host:").count(), 1);
}

/// 整链：假上游 + 真中转 + 真客户端，验「握手后隧道不断、双向字节都通」。
/// （修复前此用例报红：上行 0B / 下行 3B + WSAEWOULDBLOCK 10035——Windows accept 继承非阻塞态。）
#[test]
fn relay_keeps_tunnel_alive_and_pipes_bytes() {
    // 假上游：收首部 → 回 101 → 立刻下行一句 → 回显上行一句
    let upstream = TcpListener::bind("127.0.0.1:0").unwrap();
    let upstream_port = upstream.local_addr().unwrap().port();
    let fake = std::thread::spawn(move || {
        let (sock, _) = upstream.accept().unwrap();
        let mut reader = BufReader::new(sock.try_clone().unwrap());
        let head = read_head(&mut reader).unwrap();
        let head_text = String::from_utf8_lossy(&head).to_string();
        {
            let mut w = sock.try_clone().unwrap();
            w.write_all(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: x\r\n\r\n")
                .unwrap();
            w.flush().unwrap();
        }
        {
            let mut w = sock.try_clone().unwrap();
            w.write_all(b"S2C").unwrap();
            w.flush().unwrap();
        }
        let mut buf = [0u8; 32];
        let n = reader.read(&mut buf).unwrap();
        let mut w = sock.try_clone().unwrap();
        w.write_all(&buf[..n]).unwrap();
        w.flush().unwrap();
        (head_text, n)
    });

    let relay = start(upstream_port, "dsh-auth-x=v1.y.z".to_string(), false).unwrap();
    let base = relay.base_url();
    let secret = base.trim_end_matches('/').rsplit('/').next().unwrap().to_string();
    let mut client = TcpStream::connect(("127.0.0.1", relay.port())).unwrap();
    client
        .write_all(
            format!(
                "GET /{secret}/api/remote.mux HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nUpgrade: websocket\r\n\r\n",
                relay.port()
            )
            .as_bytes(),
        )
        .unwrap();
    client.flush().unwrap();
    let mut reader = BufReader::new(client.try_clone().unwrap());
    let resp = read_head(&mut reader).unwrap();
    let resp_text = String::from_utf8_lossy(&resp).to_string();
    assert!(resp_text.starts_with("HTTP/1.1 101"), "响应={resp_text}");

    // 下行：假上游的 S2C 必须原样到达
    let mut buf = [0u8; 16];
    let n = reader.read(&mut buf).expect("下行读取失败（隧道被提前关闭？）");
    assert_eq!(&buf[..n], b"S2C");
    // 上行：客户端字节必须到达上游（并回显）
    client.write_all(b"UP").unwrap();
    client.flush().unwrap();
    let n2 = reader.read(&mut buf).expect("回显读取失败");
    assert_eq!(&buf[..n2], b"UP");

    let (head_text, up_bytes) = fake.join().unwrap();
    assert!(head_text.contains("Cookie: dsh-auth-x=v1.y.z"), "首部={head_text}");
    assert!(head_text.contains(&format!("Host: 127.0.0.1:{upstream_port}")), "首部={head_text}");
    assert_eq!(up_bytes, 2);
}

#[test]
fn relay_rejects_unknown_prefix() {
    let relay = start(1, "c".to_string(), false).unwrap();
    let mut client = TcpStream::connect(("127.0.0.1", relay.port())).unwrap();
    client
        .write_all(b"GET /wrong/api/remote.mux HTTP/1.1\r\nHost: x\r\n\r\n")
        .unwrap();
    client.flush().unwrap();
    let mut reader = BufReader::new(client.try_clone().unwrap());
    let resp = read_head(&mut reader).unwrap();
    assert!(String::from_utf8_lossy(&resp).starts_with("HTTP/1.1 404"));
}

/// 顺带覆盖 read_head 的终止条件（空行即止）。
#[test]
fn read_head_stops_at_blank_line() {
    let mut reader = BufReader::new(&b"GET / HTTP/1.1\r\nA: b\r\n\r\nREST"[..]);
    let head = read_head(&mut reader).unwrap();
    assert_eq!(String::from_utf8_lossy(&head), "GET / HTTP/1.1\r\nA: b\r\n\r\n");
    let mut rest = Vec::new();
    reader.read_to_end(&mut rest).unwrap();
    assert_eq!(&rest, b"REST");
}
