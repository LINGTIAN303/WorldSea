// dsh_pipe 的测试：客户端对帧协议的收发行为（用假宿主走完整 hello/请求/流/断链路径）。
// 上游语义（闸门 / 注入 / 缓存）在 dsh_proxy_tests.rs；真实宿主的端到端在壳外验收脚本。

use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::test_host::{self, Reply, SeenRequest};
use super::*;

fn text_reply(body: &str) -> Reply {
    Reply::Unary {
        status: 200,
        headers: vec![("content-type".to_string(), "text/plain; charset=utf-8".to_string())],
        body: body.as_bytes().to_vec(),
    }
}

/// 起假宿主 + 客户端（hello 已过）。
fn connected(respond: Arc<dyn Fn(&SeenRequest) -> Reply + Send + Sync>) -> (FakeHostHandles, PipeClient) {
    let host = test_host::spawn(respond);
    let handles = FakeHostHandles {
        seen: host.seen.clone(),
        events: host.events.clone(),
        closer: host.closer.try_clone().unwrap(),
    };
    let client = PipeClient::over_streams_for_tests(host.reader, host.writer).expect("客户端握手应成功");
    (handles, client)
}

struct FakeHostHandles {
    seen: Arc<Mutex<Vec<SeenRequest>>>,
    events: Arc<Mutex<Vec<String>>>,
    closer: std::net::TcpStream,
}

#[test]
fn greets_hello_and_performs_a_unary_request() {
    let (handles, client) = connected(Arc::new(|_request| text_reply("pong")));
    let response = client.request("GET", "/assets/x.js", &[("cookie".to_string(), "c=1".to_string())], None).unwrap();
    assert_eq!(response.status, 200);
    assert!(response.headers.iter().any(|(name, value)| name == "content-type" && value.starts_with("text/plain")));
    assert_eq!(String::from_utf8_lossy(&response.body), "pong");
    let seen = handles.seen.lock().unwrap();
    let request = seen.first().expect("假宿主应收到请求");
    assert_eq!(request.method, "GET");
    assert_eq!(request.url, "/assets/x.js");
    assert_eq!(request.headers.get("host").map(String::as_str), Some("127.0.0.1"));
    assert_eq!(request.headers.get("cookie").map(String::as_str), Some("c=1"));
}

#[test]
fn carries_request_body_and_streams_response_chunks() {
    let (handles, client) = connected(Arc::new(|request| {
        if request.body.is_empty() {
            Reply::Streamed {
                status: 200,
                headers: vec![("content-type".to_string(), "text/plain".to_string())],
                chunks: vec![b"a".to_vec(), b"b".to_vec(), b"c".to_vec()],
            }
        } else {
            text_reply(&format!("echo:{}", String::from_utf8_lossy(&request.body)))
        }
    }));
    let response = client.request("POST", "/api/session/create", &[], Some(b"{\"x\":1}")).unwrap();
    assert_eq!(String::from_utf8_lossy(&response.body), "echo:{\"x\":1}");
    assert_eq!(handles.seen.lock().unwrap()[0].body, b"{\"x\":1}");

    let response = client.request("GET", "/plugins/big.js", &[], None).unwrap();
    assert_eq!(response.status, 200);
    // 分块响应按 res-head/res-chunk/res-end 装配成完整体
    assert_eq!(String::from_utf8_lossy(&response.body), "abc");
}

#[test]
fn response_error_frame_fails_the_request_with_its_message() {
    let (_handles, client) = connected(Arc::new(|_request| Reply::Fail { message: "response destroyed".to_string() }));
    let error = client.request("GET", "/assets/x.js", &[], None).unwrap_err();
    assert!(error.contains("response destroyed"), "{error}");
}

#[test]
fn protocol_version_mismatch_is_rejected_loudly() {
    let host = test_host::spawn_with_hello(Arc::new(|_request| text_reply("x")), 2);
    let error = PipeClient::over_streams_for_tests(host.reader, host.writer).unwrap_err();
    assert!(error.contains("版本不符"), "{error}");
}

#[test]
fn stream_lane_routes_downlink_items_uplink_and_end() {
    let (handles, client) = connected(Arc::new(|_request| text_reply("unused")));
    let (tx, rx) = mpsc::channel::<StreamEvent>();
    let sink: StreamSink = Arc::new(move |event| { let _ = tx.send(event); });
    let id = client
        .stream_open("echo", serde_json::json!({ "items": [1, "two"] }), sink)
        .unwrap();
    let events: Vec<StreamEvent> = (0..2).filter_map(|_| rx.recv_timeout(Duration::from_secs(5)).ok()).collect();
    assert!(matches!(events[0], StreamEvent::Item(ref v) if *v == serde_json::json!(1)));
    assert!(matches!(events[1], StreamEvent::Item(ref v) if *v == serde_json::json!("two")));
    let terminal = rx.recv_timeout(Duration::from_secs(5)).expect("应有终态");
    assert!(matches!(terminal, StreamEvent::End));

    client.stream_send(id, serde_json::json!({ "k": "v" })).unwrap();
    client.stream_end(id).unwrap();
    // 上行是异步字节：等到两件事都到达假宿主再断言
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let events = handles.events.lock().unwrap().clone();
        if events.iter().any(|event| event.starts_with(&format!("uplink:{id}:")))
            && events.contains(&format!("uplink-end:{id}"))
        {
            assert!(events.contains(&format!("open:{id}")), "{events:?}");
            assert!(events.iter().any(|event| event.contains("\"k\":\"v\"")), "{events:?}");
            break;
        }
        assert!(std::time::Instant::now() < deadline, "上行事件未在限时内到达：{events:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn stream_failure_carries_the_remote_failure_fields() {
    let (_handles, client) = connected(Arc::new(|_request| text_reply("unused")));
    let (tx, rx) = mpsc::channel::<StreamEvent>();
    let sink: StreamSink = Arc::new(move |event| { let _ = tx.send(event); });
    client.stream_open("fail", serde_json::json!({ "fail": true }), sink).unwrap();
    match rx.recv_timeout(Duration::from_secs(5)).expect("应有失败事件") {
        StreamEvent::Error { kind, code, message, .. } => {
            assert_eq!(kind, "remote");
            assert_eq!(code.as_deref(), Some("gateway/protocol"));
            assert_eq!(message, "boom");
        }
        other => panic!("期望 Error，得到 {other:?}"),
    }
}

#[test]
fn stream_cancel_sends_abort_to_the_host() {
    let (handles, client) = connected(Arc::new(|_request| text_reply("unused")));
    let sink: StreamSink = Arc::new(|_event| {});
    let id = client.stream_open("never", serde_json::json!({ "never": true }), sink).unwrap();
    client.stream_cancel(id);
    // abort 是异步字节：等它到达假宿主
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        if handles.events.lock().unwrap().contains(&format!("abort:{id}")) {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "abort 未在限时内到达");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn broken_pipe_fails_pending_requests_and_streams_explicitly() {
    let (handles, client) = connected(Arc::new(|_request| Reply::Unary {
        status: 200,
        headers: Vec::new(),
        body: Vec::new(),
    }));
    let (tx, rx) = mpsc::channel::<StreamEvent>();
    let sink: StreamSink = Arc::new(move |event| { let _ = tx.send(event); });
    client.stream_open("never", serde_json::json!({ "never": true }), sink).unwrap();

    // 宿主侧断开 → 流显式收 carrier 错、后续请求显式报错（都不静默挂起）
    let _ = handles.closer.shutdown(std::net::Shutdown::Both);
    match rx.recv_timeout(Duration::from_secs(5)).expect("应有载体故障事件") {
        StreamEvent::Error { kind, .. } => assert_eq!(kind, "carrier"),
        other => panic!("期望 carrier Error，得到 {other:?}"),
    }
    let error = client.request("GET", "/", &[], None).unwrap_err();
    assert!(error.contains("断开") || error.contains("未就绪"), "{error}");
}

/// 手动探针（`cargo test -- --ignored --nocapture`）：对活着的宿主管道做一次 hello + 303 交换。
/// 输入走文件（避免 shell 层对反斜杠/环境变量的转换歧义）：
/// `/tmp/worldsea-pipe-probe.txt` 两行 = 管道路径、就绪行 token。
#[test]
#[ignore = "手动探针：需要活着的宿主管道与 token（文件驱动）"]
fn probe_live_pipe_exchange() {
    let probe_file = std::env::var("WORLDSEA_PIPE_PROBE_FILE")
        .unwrap_or_else(|_| "D:/WorldSea/.workbuddy/c2b-pipe-path.txt".to_string());
    let content = std::fs::read_to_string(&probe_file).expect("读探针文件失败");
    let mut lines = content.lines();
    let path = lines.next().expect("探针文件第一行应是管道路径").trim().to_string();
    let token = lines.next().expect("探针文件第二行应是 token").trim().to_string();
    println!("[probe] path-bytes={:?}", path.as_bytes());
    let client = PipeClient::connect(&path).expect("拨号 + hello 应成功");
    println!("[probe] connected, alive={}", client.is_alive());
    let response = client
        .request("GET", &format!("/?token={token}"), &[], None)
        .expect("交换请求应成功");
    println!(
        "[probe] status={} headers={:?} bodyLen={}",
        response.status,
        response.headers,
        response.body.len()
    );
    assert_eq!(response.status, 303);
}

/// 手动原始 IO 探针（排障用）：绕开客户端，直接用 std 文件 IO 在同一条句柄上读 hello、写 req、读响应。
/// 目的：判定「写不达宿主」是 std 命名管道语义问题还是客户端封装问题。
#[test]
#[ignore = "手动探针：需要活着的宿主管道与 token（文件驱动）"]
fn probe_raw_std_io() {
    use std::io::{Read, Write};
    let content = std::fs::read_to_string("D:/WorldSea/.workbuddy/c2b-pipe-path.txt").unwrap();
    let mut lines = content.lines();
    let path = lines.next().unwrap().trim().to_string();
    let token = lines.next().unwrap().trim().to_string();
    let mut handle = std::fs::OpenOptions::new().read(true).write(true).open(&path).expect("打开管道");
    // 读 hello 帧
    let mut header = [0u8; 5];
    handle.read_exact(&mut header).expect("读 hello 头");
    let len = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
    let mut payload = vec![0u8; len];
    handle.read_exact(&mut payload).expect("读 hello 体");
    println!("[raw] hello: {}", String::from_utf8_lossy(&payload));
    // 写 req 帧（与客户端同形）
    let frame = format!(
        "{{\"t\":\"req\",\"id\":1,\"method\":\"GET\",\"url\":\"/?token={token}\",\"headers\":{{\"host\":\"127.0.0.1\"}}}}"
    );
    let mut out = Vec::new();
    out.extend_from_slice(&(frame.len() as u32).to_be_bytes());
    out.push(0x4a);
    out.extend_from_slice(frame.as_bytes());
    println!("[raw] writing {} bytes", out.len());
    handle.write_all(&out).expect("写 req");
    let _ = handle.flush();
    println!("[raw] write returned");
    // 读响应帧
    handle.read_exact(&mut header).expect("读响应头");
    let len = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
    let mut payload = vec![0u8; len];
    handle.read_exact(&mut payload).expect("读响应体");
    println!("[raw] response: {}", String::from_utf8_lossy(&payload));
}
