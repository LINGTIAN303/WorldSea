//! # 原文外置存储（A1 己1①）
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §6.1 / §6.3.1 / §6.3.3。
//!
//! ## 职责
//!
//! 把超长内容在**被截断之前**存成独立文件，返回一个**内容坐标**；此后内容即使
//! 在上下文里被截断、被裁剪，也能按坐标取回。于是「**内容丢失**」降级为
//! 「**位置丢失**」。
//!
//! ```text
//! {记忆根}/raw/{sha256前16}.txt
//! ```
//!
//! ## 三处关键设计
//!
//! ### 1. 内容寻址（而非按会话 / 按条编号）
//!
//! 文件名**只由内容决定** → 同一份超长内容（如反复读取的同一文件）**天然去重**，
//! 且坐标可跨会话复用。这正是设计文档 §6.3.1 选定「内容寻址」的理由。
//!
//! 因此落点是**全局共享**的 `{记忆根}/raw/`，而**不是**按会话分目录——
//! 按会话分会丧失跨会话去重收益。安全边界靠「不暴露为工作区路径 + 只下发只读能力」
//! 满足（§6.3.3 的隔离**实质**是「隔离于用户工作区」，而非「隔离于会话」）。
//!
//! ### 2. 真文件（而非表内虚拟路径）
//!
//! vendor 有两套 `write_raw_context`：`SqliteStorage` 存 `raw_contexts` 表内、
//! 返回**虚拟路径**；`LocalStorage` 写**真实文件**。本模块取**真文件**，理由
//! （设计 §6.3.3）：① 原文**不随 `memories.db` 损坏而丢失** ② 隔离性更强
//! ③ GC 可直接以「磁盘上的实际文件」为扫描对象（§6.3.2 的关键分解）。
//!
//! ### 3. 同步 API（有意为之）
//!
//! 调用点（[`agent_runtime::raw_context::RawContextSink`]）是**同步闭包**——
//! 它在工具结果入历史之前被调用，处在不 await 的路径上。故本模块的写入 / 读取
//! 都是**同步**的（`std::fs`）：外置的是单条工具结果（通常几十 KB 到几 MB），
//! 一次同步写文件的代价远小于把整条截断链路改成 async 的代价。
//!
//! ## 大小闸门（§6.3.3 硬约束 3）
//!
//! 两道：**单文件上限** + **总量上限**。任一道超限即**拒绝外置**（返回 `None`）——
//! 调用方随即退回「纯截断（保头 + 保尾）」，**功能不中断**。
//!
//! **闸门不做「先截断再外置」**：那会让外置的内容与原文不一致，制造「伪保真」
//! ——比没有更糟（后续按坐标取回却以为拿到的是全文）。
//!
//! ## 与 GC 的关系（§6.3.2）
//!
//! **甲3 落地前只增不删**。本模块提供 `list_hashes()`（GC 的扫描对象 = 磁盘实际文件）
//! 与 `delete()`（硬删），引用判定（`is_gc_eligible`）在 `ExtStore`，二者由后续
//! GC 调度组合使用。**硬删顺序：先删物理文件、再清引用行**（反过来会产生
//! 不可追溯的孤儿）。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_runtime::raw_context::{RawContextSink, RawRef};

/// 单文件默认上限（32 MiB）
///
/// 取 32 MiB：远大于 `clamp_tool_result` 的 12 KB 阈值，能覆盖「整份大文件被读取」
/// 的真实场景；同时避免把异常巨大的输出（如误读二进制）写进磁盘。
pub const DEFAULT_MAX_FILE_BYTES: usize = 32 * 1024 * 1024;

/// 总量默认上限（2 GiB）
///
/// 甲3 淘汰落地前**只增不删**，故必须有个总量天花板兜底；超限只**拒绝新的外置**
/// （不删旧的，避免误删），并留 WARN 日志（§6.3.2「只增不删 + 容量闸门」）。
pub const DEFAULT_MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// 外置目录名（相对记忆根）
pub const RAW_DIR_NAME: &str = "raw";

/// 原文外置存储
#[derive(Debug, Clone)]
pub struct RawStore {
    /// 外置目录（`{记忆根}/raw`）
    dir: PathBuf,
    /// 单文件上限（字节）
    max_file_bytes: usize,
    /// 总量上限（字节）
    max_total_bytes: u64,
}

impl RawStore {
    /// 在记忆根下打开（不存在则创建）
    pub fn open(memory_root: impl Into<PathBuf>) -> std::io::Result<Self> {
        let dir = memory_root.into().join(RAW_DIR_NAME);
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            dir,
            max_file_bytes: DEFAULT_MAX_FILE_BYTES,
            max_total_bytes: DEFAULT_MAX_TOTAL_BYTES,
        })
    }

    /// 覆盖闸门（链式；测试与受限部署用）
    pub fn with_limits(mut self, max_file_bytes: usize, max_total_bytes: u64) -> Self {
        self.max_file_bytes = max_file_bytes;
        self.max_total_bytes = max_total_bytes;
        self
    }

    /// 外置目录
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// 某坐标对应的文件路径
    pub fn path_of(&self, content_hash: &str) -> PathBuf {
        self.dir.join(format!("{content_hash}.txt"))
    }

    /// 内容坐标（sha256 前 16 位十六进制）——**写入与读取共用的唯一口径**
    pub fn hash_of(text: &str) -> String {
        hash_of(text)
    }

    /// 构造注入给 `AgentLoop` 的外置器（闭包）
    ///
    /// 闭包捕获本 store 的副本（`RawStore` 是廉价克隆：一个路径 + 两个数字），
    /// 每次调用做「判重 → 闸门 → 写文件」。
    pub fn sink(&self) -> RawContextSink {
        let store = self.clone();
        Arc::new(move |text: &str| store.store(text))
    }

    /// 外置一段原文（同步）
    ///
    /// 返回 `None` = 未外置（闸门拒绝 / IO 失败），调用方应退回纯截断。
    ///
    /// **幂等**：同内容重复外置时，文件已存在则直接复用（内容寻址的天然去重），
    /// 不重复写盘、也不计容量两次。
    pub fn store(&self, text: &str) -> Option<RawRef> {
        let bytes = text.len();
        if bytes == 0 {
            return None; // 空内容没有外置意义
        }
        if bytes > self.max_file_bytes {
            tracing::warn!(
                bytes,
                limit = self.max_file_bytes,
                "原文超过单文件上限，拒绝外置（退回纯截断）"
            );
            return None;
        }

        let hash = hash_of(text);
        let path = self.path_of(&hash);

        // 幂等：已存在即复用（内容寻址 → 同名必同内容）
        if path.exists() {
            return Some(RawRef {
                content_hash: hash,
                byte_len: bytes,
            });
        }

        // 总量闸门（只在新写时判，避免重复内容被误拒）
        let used = self.usage_bytes();
        if used.saturating_add(bytes as u64) > self.max_total_bytes {
            tracing::warn!(
                used,
                incoming = bytes,
                limit = self.max_total_bytes,
                "外置目录总量超限，拒绝外置（退回纯截断；甲3 落地前只增不删）"
            );
            return None;
        }

        // 原子写：先写临时文件再改名，避免「写了一半」被当成完整原文取走
        let tmp = self.dir.join(format!(".{hash}.tmp"));
        if let Err(e) = std::fs::write(&tmp, text.as_bytes()) {
            tracing::warn!(error = %e, "写外置临时文件失败（退回纯截断）");
            let _ = std::fs::remove_file(&tmp);
            return None;
        }
        if let Err(e) = std::fs::rename(&tmp, &path) {
            tracing::warn!(error = %e, "外置文件改名失败（退回纯截断）");
            let _ = std::fs::remove_file(&tmp);
            return None;
        }

        tracing::debug!(hash = %hash, bytes, "原文已外置");
        Some(RawRef {
            content_hash: hash,
            byte_len: bytes,
        })
    }

    /// 按坐标取回原文（同步）
    ///
    /// 坐标非法（格式不对，防止路径穿越）或文件不存在 → `None`。
    pub fn read(&self, content_hash: &str) -> Option<String> {
        if !is_valid_hash(content_hash) {
            // 坐标来自消息文本，必须校验后再落盘拼路径（防 `../` 穿越）
            return None;
        }
        std::fs::read_to_string(self.path_of(content_hash)).ok()
    }

    /// 坐标是否存在（不读内容，只探测）
    pub fn contains(&self, content_hash: &str) -> bool {
        is_valid_hash(content_hash) && self.path_of(content_hash).exists()
    }

    /// 已外置的全部坐标（**GC 的扫描对象 = 磁盘上的实际文件**，§6.3.2）
    ///
    /// 排序稳定（字典序），便于批处理与测试断言。
    pub fn list_hashes(&self) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        let mut out: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name
                    .strip_suffix(".txt")
                    .filter(|h| is_valid_hash(h))
                    .map(|h| h.to_string())
            })
            .collect();
        out.sort();
        out
    }

    /// 已外置文件的字节总量
    pub fn usage_bytes(&self) -> u64 {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return 0;
        };
        entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.metadata().ok())
            .filter(|m| m.is_file())
            .map(|m| m.len())
            .sum()
    }

    /// 已外置文件数
    pub fn count(&self) -> usize {
        self.list_hashes().len()
    }

    /// 硬删一个外置文件（GC 的最后一档）
    ///
    /// **顺序要求**：调用方须**先删物理文件、再清引用行**（§6.3.2）——
    /// 反过来一旦清行成功而删文件失败，文件即成不可追溯的孤儿。
    /// 文件不存在视为已删除（幂等）。
    pub fn delete(&self, content_hash: &str) -> bool {
        if !is_valid_hash(content_hash) {
            return false;
        }
        match std::fs::remove_file(self.path_of(content_hash)) {
            Ok(()) => true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => true,
            Err(e) => {
                tracing::warn!(hash = %content_hash, error = %e, "删除外置文件失败");
                false
            }
        }
    }
}

/// 坐标格式校验：**恰好 16 位十六进制**
///
/// 双重作用：① 防止消息文本里的任意字符串被当作坐标拼进文件路径（路径穿越）
/// ② 与 [`agent_runtime::raw_context::parse_externalized_hash`] 的口径一致
pub fn is_valid_hash(hash: &str) -> bool {
    hash.len() == 16 && hash.chars().all(|c| c.is_ascii_hexdigit())
}

/// 内容坐标（sha256 前 16 位十六进制）
///
/// 与 [`agent_runtime::raw_context::parse_externalized_hash`] 配对：
/// 写入侧用本函数算、读取侧用那个解析，两侧必须逐位一致，否则取不回。
pub fn hash_of(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(text.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    hex.chars().take(16).collect()
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &tempfile::TempDir) -> RawStore {
        RawStore::open(dir.path()).expect("打开外置存储")
    }

    #[test]
    fn hash_is_content_addressed_and_16_hex() {
        let a = hash_of("hello");
        assert_eq!(a, hash_of("hello"), "同内容必同坐标");
        assert_ne!(a, hash_of("hellO"));
        assert_eq!(a.len(), 16);
        assert!(is_valid_hash(&a));
        // 多字节内容也稳定
        assert_eq!(hash_of("中文"), hash_of("中文"));
    }

    #[test]
    fn hash_validator_rejects_traversal_and_wrong_shapes() {
        assert!(is_valid_hash("0123456789abcdef"));
        assert!(!is_valid_hash(""), "空串非法");
        assert!(!is_valid_hash("0123456789abcde"), "15 位非法");
        assert!(!is_valid_hash("0123456789abcdef0"), "17 位非法");
        assert!(!is_valid_hash("../etc/passwd"), "路径穿越形态非法");
        assert!(!is_valid_hash("0123456789abcdeZ"), "非十六进制非法");
        assert!(!is_valid_hash("0123/456789abcd"), "含分隔符非法");
    }

    #[test]
    fn store_then_read_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let text = "完整的工具输出原文\n包含多行\n与中文";

        let r = s.store(text).expect("应外置成功");
        assert_eq!(r.byte_len, text.len());
        assert!(s.contains(&r.content_hash));
        assert_eq!(s.read(&r.content_hash).as_deref(), Some(text), "须能原样取回");

        // 落点是真文件（不是表内虚拟路径）
        assert!(s.path_of(&r.content_hash).exists());
        assert!(s.path_of(&r.content_hash).ends_with(format!("{}.txt", r.content_hash)));
    }

    #[test]
    fn same_content_dedupes_to_one_file() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);

        let r1 = s.store("重复的内容").unwrap();
        let r2 = s.store("重复的内容").unwrap();
        assert_eq!(r1.content_hash, r2.content_hash, "同内容必同坐标");
        assert_eq!(s.count(), 1, "内容寻址应天然去重（只落一个文件）");
    }

    #[test]
    fn oversized_content_is_rejected_not_truncated() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir).with_limits(100, 1_000_000);

        // 超单文件上限 → 拒绝（返回 None，调用方退回纯截断）
        assert!(s.store(&"x".repeat(101)).is_none(), "超单文件上限应拒绝");
        assert_eq!(s.count(), 0, "拒绝时不应留下任何文件");
        // 边界内可通过
        assert!(s.store(&"x".repeat(100)).is_some());
    }

    #[test]
    fn total_quota_blocks_new_writes_but_keeps_existing() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir).with_limits(1000, 150);

        assert!(s.store(&"a".repeat(100)).is_some(), "首条应通过");
        // 已用 100，再写 100 会超 150 → 拒绝
        assert!(s.store(&"b".repeat(100)).is_none(), "超总量应拒绝新写");
        // ★ 只增不删：已存的内容不受影响
        assert_eq!(s.count(), 1, "拒绝新写不应删除已有内容");
        assert!(s.usage_bytes() > 0);
    }

    #[test]
    fn empty_content_is_not_stored() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        assert!(s.store("").is_none(), "空内容无外置意义");
        assert_eq!(s.count(), 0);
    }

    #[test]
    fn read_rejects_invalid_hash_before_touching_fs() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        // 非法坐标一律 None（不拼路径，防穿越）
        assert!(s.read("../../../etc/passwd").is_none());
        assert!(s.read("short").is_none());
        assert!(!s.contains("../../x"));
        assert!(s.read(&hash_of("不存在的内容")).is_none(), "合法但不存在 → None");
    }

    #[test]
    fn list_and_delete_cover_disk_files() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let h1 = s.store("内容一").unwrap().content_hash;
        let h2 = s.store("内容二").unwrap().content_hash;

        let mut listed = s.list_hashes();
        listed.sort();
        let mut expected = vec![h1.clone(), h2.clone()];
        expected.sort();
        assert_eq!(listed, expected, "列举 = 磁盘上的实际文件");

        // 删除（幂等）
        assert!(s.delete(&h1));
        assert!(!s.contains(&h1));
        assert!(s.delete(&h1), "重复删除应幂等成功");
        assert_eq!(s.count(), 1);
        // 非法坐标不删
        assert!(!s.delete("../x"));
    }

    #[test]
    fn sink_closure_is_injectable_and_behaves_like_store() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let sink = s.sink();

        let r = sink("经闭包外置的内容").expect("闭包应可用");
        assert_eq!(s.read(&r.content_hash).as_deref(), Some("经闭包外置的内容"));
    }

    #[test]
    fn partial_write_does_not_leave_a_tmp_behind() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(&dir);
        let _ = s.store("正常内容").unwrap();
        // 目录里不应残留 .tmp
        let leftovers: Vec<String> = std::fs::read_dir(s.dir())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "不应残留临时文件: {leftovers:?}");
    }
}
