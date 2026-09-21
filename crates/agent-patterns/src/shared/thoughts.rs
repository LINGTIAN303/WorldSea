//! 思维域共享类型 — ThoughtNode/ToTConfig/ToTError/ToTTerminationReason + 策略 trait
//!
//! 原 tree_of_thoughts/{node,config,error,strategies}.rs 合并，供 ToT/GoT 共同复用
//! （matrix §4 GoT 解耦：GoT 经本模块公开 API 复用，不再跨目录 import tot 内部符号）。

use async_trait::async_trait;
use tracing::{debug, info};

use agent_kernel::backend::{NodeBackendAccessor, PromptCallOptions};
use crate::shared::json::extract_json_object_string;

// ─── 思维节点 ────────────────────────────────────────────

/// 思维节点 — 树/图中的一个思维状态
///
/// 每个节点包含思维内容、父节点引用、深度、评分与子节点列表。
/// 根节点 depth=0，content=用户输入。
///
/// ## GoT 扩展
/// - `parents`：图语义下的多父节点列表（树语义下为空 Vec）
/// - `parent_id` 保留用于树语义兼容（ToT 模式下为单一 parent）
/// - GoT 聚合节点的 `parents` 包含所有被聚合的源节点 ID
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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

/// 思维探索终止原因（ToT/GoT 共用）
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

// ─── ToT 配置 ────────────────────────────────────────────

/// 思维探索配置（ToT/GoT 共用，GoT 以 `#[serde(flatten)]` 复用）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

// ─── 错误 ────────────────────────────────────────────

/// 思维探索错误（ToT/GoT 共用）
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

impl From<agent_kernel::backend::BackendError> for ToTError {
    fn from(e: agent_kernel::backend::BackendError) -> Self {
        Self::LlmCall(e.to_string())
    }
}

// ─── 探索策略 trait ────────────────────────────────────────────

/// 探索策略 trait
///
/// 默认实现：`BeamSearchStrategy`（基于 LLM 生成 + Beam Search 剪枝）
/// 可注入自定义实现：基于规则、基于模板、基于历史经验等。
#[async_trait]
pub trait ExplorationStrategy: Send + Sync {
    /// 根据父节点生成下一层候选思维
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
/// 评分与剪枝由节点 execute 统一处理，本策略只负责"生成"。
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
    pub fn parse_response(text: &str) -> Result<Vec<String>, ToTError> {
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
            // 阶段 3 · ④ 扩展：旁路入账标签（D13 旁路全收）
            purpose: Some("tot_expand".into()),
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
    pub fn parse_response(text: &str) -> Result<(u8, Option<String>), ToTError> {
        let json_str = extract_json_object_string(text);

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
            // 阶段 3 · ④ 扩展：旁路入账标签（D13 旁路全收）
            purpose: Some("tot_score".into()),
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
    pub fn parse_response(text: &str) -> Result<bool, ToTError> {
        let json_str = extract_json_object_string(text);

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
            // 阶段 3 · ④ 扩展：旁路入账标签（D13 旁路全收）
            purpose: Some("tot_goal_check".into()),
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

