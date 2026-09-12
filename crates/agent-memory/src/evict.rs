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

/// 对某个记忆根目录跑**一轮**完整巡检
///
/// - `root`：记忆存储根（与 `MemoryCenterAccessor::new_sqlite` 同源）
/// - `now_ms`：巡检时点（Unix 毫秒；显式传入以便测试与回放）
/// - `policy`：淘汰策略参数（[`EvictionPolicy::default`] 即设计起点）
///
/// 记忆分片固定为 `None`（→ `_default`）——与 `build_memory_accessor` 的当前实现一致；
/// 丁3 `project_id` 记忆隔离落地后，此处需同步升级为按项目分片巡检（届时由调度层
/// 遍历项目列表逐个调用）。
pub async fn run_gc_pass(
    root: &Path,
    now_ms: i64,
    policy: &EvictionPolicy,
) -> Result<GcReport, String> {
    let ext = ExtStore::open(root.to_path_buf(), None).map_err(|e| e.to_string())?;
    let raw = RawStore::open(root.to_path_buf()).map_err(|e| e.to_string())?;
    let storage = SqliteStorage::new(root.to_path_buf(), None).map_err(|e| e.to_string())?;
    run_gc_pass_with(&storage, &ext, &raw, now_ms, policy).await
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

    // ── ① 衰减 + 软淘汰/恢复（可逆，不删任何东西）────────────────
    let decay = ext
        .apply_decay(now_ms, *policy)
        .await
        .map_err(|e| e.to_string())?;
    report.decay_scored = decay.scored;
    report.newly_deprecated = decay.newly_deprecated.len();
    report.restored = decay.restored;

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

    // ── ③ 外置文件 GC ────────────────────────────────────────────
    // ③a 恢复：回收站中但已重新获引的（内容寻址使「同内容再次出现」= 同坐标）
    for (hash, _) in ext.trash_list().await.map_err(|e| e.to_string())? {
        let eligible = ext
            .is_gc_eligible(&hash)
            .await
            .map_err(|e| e.to_string())?;
        if !eligible {
            if ext
                .trash_restore(&hash)
                .await
                .map_err(|e| e.to_string())?
            {
                report.raw_restored += 1;
            }
        } else if !raw.contains(&hash) {
            // 孤儿记录：文件已不在（外部清理 / 上次硬删中断）→ 收敛
            ext.trash_forget(&hash).await.map_err(|e| e.to_string())?;
            report.trash_pruned += 1;
        }
    }

    // ③b 扫描磁盘文件：判定 → 入回收站 → 到期硬删
    let retention_ms = policy.trash_retention_ms();
    for hash in raw.list_hashes() {
        let eligible = ext
            .is_gc_eligible(&hash)
            .await
            .map_err(|e| e.to_string())?;
        if !eligible {
            report.raw_protected += 1;
            continue;
        }
        match ext
            .trash_taken_at(&hash)
            .await
            .map_err(|e| e.to_string())?
        {
            None => {
                // 首次失去引用 → 入回收站（时点自此刻起算）
                ext.trash_put(&hash, now_ms).await.map_err(|e| e.to_string())?;
                report.raw_trashed += 1;
            }
            Some(taken) if now_ms.saturating_sub(taken) >= retention_ms => {
                // 回收站到期 → 硬删：先删物理文件、再清引用行、最后清回收站记录
                if !raw.delete(&hash) {
                    // 删文件失败：不清理引用与回收站记录（留待下次巡检重试，
                    // 保持「文件与引用记录同进出」的可追溯性）
                    tracing::warn!(hash = %hash, "硬删外置文件失败（保留记录待重试）");
                    continue;
                }
                ext.purge_raw_refs(&hash)
                    .await
                    .map_err(|e| e.to_string())?;
                ext.trash_forget(&hash).await.map_err(|e| e.to_string())?;
                report.raw_purged += 1;
            }
            Some(_) => {
                // 回收站窗口内：不动（等满 trash_retention_days）
            }
        }
    }

    Ok(report)
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
}
