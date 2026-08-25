use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ─── 共享黑板 ────────────────────────────────────────────

/// 共享黑板 — 全局共享上下文
///
/// 所有 Agent 通过 `Arc<RwLock<SharedBlackboard>>` 并发读写。
/// 设计为简单 KV 存储，避免与具体业务耦合。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedBlackboard {
    /// 原始任务（用户输入）
    pub task: String,
    /// 共享上下文 KV（Agent 可写入中间产物、配置等）
    pub shared_context: HashMap<String, String>,
    /// 每个 Agent 的输出历史（agent_id → [outputs]）
    pub agent_outputs: HashMap<String, Vec<String>>,
    /// 最终结果（任一 Agent 写入即视为达成目标）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_result: Option<String>,
    /// 已完成的轮次数
    pub rounds_completed: usize,
}

impl SharedBlackboard {
    /// 创建新的黑板
    pub fn new(task: impl Into<String>) -> Self {
        Self {
            task: task.into(),
            shared_context: HashMap::new(),
            agent_outputs: HashMap::new(),
            final_result: None,
            rounds_completed: 0,
        }
    }

    /// 写入共享上下文 KV
    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.shared_context.insert(key.into(), value.into());
    }

    /// 读取共享上下文 KV
    pub fn get(&self, key: &str) -> Option<&String> {
        self.shared_context.get(key)
    }

    /// 追加 Agent 输出
    pub fn append_output(&mut self, agent_id: impl Into<String>, output: impl Into<String>) {
        self.agent_outputs
            .entry(agent_id.into())
            .or_default()
            .push(output.into());
    }

    /// 获取 Agent 的所有输出
    pub fn get_outputs(&self, agent_id: &str) -> &[String] {
        self.agent_outputs
            .get(agent_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// 设置最终结果
    pub fn set_final_result(&mut self, result: impl Into<String>) {
        self.final_result = Some(result.into());
    }

    /// 增加完成轮次
    pub fn increment_rounds(&mut self) {
        self.rounds_completed += 1;
    }
}
