//! # 衰减评分与三级淘汰策略（A1 甲3）
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §4.3 / §6.3.2。
//!
//! ## 要解决的问题
//!
//! 改造前「会遗忘」一栏是空的：记忆只增不减，被裁历史只解除引用（丙2 阶段 B 保住了
//! 内容，但没有淘汰），外置原文只增不删。没有衰减与淘汰，记忆库与外置目录都会无限增长。
//!
//! ## 三级链（本模块提供纯函数，执行在 [`crate::evict`]）
//!
//! ```text
//!   写入 ──▶ [保护期] ──▶ [软淘汰·回收站] ──▶ [硬删]
//!              │              │ 7 天(外置) / 90 天(条目) │
//!              │              └── 恢复 ──▶ 回保护期
//!              │
//!              └─ 保护条件（任一成立即不衰减/不淘汰）：
//!                 · pinned = true          （永不衰减、永不淘汰）
//!                 · 有活跃引用（ref_count > 0，外置文件侧）
//! ```
//!
//! | 级别 | 判据 | 动作 |
//! |---|---|---|
//! | 衰减评分 | [`score`]（半衰期指数衰减 + 访问加权） | 更新 `decay_score` |
//! | 软淘汰 | `score < deprecated_threshold`（0.15） | 标记 `deprecated_at`（入回收站，**可恢复**） |
//! | 硬删 | 回收站到期（`delete_after_days` = 90）且无引用 | 物理删除（DB 行 + 外置文件） |
//!
//! ## 参数起点（取自 `packages/memory-archive/src/defaults.ts:24-28`）
//!
//! `halfLifeDays = 30` · `deprecatedThreshold = 0.15` · `deleteAfterDays = 90` ·
//! `trashRetentionDays = 7`——设计文档 §4.3 明示「起点」，本模块固化为一处常量，
//! 落 `EvictionPolicy`。
//!
//! ## 评分公式（与 memory-archive P16 同构）
//!
//! ```text
//! score = time_factor × (0.4 + 0.3 × access_factor + 0.3 × recency_factor)
//!
//!   time_factor    = 0.5 ^ (age_days / half_life_days)      // 半衰期指数衰减
//!   access_factor  = ln(1 + access_count) / ln(10)          // 访问频次（对数压缩）
//!   recency_factor = 1.0（≤7 天）/ 0.5（≤30 天）/ 0（更久）  // 最近访问
//! ```
//!
//! **与 memory-archive 的一处有意偏离**：去掉了 `importance_weight`
//! （`0.5 + importance × 0.5`）。理由——vendor `MemoryFile.importance` 虽在模型中
//! （0-100），但**当前没有任何写入路径会把它置为非 0**，此时引入该权重等于给所有
//! 条目乘一个常数 0.5（只是把有效半衰期缩短一半），不带来任何区分度。
//! 待重要性有真实来源（UI 标注 / 用户显式提升）时再接入，接口位置已预留在
//! [`score`] 的入参上（新增参数即可，调用点集中）。
//!
//! ## 恢复语义
//!
//! 软淘汰**可逆**：重新被召回命中（`access_count` / `last_access_at` 更新）后
//! score 回升至阈值以上时，`apply_decay` 会**清除 `deprecated_at`**（回保护期）。
//! 硬删**不可逆**——故硬删前的回收站窗口（90 天）是唯一的安全垫。

/// 一天的毫秒数（时间换算的唯一常量）
pub const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// 淘汰策略参数（三级链的全部阈值；`Copy`，可自由传递）
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EvictionPolicy {
    /// 半衰期（天）——`time_factor = 0.5 ^ (age / half_life)`
    pub half_life_days: f64,
    /// 软淘汰阈值——`score < 该值` 且未软删 → 标记 `deprecated_at`
    pub deprecated_threshold: f64,
    /// 硬删期限（天）——软删满该天数且无引用 → 物理删除
    pub delete_after_days: f64,
    /// 回收站保留（天）——**外置文件**软删（入回收站）满该天数 → 物理删除
    ///
    /// 与 `delete_after_days` 的分工：前者管**外置文件**（无引用即入回收站，
    /// §6.3.2），后者管**记忆条目**（软淘汰后多久物理删）。两者是不同对象的时钟。
    pub trash_retention_days: f64,
}

impl Default for EvictionPolicy {
    fn default() -> Self {
        Self {
            half_life_days: 30.0,
            deprecated_threshold: 0.15,
            delete_after_days: 90.0,
            trash_retention_days: 7.0,
        }
    }
}

impl EvictionPolicy {
    /// 硬删期限（毫秒）——软删时点距今超过此值即到期
    pub fn delete_after_ms(&self) -> i64 {
        (self.delete_after_days * DAY_MS as f64) as i64
    }

    /// 回收站保留期（毫秒）——外置文件入回收站后多久可硬删
    pub fn trash_retention_ms(&self) -> i64 {
        (self.trash_retention_days * DAY_MS as f64) as i64
    }

    /// 是否达到软淘汰条件
    pub fn is_deprecated(&self, score: f64) -> bool {
        score < self.deprecated_threshold
    }
}

/// 衰减评分（0.0–1.0）
///
/// - `created_at_ms`：记忆发生时点（Unix 毫秒）
/// - `last_access_at_ms`：最近一次召回命中的时点（`0` = 从未访问，回退到发生时点）
/// - `access_count`：累计召回命中次数
/// - `pinned`：置顶条目直接返回 `1.0`（永不衰减）
/// - `now_ms`：评分时点
///
/// 未访问过的条目用「发生时点」参与 recency 计算（与 memory-archive 的
/// `lastAccessedAt` 缺省即 `createdAt` 一致）；age 取「最近一次活动」，
/// 故一次真实召回即可让条目「返青」。
pub fn score(
    created_at_ms: i64,
    last_access_at_ms: i64,
    access_count: u32,
    pinned: bool,
    now_ms: i64,
    policy: &EvictionPolicy,
) -> f64 {
    if pinned {
        return 1.0;
    }

    let last_activity = if last_access_at_ms > 0 {
        last_access_at_ms.max(created_at_ms)
    } else {
        created_at_ms
    };

    // age 不取负（时点前移的异常数据不放大分数）
    let age_days = ((now_ms - last_activity).max(0) as f64) / DAY_MS as f64;

    // ① 时间衰减（半衰期模型）
    let time_factor = if policy.half_life_days > 0.0 {
        0.5f64.powf(age_days / policy.half_life_days)
    } else {
        0.0
    };

    // ② 访问频次（ln(10) 归一 → 10 次访问达到满值 1.0）
    let access_factor = ((1.0 + access_count as f64).ln() / 10f64.ln()).min(1.0);

    // ③ 最近访问（7 天内返青满值 / 30 天内半值 / 更久归零）
    let days_since_access = ((now_ms - (if last_access_at_ms > 0 { last_access_at_ms } else { created_at_ms }))
        .max(0) as f64)
        / DAY_MS as f64;
    let recency_factor = if days_since_access <= 7.0 {
        1.0
    } else if days_since_access <= 30.0 {
        0.5
    } else {
        0.0
    };

    let raw = time_factor * (0.4 + 0.3 * access_factor + 0.3 * recency_factor);
    raw.clamp(0.0, 1.0)
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const D: i64 = DAY_MS;

    #[test]
    fn pinned_never_decays() {
        let p = EvictionPolicy::default();
        // 一年前的置顶条目仍是满分
        assert_eq!(score(0, 0, 0, true, 365 * D, &p), 1.0);
    }

    #[test]
    fn fresh_entry_scores_high_and_decays_monotonically() {
        let p = EvictionPolicy::default();
        let fresh = score(0, 0, 0, false, 0, &p);
        assert!((fresh - 0.7).abs() < 1e-9, "新条目 = 0.4 + recency 0.3 = 0.7，实际 {fresh}");

        let mut prev = fresh;
        for d in [1i64, 7, 30, 60, 120, 365] {
            let s = score(0, 0, 0, false, d * D, &p);
            assert!(s <= prev + 1e-9, "score 应随时点单调不增（d={d}: {s} > {prev}）");
            prev = s;
        }
        // 一年无访问：远低于阈值
        assert!(p.is_deprecated(prev), "一年无访问应判为软淘汰候选");
    }

    #[test]
    fn half_life_is_exactly_half_at_half_life_days() {
        let p = EvictionPolicy::default();
        // 30 天时 time_factor 恰为 0.5；access=0、recency=0.5（30 天上界）→ 0.5×0.55
        let s30 = score(0, 0, 0, false, 30 * D, &p);
        assert!((s30 - 0.5 * (0.4 + 0.3 * 0.5)).abs() < 1e-9, "实际 {s30}");
    }

    #[test]
    fn access_and_recency_raise_score() {
        let p = EvictionPolicy::default();
        let base = score(0, 0, 0, false, 10 * D, &p);
        // 10 次访问（满值 access_factor=1）应显著抬分
        let accessed = score(0, 0, 9, false, 10 * D, &p);
        assert!(accessed > base, "访问加权应抬分: {accessed} vs {base}");
        // 最近访问（1 天前）比 61 天前分值高
        let recent = score(0, 10 * D - D, 0, false, 10 * D, &p);
        let stale = score(0, 10 * D - 61 * D, 0, false, 10 * D, &p);
        assert!(recent > stale, "最近访问应抬分: {recent} vs {stale}");
    }

    #[test]
    fn deprecated_threshold_crossing_is_around_40_days_without_access() {
        let p = EvictionPolicy::default();
        let mut crossed = None;
        for d in 1..200 {
            let s = score(0, 0, 0, false, d * D, &p);
            if p.is_deprecated(s) {
                crossed = Some(d);
                break;
            }
        }
        let d = crossed.expect("200 天内应跨过阈值");
        assert!(
            (30..=60).contains(&d),
            "无访问条目的软淘汰应在 30–60 天区间（半衰期 30 / 阈值 0.15），实际 {d} 天"
        );
    }

    #[test]
    fn recent_access_resets_effective_age() {
        let p = EvictionPolicy::default();
        // 90 天前创建、但昨天刚被召回：应因 recency 返青、不判淘汰
        let s = score(90 * D, 89 * D, 3, false, 90 * D, &p);
        assert!(!p.is_deprecated(s), "召回后应返青，实际 {s}");
    }

    #[test]
    fn clock_skew_and_zero_values_are_safe() {
        let p = EvictionPolicy::default();
        // now 早于 created（时钟回拨）：不产生 >1 的分数
        let s = score(10 * D, 0, 0, false, 0, &p);
        assert!((0.0..=1.0).contains(&s), "实际 {s}");
        // 零半衰期不除零
        let mut bad = p;
        bad.half_life_days = 0.0;
        assert_eq!(score(0, 0, 0, false, D, &bad), 0.0);
    }

    #[test]
    fn millisecond_conversions_are_consistent() {
        let p = EvictionPolicy::default();
        assert_eq!(p.delete_after_ms(), 90 * DAY_MS);
        assert_eq!(p.trash_retention_ms(), 7 * DAY_MS);
    }
}
