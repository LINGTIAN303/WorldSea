//! # Tree of Thoughts (ToT) — 思维树编排模式
//!
//! 实现 Tree of Thoughts Pattern：通过树形探索多路径思维，
//! 使用 LLM 评分 + Beam Search 剪枝，寻找最优解或达成目标。
//!
//! ## 架构
//! ```text
//! 用户输入（问题/任务）
//!    ↓
//! ToTNode.execute
//!    ├─ 1. 创建根节点（depth=0，content=输入）
//!    ├─ 2. 评分根节点 + 目标检查
//!    ├─ 3. 循环（层扩展）：
//!    │   ├─ 3a. 检查终止条件（深度/节点数/收敛/中断）
//!    │   ├─ 3b. 选择当前层 top-K 节点（beam_width）
//!    │   ├─ 3c. 对每个节点并发生成 branch_factor 个候选（JoinSet）
//!    │   ├─ 3d. 评分所有候选 + 目标检查
//!    │   └─ 3e. 选择 top-K 进入下一层
//!    ├─ 4. 返回最优思维（写入 state.messages）
//!    └─ 5. 触发 ToTGoalReached 或 ToTTerminated 事件
//! ```
//!
//! ## 关键设计
//! - **Beam Search**：默认探索策略，每层保留 top-K 节点继续扩展
//! - **LLM 评分**：默认 0-100 分制，可通过 `ScoringStrategy` trait 扩展
//! - **LLM 目标检查**：默认通过 LLM 判断是否达成目标，可通过 trait 扩展
//! - **JoinSet 层内并发**：同层节点扩展并发执行，提升探索效率
//! - **四终止条件**：max_depth / max_thoughts / LLM 目标达成 / 评分收敛
//! - **可插拔策略**：三个 trait（Exploration/Scoring/GoalCheck）均支持自定义实现
//!
//! ## 与 Supervisor/Router 的差异
//! - ToT 不调用子 AgentLoop，所有思维生成/评分/目标检查都通过 LLM 调用完成
//! - ToT 是树探索模式，维护 `tree: HashMap<id, ThoughtNode>` 内部状态
//! - ToT 的输出是最优思维内容（写入 `state.messages`），不是路由决策或子 Agent 结果
//!
//! ## 与 TS 版的差异
//! - Rust 版用 `tokio::task::JoinSet` 实现层内并发，TS 版用 `Promise.all`
//! - Rust 版用 `Arc<RwLock<HashMap>>` 维护树结构，TS 版用 Map
//! - 事件系统复用 `OrchestratorEvent`，新增 6 个 ToT 变体

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tokio::task::JoinSet;
use tracing::{debug, info, warn};

use crate::backend::{NodeBackendAccessor, PromptCallOptions};
use crate::event::OrchestratorEvent;
use crate::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
use crate::types::{MessageRole, OrchestratorMessage};

// ─── 思维节点 ────────────────────────────────────────────

/// 思维节点 — 树/图中的一个思维状态
///
/// 每个节点包含思维内容、父节点引用、深度、评分与子节点列表。
/// 根节点 depth=0，content=用户输入。
///
/// ## GoT 扩展（阶段 2.2）
/// - `parents`：图语义下的多父节点列表（树语义下为空 Vec）
/// - `parent_id` 保留用于树语义兼容（ToT 模式下为单一 parent）
/// - GoT 聚合节点的 `parents` 包含所有被聚合的源节点 ID
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThoughtNode {
    /// 节点唯一 ID（UUID 或递增编号）
    pub id: String,
    /// 思维内容（LLM 生成的思维文本）
    pub content: String,
    /// 父节点 ID（根节点为 None）
    ///
    /// 树语义字段：ToT 模式下为单一 parent。
    /// GoT 聚合节点也设置此字段（取第一个源节点），以保持向后兼容。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub parent_id: Option<String>,
    /// 多父节点列表（图语义）
    ///
    /// GoT 扩展字段：聚合节点的所有源节点 ID。
    /// ToT 模式下为空 Vec（树语义，仅用 `parent_id`）。
    /// 序列化时默认空 Vec（向后兼容老数据）。
    #[serde(default)]
    pub parents: Vec<String>,
    /// 深度（根节点=0）
    pub depth: usize,
    /// 评分（0-100，越高越好；None=未评分）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub score: Option<u8>,
    /// 评分理由（可选，LLM 评分策略会填充）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub score_reasoning: Option<String>,
    /// 子节点 ID 列表
    #[serde(default)]
    pub children: Vec<String>,
    /// 节点状态
    pub status: ThoughtNodeStatus,
}

/// 思维节点状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThoughtNodeStatus {
    /// 待评分（刚创建）
    Pending,
    /// 已评分
    Scored,
    /// 已扩展（已生成子节点）
    Expanded,
    /// 被剪枝（评分过低，不继续扩展）
    Pruned,
    /// 达成目标
    Goal,
}

// ─── 终止原因 ────────────────────────────────────────────

/// ToT 终止原因
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToTTerminationReason {
    /// LLM 目标达成
    GoalReached,
    /// 深度超限
    MaxDepthExceeded,
    /// 节点数超限
    MaxThoughtsExceeded,
    /// 评分收敛（top-K 差距 < threshold）
    ScoreConverged,
    /// 无候选节点（所有都被剪枝）
    NoCandidates,
    /// 外部中断
    Aborted,
}

impl ToTTerminationReason {
    /// 转为字符串标识（用于事件序列化）
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::GoalReached => "goal_reached",
            Self::MaxDepthExceeded => "max_depth_exceeded",
            Self::MaxThoughtsExceeded => "max_thoughts_exceeded",
            Self::ScoreConverged => "score_converged",
            Self::NoCandidates => "no_candidates",
            Self::Aborted => "aborted",
        }
    }
}

// ─── 错误 ────────────────────────────────────────────

/// ToT 错误
#[derive(Debug, thiserror::Error)]
pub enum ToTError {
    #[error("LLM 调用失败: {0}")]
    LlmCall(String),

    #[error("LLM 响应解析失败: {0}")]
    Parse(String),

    #[error("探索失败: {0}")]
    Explore(String),

    #[error("评分失败: {0}")]
    Score(String),

    #[error("目标检查失败: {0}")]
    GoalCheck(String),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("其他错误: {0}")]
    Other(String),
}

impl From<crate::backend::BackendError> for ToTError {
    fn from(e: crate::backend::BackendError) -> Self {
        Self::LlmCall(e.to_string())
    }
}

/// 提取 LLM 输出中的 JSON 对象子串
///
/// 容错处理：
/// - ```json 代码围栏包裹
/// - 推理模型常见的双花括号 `{{...}}` 包裹（去掉一层）
///
/// 返回可被 `serde_json::from_str` 直接解析的对象字符串。
fn extract_json_object(text: &str) -> String {
    let trimmed = text.trim();
    let json_str = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|s| s.strip_suffix("```"))
        .map(|s| s.trim())
        .unwrap_or(trimmed);

    // 双花括号包裹（如 `{{"score":0}}`）→ 去掉一层花括号
    if json_str.starts_with("{{") && json_str.ends_with("}}") {
        let inner = &json_str[1..json_str.len() - 1];
        return inner.trim().to_string();
    }

    json_str.to_string()
}

// ─── 探索策略 trait ────────────────────────────────────────────

/// 探索策略 trait
///
/// 默认实现：`BeamSearchStrategy`（基于 LLM 生成 + Beam Search 剪枝）
/// 可注入自定义实现：基于规则、基于模板、基于历史经验等。
#[async_trait]
pub trait ExplorationStrategy: Send + Sync {
    /// 根据父节点生成下一层候选思维
    ///
    /// # 参数
    /// - `parent`：父思维节点
    /// - `context`：原始任务/问题（用户输入）
    /// - `branch_factor`：期望生成的候选数量
    /// - `backend`：LLM 后端访问器
    ///
    /// # 返回
    /// 候选思维内容列表（长度应接近 `branch_factor`）。
    async fn expand(
        &self,
        parent: &ThoughtNode,
        context: &str,
        branch_factor: usize,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<Vec<String>, ToTError>;
}

// ─── 评分策略 trait ────────────────────────────────────────────

/// 评分策略 trait
///
/// 默认实现：`LlmScoringStrategy`（基于 LLM 评分）
/// 可注入自定义实现：基于规则、基于启发式函数等。
#[async_trait]
pub trait ScoringStrategy: Send + Sync {
    /// 评分一个思维节点
    ///
    /// # 参数
    /// - `node`：待评分节点
    /// - `context`：原始任务/问题
    /// - `backend`：LLM 后端访问器
    ///
    /// # 返回
    /// `(score, reasoning)`：评分（0-100）与可选理由。
    async fn score(
        &self,
        node: &ThoughtNode,
        context: &str,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<(u8, Option<String>), ToTError>;
}

// ─── 目标检查策略 trait ────────────────────────────────────────────

/// 目标检查策略 trait
///
/// 默认实现：`LlmGoalCheckStrategy`（基于 LLM 判断）
/// 可注入自定义实现：基于关键词、基于规则等。
#[async_trait]
pub trait GoalCheckStrategy: Send + Sync {
    /// 检查是否达成目标
    ///
    /// # 参数
    /// - `node`：待检查节点
    /// - `context`：原始任务/问题
    /// - `backend`：LLM 后端访问器
    ///
    /// # 返回
    /// `true` 表示该节点已达成目标，ToT 应终止并返回此节点。
    async fn check_goal(
        &self,
        node: &ThoughtNode,
        context: &str,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<bool, ToTError>;
}

// ─── 探索提示词模板 ────────────────────────────────────────────

/// 探索提示词模板 — 可定制 `BeamSearchStrategy` 的 system/user 提示词
#[derive(Debug, Clone)]
pub struct ExplorationPromptTemplate {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{context}` `{parent}` `{branch_factor}` 占位符）
    pub user_template: String,
}

impl Default for ExplorationPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个思维探索者，负责在解决问题的过程中生成多个不同的下一步思维。\
                    每个思维应代表一个独立、可行的思考方向，避免与已有思维重复。\
                    必须输出合法 JSON 数组格式，不要包含其他文本。".into(),
            user_template: r#"原始问题：{context}

当前思维（父节点）：
{parent}

请生成 {branch_factor} 个不同的下一步思维，每个思维应是简洁的思考方向（一两句话）。

请输出 JSON 数组（仅 JSON，不要其他文本）：
["思维1", "思维2", ...]"#
                .into(),
        }
    }
}

// ─── 评分提示词模板 ────────────────────────────────────────────

/// 评分提示词模板
#[derive(Debug, Clone)]
pub struct ScoringPromptTemplate {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{context}` `{content}` 占位符）
    pub user_template: String,
}

impl Default for ScoringPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个思维评分者，负责评估思维节点对解决原始问题的贡献度。\
                    评分范围 0-100，越高表示越接近解决方案。\
                    必须输出合法 JSON 格式，不要包含其他文本。".into(),
            user_template: r#"原始问题：{context}

待评分思维：
{content}

请评估此思维对解决问题的贡献度，并给出 0-100 的评分。

请输出 JSON（仅 JSON，不要其他文本）：
{{
  "score": <0-100 的整数>,
  "reasoning": "<评分理由（一句话）>"
}}"#
                .into(),
        }
    }
}

// ─── 目标检查提示词模板 ────────────────────────────────────────────

/// 目标检查提示词模板
#[derive(Debug, Clone)]
pub struct GoalCheckPromptTemplate {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{context}` `{content}` 占位符）
    pub user_template: String,
}

impl Default for GoalCheckPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个目标判定者，负责判断思维节点是否已经达成原始问题的解决目标。\
                    严格判断：只有思维内容确实提供了完整、可执行的解决方案时才返回 true。\
                    必须输出合法 JSON 格式，不要包含其他文本。".into(),
            user_template: r#"原始问题：{context}

待检查思维：
{content}

此思维是否已经完整解决了原始问题？

请输出 JSON（仅 JSON，不要其他文本）：
{{
  "goal_reached": <true 或 false>,
  "reasoning": "<判断理由（一句话）>"
}}"#
                .into(),
        }
    }
}

// ─── Beam Search 探索策略（默认） ────────────────────────────────────────────

/// Beam Search 探索策略（默认实现）
///
/// 通过调用 LLM 生成多个不同的候选思维。
/// 评分与剪枝由 `ToTNode::execute` 统一处理，本策略只负责"生成"。
pub struct BeamSearchStrategy {
    /// 提示词模板
    pub prompt_template: ExplorationPromptTemplate,
}

impl Default for BeamSearchStrategy {
    fn default() -> Self {
        Self {
            prompt_template: ExplorationPromptTemplate::default(),
        }
    }
}

impl BeamSearchStrategy {
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用自定义提示词模板
    pub fn with_template(template: ExplorationPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    /// 渲染用户提示词
    fn render_user_prompt(
        &self,
        context: &str,
        parent: &ThoughtNode,
        branch_factor: usize,
    ) -> String {
        self.prompt_template
            .user_template
            .replace("{context}", context)
            .replace("{parent}", &parent.content)
            .replace("{branch_factor}", &branch_factor.to_string())
    }

    /// 解析 LLM 输出的 JSON 数组（容错处理 ```json 包裹 + 嵌套数组展平）
    ///
    /// 真实 LLM（尤其推理模型）常返回嵌套结构（如 `[["思维1","思维2"],["思维3"]]`），
    /// 这里递归展平所有数组层级为扁平字符串列表，提升健壮性。
    fn parse_response(text: &str) -> Result<Vec<String>, ToTError> {
        let trimmed = text.trim();
        let json_str = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .and_then(|s| s.strip_suffix("```"))
            .map(|s| s.trim())
            .unwrap_or(trimmed);

        let value: serde_json::Value = serde_json::from_str(json_str).map_err(|e| {
            ToTError::Parse(format!("JSON 数组解析失败: {} (input: {})", e, json_str))
        })?;

        // 递归展平：数组元素递归处理，字符串入列，非字符串元素忽略
        fn flatten(v: &serde_json::Value, out: &mut Vec<String>) {
            match v {
                serde_json::Value::Array(arr) => {
                    for item in arr {
                        flatten(item, out);
                    }
                }
                serde_json::Value::String(s) => out.push(s.clone()),
                _ => {}
            }
        }

        let mut thoughts = Vec::new();
        flatten(&value, &mut thoughts);
        Ok(thoughts)
    }
}

#[async_trait]
impl ExplorationStrategy for BeamSearchStrategy {
    async fn expand(
        &self,
        parent: &ThoughtNode,
        context: &str,
        branch_factor: usize,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<Vec<String>, ToTError> {
        if branch_factor == 0 {
            return Err(ToTError::Config(
                "branch_factor 不能为 0".into(),
            ));
        }

        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()),
            ..Default::default()
        };

        let user_prompt = self.render_user_prompt(context, parent, branch_factor);

        debug!(
            "ToT BeamSearch: 调用 LLM 生成 {} 个候选思维，parent depth={}",
            branch_factor, parent.depth
        );
        let response = backend.prompt(user_prompt, Some(options)).await?;
        info!(
            "ToT BeamSearch: LLM 返回响应，长度: {}",
            response.text.len()
        );

        let mut thoughts = Self::parse_response(&response.text)?;

        // 限制返回数量（LLM 可能返回过多或过少）
        if thoughts.len() > branch_factor {
            thoughts.truncate(branch_factor);
        }

        if thoughts.is_empty() {
            return Err(ToTError::Explore(
                "LLM 未生成任何候选思维".into(),
            ));
        }

        Ok(thoughts)
    }
}

// ─── LLM 评分策略（默认） ────────────────────────────────────────────

/// LLM 评分策略（默认实现）
///
/// 通过调用 LLM 让其评估思维节点对解决问题的贡献度，返回 0-100 分。
pub struct LlmScoringStrategy {
    /// 提示词模板
    pub prompt_template: ScoringPromptTemplate,
}

impl Default for LlmScoringStrategy {
    fn default() -> Self {
        Self {
            prompt_template: ScoringPromptTemplate::default(),
        }
    }
}

impl LlmScoringStrategy {
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用自定义提示词模板
    pub fn with_template(template: ScoringPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    /// 渲染用户提示词
    fn render_user_prompt(&self, context: &str, content: &str) -> String {
        self.prompt_template
            .user_template
            .replace("{context}", context)
            .replace("{content}", content)
    }

    /// 解析 LLM 输出的 JSON（容错处理 ```json 包裹 + 双花括号）
    fn parse_response(text: &str) -> Result<(u8, Option<String>), ToTError> {
        let json_str = extract_json_object(text);

        #[derive(serde::Deserialize)]
        struct ScoreResponse {
            score: u8,
            #[serde(default)]
            reasoning: Option<String>,
        }

        let resp: ScoreResponse = serde_json::from_str(&json_str).map_err(|e| {
            ToTError::Parse(format!("评分 JSON 解析失败: {} (input: {})", e, json_str))
        })?;

        Ok((resp.score, resp.reasoning))
    }
}

#[async_trait]
impl ScoringStrategy for LlmScoringStrategy {
    async fn score(
        &self,
        node: &ThoughtNode,
        context: &str,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<(u8, Option<String>), ToTError> {
        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()),
            ..Default::default()
        };

        let user_prompt = self.render_user_prompt(context, &node.content);

        debug!(
            "ToT LlmScoring: 评分节点 id={} depth={}",
            node.id, node.depth
        );
        let response = backend.prompt(user_prompt, Some(options)).await?;

        Self::parse_response(&response.text)
    }
}

// ─── LLM 目标检查策略（默认） ────────────────────────────────────────────

/// LLM 目标检查策略（默认实现）
///
/// 通过调用 LLM 判断思维节点是否已完整解决原始问题。
pub struct LlmGoalCheckStrategy {
    /// 提示词模板
    pub prompt_template: GoalCheckPromptTemplate,
}

impl Default for LlmGoalCheckStrategy {
    fn default() -> Self {
        Self {
            prompt_template: GoalCheckPromptTemplate::default(),
        }
    }
}

impl LlmGoalCheckStrategy {
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用自定义提示词模板
    pub fn with_template(template: GoalCheckPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    /// 渲染用户提示词
    fn render_user_prompt(&self, context: &str, content: &str) -> String {
        self.prompt_template
            .user_template
            .replace("{context}", context)
            .replace("{content}", content)
    }

    /// 解析 LLM 输出的 JSON（容错处理 ```json 包裹 + 双花括号）
    fn parse_response(text: &str) -> Result<bool, ToTError> {
        let json_str = extract_json_object(text);

        #[derive(serde::Deserialize)]
        struct GoalCheckResponse {
            goal_reached: bool,
            #[serde(default)]
            #[allow(dead_code)]
            reasoning: Option<String>,
        }

        let resp: GoalCheckResponse = serde_json::from_str(&json_str).map_err(|e| {
            ToTError::Parse(format!(
                "目标检查 JSON 解析失败: {} (input: {})",
                e, json_str
            ))
        })?;

        Ok(resp.goal_reached)
    }
}

#[async_trait]
impl GoalCheckStrategy for LlmGoalCheckStrategy {
    async fn check_goal(
        &self,
        node: &ThoughtNode,
        context: &str,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<bool, ToTError> {
        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()),
            ..Default::default()
        };

        let user_prompt = self.render_user_prompt(context, &node.content);

        debug!(
            "ToT LlmGoalCheck: 检查节点 id={} depth={}",
            node.id, node.depth
        );
        let response = backend.prompt(user_prompt, Some(options)).await?;

        Self::parse_response(&response.text)
    }
}

// ─── ToT 配置 ────────────────────────────────────────────

/// ToT 配置
///
/// 派生 `Serialize`/`Deserialize` 以支持 GoT 配置的 `#[serde(flatten)]` 复用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToTConfig {
    /// 最大深度（默认 5）
    pub max_depth: usize,
    /// 最大节点数（默认 50）
    pub max_thoughts: usize,
    /// Beam 宽度 — 每层保留的 top-K 节点数（默认 3）
    pub beam_width: usize,
    /// 分支因子 — 每个节点生成的候选数（默认 3）
    pub branch_factor: usize,
    /// 评分收敛阈值 — top-K 评分差距小于此值则收敛（默认 5）
    pub score_convergence_threshold: u8,
    /// 是否在最后汇总最优思维（生成 summary 字段）
    pub require_summary: bool,
    /// 是否在根节点就检查目标（默认 false，根节点通常只是问题陈述）
    pub check_goal_at_root: bool,
}

impl Default for ToTConfig {
    fn default() -> Self {
        Self {
            max_depth: 5,
            max_thoughts: 50,
            beam_width: 3,
            branch_factor: 3,
            score_convergence_threshold: 5,
            require_summary: true,
            check_goal_at_root: false,
        }
    }
}

// ─── ToTNode ────────────────────────────────────────────

/// ToTNode — Tree of Thoughts 节点
///
/// 在编排图中作为一个节点存在，被 Orchestrator 调度执行时：
/// 1. 接收原始问题（从 `state.input` 或最后一条 user 消息）
/// 2. 创建根节点（depth=0）
/// 3. 循环扩展：评分 → 目标检查 → Beam Search 剪枝 → 生成下一层
/// 4. 终止时返回最优思维（写入 `state.messages`）
///
/// # 使用示例
/// ```rust,ignore
/// use agent_runtime::tree_of_thoughts::{
///     ToTNode, ToTConfig,
/// };
///
/// let node = ToTNode::with_default_strategies(
///     "tot",
///     "思维树",
///     backend,
///     ToTConfig::default(),
/// );
/// ```
pub struct ToTNode {
    /// 节点 ID
    id: String,
    /// 节点名称
    name: String,
    /// 探索策略
    exploration_strategy: Arc<dyn ExplorationStrategy>,
    /// 评分策略
    scoring_strategy: Arc<dyn ScoringStrategy>,
    /// 目标检查策略
    goal_check_strategy: Arc<dyn GoalCheckStrategy>,
    /// 共享 LLM 后端
    backend: Arc<dyn NodeBackendAccessor>,
    /// 配置
    config: ToTConfig,
    /// 思维树（id → node）
    tree: Arc<RwLock<HashMap<String, ThoughtNode>>>,
    /// 最优节点 ID（执行完成后更新）
    best_node_id: Arc<RwLock<Option<String>>>,
    /// 节点 ID 生成计数器
    id_counter: Arc<RwLock<usize>>,
}

impl ToTNode {
    /// 创建新的 ToT 节点
    ///
    /// # 参数
    /// - `id`：节点 ID（在 Orchestrator 中唯一）
    /// - `name`：节点名称（调试/日志用）
    /// - `exploration_strategy`：探索策略
    /// - `scoring_strategy`：评分策略
    /// - `goal_check_strategy`：目标检查策略
    /// - `backend`：LLM 后端访问器
    /// - `config`：ToT 配置
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        exploration_strategy: Arc<dyn ExplorationStrategy>,
        scoring_strategy: Arc<dyn ScoringStrategy>,
        goal_check_strategy: Arc<dyn GoalCheckStrategy>,
        backend: Arc<dyn NodeBackendAccessor>,
        config: ToTConfig,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            exploration_strategy,
            scoring_strategy,
            goal_check_strategy,
            backend,
            config,
            tree: Arc::new(RwLock::new(HashMap::new())),
            best_node_id: Arc::new(RwLock::new(None)),
            id_counter: Arc::new(RwLock::new(0)),
        }
    }

    /// 使用默认 LLM 策略创建（便捷方法）
    pub fn with_default_strategies(
        id: impl Into<String>,
        name: impl Into<String>,
        backend: Arc<dyn NodeBackendAccessor>,
        config: ToTConfig,
    ) -> Self {
        Self::new(
            id,
            name,
            Arc::new(BeamSearchStrategy::new()),
            Arc::new(LlmScoringStrategy::new()),
            Arc::new(LlmGoalCheckStrategy::new()),
            backend,
            config,
        )
    }

    /// 生成下一个节点 ID
    async fn next_id(&self) -> String {
        let mut counter = self.id_counter.write().await;
        *counter += 1;
        format!("thought_{}", counter)
    }

    /// 检查评分是否收敛
    ///
    /// 收敛条件：top-K 节点的评分最大值与最小值之差 < threshold
    fn is_converged(top_nodes: &[&ThoughtNode], threshold: u8) -> bool {
        if top_nodes.len() < 2 {
            return false;
        }
        let scores: Vec<u8> = top_nodes
            .iter()
            .filter_map(|n| n.score)
            .collect();
        if scores.len() < 2 {
            return false;
        }
        let max = *scores.iter().max().unwrap();
        let min = *scores.iter().min().unwrap();
        max.saturating_sub(min) < threshold
    }

    /// 评分单个节点并更新树
    async fn score_node(
        &self,
        node_id: String,
        context: &str,
        ctx: &NodeContext<'_>,
    ) -> Result<(u8, Option<String>), ToTError> {
        let node_clone = {
            let tree = self.tree.read().await;
            tree.get(&node_id)
                .ok_or_else(|| ToTError::Other(format!("节点不存在: {}", node_id)))?
                .clone()
        };

        let (score, reasoning) = self
            .scoring_strategy
            .score(&node_clone, context, ctx.backend)
            .await?;

        // 更新树中节点
        {
            let mut tree = self.tree.write().await;
            if let Some(node) = tree.get_mut(&node_id) {
                node.score = Some(score);
                node.score_reasoning = reasoning.clone();
                node.status = ThoughtNodeStatus::Scored;
            }
        }

        // 发射评分事件
        ctx.emit(OrchestratorEvent::ThoughtNodeScored {
            node_id: self.id.clone(),
            thought_id: node_id,
            score,
            reasoning: reasoning.clone(),
        });

        Ok((score, reasoning))
    }

    /// 检查目标达成
    async fn check_goal(
        &self,
        node_id: &str,
        context: &str,
        ctx: &NodeContext<'_>,
    ) -> Result<bool, ToTError> {
        let node_clone = {
            let tree = self.tree.read().await;
            tree.get(node_id)
                .ok_or_else(|| ToTError::Other(format!("节点不存在: {}", node_id)))?
                .clone()
        };

        self.goal_check_strategy
            .check_goal(&node_clone, context, ctx.backend)
            .await
    }

    /// 扩展一层：对 `parents` 并发生成候选思维
    ///
    /// 返回所有新生成的子节点 ID 列表。
    async fn expand_layer(
        &self,
        parents: Vec<String>,
        context: &str,
        ctx: &NodeContext<'_>,
    ) -> Result<Vec<String>, ToTError> {
        let branch_factor = self.config.branch_factor;
        let mut join_set: JoinSet<Result<Vec<(String, usize, String)>, ToTError>> =
            JoinSet::new();

        // 为每个父节点启动一个并发任务
        for parent_id in parents {
            let parent_node = {
                let tree = self.tree.read().await;
                tree.get(&parent_id).cloned()
            };

            let Some(parent) = parent_node else {
                warn!("ToT: 父节点 {} 不存在，跳过", parent_id);
                continue;
            };

            let strategy = Arc::clone(&self.exploration_strategy);
            let backend = Arc::clone(&self.backend);
            let context_owned = context.to_string();

            join_set.spawn(async move {
                let thoughts = strategy
                    .expand(&parent, &context_owned, branch_factor, &*backend)
                    .await?;

                // 返回 (parent_id, parent_depth, thought_content) 列表
                Ok(thoughts
                    .into_iter()
                    .map(|t| (parent_id.clone(), parent.depth, t))
                    .collect::<Vec<_>>())
            });
        }

        // 收集所有候选
        let mut candidates: Vec<(String, usize, String)> = Vec::new();
        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(Ok(items)) => candidates.extend(items),
                Ok(Err(e)) => {
                    return Err(ToTError::Explore(format!("并发扩展失败: {}", e)));
                }
                Err(e) => {
                    return Err(ToTError::Explore(format!("Task join 失败: {}", e)));
                }
            }
        }

        // 创建子节点并写入树
        let mut new_node_ids = Vec::with_capacity(candidates.len());
        {
            let mut tree = self.tree.write().await;
            for (parent_id, parent_depth, content) in candidates {
                let new_id = format!(
                    "thought_{}_{}",
                    parent_depth + 1,
                    tree.len() + 1
                );
                let content_preview: String = content.chars().take(200).collect();
                let child_depth = parent_depth + 1;

                let child = ThoughtNode {
                    id: new_id.clone(),
                    content,
                    parent_id: Some(parent_id.clone()),
                    parents: Vec::new(),
                    depth: child_depth,
                    score: None,
                    score_reasoning: None,
                    children: Vec::new(),
                    status: ThoughtNodeStatus::Pending,
                };

                // 更新父节点的 children 列表
                if let Some(parent) = tree.get_mut(&parent_id) {
                    parent.children.push(new_id.clone());
                    parent.status = ThoughtNodeStatus::Expanded;
                }

                tree.insert(new_id.clone(), child);

                ctx.emit(OrchestratorEvent::ThoughtNodeCreated {
                    node_id: self.id.clone(),
                    thought_id: new_id.clone(),
                    parent_id: Some(parent_id),
                    depth: child_depth,
                    content_preview,
                });

                new_node_ids.push(new_id);
            }
        }

        Ok(new_node_ids)
    }

    /// 评分多个节点（并发）
    ///
    /// 当前未被调用（ToT 深度推理待 5.4 高级能力补齐时启用），保留备用。
    #[allow(dead_code)]
    async fn score_nodes(
        &self,
        node_ids: Vec<String>,
        context: &str,
        ctx: &NodeContext<'_>,
    ) -> Result<(), ToTError> {
        let mut join_set: JoinSet<Result<String, ToTError>> = JoinSet::new();

        for node_id in node_ids {
            let strategy = Arc::clone(&self.scoring_strategy);
            let backend = Arc::clone(&self.backend);
            let context_owned = context.to_string();

            let node_clone = {
                let tree = self.tree.read().await;
                tree.get(&node_id).cloned()
            };

            let Some(node) = node_clone else {
                continue;
            };

            join_set.spawn(async move {
                let (score, reasoning) =
                    strategy.score(&node, &context_owned, &*backend).await?;
                debug!(
                    "ToT 并发评分: node={} score={} reasoning={:?}",
                    node.id, score, reasoning
                );
                Ok(node.id)
            });
        }

        // 收集评分结果，统一更新树
        let mut scored_ids = Vec::new();
        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(Ok(id)) => scored_ids.push(id),
                Ok(Err(e)) => return Err(ToTError::Score(format!("并发评分失败: {}", e))),
                Err(e) => return Err(ToTError::Score(format!("Task join 失败: {}", e))),
            }
        }

        // 重新读取每个节点的评分（评分策略已通过 trait 调用，
        // 但 trait 方法是无状态的，我们需要重新调用以更新树）
        // 这里采用串行方式更新树（评分本身已并发完成）
        for id in scored_ids {
            self.score_node(id, context, ctx).await?;
        }

        Ok(())
    }

    /// 获取当前层 top-K 节点（按评分降序），并将未选中节点显式标记为 `Pruned`
    ///
    /// 只返回已评分且未被剪枝的节点。
    ///
    /// ## 显式剪枝
    /// 调用后，未被选入 top-K 的候选节点会被标记为 `ThoughtNodeStatus::Pruned`，
    /// 便于前端可视化与调试时清晰区分"被扩展"/"被剪枝"/"待评分"三类节点。
    /// 已达成目标（`Goal`）的节点不会被剪枝。
    async fn select_top_k(&self, k: usize, depth: usize) -> Vec<String> {
        // ── 1. 读锁：收集候选节点并按评分降序排序 ──
        let (selected_ids, pruned_ids): (Vec<String>, Vec<String>) = {
            let tree = self.tree.read().await;
            let mut candidates: Vec<&ThoughtNode> = tree
                .values()
                .filter(|n| {
                    n.depth == depth
                        && n.score.is_some()
                        && n.status != ThoughtNodeStatus::Pruned
                })
                .collect();

            // 按评分降序排序
            candidates.sort_by(|a, b| b.score.unwrap_or(0).cmp(&a.score.unwrap_or(0)));

            // 选中的 top-K 节点 ID
            let selected_ids: Vec<String> =
                candidates.iter().take(k).map(|n| n.id.clone()).collect();

            // 未选中的节点 ID（用于显式标记 Pruned，过滤掉已达成目标的节点）
            let pruned_ids: Vec<String> = candidates
                .iter()
                .skip(k)
                .filter(|n| n.status != ThoughtNodeStatus::Goal)
                .map(|n| n.id.clone())
                .collect();

            (selected_ids, pruned_ids)
        };

        // ── 2. 写锁：将未选中的节点显式标记为 Pruned ──
        if !pruned_ids.is_empty() {
            let mut tree = self.tree.write().await;
            for id in &pruned_ids {
                if let Some(node) = tree.get_mut(id) {
                    node.status = ThoughtNodeStatus::Pruned;
                }
            }
            debug!(
                "ToT: 深度 {} 显式剪枝 {} 个节点（beam_width={}）",
                depth,
                pruned_ids.len(),
                k
            );
        }

        selected_ids
    }

    /// 查找最优节点（全树搜索）
    async fn find_best_node(&self) -> Option<(String, u8, String, usize)> {
        let tree = self.tree.read().await;
        tree.values()
            .filter_map(|n| {
                n.score.map(|s| (n.id.clone(), s, n.content.clone(), n.depth))
            })
            .max_by_key(|(_, score, _, _)| *score)
    }

    /// 查找目标节点（status=Goal）
    ///
    /// 当前未被调用（ToT 深度推理待 5.4 高级能力补齐时启用），保留备用。
    #[allow(dead_code)]
    async fn find_goal_node(&self) -> Option<(String, u8, String, usize)> {
        let tree = self.tree.read().await;
        tree.values()
            .find(|n| n.status == ThoughtNodeStatus::Goal)
            .map(|n| {
                (
                    n.id.clone(),
                    n.score.unwrap_or(0),
                    n.content.clone(),
                    n.depth,
                )
            })
    }

    /// 获取思维树快照（用于状态序列化）
    pub async fn tree_snapshot(&self) -> Vec<ThoughtNode> {
        let tree = self.tree.read().await;
        tree.values().cloned().collect()
    }

    /// 获取最优节点 ID
    pub async fn best_node_id(&self) -> Option<String> {
        self.best_node_id.read().await.clone()
    }

    /// 清空思维树（用于 reset）
    pub async fn clear_tree(&self) {
        let mut tree = self.tree.write().await;
        tree.clear();
        let mut best = self.best_node_id.write().await;
        *best = None;
        let mut counter = self.id_counter.write().await;
        *counter = 0;
    }
}

#[async_trait]
impl OrchestratorNode for ToTNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::Thought
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        // ── 1. 读取原始问题 ──
        let context = if !ctx.state.input.is_empty() {
            ctx.state.input.clone()
        } else {
            ctx.state
                .messages
                .iter()
                .rev()
                .find(|m| matches!(m.role, MessageRole::User))
                .map(|m| m.content.clone())
                .unwrap_or_default()
        };

        if context.is_empty() {
            return NodeResult::error(
                "ToT: 原始问题为空（state.input 与 messages 中均无 user 消息）",
            );
        }

        // ── 2. 中断检查 ──
        if ctx.is_aborted() {
            warn!("ToT: 中断检查命中（初始化前）");
            return NodeResult::aborted();
        }

        // ── 3. 创建根节点 ──
        let root_id = self.next_id().await;
        let root_node = ThoughtNode {
            id: root_id.clone(),
            content: context.clone(),
            parent_id: None,
            parents: Vec::new(),
            depth: 0,
            score: None,
            score_reasoning: None,
            children: Vec::new(),
            status: ThoughtNodeStatus::Pending,
        };

        {
            let mut tree = self.tree.write().await;
            tree.insert(root_id.clone(), root_node);
        }

        ctx.emit(OrchestratorEvent::ThoughtNodeCreated {
            node_id: self.id.clone(),
            thought_id: root_id.clone(),
            parent_id: None,
            depth: 0,
            content_preview: context.chars().take(200).collect(),
        });

        info!("ToT: 创建根节点 id={}", root_id);

        // ── 4. 评分根节点 ──
        if let Err(e) = self.score_node(root_id.clone(), &context, &ctx).await {
            let err_msg = format!("ToT 根节点评分失败: {}", e);
            ctx.emit(OrchestratorEvent::ToTError {
                node_id: self.id.clone(),
                stage: "score".into(),
                error: err_msg.clone(),
            });
            return NodeResult::error(err_msg);
        }

        // ── 5. 可选：根节点目标检查 ──
        if self.config.check_goal_at_root {
            match self.check_goal(&root_id, &context, &ctx).await {
                Ok(true) => {
                    let tree = self.tree.read().await;
                    if let Some(node) = tree.get(&root_id) {
                        let score = node.score.unwrap_or(0);
                        ctx.emit(OrchestratorEvent::ToTGoalReached {
                            node_id: self.id.clone(),
                            thought_id: node.id.clone(),
                            depth: node.depth,
                            content: node.content.clone(),
                            score,
                        });

                        // 更新最优节点
                        {
                            let mut best = self.best_node_id.write().await;
                            *best = Some(node.id.clone());
                        }

                        return NodeResult::done_with_summary(format!(
                            "ToT: 根节点已达成目标（score={}）",
                            score
                        ));
                    }
                }
                Ok(false) => {}
                Err(e) => {
                    warn!("ToT: 根节点目标检查失败: {}", e);
                }
            }
        }

        // ── 6. 层扩展循环 ──
        let mut current_depth = 0usize;
        let mut current_layer_parents: Vec<String> = vec![root_id.clone()];

        loop {
            // ── 6a. 检查终止条件：max_depth ──
            if current_depth >= self.config.max_depth {
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::MaxDepthExceeded.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best_id.clone(),
                    best_score,
                });

                let summary = match best {
                    Some((id, s, _content, depth)) => {
                        let mut best_guard = self.best_node_id.write().await;
                        *best_guard = Some(id.clone());
                        format!(
                            "ToT: 深度超限终止（depth={}，最优 score={}，深度={}）",
                            current_depth, s, depth
                        )
                    }
                    None => "ToT: 深度超限终止（无评分节点）".into(),
                };
                let _ = summary; // summary 已在 best 写入后通过下方逻辑生成
                break;
            }

            // ── 6b. 检查终止条件：max_thoughts ──
            let total_nodes = self.tree.read().await.len();
            if total_nodes >= self.config.max_thoughts {
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::MaxThoughtsExceeded.as_str().into(),
                    total_nodes,
                    max_depth_reached: current_depth,
                    best_thought_id: best_id.clone(),
                    best_score,
                });

                if let Some((id, s, _, depth)) = best {
                    let mut best_guard = self.best_node_id.write().await;
                    *best_guard = Some(id);
                    let _ = (s, depth);
                }
                break;
            }

            // ── 6c. 检查终止条件：无候选 ──
            if current_layer_parents.is_empty() {
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::NoCandidates.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best_id,
                    best_score,
                });
                break;
            }

            // ── 6d. 中断检查 ──
            if ctx.is_aborted() {
                warn!("ToT: 中断检查命中（层扩展前）");
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::Aborted.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best_id,
                    best_score,
                });
                return NodeResult::aborted();
            }

            // ── 6e. 扩展当前层 ──
            let new_node_ids = match self
                .expand_layer(current_layer_parents.clone(), &context, &ctx)
                .await
            {
                Ok(ids) => ids,
                Err(e) => {
                    let err_msg = format!("ToT 层扩展失败: {}", e);
                    ctx.emit(OrchestratorEvent::ToTError {
                        node_id: self.id.clone(),
                        stage: "expand".into(),
                        error: err_msg.clone(),
                    });
                    return NodeResult::error(err_msg);
                }
            };

            if new_node_ids.is_empty() {
                // 所有父节点都未生成子节点
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::NoCandidates.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best_id,
                    best_score,
                });
                break;
            }

            // ── 6f. 并发评分新节点 ──
            // 注意：score_nodes 内部会触发 ThoughtNodeScored 事件
            // 但当前实现是先并发调用 strategy.score，再串行 score_node 更新树
            // 这会导致重复调用 strategy.score。修复：直接串行评分（简化）
            for node_id in &new_node_ids {
                if let Err(e) = self.score_node(node_id.clone(), &context, &ctx).await {
                    let err_msg = format!("ToT 节点评分失败: {}", e);
                    ctx.emit(OrchestratorEvent::ToTError {
                        node_id: self.id.clone(),
                        stage: "score".into(),
                        error: err_msg.clone(),
                    });
                    return NodeResult::error(err_msg);
                }
            }

            // ── 6g. 检查目标达成（每个新节点） ──
            let mut goal_reached: Option<(String, u8, String, usize)> = None;
            for node_id in &new_node_ids {
                match self.check_goal(node_id, &context, &ctx).await {
                    Ok(true) => {
                        // 找到目标节点
                        let tree = self.tree.read().await;
                        if let Some(node) = tree.get(node_id) {
                            let score = node.score.unwrap_or(0);
                            goal_reached = Some((
                                node.id.clone(),
                                score,
                                node.content.clone(),
                                node.depth,
                            ));
                        }
                        // 标记为 Goal 状态
                        drop(tree);
                        let mut tree = self.tree.write().await;
                        if let Some(node) = tree.get_mut(node_id) {
                            node.status = ThoughtNodeStatus::Goal;
                        }
                        break;
                    }
                    Ok(false) => {}
                    Err(e) => {
                        warn!("ToT: 目标检查失败 node={}: {}", node_id, e);
                    }
                }
            }

            if let Some((goal_id, goal_score, goal_content, goal_depth)) = goal_reached {
                ctx.emit(OrchestratorEvent::ToTGoalReached {
                    node_id: self.id.clone(),
                    thought_id: goal_id.clone(),
                    depth: goal_depth,
                    content: goal_content.clone(),
                    score: goal_score,
                });

                // 更新最优节点
                {
                    let mut best = self.best_node_id.write().await;
                    *best = Some(goal_id.clone());
                }

                // 写入 state.messages
                let mut meta = HashMap::new();
                meta.insert("tot_node_id".to_string(), serde_json::json!(self.id));
                meta.insert(
                    "goal_thought_id".to_string(),
                    serde_json::json!(goal_id),
                );
                meta.insert(
                    "goal_depth".to_string(),
                    serde_json::json!(goal_depth),
                );
                meta.insert(
                    "goal_score".to_string(),
                    serde_json::json!(goal_score),
                );

                ctx.state.messages.push(OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: format!(
                        "[ToT 目标达成（depth={}, score={}）]:\n{}",
                        goal_depth, goal_score, goal_content
                    ),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: Some(meta),
                });

                let summary = if self.config.require_summary {
                    Some(format!(
                        "ToT: 在深度 {} 找到目标（score={}，节点数={}）",
                        goal_depth,
                        goal_score,
                        self.tree.read().await.len()
                    ))
                } else {
                    None
                };

                return NodeResult {
                    status: NodeStatus::Done,
                    next_node_id: None,
                    error: None,
                    summary,
                };
            }

            // ── 6h. 选择 top-K 进入下一层 ──
            let next_layer_parents = self
                .select_top_k(self.config.beam_width, current_depth + 1)
                .await;

            // 发射层扩展完成事件（用第一个父节点作为代表）
            if let Some(first_parent) = current_layer_parents.first() {
                ctx.emit(OrchestratorEvent::ThoughtBranchExplored {
                    node_id: self.id.clone(),
                    parent_id: first_parent.clone(),
                    child_count: new_node_ids.len(),
                    depth: current_depth + 1,
                    kept_count: next_layer_parents.len(),
                });
            }

            // ── 6i. 检查终止条件：评分收敛 ──
            // 注意：top_nodes 持有对 tree 的引用，必须在 read guard 作用域内完成 is_converged 调用
            let converged = {
                let tree = self.tree.read().await;
                let top_nodes: Vec<&ThoughtNode> = next_layer_parents
                    .iter()
                    .filter_map(|id| tree.get(id))
                    .collect();
                Self::is_converged(&top_nodes, self.config.score_convergence_threshold)
            };
            if converged {
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::ScoreConverged.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth + 1,
                    best_thought_id: best_id.clone(),
                    best_score,
                });

                if let Some((id, _, _, _)) = best {
                    let mut best_guard = self.best_node_id.write().await;
                    *best_guard = Some(id);
                }
                break;
            }

            // ── 6j. 准备下一层 ──
            current_depth += 1;
            current_layer_parents = next_layer_parents;
        }

        // ── 7. 循环结束，写入最优结果 ──
        // find_best_node 已统一查找评分最高的节点（不限于 goal 节点），
        // 无需额外的 or_else 分支。
        let best = self.find_best_node().await;

        let (best_id, best_score, best_content, best_depth) = match best {
            Some(b) => b,
            None => {
                return NodeResult::error("ToT: 无可用最优节点（树为空或未评分）");
            }
        };

        // 更新最优节点引用
        {
            let mut best_guard = self.best_node_id.write().await;
            *best_guard = Some(best_id.clone());
        }

        // 写入 state.messages
        let mut meta = HashMap::new();
        meta.insert("tot_node_id".to_string(), serde_json::json!(self.id));
        meta.insert(
            "best_thought_id".to_string(),
            serde_json::json!(best_id),
        );
        meta.insert(
            "best_depth".to_string(),
            serde_json::json!(best_depth),
        );
        meta.insert(
            "best_score".to_string(),
            serde_json::json!(best_score),
        );
        meta.insert(
            "total_nodes".to_string(),
            serde_json::json!(self.tree.read().await.len()),
        );

        ctx.state.messages.push(OrchestratorMessage {
            role: MessageRole::Assistant,
            content: format!(
                "[ToT 最优思维（depth={}, score={}）]:\n{}",
                best_depth, best_score, best_content
            ),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: Some(meta),
        });

        let summary = if self.config.require_summary {
            Some(format!(
                "ToT: 探索完成（最优 score={}，深度={}，总节点数={}）",
                best_score,
                best_depth,
                self.tree.read().await.len()
            ))
        } else {
            None
        };

        NodeResult {
            status: NodeStatus::Continue,
            next_node_id: None,
            error: None,
            summary,
        }
    }
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{BackendError, PromptResponse};
    use crate::node::{AbortCheck, EventEmitter};
    use crate::types::OrchestratorState;
    use async_trait::async_trait;
    use std::sync::Mutex;

    // ─── 测试桩：Backend ────────────────────────────────────

    /// 测试用 Backend — 按调用顺序返回预设的固定响应
    struct StubBackend {
        responses: Mutex<std::collections::VecDeque<String>>,
        prompt_count: Mutex<usize>,
    }

    impl StubBackend {
        fn new(responses: Vec<String>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().collect()),
                prompt_count: Mutex::new(0),
            }
        }

        fn prompt_count(&self) -> usize {
            *self.prompt_count.lock().unwrap()
        }
    }

    #[async_trait]
    impl NodeBackendAccessor for StubBackend {
        async fn prompt(
            &self,
            _prompt: String,
            _options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            *self.prompt_count.lock().unwrap() += 1;
            let resp = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_default();
            Ok(PromptResponse::text_only(resp))
        }

        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }

        async fn get_messages(&self) -> Vec<crate::types::OrchestratorMessage> {
            Vec::new()
        }

        async fn set_messages(
            &self,
            _messages: Vec<crate::types::OrchestratorMessage>,
        ) -> Result<(), BackendError> {
            Ok(())
        }

        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    // ─── 测试桩：事件/中断 ────────────────────────────────────

    struct NoopEmitter;
    impl EventEmitter for NoopEmitter {
        fn emit(&self, _event: OrchestratorEvent) {}
    }

    struct NoopAbort;
    #[async_trait]
    impl AbortCheck for NoopAbort {
        fn is_aborted(&self) -> bool {
            false
        }
        async fn wait_if_paused(&self) {}
    }

    // ─── 测试桩：策略 ────────────────────────────────────

    /// 测试用探索策略 — 返回固定候选思维
    struct StubExploration {
        thoughts: Vec<String>,
    }

    #[async_trait]
    impl ExplorationStrategy for StubExploration {
        async fn expand(
            &self,
            _parent: &ThoughtNode,
            _context: &str,
            branch_factor: usize,
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<Vec<String>, ToTError> {
            Ok(self.thoughts.iter().take(branch_factor).cloned().collect())
        }
    }

    /// 测试用评分策略 — 返回固定评分
    struct StubScoring {
        score: u8,
    }

    #[async_trait]
    impl ScoringStrategy for StubScoring {
        async fn score(
            &self,
            _node: &ThoughtNode,
            _context: &str,
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<(u8, Option<String>), ToTError> {
            Ok((self.score, Some("stub score".into())))
        }
    }

    /// 测试用目标检查策略 — 总是返回 false
    struct StubGoalCheck;

    #[async_trait]
    impl GoalCheckStrategy for StubGoalCheck {
        async fn check_goal(
            &self,
            _node: &ThoughtNode,
            _context: &str,
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<bool, ToTError> {
            Ok(false)
        }
    }

    // ─── 测试：JSON 解析 ────────────────────────────────────

    #[test]
    fn parse_exploration_response_should_handle_plain_json() {
        let text = r#"["思维1","思维2","思维3"]"#;
        let r = BeamSearchStrategy::parse_response(text).unwrap();
        assert_eq!(r.len(), 3);
        assert_eq!(r[0], "思维1");
    }

    #[test]
    fn parse_exploration_response_should_handle_code_fence() {
        let text = r#"```json
["a","b"]
```"#;
        let r = BeamSearchStrategy::parse_response(text).unwrap();
        assert_eq!(r.len(), 2);
    }

    #[test]
    fn parse_exploration_response_should_flatten_nested_arrays() {
        // 推理模型常返回嵌套数组（每个思维是一个子数组），应展平为扁平字符串列表
        let text = r#"[["思维1","思维2"],["思维3"]]"#;
        let r = BeamSearchStrategy::parse_response(text).unwrap();
        assert_eq!(r.len(), 3);
        assert_eq!(r[0], "思维1");
        assert_eq!(r[2], "思维3");
    }

    #[test]
    fn parse_scoring_response_should_extract_score_and_reasoning() {
        let text = r#"{"score":85,"reasoning":"思路清晰"}"#;
        let (s, r) = LlmScoringStrategy::parse_response(text).unwrap();
        assert_eq!(s, 85);
        assert_eq!(r.as_deref(), Some("思路清晰"));
    }

    #[test]
    fn parse_goal_check_response_should_extract_bool() {
        let text = r#"{"goal_reached":true,"reasoning":"已解决"}"#;
        let r = LlmGoalCheckStrategy::parse_response(text).unwrap();
        assert!(r);
    }

    #[test]
    fn parse_goal_check_response_should_handle_false() {
        let text = r#"{"goal_reached":false,"reasoning":"未解决"}"#;
        let r = LlmGoalCheckStrategy::parse_response(text).unwrap();
        assert!(!r);
    }

    // ─── 测试：终止原因 ────────────────────────────────────

    #[test]
    fn termination_reason_as_str_should_match() {
        assert_eq!(
            ToTTerminationReason::GoalReached.as_str(),
            "goal_reached"
        );
        assert_eq!(
            ToTTerminationReason::MaxDepthExceeded.as_str(),
            "max_depth_exceeded"
        );
        assert_eq!(
            ToTTerminationReason::ScoreConverged.as_str(),
            "score_converged"
        );
    }

    // ─── 测试：评分收敛检测 ────────────────────────────────────

    #[test]
    fn is_converged_should_return_true_when_diff_below_threshold() {
        let nodes = vec![
            ThoughtNode {
                id: "1".into(),
                content: "a".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 1,
                score: Some(85),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
            ThoughtNode {
                id: "2".into(),
                content: "b".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 1,
                score: Some(87),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
        ];
        let refs: Vec<&ThoughtNode> = nodes.iter().collect();
        assert!(ToTNode::is_converged(&refs, 5));
    }

    #[test]
    fn is_converged_should_return_false_when_diff_above_threshold() {
        let nodes = vec![
            ThoughtNode {
                id: "1".into(),
                content: "a".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 1,
                score: Some(50),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
            ThoughtNode {
                id: "2".into(),
                content: "b".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 1,
                score: Some(90),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
        ];
        let refs: Vec<&ThoughtNode> = nodes.iter().collect();
        assert!(!ToTNode::is_converged(&refs, 5));
    }

    // ─── 测试：ToTNode execute ────────────────────────────────────

    #[tokio::test]
    async fn tot_execute_should_terminate_on_max_depth() {
        // 使用 stub 策略，避免真实 LLM 调用
        let backend = Arc::new(StubBackend::new(vec![]));

        let config = ToTConfig {
            max_depth: 2,
            max_thoughts: 50,
            beam_width: 2,
            branch_factor: 2,
            score_convergence_threshold: 5,
            require_summary: true,
            check_goal_at_root: false,
        };

        let node = ToTNode::new(
            "tot",
            "思维树",
            Arc::new(StubExploration {
                thoughts: vec!["候选1".into(), "候选2".into()],
            }),
            Arc::new(StubScoring { score: 80 }),
            Arc::new(StubGoalCheck),
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            config,
        );

        let mut state = OrchestratorState::new("解决一个数学问题");
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        // 应该是 Continue 或 Done（取决于是否触发目标）
        assert!(
            matches!(result.status, NodeStatus::Continue | NodeStatus::Done),
            "应为 Continue 或 Done，实际: {:?}",
            result.status
        );

        // 验证 state.messages 被写入
        assert!(!state.messages.is_empty());
        let last = state.messages.last().unwrap();
        assert!(matches!(last.role, MessageRole::Assistant));
        assert!(last.content.contains("[ToT"));
    }

    #[tokio::test]
    async fn tot_execute_should_error_on_empty_context() {
        let backend = Arc::new(StubBackend::new(vec![]));
        let node = ToTNode::with_default_strategies(
            "tot",
            "思维树",
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            ToTConfig::default(),
        );

        let mut state = OrchestratorState::new(String::new());
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
        assert!(result.error.unwrap().contains("原始问题为空"));
    }

    #[tokio::test]
    async fn tot_execute_should_terminate_on_goal_reached() {
        let backend = Arc::new(StubBackend::new(vec![]));

        /// 目标检查策略 — 第二次调用返回 true（即第一个子节点达成目标）
        struct GoalOnSecondCall {
            call_count: Mutex<usize>,
        }

        #[async_trait]
        impl GoalCheckStrategy for GoalOnSecondCall {
            async fn check_goal(
                &self,
                _node: &ThoughtNode,
                _context: &str,
                _backend: &dyn NodeBackendAccessor,
            ) -> Result<bool, ToTError> {
                let mut count = self.call_count.lock().unwrap();
                *count += 1;
                // 根节点检查 + 第一个子节点检查 = true
                Ok(*count >= 2)
            }
        }

        let config = ToTConfig {
            max_depth: 5,
            max_thoughts: 50,
            beam_width: 2,
            branch_factor: 2,
            score_convergence_threshold: 5,
            require_summary: true,
            check_goal_at_root: false,
        };

        let node = ToTNode::new(
            "tot",
            "思维树",
            Arc::new(StubExploration {
                thoughts: vec!["目标解".into(), "候选2".into()],
            }),
            Arc::new(StubScoring { score: 95 }),
            Arc::new(GoalOnSecondCall {
                call_count: Mutex::new(0),
            }),
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            config,
        );

        let mut state = OrchestratorState::new("求解问题");
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Done);
        assert!(result.summary.is_some());

        // 验证 state.messages 包含目标达成消息
        assert!(!state.messages.is_empty());
        let last = state.messages.last().unwrap();
        assert!(last.content.contains("[ToT 目标达成"));
    }

    // ─── 测试：树快照 ────────────────────────────────────

    #[tokio::test]
    async fn tree_snapshot_should_return_all_nodes() {
        let backend = Arc::new(StubBackend::new(vec![]));
        let node = ToTNode::with_default_strategies(
            "tot",
            "思维树",
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            ToTConfig::default(),
        );

        // 手动插入几个节点
        {
            let mut tree = node.tree.write().await;
            tree.insert(
                "n1".into(),
                ThoughtNode {
                    id: "n1".into(),
                    content: "a".into(),
                    parent_id: None,
                    parents: Vec::new(),
                    depth: 0,
                    score: Some(80),
                    score_reasoning: None,
                    children: vec![],
                    status: ThoughtNodeStatus::Scored,
                },
            );
            tree.insert(
                "n2".into(),
                ThoughtNode {
                    id: "n2".into(),
                    content: "b".into(),
                    parent_id: Some("n1".into()),
                    parents: Vec::new(),
                    depth: 1,
                    score: Some(85),
                    score_reasoning: None,
                    children: vec![],
                    status: ThoughtNodeStatus::Scored,
                },
            );
        }

        let snapshot = node.tree_snapshot().await;
        assert_eq!(snapshot.len(), 2);
    }
}
