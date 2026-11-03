// 测试基建：假管道宿主——按宿主 `pipe-transport` 帧协议应答的最小实现（TCP 回环对充当哑通道）。
// 供 dsh_pipe_tests（客户端行为）与 dsh_proxy_tests（管道上游的转发语义）复用；只列断言需要的事实。

use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

use serde_json::{json, Map, Value};

const KIND_JSON: u8 = 0x4a;
const KIND_BINARY: u8 = 0x42;

/// 宿主收到的请求配方（断言用）。
#[derive(Debug, Clone)]
pub(crate) struct SeenRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

/// 假宿主的应答。
pub(crate) enum Reply {
    /// 一元响应（体可空）。
    Unary { status: u16, headers: Vec<(String, String)>, body: Vec<u8> },
    /// 流式响应（res-head + 分块 + res-end）。
    Streamed { status: u16, headers: Vec<(String, String)>, chunks: Vec<Vec<u8>> },
    /// `res-err`（响应中途失败）。
    Fail { message: String },
}

/// 客户端与假宿主的柄（reader/writer 喂给 `PipeClient::over_streams_for_tests`）。
pub(crate) struct FakeHost {
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    pub seen: Arc<Mutex<Vec<SeenRequest>>>,
    /// 流事件序列（`open:<id>` / `uplink:<id>:<value>` / `uplink-end:<id>` / `abort:<id>`）。
    pub events: Arc<Mutex<Vec<String>>>,
    /// 宿主侧连接的克隆：测试 drop/shutdown 它以模拟管道断开。
    pub closer: TcpStream,
}

/// 起一个假宿主：`respond` 决定每个请求的应答。
pub(crate) fn spawn(
    respond: Arc<dyn Fn(&SeenRequest) -> Reply + Send + Sync>,
) -> FakeHost {
    spawn_with_hello(respond, 1)
}

/// 同 [`spawn`]，但指定 hello 里的协议版本（测版本不符的拒绝路径）。
pub(crate) fn spawn_with_hello(
    respond: Arc<dyn Fn(&SeenRequest) -> Reply + Send + Sync>,
    hello_version: u64,
) -> FakeHost {
    spawn_with_greeting(respond, hello_version, None)
}

/// 同 [`spawn_with_hello`]，并指定 hello 的 `routePrefixes`（`None` = 不带该字段，模拟旧宿主）。
pub(crate) fn spawn_with_greeting(
    respond: Arc<dyn Fn(&SeenRequest) -> Reply + Send + Sync>,
    hello_version: u64,
    route_prefixes: Option<Vec<String>>,
) -> FakeHost {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let client_side = TcpStream::connect(addr).unwrap();
    let (host_side, _) = listener.accept().unwrap();
    let reader_side = host_side.try_clone().unwrap();
    let closer = host_side.try_clone().unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let events = Arc::new(Mutex::new(Vec::new()));
    let seen_thread = seen.clone();
    let events_thread = events.clone();
    std::thread::spawn(move || {
        serve(reader_side, host_side, respond, seen_thread, events_thread, hello_version, route_prefixes);
    });
    let reader = Box::new(client_side.try_clone().unwrap());
    let writer = Box::new(client_side);
    FakeHost { reader, writer, seen, events, closer }
}

fn serve(
    reader_side: TcpStream,
    host_side: TcpStream,
    respond: Arc<dyn Fn(&SeenRequest) -> Reply + Send + Sync>,
    seen: Arc<Mutex<Vec<SeenRequest>>>,
    events: Arc<Mutex<Vec<String>>>,
    hello_version: u64,
    route_prefixes: Option<Vec<String>>,
) {
    let mut reader = BufReader::new(reader_side);
    let mut writer = host_side;
    // 不带 routePrefixes 时整字段省略——模拟改造前的旧宿主，验证壳侧向后兼容
    let mut hello = json!({ "t": "hello", "version": hello_version, "carrier": "worldsea-pipe" });
    if let Some(prefixes) = route_prefixes {
        hello["routePrefixes"] = json!(prefixes);
    }
    write_json(&mut writer, &hello);
    let mut held: Option<(u32, SeenRequest)> = None;
    loop {
        let Some((kind, payload)) = read_frame(&mut reader) else { return };
        if kind == KIND_BINARY {
            let Some((id, request)) = held.take() else { return };
            if payload.len() < 4 || payload[0..4] != id.to_be_bytes() {
                return;
            }
            let mut request = request;
            request.body = payload[4..].to_vec();
            seen.lock().unwrap().push(request.clone());
            reply(&mut writer, id, respond.as_ref()( &request));
            continue;
        }
        if kind != KIND_JSON {
            return;
        }
        let Ok(frame) = serde_json::from_slice::<Value>(&payload) else { return };
        let id = frame.get("id").and_then(Value::as_u64).unwrap_or(0) as u32;
        match frame.get("t").and_then(Value::as_str).unwrap_or("") {
            "req" => {
                let request = SeenRequest {
                    method: frame.get("method").and_then(Value::as_str).unwrap_or("").to_string(),
                    url: frame.get("url").and_then(Value::as_str).unwrap_or("").to_string(),
                    headers: frame
                        .get("headers")
                        .and_then(Value::as_object)
                        .map(|map| map.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect())
                        .unwrap_or_default(),
                    body: Vec::new(),
                };
                match frame.get("bodyLen").and_then(Value::as_u64) {
                    Some(len) if len > 0 => held = Some((id, request)),
                    _ => {
                        seen.lock().unwrap().push(request.clone());
                        reply(&mut writer, id, respond.as_ref()(&request));
                    }
                }
            }
            "stream-open" => {
                events.lock().unwrap().push(format!("open:{id}"));
                let payload = frame.get("payload").cloned().unwrap_or(Value::Null);
                if payload.get("never").is_some() {
                    // 挂住等待 abort：不结束
                } else if payload.get("fail").is_some() {
                    write_json(&mut writer, &json!({
                        "t": "stream-error", "id": id,
                        "failure": { "kind": "remote", "code": "gateway/protocol", "message": "boom", "details": {} },
                    }));
                } else {
                    let items = payload.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
                    for item in items {
                        write_json(&mut writer, &json!({ "t": "stream-item", "id": id, "value": item }));
                    }
                    write_json(&mut writer, &json!({ "t": "stream-end", "id": id }));
                }
            }
            "stream-uplink-item" => {
                let value = frame.get("value").cloned().unwrap_or(Value::Null);
                events.lock().unwrap().push(format!("uplink:{id}:{}", serde_json::to_string(&value).unwrap_or_default()));
            }
            "stream-uplink-end" => events.lock().unwrap().push(format!("uplink-end:{id}")),
            "abort" => events.lock().unwrap().push(format!("abort:{id}")),
            _ => return,
        }
    }
}

fn reply(writer: &mut TcpStream, id: u32, reply: Reply) {
    match reply {
        Reply::Unary { status, headers, body } => {
            let mut map = Map::new();
            for (name, value) in &headers {
                map.insert(name.clone(), json!(value));
            }
            let mut frame = json!({ "t": "res", "id": id, "status": status, "headers": Value::Object(map) });
            if !body.is_empty() {
                frame["bodyLen"] = json!(body.len());
            }
            write_json(writer, &frame);
            if !body.is_empty() {
                write_binary(writer, id, &body);
            }
        }
        Reply::Streamed { status, headers, chunks } => {
            let mut map = Map::new();
            for (name, value) in &headers {
                map.insert(name.clone(), json!(value));
            }
            write_json(writer, &json!({ "t": "res-head", "id": id, "status": status, "headers": Value::Object(map) }));
            for chunk in &chunks {
                write_json(writer, &json!({ "t": "res-chunk", "id": id, "chunkLen": chunk.len() }));
                write_binary(writer, id, chunk);
            }
            write_json(writer, &json!({ "t": "res-end", "id": id }));
        }
        Reply::Fail { message } => {
            write_json(writer, &json!({ "t": "res-err", "id": id, "message": message }));
        }
    }
}

fn write_json(writer: &mut TcpStream, value: &Value) {
    let payload = serde_json::to_vec(value).unwrap();
    write_frame(writer, KIND_JSON, &payload);
}

fn write_binary(writer: &mut TcpStream, id: u32, bytes: &[u8]) {
    let mut payload = Vec::with_capacity(4 + bytes.len());
    payload.extend_from_slice(&id.to_be_bytes());
    payload.extend_from_slice(bytes);
    write_frame(writer, KIND_BINARY, &payload);
}

fn write_frame(writer: &mut TcpStream, kind: u8, payload: &[u8]) {
    let mut frame = Vec::with_capacity(5 + payload.len());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.push(kind);
    frame.extend_from_slice(payload);
    let _ = writer.write_all(&frame);
    let _ = writer.flush();
}

fn read_frame(reader: &mut BufReader<TcpStream>) -> Option<(u8, Vec<u8>)> {
    let mut header = [0u8; 5];
    reader.read_exact(&mut header).ok()?;
    let length = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload).ok()?;
    Some((header[4], payload))
}
