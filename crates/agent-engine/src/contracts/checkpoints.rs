//! 检查点契约（S3-e 合并裁定 · 方案 A：**类型层统一 + 单查询入口**）
//!
//! 背景：会话检查点（请求边界**指针**，S3-d 落地）与长任务断点（`LongTaskCheckpoint`
//! **快照**，B9 既有）此前是两套概念/接口；[09-S3e §四 Q2] 拍板按 04-§2.5 原文
//! 「与长任务 `CheckpointProvider` 合并为同一接口（不新建第二套）」，
//! 落地形态经 [10-设计草案] 选型为方案 A（用户 2026-09-22 拍板）：
//!
//! - **[`CheckpointRef`] = 两类检查点的统一引用视图**（单一概念面）——只含定位与元信息、
//!   不含载荷；载荷各归其位（会话锚点无载荷；任务断点快照仍在 `long_tasks` 记录里）。
//! - 存储与保留策略**天然分治**：锚点按数量淘汰；任务断点随任务生命周期，不参与锚点淘汰。
//! - 消费方：`agent-commands::session_checkpoint::list_checkpoint_refs`（统一查询入口）。

use serde::{Deserialize, Serialize};

/// 检查点种类（统一概念面；S3-e 合并裁定）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckpointKind {
    /// 会话锚点：视图可回到的请求边界（**轻**——内容由不可变日志 + 请求快照链承载）
    SessionAnchor,
    /// 任务断点：长任务可续跑的状态快照（**重**——快照本体在任务记录中）
    TaskResume,
}

/// 检查点定位（两类载体各自的坐标）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CheckpointAnchor {
    /// 请求边界（会话锚点坐标；与请求快照重建链同源）
    RequestBoundary {
        /// 会话内请求序号
        request_seq: i64,
    },
    /// 任务进度（任务断点坐标；快照本体由任务记录承载）
    TaskProgress {
        /// 长任务 id
        task_id: String,
    },
}

/// 统一检查点引用（查询视图；不含载荷）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct CheckpointRef {
    /// 检查点 id（会话锚点 = `session_checkpoints.id`；任务断点 = `task_id`）
    pub id: String,
    /// 归属会话（会话锚点恒有；任务断点在引入会话绑定前为 `None`）
    pub session_id: Option<String>,
    /// 定位坐标
    pub anchor: CheckpointAnchor,
    /// 创建 / 最后更新时点（Unix 毫秒；跨源合并排序用）
    pub created_at_ms: i64,
}

impl CheckpointRef {
    /// 种类（由 [`Self::anchor`] 派生——单一事实源，避免并列字段漂移）
    pub fn kind(&self) -> CheckpointKind {
        match self.anchor {
            CheckpointAnchor::RequestBoundary { .. } => CheckpointKind::SessionAnchor,
            CheckpointAnchor::TaskProgress { .. } => CheckpointKind::TaskResume,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_derives_from_anchor() {
        let anchor_ref = CheckpointRef {
            id: "cp-1".into(),
            session_id: Some("s1".into()),
            anchor: CheckpointAnchor::RequestBoundary { request_seq: 7 },
            created_at_ms: 100,
        };
        assert_eq!(anchor_ref.kind(), CheckpointKind::SessionAnchor);
        let task_ref = CheckpointRef {
            id: "longtask-main-1".into(),
            session_id: None,
            anchor: CheckpointAnchor::TaskProgress { task_id: "longtask-main-1".into() },
            created_at_ms: 200,
        };
        assert_eq!(task_ref.kind(), CheckpointKind::TaskResume);
    }

    #[test]
    fn refs_serde_roundtrip_snake_case() {
        // 跨层传递口径（与 contracts 既有约定一致：snake_case；anchor 以 kind 标签区分）
        let anchor_ref = CheckpointRef {
            id: "cp-1".into(),
            session_id: Some("s1".into()),
            anchor: CheckpointAnchor::RequestBoundary { request_seq: 3 },
            created_at_ms: 100,
        };
        let json = serde_json::to_string(&anchor_ref).unwrap();
        assert!(json.contains("\"request_boundary\""), "anchor 标签应 snake_case: {json}");
        assert!(json.contains("\"session_id\":\"s1\""));
        let back: CheckpointRef = serde_json::from_str(&json).unwrap();
        assert_eq!(back, anchor_ref);

        let task_ref = CheckpointRef {
            id: "t-1".into(),
            session_id: None,
            anchor: CheckpointAnchor::TaskProgress { task_id: "t-1".into() },
            created_at_ms: 200,
        };
        let back: CheckpointRef =
            serde_json::from_str(&serde_json::to_string(&task_ref).unwrap()).unwrap();
        assert_eq!(back, task_ref);
        assert_eq!(serde_json::to_string(&CheckpointKind::TaskResume).unwrap(), "\"task_resume\"");
    }
}
