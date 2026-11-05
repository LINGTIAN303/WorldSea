// IPC 管道传输客户端——宿主管道载体的壳侧对端（`--ipc-pipe` 模式）。壳在此层只做「帧 + 多路复用」，
// 不解析 HTTP/WS——流语义（open/item/end/error/uplink/abort）由宿主的管道载体直连 `typertGateway.wireStream.open` 完成。
// 帧格式与宿主侧 `dsh/packages/bundle/web-app/src/pipe-transport.ts` **严格同构**：
// `u32be(length) + u8(kind) + payload`；J = JSON 控制帧，B = 二进制体帧（payload = `u32be(id) + bytes`，且严格跟随其声明帧）；
// 一条连接多路复用全部请求（id → 一元响应）与 mux 流（id → 下行事件）；连接形态：Windows 命名管道 / POSIX Unix 域套接字。反证开关：`WORLDSEA_TCP_HOST=1` 走 legacy（TCP + WS 中转）。

use std::collections::HashMap;
// Windows 非测试构建下读写都走 `dsh_pipe_io` 的轮询循环，这里不再引用这两个 trait
#[cfg(any(unix, test))]
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

/// 协议版本（宿主 `PIPE_TRANSPORT_VERSION` 必须相等；不等即拒——不静默降级）。
pub const PIPE_PROTOCOL_VERSION: u64 = 1;

pub(crate) const KIND_JSON: u8 = 0x4a;
pub(crate) const KIND_BINARY: u8 = 0x42;
pub(crate) const FRAME_HEADER_BYTES: usize = 5;
/// 单帧上限（与宿主一致：320 MiB，覆盖 300 MiB 的 /api 体上限）。
pub(crate) const MAX_FRAME_BYTES: usize = 320 * 1024 * 1024;
/// 一元请求超时（与转发链的 reqwest 超时口径一致）。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
/// hello 握手等待上限（宿主连接后立即发送）。
const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
/// 拨号重试节奏（宿主可能仍在绑定管道；就绪行已过，通常一次即中）。
const DIAL_RETRY_INTERVAL: Duration = Duration::from_millis(250);

/// hello 握手结果：协议版本 + 宿主自报的前缀路由表（旧宿主不带该字段则为空）。
#[derive(Debug, Clone, Default)]
pub struct HelloInfo {
    pub version: u64,
    /// 宿主 webserver 当前注册的前缀路由（如 `/api`、`/plugins`、插件命名空间）。
    /// 壳侧路径闸门据此判定「宿主是否真的会路由这条路径」。
    pub route_prefixes: Vec<String>,
}

/// 一条一元上游响应（体已在壳内缓冲——协议应答本身是缓冲体）。
#[derive(Debug)]
pub struct PipeResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// 流下行事件（reader 线程回调；调用方负责投递给页面）。
#[derive(Debug, Clone)]
pub enum StreamEvent {
    Item(Value),
    End,
    Error { kind: String, code: Option<String>, message: String, details: Option<Value> },
}

/// 一条流的页面上行/取消句柄 + 下行回调。
pub type StreamSink = Arc<dyn Fn(StreamEvent) + Send + Sync>;


pub(crate) struct Inner {
    /// 写线程入口（整帧字节直接进队列，序即连接上的写序）。
    pub(crate) writer: Sender<Vec<u8>>,
    /// 帧写锁：宿主按「控帧 + 体帧」**单槽配对**读，
    /// 而壳侧代理是**每请求一线程**并发发 POST —— 不加锁会让两条 `req`+体帧交错，
    /// 宿主判协议违规并**整条断链**（真机实测：页面 reload 触发）。
    /// 约定：**成对帧必须在同一临界区内写完**；单帧写入也走本锁。
    pub(crate) write_lock: Mutex<()>,
    /// 待决一元请求：id → 结果通道。
    pub(crate) pending: Mutex<HashMap<u32, Sender<Result<PipeResponse, String>>>>,
    /// 活跃流：id → 下行回调。
    pub(crate) streams: Mutex<HashMap<u32, StreamSink>>,
    next_id: AtomicU32,
    /// hello 校验通过后为真；连接断掉即复位（后续请求显式报错，不静默挂起）。
    pub(crate) alive: AtomicBool,
    /// hello 带来的宿主前缀路由表（路径闸门的运行期依据；空 = 旧宿主或未握手）。
    pub(crate) route_prefixes: Mutex<Vec<String>>,
}

/// 管道客户端（可克隆共享；内部读写线程随最后一个句柄回收）。
pub struct PipeClient {
    inner: Arc<Inner>,
}

impl std::fmt::Debug for PipeClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PipeClient(alive={})", self.is_alive())
    }
}

impl PipeClient {
    /// 拨号并完成 hello 校验；失败返回可读原因（调用方决定重试或回退）。
    #[cfg(windows)]
    pub fn connect(path: &str) -> Result<Self, String> {
        let file = dial_pipe(path)?;
        Self::over_pipe(file)
    }

    /// 拨号并完成 hello 校验；失败返回可读原因（调用方决定重试或回退）。
    #[cfg(unix)]
    pub fn connect(path: &str) -> Result<Self, String> {
        let (reader, writer) = dial_unix(path)?;
        Self::over_streams(reader, writer)
    }

    /// 在给定时刻内反复拨号（宿主绑定与就绪行之间可能有毫秒级竞态）。
    pub fn connect_retry(path: &str, timeout: Duration) -> Result<Self, String> {
        let deadline = Instant::now() + timeout;
        loop {
            match Self::connect(path) {
                Ok(client) => return Ok(client),
                Err(error) => {
                    if Instant::now() >= deadline {
                        return Err(format!("连接管道失败（{timeout:?} 内重试耗尽）：{error}"));
                    }
                    std::thread::sleep(DIAL_RETRY_INTERVAL);
                }
            }
        }
    }

    /// 以既有双向流构造客户端（测试用：可接在任意哑通道上，如 TCP 回环对；Unix 也走这条）。
    /// 读写各一条线程——**该形态仅对套接字成立**：Windows 命名管道的同步句柄上并发读写会被
    /// 文件对象串行化（读线程一阻塞，写永不落地），故管道侧走 [`Self::over_pipe`] 的单线程轮询。
    #[cfg(any(unix, test))]
    fn over_streams(mut reader: Box<dyn Read + Send>, mut writer: Box<dyn Write + Send>) -> Result<Self, String> {
        let (frame_tx, frame_rx) = mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            for frame in frame_rx {
                if let Err(error) = writer.write_all(&frame) {
                    // 写失败必须可见：静默吞掉会让上层只看到「请求超时」，无从定位
                    eprintln!("[DSH-SHELL] pipe: 写帧失败：{error}");
                    break;
                }
                let _ = writer.flush();
            }
        });
        let inner = Arc::new(Inner {
            writer: frame_tx,
            write_lock: Mutex::new(()),
            pending: Mutex::new(HashMap::new()),
            streams: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
            alive: AtomicBool::new(false),
            route_prefixes: Mutex::new(Vec::new()),
        });
        let (hello_tx, hello_rx) = mpsc::channel::<Result<HelloInfo, String>>();
        {
            let inner = inner.clone();
            std::thread::spawn(move || crate::dsh_pipe_io::reader_loop(&mut reader, inner, hello_tx));
        }
        Self::await_hello(&inner, hello_rx)
    }

    /// Windows 命名管道：**单线程轮询 IO**——同一句柄上先冲写队列、再按 `PeekNamedPipe` 判可读后读，
    /// 从根本上避开「同步句柄并发读写死锁」（见 connect 注释与 dial_pipe 注释）。
    #[cfg(windows)]
    fn over_pipe(mut file: std::fs::File) -> Result<Self, String> {
        let (frame_tx, frame_rx) = mpsc::channel::<Vec<u8>>();
        let inner = Arc::new(Inner {
            writer: frame_tx,
            write_lock: Mutex::new(()),
            pending: Mutex::new(HashMap::new()),
            streams: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
            alive: AtomicBool::new(false),
            route_prefixes: Mutex::new(Vec::new()),
        });
        let (hello_tx, hello_rx) = mpsc::channel::<Result<HelloInfo, String>>();
        {
            let inner = inner.clone();
            std::thread::spawn(move || crate::dsh_pipe_io::pipe_io_loop(&mut file, inner, frame_rx, hello_tx));
        }
        Self::await_hello(&inner, hello_rx)
    }

    fn await_hello(inner: &Arc<Inner>, hello_rx: Receiver<Result<HelloInfo, String>>) -> Result<Self, String> {
        match hello_rx.recv_timeout(HELLO_TIMEOUT) {
            Ok(Ok(info)) if info.version == PIPE_PROTOCOL_VERSION => {
                *inner.route_prefixes.lock().unwrap() = info.route_prefixes;
                Ok(Self { inner: inner.clone() })
            }
            Ok(Ok(info)) => Err(format!("管道协议版本不符：宿主 {}，本壳 {PIPE_PROTOCOL_VERSION}", info.version)),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(format!("等待管道 hello 超时（{}s）", HELLO_TIMEOUT.as_secs())),
        }
    }

    /// 是否仍在服务（hello 过、连接未断）。
    pub fn is_alive(&self) -> bool {
        self.inner.alive.load(Ordering::SeqCst)
    }

    /// 宿主自报的前缀路由表（hello 时快照；旧宿主或未握手则为空）。
    /// 路径闸门用它判定「宿主是否真的会路由这条路径」，从而不必在壳内维护手工清单。
    pub fn route_prefixes(&self) -> Vec<String> {
        self.inner.route_prefixes.lock().unwrap().clone()
    }

    /// 测试专用：以既有双向流构造（哑通道），走完整 hello 握手。
    #[cfg(test)]
    pub(crate) fn over_streams_for_tests(
        reader: Box<dyn Read + Send>,
        writer: Box<dyn Write + Send>,
    ) -> Result<Self, String> {
        Self::over_streams(reader, writer)
    }

    /// 一元请求：写 `req`（+ 体帧），阻塞等待整条响应。
    /// `headers` 由调用方给（cookie 等壳侧语义）；`host` 固定 `127.0.0.1`（与 303 交换同 authority）。
    pub fn request(
        &self,
        method: &str,
        path_and_query: &str,
        headers: &[(String, String)],
        body: Option<&[u8]>,
    ) -> Result<PipeResponse, String> {
        self.request_with_timeout(method, path_and_query, headers, body, REQUEST_TIMEOUT)
    }

    /// 同 [`PipeClient::request`]，但由调用方给等待上限。
    /// 用于「宿主侧 handler 本身要等外部往返」的路由（典型：账号登录回调要等授权码兑换完成才回包）。
    pub fn request_with_timeout(
        &self,
        method: &str,
        path_and_query: &str,
        headers: &[(String, String)],
        body: Option<&[u8]>,
        timeout: Duration,
    ) -> Result<PipeResponse, String> {
        if !self.is_alive() {
            return Err("管道未就绪或已断开".to_string());
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::channel();
        self.inner.pending.lock().unwrap().insert(id, sender);
        let mut map = Map::new();
        map.insert("host".to_string(), json!("127.0.0.1"));
        for (key, value) in headers {
            map.insert(key.clone(), json!(value));
        }
        let mut frame = json!({
            "t": "req",
            "id": id,
            "method": method,
            "url": path_and_query,
            "headers": Value::Object(map),
        });
        if let Some(bytes) = body {
            frame["bodyLen"] = json!(bytes.len());
        }
        let json_bytes = serde_json::to_vec(&frame).map_err(|e| format!("请求帧序列化失败：{e}"))?;
        // 控帧与体帧**成对落线**（见 `write_lock` 注释）：配对窗口内不得插入其它帧，否则宿主单槽配对失配 → 断链
        let mut frames = vec![(KIND_JSON, json_bytes)];
        if let Some(bytes) = body {
            frames.push((KIND_BINARY, with_id(id, bytes)));
        }
        if let Err(error) = self.write_frames(&frames) {
            self.inner.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        match receiver.recv_timeout(timeout) {
            Ok(result) => result,
            Err(RecvTimeoutError::Timeout) => {
                self.inner.pending.lock().unwrap().remove(&id);
                Err(format!(
                    "上游请求超时（{method} {path_and_query}，{}s）",
                    timeout.as_secs()
                ))
            }
            Err(RecvTimeoutError::Disconnected) => Err("管道读端已收尾".to_string()),
        }
    }

    /// 打开一条逻辑流；下行事件回调到 `sink`（注册在 reader 线程派发面上）。
    pub fn stream_open(&self, endpoint: &str, payload: Value, sink: StreamSink) -> Result<u32, String> {
        if !self.is_alive() {
            return Err("管道未就绪或已断开".to_string());
        }
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        self.inner.streams.lock().unwrap().insert(id, sink);
        let frame = json!({
            "t": "stream-open",
            "id": id,
            "endpoint": endpoint,
            "payload": payload,
        });
        let bytes = serde_json::to_vec(&frame).map_err(|e| format!("流开帧序列化失败：{e}"))?;
        if let Err(error) = self.write_frames(&[(KIND_JSON, bytes)]) {
            self.inner.streams.lock().unwrap().remove(&id);
            return Err(error);
        }
        Ok(id)
    }

    /// 上行一项（页面 → 宿主方法）。
    pub fn stream_send(&self, id: u32, value: Value) -> Result<(), String> {
        let bytes = serde_json::to_vec(&json!({ "t": "stream-uplink-item", "id": id, "value": value }))
            .map_err(|e| format!("上行帧序列化失败：{e}"))?;
        self.write_frames(&[(KIND_JSON, bytes)])
    }

    /// 上行半关（幂等；失败只返回错误，不重试）。
    pub fn stream_end(&self, id: u32) -> Result<(), String> {
        let bytes = serde_json::to_vec(&json!({ "t": "stream-uplink-end", "id": id }))
            .map_err(|e| format!("上行关帧序列化失败：{e}"))?;
        self.write_frames(&[(KIND_JSON, bytes)])
    }

    /// 取消一条流：撤下行回调 + 通知宿主 abort（宿主同时中止 opener 的 signal）。
    pub fn stream_cancel(&self, id: u32) {
        self.inner.streams.lock().unwrap().remove(&id);
        if let Ok(bytes) = serde_json::to_vec(&json!({ "t": "abort", "id": id })) {
            let _ = self.write_frames(&[(KIND_JSON, bytes)]);
        }
    }

    fn send_frame(&self, kind: u8, payload: Vec<u8>) -> Result<(), String> {
        let mut frame = Vec::with_capacity(FRAME_HEADER_BYTES + payload.len());
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.push(kind);
        frame.extend_from_slice(&payload);
        self.inner.writer.send(frame).map_err(|_| "管道写线程已退出".to_string())
    }

    /// **成组写帧**：同一临界区内按序写完 —— 用于「控帧 + 体帧」这类必须相邻的帧对。
    fn write_frames(&self, frames: &[(u8, Vec<u8>)]) -> Result<(), String> {
        let _guard = self.inner.write_lock.lock().map_err(|_| "帧写锁不可用".to_string())?;
        for (kind, payload) in frames {
            self.send_frame(*kind, payload.clone())?;
        }
        Ok(())
    }
}

/// 二进制体帧载荷 = `u32be(id) + bytes`（与宿主同构）。
fn with_id(id: u32, bytes: &[u8]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(4 + bytes.len());
    payload.extend_from_slice(&id.to_be_bytes());
    payload.extend_from_slice(bytes);
    payload
}

/// 拨号：Windows = 命名管道按**同步**文件形态打开（并发读写约束由 [`PipeClient::over_pipe`] 的
/// 单线程轮询承担）；POSIX = Unix 域套接字。〔Windows 命名管道的两条硬约束（实测 2026-09-24，活体管道上逮到）〕
/// ① **同步句柄上的并发读写会被文件对象串行化**：后台读线程阻塞在 ReadFile 时，另一线程的写永不落地
///    （症状＝「hello 收到、请求永不到达、无报错」；`try_clone` 救不了）——故管道侧用单线程轮询 IO；
/// ② **带 `FILE_FLAG_OVERLAPPED` 打开的句柄不能交给 std 的 File**：std 走同步 NT 调用，遇 STATUS_PENDING 直接 `rtabort!`（std issue #81357）——此路不可走。
#[cfg(windows)]
fn dial_pipe(path: &str) -> Result<std::fs::File, String> {
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("打开命名管道失败（{path}）：{e}"))
}

#[cfg(unix)]
fn dial_unix(path: &str) -> Result<(Box<dyn Read + Send>, Box<dyn Write + Send>), String> {
    let reader = std::os::unix::net::UnixStream::connect(path)
        .map_err(|e| format!("连接 Unix 域套接字失败（{path}）：{e}"))?;
    let writer = reader.try_clone().map_err(|e| format!("克隆套接字失败：{e}"))?;
    Ok((Box::new(reader), Box::new(writer)))
}

#[cfg(test)]
#[path = "dsh_pipe_test_host.rs"]
pub(crate) mod test_host;

#[cfg(test)]
#[path = "dsh_pipe_tests.rs"]
mod tests;
