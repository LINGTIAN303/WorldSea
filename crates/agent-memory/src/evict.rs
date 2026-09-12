//! # 淘汰执行器：一轮记忆巡检（A1 甲3）
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §4.3 / §6.3.2。
//!
//! ## 一轮巡检做三件事（顺序固定）
//!
//! ```text
//! ① 记忆条目衰减      apply_decay            → 重算评分 + 软淘汰/恢复（可逆）
//! ② 记忆条目硬删      purge_due_entries      → 回收站满 delete_after_days(90) → 物理删
//! ③ 外置文件 GC       扫描磁盘 → is_gc_eligible → 回收站(7 天) → 物理删
//! ```
//!
//! 前两步只动 `memories.db` + `memory_ext.db`；第三步只动 `{记忆根}/raw/` 与外置引用表。
//! 三者互不依赖，但顺序有意义：**先衰减后硬删**——同一次巡检中新软删的条目不该
//! 被立刻硬删（回收站窗口是它的安全垫）。
//!
//! ## 外置文件 GC 的关键分解（§6.3.2 施工定稿）
//!
//! - **扫描对象是磁盘上的实际文件**（[`RawStore::list_hashes`]），不是 `raw_ref` 的行——
//!   引用被释放后行即物理删除，该哈希在表中已查不到。
//! - **判定用谓词** [`ExtStore::is_gc_eligible`]（有效引用数 = 0 且无 pinned），
//!   逐个文件询问，而非枚举候选。
//! - **硬删顺序：先删物理文件、再清引用行、最后清回收站记录**——反过来一旦清行成功
//!   而删文件失败，文件即成不可追溯的孤儿。
//! - **回收站时点自「首次失去引用」起算**（[`ExtStore::trash_put`] 保留最早时点）——
//!   否则每次巡检重置窗口，永不硬删。
//! - **恢复**：回收站中的文件若重新获得引用（如新会话再次读到同一份超长内容，
//!   内容寻址 → 同坐标），下一次巡检把它移出回收站。
//!
//! ## 保护条件（任一成立即不 GC）
//!
//! - `pinned`（引用行的 pinned 列）
//! - 存在**有效引用**（`raw_ref.deleted_at IS NULL` 的行）
//!
//! ## 与调度的关系
//!
//! 本模块只提供**一轮**巡检（[`run_gc_pass`]，纯函数式、可重入、幂等），
//! 不含定时器。调度由装配层负责（`agent-commands` 的后台任务按间隔调用），
//! 也可由运维 / 测试随时手动触发。

use std::path::Path;
use std::sync::Arc;

use memory_center_core::sqlite::SqliteStorage;
use memory_center_core::storage::Storage;

use crate::decay::EvictionPolicy;
use crate::ext::ExtStore;
use crate::raw_store::RawStore;

/// 一轮巡检的完整结果（观测与验收用）
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GcReport {
    /// ① 重算衰减评分的条目数
    pub decay_scored: usize,
    /// ① 本次新软淘汰的条目数
    pub newly_deprecated: usize,
    /// ① 本次恢复（召回返青）的条目数
    pub restored: usize,
    /// ② 硬删的条目数（`memories.db` + `memory_ext.db` 两侧）
    pub entries_evicted: usize,
    /// ③ 仍受保护（有引用 / pinned）的外置文件数
    pub raw_protected: usize,
    /// ③ 本次新入回收站的外置文件数
    pub raw_trashed: usize,
    /// ③ 本次从回收站恢复的外置文件数
    pub raw_restored: usize,
    /// ③ 硬删的外置文件数
    pub raw_purged: usize,
    /// ③ 顺带清理的孤儿回收站记录数（文件已不在，记录残留）
    pub trash_pruned: usize,
    /// ② 本次硬删的 hook_id 列表（供装配层同步检索索引——A2 戊1）
    ///
    /// 硬删后 `memories.db` 里已无该条目，但 BM25 / 向量索引是**进程内 + 独立库**，
    /// 不会随删；装配层据本列表把对应条目移出索引（否则会残留幽灵索引项）。
    pub evicted_hooks: Vec<String>,
}

impl GcReport {
    /// 本轮是否有实际动作（供调度层决定是否记日志）
    pub fn did_something(&self) -> bool {
        self.newly_deprecated > 0
            || self.restored > 0
            || self.entries_evicted > 0
            || self.raw_trashed > 0
            || self.raw_restored > 0
            || self.raw_purged > 0
            || self.trash_pruned > 0
    }
}

/// 对某个记忆根跑**一轮**完整巡检（全分片）
///
/// 丁3（2026-09-12）：记忆按项目分片（`root/projects/{project_id}`）后，本函数
/// **遍历全部分片**：
/// - ①② 逐分片执行（衰减 / 软淘汰 / 硬删——数据归属各自分片）
/// - ③ **全局一次且跨分片协调**——外置文件（`raw/`）是全局共享的（内容寻址：
///   同内容同坐标），物理删除必须满足「**所有分片**都无有效引用与 pinned，
///   且以**最后一个**分片失去引用的时点起算回收站窗口」；否则会误删其他项目
///   仍在引用的原文（跨分片正确性，本批修复的核心缺陷）。
///
/// - `root`：记忆存储根（与 `MemoryCenterAccessor::new_sqlite` 同源）
/// - `now_ms`：巡检时点（Unix 毫秒；显式传入以便测试与回放）
/// - `policy`：淘汰策略参数（[`EvictionPolicy::default`] 即设计起点）
pub async fn run_gc_pass(
    root: &Path,
    now_ms: i64,
    policy: &EvictionPolicy,
) -> Result<GcReport, String> {
    let shards = open_shards(root)?;
    let raw = RawStore::open(root.to_path_buf()).map_err(|e| e.to_string())?;
    let mut report = GcReport::default();
    for s in &shards {
        run_shard_evict(s.storage.as_ref(), &s.ext, now_ms, policy, &mut report).await?;
    }
    let exts: Vec<&ExtStore> = shards.iter().map(|s| &s.ext).collect();
    run_raw_gc(&raw, &exts, now_ms, policy, &mut report).await?;
    Ok(report)
}

/// 记忆分片句柄（巡检用）
struct ShardHandles {
    /// 分片名（project_id，或 `_default`；排序与日志用）
    pid: String,
    ext: ExtStore,
    storage: Arc<dyn Storage>,
}

/// 枚举记忆根下的全部分片（`root/projects/*` 目录；无目录 = 无分片）
///
/// 含 `_default`（无项目归属的兜底分片）——它的存量数据同样按衰减自然收敛。
/// 目录名回映射为 project_id（`_default` → `None`），与三库（memories/ext/vec）
/// 的分片判据保持一致。
fn open_shards(root: &Path) -> Result<Vec<ShardHandles>, String> {
    let projects = root.join("projects");
    let mut out: Vec<ShardHandles> = Vec::new();
    let Ok(rd) = std::fs::read_dir(&projects) else {
        return Ok(out); // 无 projects 目录 = 无分片
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(pid) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let project_id = if pid == "_default" {
            None
        } else {
            Some(pid.to_string())
        };
        let ext = ExtStore::open(root.to_path_buf(), project_id.clone()).map_err(|e| e.to_string())?;
        let storage: Arc<dyn Storage> = Arc::new(
            SqliteStorage::new(root.to_path_buf(), project_id).map_err(|e| e.to_string())?,
        );
        out.push(ShardHandles {
            pid: pid.to_string(),
            ext,
            storage,
        });
    }
    // 稳定顺序（日志与测试可预期）
    out.sort_by(|a, b| a.pid.cmp(&b.pid));
    Ok(out)
}

/// 巡检主体（依赖注入版：测试与自定义后端用）
///
/// 与 [`run_gc_pass`] 的区别：不自行打开存储，由调用方注入——
/// 便于单测用内存后端 / 临时目录，也便于未来把 `Storage` 换成别家实现。
pub async fn run_gc_pass_with(
    storage: &dyn Storage,
    ext: &ExtStore,
    raw: &RawStore,
    now_ms: i64,
    policy: &EvictionPolicy,
) -> Result<GcReport, String> {
    let mut report = GcReport::default();
    run_shard_evict(storage, ext, now_ms, policy, &mut report).await?;
    run_raw_gc(raw, &[ext], now_ms, policy, &mut report).await?;
    Ok(report)
}

/// ①② 单分片步骤：衰减（含软淘汰/恢复）→ 硬删到期条目
async fn run_shard_evict(
    storage: &dyn Storage,
    ext: &ExtStore,
    now_ms: i64,
    policy: &EvictionPolicy,
    report: &mut GcReport,
) -> Result<(), String> {
    // ── ① 衰减 + 软淘汰/恢复（可逆，不删任何东西）────────────────
    let decay = ext
        .apply_decay(now_ms, *policy)
        .await
        .map_err(|e| e.to_string())?;
    report.decay_scored += decay.scored;
    report.newly_deprecated += decay.newly_deprecated.len();
    report.restored += decay.restored;

    // ── ② 硬删：回收站满 delete_after_days 的条目 ─────────────────
    // 顺序：先删 memories.db 的记忆行（hooks 随 FK 级联），再清本库扩展行。
    // 单条失败不中断整轮（记 warn 后继续），避免一条坏数据阻塞全部淘汰。
    let due = ext
        .purge_due_entries(now_ms, *policy)
        .await
        .map_err(|e| e.to_string())?;
    for entry in due {
        match storage.delete_memory(&entry.memory_id).await {
            Ok(()) => {
                if let Err(e) = ext.delete_memory_ext(&entry.memory_id).await {
                    tracing::warn!(
                        memory_id = %entry.memory_id,
                        "硬删后清理扩展记录失败（下次巡检会因 memories 行缺失而报错，可手工清理）: {e}"
                    );
                }
                report.entries_evicted += 1;
                // A2 戊1：登记硬删 hook（装配层据此同步检索索引）
                report.evicted_hooks.push(entry.hook_id.clone());
            }
            Err(e) => {
                tracing::warn!(
                    memory_id = %entry.memory_id,
                    hook = %entry.hook_id,
                    "硬删记忆行失败（跳过，留待下次巡检）: {e}"
                );
            }
        }
    }
    Ok(())
}

/// ③ 外置文件 GC（全局一次；跨分片协调）
///
/// **跨分片规则（丁3）**：
/// - 判定谓词 `is_gc_eligible` 是分片内的（引用表 / pinned 按分片）→ 全局「可删」
///   要求**所有分片**都适格（任一分片有引用即受保护）；
/// - 回收站窗口以**最后一个**分片失去引用的时点起算（各分片独立记录时点，
///   取最大值；尚无记录的分片本次补记 = 起点顺延到本次巡检）；
/// - 硬删时清**全部分片**的引用行与回收站记录（同一坐标的引用可能分布在多个分片）。
///
/// `shard_exts` 为空时（无分片）**保守不动**——没有判定依据时不删任何文件。
async fn run_raw_gc(
    raw: &RawStore,
    shard_exts: &[&ExtStore],
    now_ms: i64,
    policy: &EvictionPolicy,
    report: &mut GcReport,
) -> Result<(), String> {
    if shard_exts.is_empty() {
        tracing::debug!("外置文件 GC：无记忆分片，本轮跳过（保守不删）");
        return Ok(());
    }

    // ── ③a 孤儿收敛：各分片回收站记录指向的文件已不在（外部清理 / 上次硬删中断）──
    for ext in shard_exts {
        for (hash, _) in ext.trash_list().await.map_err(|e| e.to_string())? {
            if !raw.contains(&hash) {
                ext.trash_forget(&hash).await.map_err(|e| e.to_string())?;
                report.trash_pruned += 1;
            }
        }
    }

    // ── ③b 扫描磁盘文件（全局一次）：跨分片判定 → 入回收站 → 到期硬删 ──
    let retention_ms = policy.trash_retention_ms();
    for hash in raw.list_hashes() {
        // 跨分片判定：任一分片有有效引用 / pinned → 受保护
        let mut all_eligible = true;
        for ext in shard_exts {
            if !ext.is_gc_eligible(&hash).await.map_err(|e| e.to_string())? {
                all_eligible = false;
                break;
            }
        }
        if !all_eligible {
            // 曾有分片把它入回收站（另一分片仍引用）→ 各分片恢复（清记录）；
            // 窗口计时随后自「最后失去引用」重新起算
            for ext in shard_exts {
                if ext.trash_restore(&hash).await.map_err(|e| e.to_string())? {
                    report.raw_restored += 1;
                }
            }
            report.raw_protected += 1;
            continue;
        }
        // 全分片皆无引用：为尚无回收站记录的分片补记时点（窗口起点 = 本次巡检时刻），
        // 并取各分片时点的最大值 = 「最后失去引用」的近似时刻
        let mut newly_trashed = false;
        let mut latest: Option<i64> = None;
        for ext in shard_exts {
            match ext.trash_taken_at(&hash).await.map_err(|e| e.to_string())? {
                Some(t) => latest = Some(latest.map_or(t, |m: i64| m.max(t))),
                None => {
                    ext.trash_put(&hash, now_ms).await.map_err(|e| e.to_string())?;
                    newly_trashed = true;
                }
            }
        }
        let release_at = if newly_trashed {
            now_ms
        } else {
            latest.unwrap_or(now_ms)
        };
        if now_ms.saturating_sub(release_at) >= retention_ms {
            // 到期硬删：先删物理文件、再清全分片引用行与回收站记录
            if !raw.delete(&hash) {
                // 删文件失败：不清记录（留待下次巡检重试，
                // 保持「文件与引用记录同进出」的可追溯性）
                tracing::warn!(hash = %hash, "硬删外置文件失败（保留记录待重试）");
                continue;
            }
            for ext in shard_exts {
                ext.purge_raw_refs(&hash).await.map_err(|e| e.to_string())?;
                ext.trash_forget(&hash).await.map_err(|e| e.to_string())?;
            }
            report.raw_purged += 1;
        } else if newly_trashed {
            report.raw_trashed += 1;
        }
    }
    Ok(())
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decay::DAY_MS;
    use crate::ext::owner_kind;
    use memory_center_core::model::{MemoryFile, MessageContent, MessageTurn, Tag};

    /// 建一个临时记忆根（含 memories.db / memory_ext.db / raw/）
    fn setup() -> (tempfile::TempDir, ExtStore, RawStore, SqliteStorage) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let ext = ExtStore::open(root.clone(), None).unwrap();
        let raw = RawStore::open(root.clone()).unwrap();
        let storage = SqliteStorage::new(root, None).unwrap();
        (dir, ext, raw, storage)
    }

    /// 往 memories.db 塞一条记忆（不经归档流程，直写存储），返回其 memory_id
    ///
    /// memory_id 由 `write_memory` 生成（UUID），调用方需用它登记扩展行——
    /// 扩展行的 `memory_id` 与 `memories.id` 必须一致，否则硬删定位不到记忆行。
    async fn seed_memory(storage: &SqliteStorage, session_id: &str) -> String {
        let now = chrono::Utc::now();
        let memory = MemoryFile {
            id: uuid::Uuid::new_v4(),
            schema_version: 1,
            archived_at: now,
            session_id: session_id.to_string(),
            project_id: None,
            turns: vec![MessageTurn {
                id: uuid::Uuid::new_v4(),
                user_message: MessageContent {
                    text: Some("旧记忆内容".into()),
                    attachments: Vec::new(),
                    tool_calls: Vec::new(),
                    thinking: None,
                    file_changes: Vec::new(),
                },
                llm_message: MessageContent {
                    text: Some("回复".into()),
                    attachments: Vec::new(),
                    tool_calls: Vec::new(),
                    thinking: None,
                    file_changes: Vec::new(),
                },
                tags: vec![Tag::Text],
                timestamp: now,
                token_count: 10,
                stop_reason: None,
                cost: None,
            }],
            tags: vec![Tag::Text],
            total_tokens: 10,
            truncated: false,
            period: memory_center_core::model::ArchivePeriod::Daily,
            access_count: 0,
            importance: 0,
            updates: Vec::new(),
        };
        storage.write_memory(&memory).await.unwrap();
        memory.id.to_string()
    }

    #[tokio::test]
    async fn full_pass_trashes_then_purges_unreferenced_raw_file() {
        let (_dir, ext, raw, storage) = setup();

        // 一个无引用的外置文件（模拟：引用已被释放 / 从未登记）
        let text = "超长原文内容".repeat(10);
        let r = raw.store(&text).unwrap();

        // 第一轮：入回收站（不满 7 天 → 不硬删）
        let now = 1_000_000_000_000i64;
        let report = run_gc_pass_with(&storage, &ext, &raw, now, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report.raw_trashed, 1, "无引用文件应入回收站");
        assert_eq!(report.raw_purged, 0, "窗口内不得硬删");
        assert!(raw.contains(&r.content_hash), "文件应仍在");

        // 第二轮（+3 天）：仍在窗口内
        let report = run_gc_pass_with(
            &storage,
            &ext,
            &raw,
            now + 3 * DAY_MS,
            &EvictionPolicy::default(),
        )
        .await
        .unwrap();
        assert_eq!(report.raw_purged, 0);
        assert!(raw.contains(&r.content_hash));

        // 第三轮（+8 天）：满 7 天 → 硬删
        let report = run_gc_pass_with(
            &storage,
            &ext,
            &raw,
            now + 8 * DAY_MS,
            &EvictionPolicy::default(),
        )
        .await
        .unwrap();
        assert_eq!(report.raw_purged, 1, "回收站到期应硬删");
        assert!(!raw.contains(&r.content_hash), "物理文件应被删除");
        assert!(
            ext.trash_taken_at(&r.content_hash).await.unwrap().is_none(),
            "回收站记录应一并清理"
        );
    }

    #[tokio::test]
    async fn referenced_raw_file_is_protected_and_restored_after_trash() {
        let (_dir, ext, raw, storage) = setup();
        let r = raw.store("被引用的原文").unwrap();
        let now = 1_000_000_000_000i64;

        // 无引用 → 入回收站
        let report = run_gc_pass_with(&storage, &ext, &raw, now, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report.raw_trashed, 1);

        // 重新获得引用（如新会话读到同一份内容）→ 下一轮恢复
        ext.acquire_raw_ref(&r.content_hash, owner_kind::CONTEXT_ANCHOR, "sess-x", false)
            .await
            .unwrap();
        let report = run_gc_pass_with(
            &storage,
            &ext,
            &raw,
            now + DAY_MS,
            &EvictionPolicy::default(),
        )
        .await
        .unwrap();
        assert_eq!(report.raw_restored, 1, "重新获引应移出回收站");
        assert_eq!(report.raw_protected, 1);
        // 窗口早已超过，但受保护 → 不硬删
        let report = run_gc_pass_with(
            &storage,
            &ext,
            &raw,
            now + 100 * DAY_MS,
            &EvictionPolicy::default(),
        )
        .await
        .unwrap();
        assert_eq!(report.raw_purged, 0, "有引用不得硬删");
        assert!(raw.contains(&r.content_hash));
    }

    #[tokio::test]
    async fn pinned_ref_protects_raw_file_from_gc() {
        let (_dir, ext, raw, storage) = setup();
        let r = raw.store("置顶保护的内容").unwrap();
        // 软删的 pinned 引用：有效引用数 0，但 pinned → 仍受保护
        ext.acquire_raw_ref(&r.content_hash, owner_kind::ARCHIVE, "hook-p", true)
            .await
            .unwrap();
        ext.soft_delete_raw_refs(&r.content_hash).await.unwrap();

        let report = run_gc_pass_with(&storage, &ext, &raw, 2_000 * DAY_MS, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report.raw_trashed, 0, "pinned 不入回收站");
        assert_eq!(report.raw_purged, 0);
        assert!(raw.contains(&r.content_hash));
    }

    #[tokio::test]
    async fn orphan_trash_records_are_pruned() {
        let (_dir, ext, _raw, storage) = setup();
        // 回收站里有一个文件已不存在的记录
        ext.trash_put("deadbeefdeadbeef", 0).await.unwrap();
        let report = run_gc_pass_with(
            &storage,
            &ext,
            &_raw,
            1_000_000_000_000,
            &EvictionPolicy::default(),
        )
        .await
        .unwrap();
        assert_eq!(report.trash_pruned, 1, "孤儿回收站记录应被收敛");
    }

    #[tokio::test]
    async fn memory_entries_decay_deprecate_then_evict() {
        let (_dir, ext, raw, storage) = setup();
        let now = 1_000_000_000_000i64;
        // 先落一条记忆行（拿真实 memory_id），再按其登记扩展行并回溯 created_at 到 1 年前
        let memory_id = seed_memory(&storage, "sess-1").await;
        ext.ensure_memory_ext(&memory_id, "hook-old", now - 365 * DAY_MS, "rule")
            .await
            .unwrap();
        // 一条新记忆 → 不淘汰
        ext.ensure_memory_ext("mem-new", "hook-new", now, "rule")
            .await
            .unwrap();

        let report = run_gc_pass_with(&storage, &ext, &raw, now, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report.decay_scored, 2);
        assert_eq!(report.newly_deprecated, 1, "仅一年前的记忆应软淘汰");

        let old = ext.get_by_hook("hook-old").await.unwrap().unwrap();
        assert!(old.deprecated_at.is_some());
        assert!(old.decay_score < 0.15);
        let new = ext.get_by_hook("hook-new").await.unwrap().unwrap();
        assert!(new.deprecated_at.is_none());

        // 未满 90 天 → 不硬删
        let report = run_gc_pass_with(
            &storage,
            &ext,
            &raw,
            now + 30 * DAY_MS,
            &EvictionPolicy::default(),
        )
        .await
        .unwrap();
        assert_eq!(report.entries_evicted, 0);

        // 满 90 天 → 硬删（memories 行 + 扩展行）
        let report = run_gc_pass_with(
            &storage,
            &ext,
            &raw,
            now + 91 * DAY_MS,
            &EvictionPolicy::default(),
        )
        .await
        .unwrap();
        assert_eq!(report.entries_evicted, 1, "回收站满 90 天应硬删");
        assert_eq!(
            report.evicted_hooks,
            vec!["hook-old".to_string()],
            "A2 戊1：硬删 hook 应回传（装配层据此同步检索索引）"
        );
        assert!(
            ext.get_memory_ext(&memory_id).await.unwrap().is_none(),
            "扩展行应清理"
        );
        assert!(
            storage.read_memory(&memory_id).await.is_err(),
            "memories 行应被物理删除"
        );
    }

    #[tokio::test]
    async fn recency_restores_deprecated_entry() {
        let (_dir, ext, raw, storage) = setup();
        let now = 1_000_000_000_000i64;
        ext.ensure_memory_ext("mem-a", "hook-a", now - 365 * DAY_MS, "rule")
            .await
            .unwrap();
        run_gc_pass_with(&storage, &ext, &raw, now, &EvictionPolicy::default())
            .await
            .unwrap();
        assert!(ext
            .get_by_hook("hook-a")
            .await
            .unwrap()
            .unwrap()
            .deprecated_at
            .is_some());

        // 召回命中（访问记录刷新到「现在」）→ 下一轮恢复
        ext.touch_by_hook("hook-a", now).await.unwrap();
        let report = run_gc_pass_with(
            &storage,
            &ext,
            &raw,
            now + DAY_MS,
            &EvictionPolicy::default(),
        )
        .await
        .unwrap();
        assert_eq!(report.restored, 1, "召回返青应恢复条目");
        assert!(ext
            .get_by_hook("hook-a")
            .await
            .unwrap()
            .unwrap()
            .deprecated_at
            .is_none());
    }

    #[tokio::test]
    async fn pinned_entry_never_deprecated_or_evicted() {
        let (_dir, ext, raw, storage) = setup();
        let now = 1_000_000_000_000i64;
        ext.ensure_memory_ext("mem-pin", "hook-pin", now - 10 * 365 * DAY_MS, "rule")
            .await
            .unwrap();
        ext.set_pinned_by_hook("hook-pin", true).await.unwrap();

        let report = run_gc_pass_with(&storage, &ext, &raw, now, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report.newly_deprecated, 0, "pinned 永不软淘汰");
        let row = ext.get_by_hook("hook-pin").await.unwrap().unwrap();
        assert_eq!(row.decay_score, 1.0);
        assert!(row.deprecated_at.is_none());
    }

    #[tokio::test]
    async fn empty_run_is_clean_and_idempotent() {
        let (_dir, ext, raw, storage) = setup();
        let report = run_gc_pass_with(&storage, &ext, &raw, 1_000_000_000_000, &EvictionPolicy::default())
            .await
            .unwrap();
        assert!(!report.did_something(), "空目录巡检应无动作");
        // 重入无副作用
        let again = run_gc_pass_with(&storage, &ext, &raw, 1_000_000_000_001, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report, again);
    }

    // ─── 丁3：跨分片巡检与守卫 ──────────────────────────────

    /// 跨分片守卫（丁3 核心修复）：外置文件被「另一分片」引用时不得硬删
    ///
    /// 外置文件全局共享（内容寻址），而引用表/回收站按项目分片——
    /// 若按分片独立判定，p2 分片（无引用）会把 p1 仍在引用的原文误删。
    #[tokio::test]
    async fn cross_shard_gc_protects_shared_raw_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();

        let raw = RawStore::open(root.clone()).unwrap();
        let r = raw.store("被 p1 引用的原文").unwrap();

        // p1：登记有效引用；p2：无引用（孤立视角）
        let ext_p1 = ExtStore::open(root.clone(), Some("p1".to_string())).unwrap();
        ext_p1
            .acquire_raw_ref(&r.content_hash, owner_kind::CONTEXT_ANCHOR, "sess-1", false)
            .await
            .unwrap();
        let _ext_p2 = ExtStore::open(root.clone(), Some("p2".to_string())).unwrap();

        let now = 1_000_000_000_000i64;
        // 两轮（第二轮远超回收站窗口）：分片独立判定时 p2 会误删
        for step in [0i64, 100 * DAY_MS] {
            let report = run_gc_pass(&root, now + step, &EvictionPolicy::default())
                .await
                .unwrap();
            assert_eq!(report.raw_purged, 0, "p1 仍引用时不得硬删");
        }
        assert!(raw.contains(&r.content_hash), "跨分片共享的原文必须保留");
    }

    /// 全分片皆无引用 → 正常入回收站并按窗口硬删（跨分片守卫不误保护）
    #[tokio::test]
    async fn cross_shard_gc_purges_when_all_shards_release() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let raw = RawStore::open(root.clone()).unwrap();
        let r = raw.store("无人引用的原文").unwrap();

        // 两个分片都曾有引用（已软删）——当前皆无有效引用
        for pid in ["p1", "p2"] {
            let ext = ExtStore::open(root.clone(), Some(pid.to_string())).unwrap();
            ext.acquire_raw_ref(
                &r.content_hash,
                owner_kind::ARCHIVE,
                &format!("hook-{pid}"),
                false,
            )
            .await
            .unwrap();
            ext.soft_delete_raw_refs(&r.content_hash).await.unwrap();
        }

        let now = 1_000_000_000_000i64;
        // 首轮：全分片无引用 → 各分片补记时点 → 入回收站（未到期）
        let report = run_gc_pass(&root, now, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report.raw_trashed, 1, "首次入回收站计一次（跨分片不重复计数）");
        assert_eq!(report.raw_purged, 0);

        // +8 天：满 7 天窗口 → 硬删（并清全分片引用与回收站记录）
        let report = run_gc_pass(&root, now + 8 * DAY_MS, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report.raw_purged, 1, "全分片释放满窗口后应硬删");
        assert!(!raw.contains(&r.content_hash));
        for pid in ["p1", "p2"] {
            let ext = ExtStore::open(root.clone(), Some(pid.to_string())).unwrap();
            assert!(
                ext.trash_taken_at(&r.content_hash).await.unwrap().is_none(),
                "{pid} 的回收站记录应一并清理"
            );
        }
    }

    /// 巡检遍历全部分片：各分片的到期条目都被硬删（`evicted_hooks` 聚合回传）
    #[tokio::test]
    async fn gc_pass_traverses_all_shards() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let now = 1_000_000_000_000i64;

        // p1 / p2 各 seed 一条一年前的记忆扩展行（指向各自分片的记忆库）
        for pid in ["p1", "p2"] {
            let ext = ExtStore::open(root.clone(), Some(pid.to_string())).unwrap();
            let storage = SqliteStorage::new(root.clone(), Some(pid.to_string())).unwrap();
            let memory_id = seed_memory(&storage, "sess-x").await;
            ext.ensure_memory_ext(&memory_id, &format!("hook-{pid}"), now - 365 * DAY_MS, "rule")
                .await
                .unwrap();
        }

        // 首轮：两分片各软淘汰 1 条
        let report = run_gc_pass(&root, now, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report.newly_deprecated, 2, "两个分片各软淘汰一条");

        // +91 天：两分片各硬删 1 条（遍历生效），hook 聚合回传
        let report = run_gc_pass(&root, now + 91 * DAY_MS, &EvictionPolicy::default())
            .await
            .unwrap();
        assert_eq!(report.entries_evicted, 2, "两个分片各硬删一条");
        let mut hooks = report.evicted_hooks.clone();
        hooks.sort();
        assert_eq!(hooks, vec!["hook-p1".to_string(), "hook-p2".to_string()]);
    }
}
