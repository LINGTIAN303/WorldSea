// 管道传输的帧解析 / 派发与两条 I-O 循环（从 dsh_pipe.rs 拆出）。两条循环形态（实测约束见 dsh_pipe.rs 的 dial_pipe 注释）：
// - 套接字形态（Unix / 测试）：独立读线程 + 独立写线程；
// - Windows 命名管道：**单线程轮询**——先冲写队列、再按 `PeekNamedPipe` 判可读后读，
//   避开同步句柄上「并发读写被文件对象串行化」的死锁。
// 两者共用同一 `FrameDispatch` 状态机（帧解析 + 归属校验 + 派发），断链一律 fail-closed。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use crate::dsh_pipe::{
    Inner, PipeResponse, StreamEvent, FRAME_HEADER_BYTES, KIND_BINARY, KIND_JSON, MAX_FRAME_BYTES,
};

/// 响应装配中的预期状态（reader 线程私有；二进制体帧按 id 与其配对）。
enum Expect {
    /// 一元 `res` 声明了 bodyLen：等一个整块体帧。
    Whole { status: u16, headers: Vec<(String, String)>, len: usize },
    /// `res-head` 后的分块流：`chunk` 记录下一个体帧的声明长度，`res-end` 收尾。
    Streamed { status: u16, headers: Vec<(String, String)>, body: Vec<u8>, chunk: Option<usize> },
}

/// 帧解析 + 派发状态机（两种 IO 循环共用）。
struct FrameDispatch {
    inner: Arc<Inner>,
    expects: HashMap<u32, Expect>,
    buffer: Vec<u8>,
    hello_tx: Option<Sender<Result<u64, String>>>,
}

impl FrameDispatch {
    fn new(inner: Arc<Inner>, hello_tx: Sender<Result<u64, String>>) -> Self {
        Self { inner, expects: HashMap::new(), buffer: Vec::new(), hello_tx: Some(hello_tx) }
    }

    /// 喂入新字节；返回 false = 断链（协议失序 / 帧长越界 / 归属不明）。
    fn feed(&mut self, chunk: &[u8]) -> bool {
        self.buffer.extend_from_slice(chunk);
        loop {
            if self.buffer.len() < FRAME_HEADER_BYTES {
                return true;
            }
            let length = u32::from_be_bytes([self.buffer[0], self.buffer[1], self.buffer[2], self.buffer[3]]) as usize;
            if length > MAX_FRAME_BYTES {
                eprintln!("[DSH-SHELL] pipe: 帧长 {length} 超过上限，断链");
                return false;
            }
            if self.buffer.len() < FRAME_HEADER_BYTES + length {
                return true;
            }
            let kind = self.buffer[4];
            let payload = self.buffer[FRAME_HEADER_BYTES..FRAME_HEADER_BYTES + length].to_vec();
            self.buffer.drain(..FRAME_HEADER_BYTES + length);
            if !dispatch(kind, payload, &self.inner, &mut self.expects, &mut self.hello_tx) {
                eprintln!("[DSH-SHELL] pipe: 协议失序帧（kind={kind}），断链（fail-closed）");
                return false;
            }
        }
    }

    /// 连接终止收尾：显式失败所有待决与流（不静默挂起）。
    fn finish(self) {
        let inner = self.inner;
        let mut hello_tx = self.hello_tx;
        inner.alive.store(false, Ordering::SeqCst);
        if let Some(tx) = hello_tx.take() {
            let _ = tx.send(Err("管道在 hello 之前断开".to_string()));
        }
        for (_, sender) in inner.pending.lock().unwrap().drain() {
            let _ = sender.send(Err("管道连接已断开".to_string()));
        }
        for (_, sink) in inner.streams.lock().unwrap().drain() {
            sink(StreamEvent::Error {
                kind: "carrier".to_string(),
                code: None,
                message: "管道连接已断开".to_string(),
                details: None,
            });
        }
    }
}

/// 读循环（套接字形态：独立读线程；写线程独立，无句柄串行化问题）。
#[cfg(any(unix, test))]
pub(crate) fn reader_loop(reader: &mut dyn Read, inner: Arc<Inner>, hello_tx: Sender<Result<u64, String>>) {
    let mut io = FrameDispatch::new(inner, hello_tx);
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        let read = match reader.read(&mut chunk) {
            Ok(0) => {
                eprintln!("[DSH-SHELL] pipe: 读端收尾（EOF）");
                break;
            }
            Err(error) => {
                eprintln!("[DSH-SHELL] pipe: 读端失败：{error}");
                break;
            }
            Ok(n) => n,
        };
        if !io.feed(&chunk[..read]) {
            break;
        }
    }
    io.finish();
}

/// 轮询 IO 循环（Windows 命名管道形态）：**单线程**内先冲写队列、再按可读性读——
/// 避开同步句柄的并发读写串行化（见 dial_pipe 注释）；空闲时 1ms 休眠（对 UI 流的延迟可忽略）。
#[cfg(windows)]
pub(crate) fn pipe_io_loop(
    file: &mut std::fs::File,
    inner: Arc<Inner>,
    frames: Receiver<Vec<u8>>,
    hello_tx: Sender<Result<u64, String>>,
) {
    use std::os::windows::io::AsRawHandle;
    let handle = file.as_raw_handle();
    let mut io = FrameDispatch::new(inner, hello_tx);
    let mut chunk = vec![0u8; 64 * 1024];
    'outer: loop {
        // 1) 冲写队列（写小帧；宿主持续消费，正常不阻塞）
        while let Ok(frame) = frames.try_recv() {
            if let Err(error) = file.write_all(&frame) {
                eprintln!("[DSH-SHELL] pipe: 写帧失败：{error}");
                break 'outer;
            }
        }
        // 2) 可读才读（避免阻塞读把写饿死）
        match peek_available(handle) {
            Ok(0) => {
                std::thread::sleep(Duration::from_millis(1));
                continue;
            }
            Ok(_) => match file.read(&mut chunk) {
                Ok(0) => {
                    eprintln!("[DSH-SHELL] pipe: 读端收尾（EOF）");
                    break;
                }
                Ok(n) => {
                    if !io.feed(&chunk[..n]) {
                        break;
                    }
                }
                Err(error) => {
                    eprintln!("[DSH-SHELL] pipe: 读端失败：{error}");
                    break;
                }
            },
            Err(error) => {
                eprintln!("[DSH-SHELL] pipe: 可读性探测失败：{error}");
                break;
            }
        }
    }
    io.finish();
}

/// `PeekNamedPipe`：返回可读字节数（不消费）。同步管道的多路复用读就绪判据。
#[cfg(windows)]
fn peek_available(handle: std::os::windows::io::RawHandle) -> std::io::Result<u32> {
    #[link(name = "kernel32")]
    extern "system" {
        fn PeekNamedPipe(
            handle: *mut core::ffi::c_void,
            buffer: *mut core::ffi::c_void,
            buffer_size: u32,
            bytes_read: *mut u32,
            bytes_available: *mut u32,
            bytes_left: *mut u32,
        ) -> i32;
    }
    let mut available = 0u32;
    let ok = unsafe {
        PeekNamedPipe(
            handle.cast(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            &mut available,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(available)
}

/// 派发一帧；返回 false = 协议失序（调用方断链，fail-closed）。
fn dispatch(
    kind: u8,
    payload: Vec<u8>,
    inner: &Arc<Inner>,
    expects: &mut HashMap<u32, Expect>,
    hello_tx: &mut Option<Sender<Result<u64, String>>>,
) -> bool {
    if kind == KIND_BINARY {
        if payload.len() < 4 {
            return false;
        }
        let id = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]);
        let bytes = payload[4..].to_vec();
        match expects.remove(&id) {
            Some(Expect::Whole { status, headers, len }) => {
                if bytes.len() != len {
                    return false;
                }
                complete(inner, id, PipeResponse { status, headers, body: bytes });
                true
            }
            Some(Expect::Streamed { status, headers, mut body, chunk }) => {
                let Some(declared) = chunk else { return false };
                if bytes.len() != declared {
                    return false;
                }
                body.extend_from_slice(&bytes);
                expects.insert(id, Expect::Streamed { status, headers, body, chunk: None });
                true
            }
            None => false,
        }
    } else if kind == KIND_JSON {
        let Ok(value) = serde_json::from_slice::<Value>(&payload) else {
            return false;
        };
        let frame_type = value.get("t").and_then(Value::as_str).unwrap_or("");
        let id = || value.get("id").and_then(Value::as_u64).map(|v| v as u32);
        match frame_type {
            "hello" => {
                let version = value.get("version").and_then(Value::as_u64).unwrap_or(0);
                inner.alive.store(true, Ordering::SeqCst);
                if let Some(tx) = hello_tx.take() {
                    let _ = tx.send(Ok(version));
                }
                true
            }
            "res" => {
                let (Some(id), Some(status)) = (id(), value.get("status").and_then(Value::as_u64)) else {
                    return false;
                };
                let headers = headers_of(&value);
                match value.get("bodyLen").and_then(Value::as_u64) {
                    Some(len) if len > 0 => {
                        expects.insert(id, Expect::Whole { status: status as u16, headers, len: len as usize });
                        true
                    }
                    _ => {
                        complete(inner, id, PipeResponse { status: status as u16, headers, body: Vec::new() });
                        true
                    }
                }
            }
            "res-head" => {
                let (Some(id), Some(status)) = (id(), value.get("status").and_then(Value::as_u64)) else {
                    return false;
                };
                expects.insert(
                    id,
                    Expect::Streamed { status: status as u16, headers: headers_of(&value), body: Vec::new(), chunk: None },
                );
                true
            }
            "res-chunk" => {
                let (Some(id), Some(chunk_len)) = (id(), value.get("chunkLen").and_then(Value::as_u64)) else {
                    return false;
                };
                match expects.remove(&id) {
                    Some(Expect::Streamed { status, headers, body, chunk: None }) => {
                        expects.insert(id, Expect::Streamed { status, headers, body, chunk: Some(chunk_len as usize) });
                        true
                    }
                    Some(other) => {
                        expects.insert(id, other);
                        false
                    }
                    None => false,
                }
            }
            "res-end" => {
                let Some(id) = id() else { return false };
                match expects.remove(&id) {
                    Some(Expect::Streamed { status, headers, body, .. }) => {
                        complete(inner, id, PipeResponse { status, headers, body });
                        true
                    }
                    _ => false,
                }
            }
            "res-err" => {
                let Some(id) = id() else { return false };
                expects.remove(&id);
                fail(inner, id, value.get("message").and_then(Value::as_str).unwrap_or("响应失败").to_string());
                true
            }
            "stream-item" => {
                let Some(id) = id() else { return false };
                let sink = inner.streams.lock().unwrap().get(&id).cloned();
                if let Some(sink) = sink {
                    sink(StreamEvent::Item(value.get("value").cloned().unwrap_or(Value::Null)));
                }
                true
            }
            "stream-end" => {
                let Some(id) = id() else { return false };
                if let Some(sink) = inner.streams.lock().unwrap().remove(&id) {
                    sink(StreamEvent::End);
                }
                true
            }
            "stream-error" => {
                let Some(id) = id() else { return false };
                let failure = value.get("failure").cloned().unwrap_or(Value::Null);
                if let Some(sink) = inner.streams.lock().unwrap().remove(&id) {
                    sink(StreamEvent::Error {
                        kind: failure.get("kind").and_then(Value::as_str).unwrap_or("remote").to_string(),
                        code: failure.get("code").and_then(Value::as_str).map(str::to_string),
                        message: failure.get("message").and_then(Value::as_str).unwrap_or("流失败").to_string(),
                        details: failure.get("details").cloned(),
                    });
                }
                true
            }
            _ => false,
        }
    } else {
        false
    }
}

/// 响应头对象 → 有序键值对（宿主一律小写键）。
fn headers_of(value: &Value) -> Vec<(String, String)> {
    value
        .get("headers")
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .map(|(key, value)| (key.clone(), value.as_str().unwrap_or("").to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn complete(inner: &Arc<Inner>, id: u32, response: PipeResponse) {
    if let Some(sender) = inner.pending.lock().unwrap().remove(&id) {
        let _ = sender.send(Ok(response));
    }
}

fn fail(inner: &Arc<Inner>, id: u32, message: String) {
    if let Some(sender) = inner.pending.lock().unwrap().remove(&id) {
        let _ = sender.send(Err(message));
    }
}
