//! 请求快照 WAL（阶段 3 · ④ 写路径 s2：**同步追加文件 + 异步落库**）
//!
//! 设计见 [08-请求头快照设计草案](../../../docs/plans/2026-09-16-deepseek-harness-方向探究/08-请求头快照设计草案.md)（裁定 D11）。
//!
//! ## 为什么有文件这一层
//!
//! 快照事件为**同步分发**：监听器在请求派发前把快照行同步追加进
//! `{记忆根}/requests/{session}.jsonl`（写入代价极小，主链路零阻塞），随后经通道
//! 通知后台任务把未落库的行写入 `request_snapshots`。**进程崩溃**（panic / 强杀）
//! 不影响已写文件（OS 页缓存随文件系统存活）；会话下一次装载（Agent 构建期）的
//! **补齐刷入**把残留行补进库，文件随后被移除以维持「WAL 只留未落库行」的不变式。
//!
//! （不做逐行 fsync：目标场景是进程崩溃而非断电；整机掉电丢失最后数毫秒的快照，
//! 属可接受的诊断降级。）
//!
//! ## 幂等与不丢行
//!
//! - **落库幂等**：`request_snapshots` 有内容摘要唯一键，重放安全（含并行通知的重复刷入）
//! - **不丢行**：截断只在「读文件期间无新追加」时执行（[`WalGate`] 计数比对；
//!   有任何追加即保守跳过，留待下次通知重试）
//! - **会话删除**：WAL 文件随会话清理（[`remove_wal_file`]，由命令层删除路径调用）

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};

use agent_runtime::agent::request_snapshot::RequestSnapshot;
use agent_runtime::event::OrchestratorEvent;
use agent_runtime::event_bus::{Listener, ListenerOutcome};

use crate::session_store::SessionRepository;

/// WAL 文件目录名（相对记忆根；与 `raw/`、`raw/locks/` 平级）
pub const REQUESTS_DIR_NAME: &str = "requests";

/// 会话 WAL 文件路径（`{记忆根}/requests/{session}.jsonl`）
pub fn wal_path(memory_root: &Path, session_id: &str) -> PathBuf {
    memory_root
        .join(REQUESTS_DIR_NAME)
        .join(format!("{}.jsonl", safe_name(session_id)))
}

/// 删除会话的 WAL 文件（幂等；会话删除路径调用）
pub fn remove_wal_file(memory_root: &Path, session_id: &str) {
    let path = wal_path(memory_root, session_id);
    match std::fs::remove_file(&path) {
        Ok(()) => tracing::debug!(path = %path.display(), "请求快照 WAL 已随会话清理"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => tracing::warn!(error = %e, path = %path.display(), "清理请求快照 WAL 失败"),
    }
}

/// 文件名安全化（非字母数字/下划线/连字符 → `_`；防路径穿越）
fn safe_name(session_id: &str) -> String {
    session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// WAL 追加闸：追加计数 + 互斥
///
/// 追加（监听器，同步）与截断（刷入任务，异步）共用本闸：追加时计数 +1 且与截断互斥，
/// 使「读文件期间无新行」的判据可靠（保守跳过优于丢行）。
#[derive(Default)]
pub struct WalGate {
    count: StdMutex<u64>,
}

impl WalGate {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock_count(&self) -> Option<std::sync::MutexGuard<'_, u64>> {
        self.count.lock().ok()
    }
}

/// 请求快照监听器——同步追加 WAL 行，随后通知后台刷入库
pub struct RequestSnapshotListener {
    path: PathBuf,
    notify: tokio::sync::mpsc::UnboundedSender<()>,
    gate: Arc<WalGate>,
}

impl RequestSnapshotListener {
    pub fn new(
        path: PathBuf,
        notify: tokio::sync::mpsc::UnboundedSender<()>,
        gate: Arc<WalGate>,
    ) -> Self {
        Self { path, notify, gate }
    }
}

impl Listener for RequestSnapshotListener {
    fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
        if let OrchestratorEvent::RequestSnapshotCaptured { snapshot } = event {
            let Ok(line) = serde_json::to_string(snapshot) else {
                tracing::warn!("请求快照序列化失败（诊断降级，不阻断）");
                return ListenerOutcome::Continue;
            };
            match self.gate.lock_count() {
                Some(mut count) => match append_line(&self.path, &line) {
                    Ok(()) => {
                        *count += 1;
                        // 通知落库（通道满/关闭均无所谓——关闭时后台已退出，兜底是装载期补齐）
                        let _ = self.notify.send(());
                    }
                    Err(e) => tracing::warn!(
                        error = %e,
                        path = %self.path.display(),
                        "请求快照 WAL 追加失败（诊断降级，不阻断）"
                    ),
                },
                None => tracing::warn!("请求快照 WAL 闸中毒，跳过本条"),
            }
        }
        ListenerOutcome::Continue
    }
}

/// 同步追加一行（自动建目录；不 fsync——目标场景是进程崩溃，见模块文档）
fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(line.as_bytes())?;
    file.write_all(b"\n")?;
    Ok(())
}

/// 启动会话的请求快照落库任务——**先做一次装载期补齐，随后随通知增量刷入**
///
/// 返回通知端（交给监听器）；通道在监听器随 Agent 释放后关闭，任务自然退出。
pub fn spawn_snapshot_flusher(
    store: Arc<dyn SessionRepository>,
    session_id: String,
    path: PathBuf,
    gate: Arc<WalGate>,
) -> tokio::sync::mpsc::UnboundedSender<()> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    tokio::spawn(async move {
        // 装载期补齐：上次进程中断遗留的未落库行
        flush_wal(&store, &session_id, &path, &gate).await;
        while rx.recv().await.is_some() {
            flush_wal(&store, &session_id, &path, &gate).await;
        }
    });
    tx
}

/// 把 WAL 文件中未落库的行刷入存储（**幂等**），并在无新追加时移除文件
///
/// 出错（存储失败）时提前返回、保留文件，等待下一次通知或下次装载重试。
pub(crate) async fn flush_wal(
    store: &Arc<dyn SessionRepository>,
    session_id: &str,
    path: &Path,
    gate: &Arc<WalGate>,
) {
    let count_before = match gate.lock_count() {
        Some(count) => *count,
        None => return, // 闸中毒 → 不刷（避免与未知状态的追加竞争）
    };
    let Ok(bytes) = std::fs::read(path) else {
        return; // 无文件 = 无待刷
    };
    if bytes.is_empty() {
        let _ = std::fs::remove_file(path);
        return;
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut ingested = 0usize;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let snapshot: RequestSnapshot = match serde_json::from_str(line) {
            Ok(snapshot) => snapshot,
            Err(e) => {
                // 坏行不可用：跳过（继续刷其余行；截断时一并清除）
                tracing::warn!(error = %e, "请求快照 WAL 行解析失败（跳过）");
                continue;
            }
        };
        match store.append_request_snapshot(session_id, &snapshot).await {
            Ok(Some(_)) => ingested += 1, // 新落库（seq 仅属仓储契约，此处只计数）
            Ok(None) => {} // 已存在（重放）——幂等
            Err(e) => {
                tracing::warn!(error = %e, "请求快照落库失败（保留 WAL 待重试）");
                return;
            }
        }
    }
    if ingested > 0 {
        tracing::debug!(session = %session_id, ingested, "请求快照已落库");
    }
    // 截断判据：读文件期间无新追加（有任何追加即保守跳过，留待下次）
    let can_truncate = gate
        .lock_count()
        .map(|count| *count == count_before)
        .unwrap_or(false);
    if can_truncate {
        if let Err(e) = std::fs::remove_file(path) {
            tracing::debug!(error = %e, "请求快照 WAL 移除失败（下次刷入重试）");
        }
    }
}