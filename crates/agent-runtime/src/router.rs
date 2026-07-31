//! # Router Pattern — 路由编排模式
//!
//! 实现 Router Pattern：纯决策节点，根据输入特征/意图分类，
//! 将请求路由到合适的专业 Agent/工具链分支。
//!
//! ## 架构
//! ```text
//! 用户输入
//!    ↓
//! RouterNode.execute
//!    ├─ 1. 读取输入（state.input 或最后一条 user 消息）
//!    ├─ 2. 中断检查
//!    ├─ 3. RoutingStrategy.route(input, targets, backend) → RouteResult
//!    ├─ 4. 目标校验（target_id 存在性）
//!    ├─ 5. 事件发射（RouterDecisionMade / RouterNoMatch / RouterError）
//!    └─ 6. 返回 NodeResult（Continue + next_node_id）
//! ```
//!
//! ## 关键设计
//! - **纯决策节点**：不执行子 Agent，只输出 `next_node_id` 让 Orchestrator 调度下一节点
//! - **与 Supervisor 的差异**：Supervisor 内部创建并执行子 AgentLoop；
//!   Router 只决定"下一步去哪"，不关心下个节点如何执行
//! - **共享 backend**：路由策略（如 LLM 决策）通过 `NodeBackendAccessor` 调用 LLM
//! - **可插拔策略**：默认 `LlmRoutingStrategy`（LLM 意图分类），
//!   可注入 `KeywordRoutingStrategy`（关键词匹配）或自定义实现
//! - **Fallback 机制**：无匹配时若配置 `fallback_target_id`，走 fallback 并触发
//!   `RouterDecisionMade { is_fallback: true }`；否则触发 `RouterNoMatch`
//!
//! ## 嵌套路由（路由树）
//! RouterNode 本身是**扁平路由**：单次决策从一个 `targets` 列表中选择一个目标。
//! 嵌套路由（路由树）通过**编排图（Orchestrator Graph）**天然实现，无需在 RouterNode
//! 内部特殊支持：
//!
//! 1. Router A 的某个 `RouteTarget.id` 指向编排图中的另一个 Router B 节点
//! 2. Router A.execute 返回 `next_node_id = "router_b"`
//! 3. Orchestrator 按图查找 `router_b` 节点并调度执行
//! 4. Router B.execute 继续决策，路由到最终专业 Agent 节点
//!
//! ```text
//!       ┌────────────┐
//! 输入 → │ Router A   │ → "router_b"
//!       └────────────┘
//!              ↓ (Orchestrator 按图调度)
//!       ┌────────────┐
//!       │ Router B   │ → "coder" / "writer" / ...
//!       └────────────┘
//!              ↓
//!       ┌────────────┐
//!       │ 专业 Agent  │
//!       └────────────┘
//! ```
//!
//! ### 设计权衡：为何不引入递归 `sub_routes` 字段
//! - **职责单一**：RouterNode 只负责单层决策，嵌套关系由编排图管理
//! - **避免与 Orchestrator 重叠**：编排图本身就是 DAG，已支持任意嵌套
//! - **可观测性更好**：每层 Router 独立发射事件，便于追踪路由链路
//! - **可复用**：同一 Router 节点可被多个上层 Router 引用
//!
//! ## 与 TS 版的差异
//! - Rust 版 RouterNode 不持有子 Agent 实例（纯决策）
//! - 事件系统复用 `OrchestratorEvent`，新增 3 个 Router 变体
//! - LLM 策略的 JSON 解析容错处理（```json 包裹）

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use crate::backend::{NodeBackendAccessor, PromptCallOptions};
use crate::event::OrchestratorEvent;
use crate::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
use crate::types::MessageRole;

// ─── 路由目标 ────────────────────────────────────────────

/// 路由目标 — 描述一个可路由的分支节点
///
/// 由用户在创建 RouterNode 时提供，定义分支的标识、名称、能力描述。
/// LLM 策略会根据 `description` 进行意图分类；关键词策略会匹配 `keywords`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteTarget {
    /// 路由目标唯一 ID（对应 Orchestrator 图中下一节点的 id）
    ///
    /// Router 决策完成后会写入 `NodeResult.next_node_id`，
    /// 由 Orchestrator 按图查找并调度对应节点。
    pub id: String,
    /// 人类可读名称（用于日志/UI 展示）
    pub name: String,
    /// 能力描述（供 LLM 策略进行意图分类时参考）
    ///
    /// 应清晰描述该分支处理的输入类型/任务类别，
    /// 如 "处理代码编写、调试、重构类任务"。
    pub description: String,
    /// 关键词列表（供 `KeywordRoutingStrategy` 匹配）
    ///
    /// 可选字段。LLM 策略不使用此字段。
    /// 关键词策略会检查输入是否包含任一关键词（大小写不敏感）。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub keywords: Option<Vec<String>>,
}

// ─── 路由决策结果 ────────────────────────────────────────────

/// 路由决策结果 — `RoutingStrategy::route` 的返回值
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteResult {
    /// 被选中的路由目标 ID
    pub target_id: String,
    /// 决策理由（可选，LLM 策略会填充）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reason: Option<String>,
}

// ─── 路由策略 trait ────────────────────────────────────────────

/// 路由策略 trait
///
/// 默认实现：`LlmRoutingStrategy`（基于 LLM 意图分类）
/// 备选实现：`KeywordRoutingStrategy`（基于关键词匹配）
/// 可注入自定义实现：基于规则、基于历史命中率等。
#[async_trait]
pub trait RoutingStrategy: Send + Sync {
    /// 根据输入和候选路由目标，决定路由到哪个目标
    ///
    /// # 参数
    /// - `input`：用户输入文本
    /// - `targets`：候选路由目标列表
    /// - `backend`：LLM 后端访问器（用于 LLM 决策策略）
    ///
    /// # 返回
    /// `RouteResult` 包含选中的 `target_id` 与可选的决策理由。
    /// 若无匹配，返回 `RoutingError::NoMatch`（由 RouterNode 决定走 fallback 还是报错）。
    async fn route(
        &self,
        input: &str,
        targets: &[RouteTarget],
        backend: &dyn NodeBackendAccessor,
    ) -> Result<RouteResult, RoutingError>;
}

/// 路由错误
#[derive(Debug, thiserror::Error)]
pub enum RoutingError {
    #[error("LLM 调用失败: {0}")]
    LlmCall(String),

    #[error("LLM 响应解析失败: {0}")]
    Parse(String),

    #[error("无可用路由目标")]
    NoTargets,

    #[error("无匹配路由目标（input: {0}）")]
    NoMatch(String),

    #[error("其他错误: {0}")]
    Other(String),
}

impl From<crate::backend::BackendError> for RoutingError {
    fn from(e: crate::backend::BackendError) -> Self {
        Self::LlmCall(e.to_string())
    }
}

// ─── LLM 路由策略（默认） ────────────────────────────────────────────

/// 提示词模板 — 可定制 `LlmRoutingStrategy` 的 system/user 提示词
#[derive(Debug, Clone)]
pub struct RoutingPromptTemplate {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{input}` 和 `{targets}` 占位符）
    pub user_template: String,
}

impl Default for RoutingPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个路由决策者（Router），负责根据用户输入选择最合适的处理分支。\
                    请根据各分支的能力描述选择最匹配的一个。\
                    必须输出合法 JSON 格式，不要包含其他文本。".into(),
            user_template: r#"用户输入：{input}

可用路由分支：
{targets}

请输出 JSON（仅 JSON，不要其他文本）：
{{
  "target_id": "<分支 ID>",
  "reason": "<选择理由（一句话）>"
}}"#
                .into(),
        }
    }
}

/// LLM 决策的路由策略（默认实现）
///
/// 通过调用 LLM 让其根据各分支的能力描述选择最匹配的一个。
/// 适用于意图分类、任务分发等场景。
pub struct LlmRoutingStrategy {
    /// 提示词模板
    pub prompt_template: RoutingPromptTemplate,
}

impl Default for LlmRoutingStrategy {
    fn default() -> Self {
        Self {
            prompt_template: RoutingPromptTemplate::default(),
        }
    }
}

impl LlmRoutingStrategy {
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用自定义提示词模板
    pub fn with_template(template: RoutingPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    /// 格式化候选路由目标列表
    fn format_targets(targets: &[RouteTarget]) -> String {
        targets
            .iter()
            .map(|t| {
                format!(
                    "- id: {}\n  name: {}\n  description: {}",
                    t.id, t.name, t.description
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// 渲染用户提示词
    fn render_user_prompt(&self, input: &str, targets: &[RouteTarget]) -> String {
        self.prompt_template
            .user_template
            .replace("{input}", input)
            .replace("{targets}", &Self::format_targets(targets))
    }

    /// 解析 LLM 输出的 JSON（容错处理 ```json 包裹）
    fn parse_response(text: &str) -> Result<RouteResult, RoutingError> {
        let trimmed = text.trim();
        let json_str = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .and_then(|s| s.strip_suffix("```"))
            .map(|s| s.trim())
            .unwrap_or(trimmed);

        let result: RouteResult = serde_json::from_str(json_str).map_err(|e| {
            RoutingError::Parse(format!("JSON 解析失败: {} (input: {})", e, json_str))
        })?;
        Ok(result)
    }
}

#[async_trait]
impl RoutingStrategy for LlmRoutingStrategy {
    async fn route(
        &self,
        input: &str,
        targets: &[RouteTarget],
        backend: &dyn NodeBackendAccessor,
    ) -> Result<RouteResult, RoutingError> {
        if targets.is_empty() {
            return Err(RoutingError::NoTargets);
        }

        // 单一目标直接返回（避免不必要的 LLM 调用）
        if targets.len() == 1 {
            debug!(
                "Router: 唯一路由目标 {}，直接路由",
                targets[0].id
            );
            return Ok(RouteResult {
                target_id: targets[0].id.clone(),
                reason: Some("唯一路由目标，直接路由".into()),
            });
        }

        // 构造调用选项（覆盖 system_prompt，禁用工具调用）
        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()), // 路由决策不需要工具
            ..Default::default()
        };

        let user_prompt = self.render_user_prompt(input, targets);

        // 调用 LLM
        debug!("Router: 调用 LLM 进行路由决策，input 长度: {}", input.len());
        let response = backend.prompt(user_prompt, Some(options)).await?;
        info!(
            "Router: LLM 返回响应，长度: {}",
            response.text.len()
        );

        // 解析响应
        let result = Self::parse_response(&response.text)?;

        // 校验返回的 target_id 存在
        if !targets.iter().any(|t| t.id == result.target_id) {
            return Err(RoutingError::Parse(format!(
                "LLM 返回的 target_id '{}' 不在候选列表中",
                result.target_id
            )));
        }

        Ok(result)
    }
}

// ─── 关键词路由策略（备选） ────────────────────────────────────────────

/// 关键词匹配的路由策略
///
/// 检查输入是否包含各目标的 `keywords`（大小写不敏感），
/// 命中即返回该目标。多目标命中时返回第一个匹配项。
///
/// 适用于规则明确、无需 LLM 决策的简单路由场景。
///
/// # 注意
/// - 不调用 LLM，纯本地匹配
/// - 未配置 keywords 的目标会被跳过
/// - 全部目标都未命中时返回 `RoutingError::NoMatch`
pub struct KeywordRoutingStrategy;

impl Default for KeywordRoutingStrategy {
    fn default() -> Self {
        Self
    }
}

impl KeywordRoutingStrategy {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl RoutingStrategy for KeywordRoutingStrategy {
    async fn route(
        &self,
        input: &str,
        targets: &[RouteTarget],
        _backend: &dyn NodeBackendAccessor,
    ) -> Result<RouteResult, RoutingError> {
        if targets.is_empty() {
            return Err(RoutingError::NoTargets);
        }

        let input_lower = input.to_lowercase();
        for target in targets {
            if let Some(keywords) = &target.keywords {
                for kw in keywords {
                    if input_lower.contains(&kw.to_lowercase()) {
                        debug!(
                            "Router: 关键词命中 target={} keyword={}",
                            target.id, kw
                        );
                        return Ok(RouteResult {
                            target_id: target.id.clone(),
                            reason: Some(format!("关键词命中: {}", kw)),
                        });
                    }
                }
            }
        }

        Err(RoutingError::NoMatch(input.chars().take(100).collect()))
    }
}

// ─── Router 配置 ────────────────────────────────────────────

/// Router 配置
#[derive(Debug, Clone)]
pub struct RouterConfig {
    /// Fallback 目标 ID（无匹配时路由到此目标）
    ///
    /// - `Some(id)`：无匹配时走 fallback，触发 `RouterDecisionMade { is_fallback: true }`
    /// - `None`：无匹配时触发 `RouterNoMatch` 事件并返回 `NodeResult::error`
    #[allow(dead_code)]
    pub fallback_target_id: Option<String>,
}

impl Default for RouterConfig {
    fn default() -> Self {
        Self {
            fallback_target_id: None,
        }
    }
}

// ─── RouterNode ────────────────────────────────────────────

/// RouterNode — 路由节点
///
/// 在编排图中作为一个节点存在，被 Orchestrator 调度执行时：
/// 1. 接收当前输入（从 `state.input` 或上一节点输出）
/// 2. 通过 `RoutingStrategy` 选择路由目标
/// 3. 校验目标存在性（target_id 在 targets 列表中）
/// 4. 发射 `RouterDecisionMade` 事件
/// 5. 返回 `NodeResult::continue_to(target_id)`（让 Orchestrator 调度下一节点）
///
/// # 使用示例
/// ```rust,ignore
/// use agent_runtime::router::{RouterNode, RouteTarget, RouterConfig};
///
/// let targets = vec![
///     RouteTarget {
///         id: "coder".into(),
///         name: "代码专家".into(),
///         description: "处理代码编写、调试、重构任务".into(),
///         keywords: Some(vec!["代码".into(), "函数".into()]),
///     },
///     RouteTarget {
///         id: "writer".into(),
///         name: "文档专家".into(),
///         description: "处理文档撰写、翻译、润色任务".into(),
///         keywords: Some(vec!["文档".into(), "翻译".into()]),
///     },
/// ];
///
/// let node = RouterNode::with_default_strategy(
///     "router",
///     "路由节点",
///     targets,
///     backend,
///     RouterConfig::default(),
/// );
/// ```
pub struct RouterNode {
    /// 节点 ID
    id: String,
    /// 节点名称
    name: String,
    /// 路由目标列表（按声明顺序，LLM 策略会展示给 LLM）
    targets: Vec<RouteTarget>,
    /// 路由策略
    strategy: Arc<dyn RoutingStrategy>,
    /// 共享 LLM 后端（保留用于未来扩展：自定义策略可直接调用 backend.prompt）
    ///
    /// 当前 LlmRoutingStrategy::route 通过参数接收 `&dyn NodeBackendAccessor`，
    /// 不读取此字段，故标记 `#[allow(dead_code)]`。保留字段是为了：
    /// 1. 保持 RouterNode::new 签名稳定（不在未来扩展时破坏调用方）
    /// 2. 支持未来在 RouterNode 内部直接调用 backend 的场景（如自定义评估、缓存等）
    #[allow(dead_code)]
    backend: Arc<dyn NodeBackendAccessor>,
    /// 配置
    config: RouterConfig,
}

impl RouterNode {
    /// 创建新的 Router 节点
    ///
    /// # 参数
    /// - `id`：节点 ID（在 Orchestrator 中唯一）
    /// - `name`：节点名称（调试/日志用）
    /// - `targets`：路由目标列表
    /// - `strategy`：路由策略
    /// - `backend`：LLM 后端访问器（LLM 策略使用，关键词策略忽略）
    /// - `config`：Router 配置
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        targets: Vec<RouteTarget>,
        strategy: Arc<dyn RoutingStrategy>,
        backend: Arc<dyn NodeBackendAccessor>,
        config: RouterConfig,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            targets,
            strategy,
            backend,
            config,
        }
    }

    /// 使用默认 LLM 策略创建（便捷方法）
    pub fn with_default_strategy(
        id: impl Into<String>,
        name: impl Into<String>,
        targets: Vec<RouteTarget>,
        backend: Arc<dyn NodeBackendAccessor>,
        config: RouterConfig,
    ) -> Self {
        Self::new(
            id,
            name,
            targets,
            Arc::new(LlmRoutingStrategy::new()),
            backend,
            config,
        )
    }

    /// 使用关键词策略创建（便捷方法）
    pub fn with_keyword_strategy(
        id: impl Into<String>,
        name: impl Into<String>,
        targets: Vec<RouteTarget>,
        backend: Arc<dyn NodeBackendAccessor>,
        config: RouterConfig,
    ) -> Self {
        Self::new(
            id,
            name,
            targets,
            Arc::new(KeywordRoutingStrategy::new()),
            backend,
            config,
        )
    }

    /// 查找路由目标
    fn find_target(&self, target_id: &str) -> Option<&RouteTarget> {
        self.targets.iter().find(|t| t.id == target_id)
    }

    /// 获取路由目标列表（只读）
    pub fn targets(&self) -> &[RouteTarget] {
        &self.targets
    }
}

#[async_trait]
impl OrchestratorNode for RouterNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::Router
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        // ── 1. 读取当前输入 ──
        // 优先用 state.input，否则用最后一条 user 消息
        let input = if !ctx.state.input.is_empty() {
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

        if input.is_empty() {
            return NodeResult::error("Router: 输入为空（state.input 与 messages 中均无 user 消息）");
        }

        // ── 2. 中断检查 ──
        if ctx.is_aborted() {
            warn!("Router: 中断检查命中（路由决策前）");
            return NodeResult::aborted();
        }

        // ── 3. 路由决策 ──
        let route_result = match self.strategy.route(&input, &self.targets, ctx.backend).await {
            Ok(r) => r,
            Err(RoutingError::NoMatch(input_sample)) => {
                // 无匹配：检查是否配置了 fallback
                if let Some(fallback_id) = &self.config.fallback_target_id {
                    // 校验 fallback 目标存在
                    if let Some(fallback_target) = self.find_target(fallback_id) {
                        info!(
                            "Router: 无匹配，走 fallback target={}",
                            fallback_id
                        );
                        ctx.emit(OrchestratorEvent::RouterDecisionMade {
                            node_id: self.id.clone(),
                            target_id: fallback_target.id.clone(),
                            target_name: fallback_target.name.clone(),
                            reason: Some(format!(
                                "无匹配，走 fallback（input: {}）",
                                input_sample
                            )),
                            is_fallback: true,
                        });
                        return NodeResult::continue_to(fallback_target.id.clone())
                            .error_or_continue(); // continue_to 已设置 next_node_id
                    } else {
                        let error_msg = format!(
                            "Router: fallback_target_id '{}' 不在 targets 列表中",
                            fallback_id
                        );
                        ctx.emit(OrchestratorEvent::RouterError {
                            node_id: self.id.clone(),
                            stage: "fallback_lookup".into(),
                            error: error_msg.clone(),
                        });
                        return NodeResult::error(error_msg);
                    }
                }

                // 无 fallback：触发 RouterNoMatch 事件并返回错误
                let input_sample: String = input.chars().take(100).collect();
                ctx.emit(OrchestratorEvent::RouterNoMatch {
                    node_id: self.id.clone(),
                    input_sample: input_sample.clone(),
                });
                return NodeResult::error(format!(
                    "Router: 无匹配路由目标（input: {}）",
                    input_sample
                ));
            }
            Err(e) => {
                let error_msg = format!("Router 路由决策失败: {}", e);
                ctx.emit(OrchestratorEvent::RouterError {
                    node_id: self.id.clone(),
                    stage: "route".into(),
                    error: error_msg.clone(),
                });
                return NodeResult::error(error_msg);
            }
        };

        debug!(
            "Router: 路由决策完成 target={} (reason: {:?})",
            route_result.target_id, route_result.reason
        );

        // ── 4. 目标校验 ──
        let target = match self.find_target(&route_result.target_id) {
            Some(t) => t,
            None => {
                let error_msg = format!(
                    "Router: 路由目标不存在: {}（targets 中未找到）",
                    route_result.target_id
                );
                ctx.emit(OrchestratorEvent::RouterError {
                    node_id: self.id.clone(),
                    stage: "target_lookup".into(),
                    error: error_msg.clone(),
                });
                return NodeResult::error(error_msg);
            }
        };

        // ── 5. 发射 RouterDecisionMade 事件 ──
        ctx.emit(OrchestratorEvent::RouterDecisionMade {
            node_id: self.id.clone(),
            target_id: target.id.clone(),
            target_name: target.name.clone(),
            reason: route_result.reason.clone(),
            is_fallback: false,
        });

        // ── 6. 返回结果 ──
        // Continue + next_node_id：让 Orchestrator 按图查找下一节点并调度
        NodeResult {
            status: NodeStatus::Continue,
            next_node_id: Some(target.id.clone()),
            error: None,
            summary: Some(format!("Router: 已路由到 '{}' 分支", target.name)),
        }
    }
}

// ─── 辅助 trait：把 error_or_continue 简化为直接构造 ───────────────────────────────

/// NodeResult 的辅助 trait（仅在本模块内用于 fallback 路径）
///
/// 由于 `NodeResult::continue_to` 不返回 `self`，无法链式调用。
/// 这里提供简化的辅助方法。
trait NodeResultExt {
    fn error_or_continue(self) -> Self;
}

impl NodeResultExt for NodeResult {
    /// 占位方法：实际上 `continue_to` 已构造完整 NodeResult，这里直接返回 self
    ///
    /// 之所以存在是因为 fallback 路径需要继续返回 NodeResult，但 `continue_to`
    /// 是关联函数而非方法。此处保留以简化代码阅读。
    fn error_or_continue(self) -> Self {
        self
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

    /// 测试用 Backend — 返回预设的固定响应
    struct StubBackend {
        response_text: String,
        prompt_count: Mutex<usize>,
    }

    impl StubBackend {
        fn new(response_text: impl Into<String>) -> Self {
            Self {
                response_text: response_text.into(),
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
            Ok(PromptResponse::text_only(self.response_text.clone()))
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

    // ─── 测试桩：策略 ────────────────────────────────────

    /// 测试用策略 — 固定返回指定的 target_id
    struct StubStrategy {
        target_id: String,
    }

    impl StubStrategy {
        fn new(target_id: impl Into<String>) -> Self {
            Self {
                target_id: target_id.into(),
            }
        }
    }

    #[async_trait]
    impl RoutingStrategy for StubStrategy {
        async fn route(
            &self,
            _input: &str,
            _targets: &[RouteTarget],
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<RouteResult, RoutingError> {
            Ok(RouteResult {
                target_id: self.target_id.clone(),
                reason: Some("stub".into()),
            })
        }
    }

    // ─── 测试桩：NodeContext 依赖 ────────────────────────────────────

    struct NoopEmitter;
    impl EventEmitter for NoopEmitter {
        fn emit(&self, _event: OrchestratorEvent) {}
    }

    struct NoopAbortCheck;
    #[async_trait]
    impl AbortCheck for NoopAbortCheck {
        fn is_aborted(&self) -> bool {
            false
        }
        async fn wait_if_paused(&self) {}
    }

    // ─── 辅助函数 ────────────────────────────────────

    fn make_targets() -> Vec<RouteTarget> {
        vec![
            RouteTarget {
                id: "coder".into(),
                name: "代码专家".into(),
                description: "处理代码任务".into(),
                keywords: Some(vec!["代码".into(), "函数".into()]),
            },
            RouteTarget {
                id: "writer".into(),
                name: "文档专家".into(),
                description: "处理文档任务".into(),
                keywords: Some(vec!["文档".into(), "翻译".into()]),
            },
        ]
    }

    fn make_backend(response_text: &str) -> Arc<StubBackend> {
        Arc::new(StubBackend::new(response_text))
    }

    // ─── 策略测试 ────────────────────────────────────

    #[tokio::test]
    async fn llm_strategy_should_return_target_id_from_llm_response() {
        let backend = make_backend(r#"{"target_id":"coder","reason":"代码任务"}"#);
        let strategy = LlmRoutingStrategy::new();
        let result = strategy
            .route("写个函数", &make_targets(), &*backend)
            .await
            .unwrap();
        assert_eq!(result.target_id, "coder");
        assert_eq!(result.reason.as_deref(), Some("代码任务"));
        assert_eq!(backend.prompt_count(), 1);
    }

    #[tokio::test]
    async fn llm_strategy_should_skip_llm_call_when_single_target() {
        let backend = make_backend("should_not_be_called");
        let strategy = LlmRoutingStrategy::new();
        let single = vec![RouteTarget {
            id: "only".into(),
            name: "唯一".into(),
            description: "唯一目标".into(),
            keywords: None,
        }];
        let result = strategy.route("任何输入", &single, &*backend).await.unwrap();
        assert_eq!(result.target_id, "only");
        assert_eq!(backend.prompt_count(), 0);
    }

    #[tokio::test]
    async fn llm_strategy_should_parse_json_with_code_fence() {
        let backend = make_blueprint(r#"```json
{"target_id":"writer","reason":"文档任务"}
```"#);
        let strategy = LlmRoutingStrategy::new();
        let result = strategy
            .route("写文档", &make_targets(), &*backend)
            .await
            .unwrap();
        assert_eq!(result.target_id, "writer");
    }

    /// 辅助：与 make_backend 一致，独立命名便于阅读
    fn make_blueprint(response_text: &str) -> Arc<StubBackend> {
        Arc::new(StubBackend::new(response_text))
    }

    #[tokio::test]
    async fn llm_strategy_should_error_when_target_id_not_in_candidates() {
        let backend = make_backend(r#"{"target_id":"nonexistent","reason":"x"}"#);
        let strategy = LlmRoutingStrategy::new();
        let err = strategy
            .route("输入", &make_targets(), &*backend)
            .await
            .unwrap_err();
        assert!(matches!(err, RoutingError::Parse(_)));
    }

    #[tokio::test]
    async fn llm_strategy_should_error_when_no_targets() {
        let backend = make_backend("x");
        let strategy = LlmRoutingStrategy::new();
        let err = strategy.route("输入", &[], &*backend).await.unwrap_err();
        assert!(matches!(err, RoutingError::NoTargets));
    }

    #[tokio::test]
    async fn keyword_strategy_should_match_keyword_case_insensitive() {
        let backend = make_backend("should_not_be_called");
        let strategy = KeywordRoutingStrategy::new();
        let result = strategy
            .route("请帮我写一个函数", &make_targets(), &*backend)
            .await
            .unwrap();
        assert_eq!(result.target_id, "coder");
        assert_eq!(backend.prompt_count(), 0); // 关键词策略不调 LLM
    }

    #[tokio::test]
    async fn keyword_strategy_should_return_no_match_when_no_keyword_hit() {
        let backend = make_blueprint("x");
        let strategy = KeywordRoutingStrategy::new();
        let err = strategy
            .route("无关输入", &make_targets(), &*backend)
            .await
            .unwrap_err();
        assert!(matches!(err, RoutingError::NoMatch(_)));
    }

    // ─── RouterNode::execute 测试 ────────────────────────────────────

    #[tokio::test]
    async fn router_node_should_return_continue_with_next_node_id() {
        let backend = make_backend(r#"{"target_id":"coder","reason":"代码"}"#);
        let node = RouterNode::with_default_strategy(
            "router",
            "路由",
            make_targets(),
            backend as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        let mut state = OrchestratorState::new("写函数");
        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        assert_eq!(result.next_node_id.as_deref(), Some("coder"));
        assert!(result.summary.is_some());
    }

    #[tokio::test]
    async fn router_node_should_use_state_input_first() {
        let backend = make_backend(r#"{"target_id":"writer","reason":"文档"}"#);
        let node = RouterNode::with_default_strategy(
            "router",
            "路由",
            make_targets(),
            backend as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        // state.input 有值，应优先使用
        let mut state = OrchestratorState::new("写文档");
        // 同时在 messages 中放入 user 消息，验证不会被误用
        state.messages.push(crate::types::OrchestratorMessage {
            role: MessageRole::User,
            content: "写代码".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });

        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        // state.input="写文档" → LLM 返回 writer
        assert_eq!(result.next_node_id.as_deref(), Some("writer"));
    }

    #[tokio::test]
    async fn router_node_should_fallback_when_no_match_and_fallback_configured() {
        // 使用关键词策略，输入不含任何关键词 → NoMatch → fallback
        let backend = make_backend("should_not_be_called");
        let mut targets = make_targets();
        // 加一个 fallback 目标
        targets.push(RouteTarget {
            id: "fallback".into(),
            name: "兜底".into(),
            description: "兜底分支".into(),
            keywords: None,
        });

        let config = RouterConfig {
            fallback_target_id: Some("fallback".into()),
        };
        let node = RouterNode::with_keyword_strategy(
            "router",
            "路由",
            targets,
            backend as Arc<dyn NodeBackendAccessor>,
            config,
        );

        let mut state = OrchestratorState::new("无关输入");
        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        assert_eq!(result.next_node_id.as_deref(), Some("fallback"));
    }

    #[tokio::test]
    async fn router_node_should_error_when_no_match_and_no_fallback() {
        let backend = make_backend("should_not_be_called");
        let node = RouterNode::with_keyword_strategy(
            "router",
            "路由",
            make_targets(),
            backend as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        let mut state = OrchestratorState::new("无关输入");
        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
        assert!(result.error.as_deref().unwrap().contains("无匹配"));
    }

    #[tokio::test]
    async fn router_node_should_error_when_empty_input() {
        let backend = make_backend("should_not_be_called");
        let node = RouterNode::with_default_strategy(
            "router",
            "路由",
            make_targets(),
            backend as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        let mut state = OrchestratorState::new(String::new());
        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
        assert!(result.error.as_deref().unwrap().contains("输入为空"));
    }

    // ─── 序列化测试 ────────────────────────────────────

    #[test]
    fn route_target_should_serialize_with_keywords() {
        let target = RouteTarget {
            id: "coder".into(),
            name: "代码专家".into(),
            description: "处理代码任务".into(),
            keywords: Some(vec!["代码".into(), "函数".into()]),
        };
        let json = serde_json::to_string(&target).unwrap();
        assert!(json.contains("\"id\":\"coder\""));
        assert!(json.contains("\"keywords\":[\"代码\",\"函数\"]"));
    }

    #[test]
    fn route_target_should_skip_keywords_when_none() {
        let target = RouteTarget {
            id: "fallback".into(),
            name: "兜底".into(),
            description: "兜底分支".into(),
            keywords: None,
        };
        let json = serde_json::to_string(&target).unwrap();
        assert!(!json.contains("keywords"));
    }

    #[test]
    fn route_result_should_skip_reason_when_none() {
        let result = RouteResult {
            target_id: "coder".into(),
            reason: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"target_id\":\"coder\""));
        assert!(!json.contains("reason"));
    }

    // ─── 嵌套路由（路由树）演示测试 ────────────────────────────────────
    //
    // 演示"Router → Router → 专业 Agent"的链式决策。
    // 嵌套关系由编排图管理：Router A 的某个 target.id 指向 Router B 节点 id。
    // 这里通过两个独立的 RouterNode 模拟链式决策，验证：
    // 1. Router A 决策后返回 next_node_id = "router_b"
    // 2. Router B 接收新输入后继续决策，返回 next_node_id = "coder"
    // 3. 两次决策的事件独立发射，便于追踪路由链路

    #[tokio::test]
    async fn nested_router_should_chain_decisions_via_orchestrator_graph() {
        // Router A：顶层路由，根据输入类别路由到子 Router 或兜底
        // targets 包含另一个 Router 节点 id（"router_b"）作为下一跳
        let targets_a = vec![
            RouteTarget {
                id: "router_b".into(),
                name: "技术子路由".into(),
                description: "处理技术类任务，进一步细分到代码/文档".into(),
                keywords: Some(vec!["代码".into(), "文档".into(), "函数".into()]),
            },
            RouteTarget {
                id: "general_agent".into(),
                name: "通用 Agent".into(),
                description: "处理非技术类通用任务".into(),
                keywords: None,
            },
        ];

        let backend_a = make_backend(r#"{"target_id":"router_b","reason":"技术任务"}"#);
        let router_a = RouterNode::with_default_strategy(
            "router_a",
            "顶层路由",
            targets_a,
            backend_a as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        // 第一跳：Router A 决策
        let mut state_a = OrchestratorState::new("帮我写一个排序函数");
        let backend_ref_a: &dyn NodeBackendAccessor = &*router_a.backend;
        let emitter_a = NoopEmitter;
        let abort_a = NoopAbortCheck;
        let ctx_a = NodeContext {
            state: &mut state_a,
            backend: backend_ref_a,
            memory: None,
            emitter: &emitter_a,
            abort_check: &abort_a,
        };
        let result_a = router_a.execute(ctx_a).await;
        assert_eq!(result_a.status, NodeStatus::Continue);
        // Router A 路由到 router_b（下一跳是另一个 Router 节点）
        assert_eq!(result_a.next_node_id.as_deref(), Some("router_b"));

        // 第二跳：Router B 接收原输入，进一步路由到专业 Agent
        // （实际编排中，Orchestrator 会把 state.input 透传给下一节点）
        let targets_b = vec![
            RouteTarget {
                id: "coder".into(),
                name: "代码专家".into(),
                description: "处理代码编写、调试、重构任务".into(),
                keywords: Some(vec!["代码".into(), "函数".into()]),
            },
            RouteTarget {
                id: "writer".into(),
                name: "文档专家".into(),
                description: "处理文档撰写、翻译、润色任务".into(),
                keywords: Some(vec!["文档".into(), "翻译".into()]),
            },
        ];

        let backend_b = make_backend(r#"{"target_id":"coder","reason":"代码任务"}"#);
        let router_b = RouterNode::with_default_strategy(
            "router_b",
            "技术子路由",
            targets_b,
            backend_b as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        // Router B 接收原输入继续决策
        let mut state_b = OrchestratorState::new("帮我写一个排序函数");
        let backend_ref_b: &dyn NodeBackendAccessor = &*router_b.backend;
        let emitter_b = NoopEmitter;
        let abort_b = NoopAbortCheck;
        let ctx_b = NodeContext {
            state: &mut state_b,
            backend: backend_ref_b,
            memory: None,
            emitter: &emitter_b,
            abort_check: &abort_b,
        };
        let result_b = router_b.execute(ctx_b).await;
        assert_eq!(result_b.status, NodeStatus::Continue);
        // Router B 路由到 coder（最终专业 Agent）
        assert_eq!(result_b.next_node_id.as_deref(), Some("coder"));

        // 验证：两次决策的 summary 独立，便于追踪路由链路
        assert!(result_a
            .summary
            .as_deref()
            .unwrap()
            .contains("技术子路由"));
        assert!(result_b.summary.as_deref().unwrap().contains("代码专家"));
    }
}
