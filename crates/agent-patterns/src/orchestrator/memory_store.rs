//! M4 记忆横切：四层记忆存储（设计 §7）
//!
//! 四层（设计 表 7-1，按生命周期从短到长、抽象度从低到高）：
//! 工作记忆（单任务黑板窗口）/ 情景记忆（单会话历史）/ 语义记忆（跨会话项目知识）/
//! 程序性记忆（跨会话技能与策略）。
//!
//! `LayeredMemoryStore` 是 M1 `MemoryHandle` trait 的参照实现（内存形态）：
//! - **before 钩子召回注入**：按节点最近活动召回各层条目注入节点视图（ctx.recalled）；
//! - **after 钩子沉淀**：节点 `mem.notes` 写入按层落库；
//! - **任务终局归档点**（设计 7.3）：`archive_run` 把任务意图/链路/结果归档为情景
//!   记忆、把治理台账/路由决策提炼为程序性记忆——「下次遇到类似任务能想起来」；
//! - **持久化**：快照/还原（serde）——SQLite 等落盘由宿主注入（本层不绑存储介质）；
//! - **检索**：关键词包含匹配（召回按相关性，M3 简化；embedding 升级不破坏接口）。
//!
//! 边界（设计 7.3 集成纪律）：钩子由执行器统一挂；记忆只影响 prompt 组装，
//! 不改变路由与图结构。

use std::sync::Mutex;


use crate::orchestrator::error::MemoryError;
use crate::orchestrator::executor::RunReport;
use crate::orchestrator::handles::{MemEntry, MemLayer, MemoryHandle};

/// 单层存储：只追加条目（时间序）
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Layer {
    entries: Vec<MemEntry>,
}

/// 四层记忆存储（MemoryHandle 参照实现；Clone 共享语义经 Arc 包装由调用方决定）
#[derive(Default)]
pub struct LayeredMemoryStore {
    layers: Mutex<[Layer; 4]>,
    /// 召回条数上限（每层）
    recall_limit: usize,
}

impl LayeredMemoryStore {
    pub fn new(recall_limit: usize) -> Self {
        Self { layers: Mutex::new(Default::default()), recall_limit }
    }

    fn layer_idx(layer: MemLayer) -> usize {
        match layer {
            MemLayer::Working => 0,
            MemLayer::Episodic => 1,
            MemLayer::Semantic => 2,
            MemLayer::Procedural => 3,
        }
    }

    /// 写入指定层
    pub fn put(&self, layer: MemLayer, key: impl Into<String>, content: impl Into<String>) {
        let mut layers = self.layers.lock().unwrap();
        layers[Self::layer_idx(layer)].entries.push(MemEntry {
            layer,
            key: key.into(),
            content: content.into(),
        });
    }

    /// 关键词召回（跨层；命中条目按层序+时间序返回，截 recall_limit）
    pub fn recall_keyword(&self, query: &str) -> Vec<MemEntry> {
        let q = query.trim();
        let layers = self.layers.lock().unwrap();
        let mut hits = Vec::new();
        if q.is_empty() {
            return hits;
        }
        for layer in layers.iter() {
            for e in &layer.entries {
                if e.content.contains(q) || e.key.contains(q) {
                    hits.push(e.clone());
                }
            }
        }
        let limit = self.recall_limit;
        hits.into_iter().rev().take(limit).collect()
    }

    /// 程序性记忆读取（Router 的 few-shot 示例库来源，设计 6.5/7.4）
    pub fn procedural_few_shot(&self, limit: usize) -> Vec<(String, String)> {
        let layers = self.layers.lock().unwrap();
        layers[Self::layer_idx(MemLayer::Procedural)]
            .entries
            .iter()
            .rev()
            .take(limit)
            .map(|e| (e.key.clone(), e.content.clone()))
            .collect()
    }

    /// 任务终局归档点（设计 §7.3）：意图/链路/结果 → 情景记忆；
    /// 治理台账 → 程序性记忆。RunReport 的步序列即链路选择记录。
    pub fn archive_run(&self, report: &RunReport, chain_label: &str) {
        let steps_desc: Vec<String> = report
            .steps
            .iter()
            .map(|s| format!("{}→{}", s.node, s.port.key()))
            .collect();
        // 情景记忆：本次任务意图 + 链路选择 + 结果摘要（设计 7.3 归档点）
        let result_summary = report
            .result
            .as_ref()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let intent = steps_desc.first().cloned().unwrap_or_default();
        self.put(
            MemLayer::Episodic,
            format!("run@{}", chrono_like_id()),
            format!("链路[{chain_label}] 步骤[{}] 结果[{}]", steps_desc.join(","), truncate(&result_summary, 200)),
        );
        let _ = intent;
        // 程序性记忆：治理台账（用量结构复用价值，设计 表 7-2 各模式「策略（写）」列）
        if !report.steps.is_empty() {
            self.put(
                MemLayer::Procedural,
                format!("ledger/{chain_label}"),
                format!(
                    "步数 {} 用量(in={},out={},calls={}) 终局={:?}",
                    report.steps.len(),
                    report.usage.input_tokens,
                    report.usage.output_tokens,
                    report.usage.llm_calls,
                    report.reason
                ),
            );
        }
    }

    /// 快照（宿主持久化落盘用；四层全量序列化）
    pub fn snapshot(&self) -> serde_json::Value {
        let layers = self.layers.lock().unwrap();
        serde_json::to_value(&*layers).unwrap_or(serde_json::Value::Null)
    }

    /// 从快照还原
    pub fn restore(&self, snap: serde_json::Value) {
        if let Ok(layers) = serde_json::from_value::<[Layer; 4]>(snap) {
            *self.layers.lock().unwrap() = layers;
        }
    }

    /// 层条目数（测试/调试）
    pub fn layer_len(&self, layer: MemLayer) -> usize {
        self.layers.lock().unwrap()[Self::layer_idx(layer)].entries.len()
    }
}

#[async_trait::async_trait]
impl MemoryHandle for LayeredMemoryStore {
    /// before 钩子（执行器调用）：按节点画像召回注入（M3 简化：以节点 id 与
    /// 通用关键词召回；向量检索升级不破坏接口）
    async fn before(&self, node: &str) -> Result<Vec<MemEntry>, MemoryError> {
        Ok(self.recall_keyword(node))
    }

    /// after 钩子（执行器调用）：节点 mem.notes 增量按情景层沉淀；
    /// 空条目不沉淀（沉淀与否由记忆层裁量，设计 4.2 第 4 步）
    async fn after(&self, node: &str, note: MemEntry) -> Result<(), MemoryError> {
        let _ = node;
        if !note.content.trim().is_empty() {
            self.put(note.layer, note.key, note.content);
        }
        Ok(())
    }

    /// 主动检索（节点内直接调用）
    async fn recall(&self, query: &str) -> Result<Vec<MemEntry>, MemoryError> {
        Ok(self.recall_keyword(query))
    }

    /// 主动写入（节点内直接调用）
    async fn store(&self, entry: MemEntry) -> Result<(), MemoryError> {
        self.put(entry.layer, entry.key, entry.content);
        Ok(())
    }
}

/// 轻量时间戳 id（归档键；chrono 不入依赖）
fn chrono_like_id() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        let mut end = max;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        &s[..end]
    }
}
