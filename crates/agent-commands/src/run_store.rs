//! # run 注册表 — 请求级编排上下文实体（B22，M1）
//!
//! `OrchestrationRun` 是一次「请求」的真实实体：判型选型 = run 形状，
//! 子 run 挂父 run 之下成树（委派生成，层级 ≤3），交接物区与决策记录随 run 驻内存。
//! 仅多阶段/深水区 run 懒持久 SQLite（v1.5 表结构），纯退化 run 不落表；
//! 重启 = 运行中 run 蒸发（会话历史只剩消息，可接受）——本模块 v1 纯内存。

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_runtime::types::{ConvergeReason, HandoverArtifact};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

/// run 出口状态机（B0-3 五出口 + Interrupted）— 与 kernel `OrchestratorEndStatus` 并行：
/// 后者是编排器单次 run 的出口，本枚举是 run 实体的生命周期状态（可含用户中断态）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Running,
    Completed,
    Aborted,
    Error,
    Timeout,
    Interrupted,
}

/// 决策记录（B0-8 / B0-9：七类决策点全部留痕）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionRecord {
    /// 决策类型（judge_type / split / delegate / review / replan / degrade / fallback）
    pub kind: String,
    /// 决策输入摘要
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub input: Option<String>,
    /// 决策输出
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub output: Option<String>,
    /// 决策理由（判型理由 / 委派 reasoning 等）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reason: Option<String>,
}

/// 请求级编排上下文实体（04-方案 §3.1）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationRun {
    /// 唯一 ID（事件 / 迹线 / 中止聚合键）
    pub run_id: String,
    /// 会话归属（会话 1:N run，v1 顶层串行）
    pub session_id: String,
    /// 子 run 树（委派生成，层级 ≤3）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub parent_run_id: Option<String>,
    /// 出口状态
    pub status: RunStatus,
    /// 收敛原因（B0-4：超限也是收敛）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub converge_reason: Option<ConvergeReason>,
    /// 判型选中的管线形状（预设 id）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pipeline: Option<String>,
    /// 交接物区（D23）
    #[serde(default)]
    pub artifacts: Vec<HandoverArtifact>,
    /// 决策记录（判型理由 / 委派 reasoning）
    #[serde(default)]
    pub decisions: Vec<DecisionRecord>,
    /// 时长统计（子 run 可见"谁干了多久"）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub started_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub finished_at: Option<i64>,
    /// 终局结论
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub final_message: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// run 注册表 — v1 纯内存（HashMap），懒持久化留 v1.5 表结构
#[derive(Default)]
pub struct RunStore {
    runs: RwLock<HashMap<String, OrchestrationRun>>,
    /// 会话当前活跃顶层 run（B11 顶层串行；供委派子 run 挂接父 run，M3-1）
    ///
    /// 由 `create(parent=None)` 自动设为当前、`finish` 仅当仍指向自身时清除；
    /// 顶层 run 串行约束下任意时刻至多一个活跃顶层 run。
    current_top_run: RwLock<Option<String>>,
}

impl RunStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// 登记一个 run，返回 run_id（外部可用作 OrchestratorRunOptions.run_id）
    ///
    /// 顶层 run（`parent_run_id=None`）自动成为「会话当前活跃顶层 run」
    /// （供委派子 run 挂接父 run，M3-1）；子 run 不抢占。
    pub async fn create(
        &self,
        session_id: &str,
        parent_run_id: Option<String>,
        pipeline: Option<String>,
    ) -> String {
        let run_id = uuid::Uuid::new_v4().to_string();
        let is_top = parent_run_id.is_none();
        let run = OrchestrationRun {
            run_id: run_id.clone(),
            session_id: session_id.to_string(),
            parent_run_id,
            status: RunStatus::Running,
            converge_reason: None,
            pipeline,
            artifacts: Vec::new(),
            decisions: Vec::new(),
            started_at: Some(now_ms()),
            finished_at: None,
            final_message: None,
        };
        self.runs.write().await.insert(run_id.clone(), run);
        if is_top {
            *self.current_top_run.write().await = Some(run_id.clone());
        }
        run_id
    }

    /// 当前活跃顶层 run（M3-1：委派子 run 的父 run 定位）
    pub async fn current_top_run(&self) -> Option<String> {
        self.current_top_run.read().await.clone()
    }

    pub async fn get(&self, run_id: &str) -> Option<OrchestrationRun> {
        self.runs.read().await.get(run_id).cloned()
    }

    /// 按会话列出（供 get_session_runs 查询 / 调试）
    pub async fn list_by_session(&self, session_id: &str) -> Vec<OrchestrationRun> {
        let guard = self.runs.read().await;
        let mut runs: Vec<_> = guard
            .values()
            .filter(|r| r.session_id == session_id)
            .cloned()
            .collect();
        runs.sort_by_key(|r| r.started_at.unwrap_or(0));
        runs
    }

    /// run 收口（正常出口：Completed/Aborted/Error/Timeout/Interrupted）
    ///
    /// 若收口的是当前活跃顶层 run → 清除 current_top_run（子 run 收口不清理父指针）。
    pub async fn finish(
        &self,
        run_id: &str,
        status: RunStatus,
        converge_reason: Option<ConvergeReason>,
        final_message: Option<String>,
    ) {
        let mut guard = self.runs.write().await;
        if let Some(run) = guard.get_mut(run_id) {
            run.status = status;
            run.converge_reason = converge_reason;
            run.final_message = final_message;
            run.finished_at = Some(now_ms());
        }
        let is_top = guard.get(run_id).map(|r| r.parent_run_id.is_none()).unwrap_or(false);
        drop(guard); // 释放 runs 写锁，避免与其他路径的锁序纠缠
        if is_top {
            // 注意：read guard 必须在此块内 drop 后再请求 write，否则同任务自锁（tokio RwLock 写优先）
            let cur = { self.current_top_run.read().await.clone() };
            if cur.as_deref() == Some(run_id) {
                *self.current_top_run.write().await = None;
            }
        }
    }

    /// 追加交接物（D23：物权威，迹线事件只引用 artifact_id + summary）
    pub async fn add_artifact(&self, run_id: &str, artifact: HandoverArtifact) {
        let mut guard = self.runs.write().await;
        if let Some(run) = guard.get_mut(run_id) {
            run.artifacts.push(artifact);
        }
    }

    /// 追加决策记录（B0-8/9）
    pub async fn add_decision(&self, run_id: &str, decision: DecisionRecord) {
        let mut guard = self.runs.write().await;
        if let Some(run) = guard.get_mut(run_id) {
            run.decisions.push(decision);
        }
    }

    /// 按 artifact_id 取物全文（FIX-1：get_artifact 命令的后端）
    pub async fn get_artifact(&self, artifact_id: &str) -> Option<HandoverArtifact> {
        let guard = self.runs.read().await;
        guard
            .values()
            .flat_map(|r| r.artifacts.iter())
            .find(|a| a.artifact_id == artifact_id)
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn create_finish_get_roundtrip() {
        let store = RunStore::new();
        let run_id = store
            .create("s1", None, Some("research-plan".to_string()))
            .await;
        let run = store.get(&run_id).await.unwrap();
        assert_eq!(run.status, RunStatus::Running);
        assert_eq!(run.pipeline.as_deref(), Some("research-plan"));

        store
            .finish(
                &run_id,
                RunStatus::Completed,
                Some(ConvergeReason::GoalReached),
                Some("done".to_string()),
            )
            .await;
        let run = store.get(&run_id).await.unwrap();
        assert_eq!(run.status, RunStatus::Completed);
        assert_eq!(run.converge_reason, Some(ConvergeReason::GoalReached));
        assert_eq!(run.final_message.as_deref(), Some("done"));
        assert!(run.finished_at.is_some());
    }

    #[tokio::test]
    async fn list_by_session_filters_and_sorts() {
        let store = RunStore::new();
        let r1 = store.create("s1", None, None).await;
        store.create("s2", None, None).await;
        let r3 = store.create("s1", Some(r1.clone()), None).await;
        let runs = store.list_by_session("s1").await;
        assert_eq!(runs.len(), 2);
        assert!(runs.iter().all(|r| r.session_id == "s1"));
        // started_at 同毫秒时排序不稳定：不断言顺序，仅断言两 run 都归属 s1
        let ids: Vec<&str> = runs.iter().map(|r| r.run_id.as_str()).collect();
        assert!(ids.contains(&r1.as_str()));
        assert!(ids.contains(&r3.as_str()));
    }

    #[tokio::test]
    async fn artifact_lookup_by_id() {
        let store = RunStore::new();
        let run_id = store.create("s1", None, None).await;
        let artifact = HandoverArtifact {
            artifact_id: "art-1".into(),
            run_id: run_id.clone(),
            from_node: "plan".into(),
            kind: agent_runtime::types::ArtifactKind::Plan(Vec::new()),
            summary: "计划已生成".into(),
            produced_at: now_ms(),
        };
        store.add_artifact(&run_id, artifact).await;
        let found = store.get_artifact("art-1").await;
        assert!(found.is_some());
        assert_eq!(found.unwrap().from_node, "plan");
    }

    #[tokio::test]
    async fn current_top_run_tracks_top_and_clears_on_finish() {
        // M3-1：顶层 run 自动成为 current；子 run 不抢占；顶层收口后清除
        let store = RunStore::new();
        let top = store.create("s1", None, Some("research-plan".to_string())).await;
        assert_eq!(store.current_top_run().await.as_deref(), Some(top.as_str()));

        // 子 run 不覆盖 current
        let child = store.create("s1", Some(top.clone()), Some("sub:worker".to_string())).await;
        assert_eq!(store.current_top_run().await.as_deref(), Some(top.as_str()));

        // 子 run 收口不清除 current
        store.finish(&child, RunStatus::Completed, Some(ConvergeReason::GoalReached), Some("ok".to_string())).await;
        assert_eq!(store.current_top_run().await.as_deref(), Some(top.as_str()));

        // 顶层收口清除
        store.finish(&top, RunStatus::Completed, Some(ConvergeReason::GoalReached), Some("done".to_string())).await;
        assert_eq!(store.current_top_run().await, None);
    }

    #[tokio::test]
    async fn new_top_run_replaces_current() {
        let store = RunStore::new();
        let a = store.create("s1", None, None).await;
        let b = store.create("s1", None, None).await;
        // 新顶层 run 覆盖 current（B11 串行：前一 run 应已收口）
        assert_eq!(store.current_top_run().await.as_deref(), Some(b.as_str()));
        // 收口旧 run（非 current）不清除新的
        store.finish(&a, RunStatus::Completed, Some(ConvergeReason::GoalReached), None).await;
        assert_eq!(store.current_top_run().await.as_deref(), Some(b.as_str()));
    }
}