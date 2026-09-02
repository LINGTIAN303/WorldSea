//! Router Pattern — 路由编排模式，详细见 docs/details/注释/agent-runtime/router.md

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use agent_kernel::backend::{NodeBackendAccessor, PromptCallOptions};
use agent_kernel::event::OrchestratorEvent;
use agent_kernel::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
use agent_kernel::router_decider::{RouterDecider, RouterDecision};
use agent_kernel::types::MessageRole;

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
    /// 根据输入和候选路由目标，决定路由到哪个目标，详细见 docs/details/注释/agent-runtime/router.md
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

impl From<agent_kernel::backend::BackendError> for RoutingError {
    fn from(e: agent_kernel::backend::BackendError) -> Self {
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

        // 构造调用选项（覆盖 system_prompt；R6 第四部分：静默调用——决策 JSON 等
        // 中间产物不泄漏为对话流正文段）。
        // 2026-09-02 B 类迁移：优先用决策工具强制调用（tool-use-as-JSON，force_tool），
        // 模型经 tool_call 返回结构化参数；未返回 tool_call 时回退旧 parse_response。
        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools: vec![crate::orchestrator::decision::route_target_decision_tool()],
            force_tool: Some("route_target_decision".into()),
            silent: true,
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

        // 优先取强制决策工具的 tool_call 参数（结构化输出形态）
        if let Some(tc) = response.tool_calls.into_iter().next() {
            let result: RouteResult = serde_json::from_value(tc.args)
                .map_err(|e| RoutingError::Parse(format!("路由决策参数非约定结构: {e}")))?;
            if !targets.iter().any(|t| t.id == result.target_id) {
                return Err(RoutingError::Parse(format!(
                    "LLM 返回的 target_id '{}' 不在候选列表中",
                    result.target_id
                )));
            }
            return Ok(result);
        }

        // 回退：旧响应文本 JSON 解析（`tools_override` 不再禁用工具，仅兜底用）
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

/// 关键词匹配的路由策略，详细见 docs/details/注释/agent-runtime/router.md
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

// ─── 四管线（A3）──────────────────────────────────────────────
//
// 参考 OpenWorld `IntentClassifier + Dispatcher` 的语义四管线设计，适配到
// WorldSmith 现有的 `RoutingStrategy` / `RouteTarget` / `RouterNode` 架构。
// 四管线：Query(查询) / Research(研究) / Experiment(实验) / Compose(创作)。
// 意图分类策略：LLM 优先（3s 超时）→ 降级关键词 → RouterNode.fallback。
// 支持 force_pipeline 强制管线（前端 Chip 注入 `/管线` 前缀）。

/// 四管线枚举 — 已上移底座 `crate::router_decider::Pipeline`（crate 拆分前置，
/// 消除 kernel→patterns 反向依赖），此处 re-export 保持对外路径兼容。
pub use agent_kernel::router_decider::Pipeline;

/// 构造四管线的路由目标列表
///
/// 与 `RouteTarget` 兼容，可直接作为 `RouterNode` 的 targets；
/// 每个目标带内部使用的 `keywords`（供关键词策略降级时匹配）。
pub fn pipeline_targets() -> Vec<RouteTarget> {
    vec![
        RouteTarget {
            id: "query".into(),
            name: "查询专家".into(),
            description: "处理事实性查询、信息检索、简单问答类任务（快、低开销）".into(),
            keywords: Some(vec![
                "查询".into(),
                "事实".into(),
                "解释".into(),
                "请问".into(),
                "什么是".into(),
                "如何".into(),
            ]),
        },
        RouteTarget {
            id: "research".into(),
            name: "研究专家".into(),
            description: "处理深度研究、多源调研、综述生成类任务（多步检索、多源整合）".into(),
            keywords: Some(vec![
                "研究".into(),
                "调研".into(),
                "综述".into(),
                "文献".into(),
                "检索".into(),
            ]),
        },
        RouteTarget {
            id: "experiment".into(),
            name: "实验专家".into(),
            description: "处理数据分析、代码编写、实验脚本类任务（计算、尝试、创新）".into(),
            keywords: Some(vec![
                "实验".into(),
                "分析".into(),
                "计算".into(),
                "代码".into(),
                "数据".into(),
                "脚本".into(),
            ]),
        },
        RouteTarget {
            id: "compose".into(),
            name: "创作专家".into(),
            description: "处理创作、写作、润色、内容生成类任务（保持艺术联想性）".into(),
            keywords: Some(vec![
                "创作".into(),
                "写作".into(),
                "续写".into(),
                "润色".into(),
                "改写".into(),
                "撰写".into(),
            ]),
        },
    ]
}

/// 从输入文本提取强制管线（force_pipeline）
///
/// 检测两类信号：
/// 1. 领先 token 为 Chip 前缀（中文 `/写作` `/调研` `/分析` `/查询` 或英文 `/compose` 等）
/// 2. 整段输入等于显式管线名（`query` / `research` / `experiment` / `compose`）
///
/// 命中返回对应 `Pipeline`，否则 `None`（交由 LLM/关键词策略正常分类）。
/// 优先级：Compose > Research > Experiment > Query（与 OpenWorld Dispatcher 一致）。
pub fn extract_force_pipeline(input: &str) -> Option<Pipeline> {
    let trimmed = input.trim();
    let lower = trimmed.to_lowercase();
    let first_word = lower.split_whitespace().next().unwrap_or("");

    // 1. Chip 前缀（领先 token）
    for kw in [
        "/写作",
        "/续写",
        "/润色",
        "/创作",
        "/改写",
        "/撰写",
        "/compose",
        "/write",
        "/polish",
    ] {
        if first_word.starts_with(kw) || first_word == kw {
            return Some(Pipeline::Compose);
        }
    }
    for kw in ["/调研", "/综述", "/文献", "/检索", "/research"] {
        if first_word.starts_with(kw) || first_word == kw {
            return Some(Pipeline::Research);
        }
    }
    for kw in [
        "/分析", "/计算", "/实验", "/代码", "/数据", "/experiment", "/analyze",
    ] {
        if first_word.starts_with(kw) || first_word == kw {
            return Some(Pipeline::Experiment);
        }
    }
    for kw in ["/查询", "/解释", "/问答", "/query", "/search"] {
        if first_word.starts_with(kw) || first_word == kw {
            return Some(Pipeline::Query);
        }
    }

    // 2. 整段等于显式管线名
    match lower.trim() {
        "query" => Some(Pipeline::Query),
        "research" => Some(Pipeline::Research),
        "experiment" => Some(Pipeline::Experiment),
        "compose" => Some(Pipeline::Compose),
        _ => None,
    }
}

/// 四管线路由策略（A3 默认）
///
/// 组合策略：
/// 1. **force_pipeline 优先**：输入含强制管线前缀时直接路由，跳过 LLM。
/// 2. **LLM 意图分类**：带 `timeout`（默认 3s），返回各分支能力描述最匹配者。
/// 3. **超时降级关键词**：LLM 超时（网络/卡顿）时降级到 `KeywordRoutingStrategy`，
///    避免用户等待；关键词未命中时由 `RouterNode` 的 fallback 兜底。
pub struct PipelineRoutingStrategy {
    llm_strategy: LlmRoutingStrategy,
    keyword_strategy: KeywordRoutingStrategy,
    timeout: Duration,
}

impl Default for PipelineRoutingStrategy {
    fn default() -> Self {
        Self::new()
    }
}

impl PipelineRoutingStrategy {
    /// 创建四管线路由策略，使用默认 3s 超时
    pub fn new() -> Self {
        Self {
            llm_strategy: LlmRoutingStrategy::new(),
            keyword_strategy: KeywordRoutingStrategy::new(),
            timeout: Duration::from_secs(3),
        }
    }

    /// 使用自定义超时创建
    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            llm_strategy: LlmRoutingStrategy::new(),
            keyword_strategy: KeywordRoutingStrategy::new(),
            timeout,
        }
    }
}

#[async_trait]
impl RoutingStrategy for PipelineRoutingStrategy {
    async fn route(
        &self,
        input: &str,
        targets: &[RouteTarget],
        backend: &dyn NodeBackendAccessor,
    ) -> Result<RouteResult, RoutingError> {
        if targets.is_empty() {
            return Err(RoutingError::NoTargets);
        }

        // 1. force_pipeline 强制
        if let Some(pipeline) = extract_force_pipeline(input) {
            if let Some(target) = targets.iter().find(|t| t.id == pipeline.target_id()) {
                debug!(
                    "Router: 强制管线 pipeline={:?} target={}",
                    pipeline,
                    target.id
                );
                return Ok(RouteResult {
                    target_id: target.id.clone(),
                    reason: Some(format!("强制管线: {}", pipeline.label())),
                });
            }
        }

        // 2. LLM 意图分类（带超时）
        match tokio::time::timeout(self.timeout, self.llm_strategy.route(input, targets, backend))
            .await
        {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(e)) => Err(e),
            Err(_elapsed) => {
                // 3. 超时降级关键词
                warn!("Router: LLM 路由超时（{:?}），降级关键词策略", self.timeout);
                self.keyword_strategy.route(input, targets, backend).await
            }
        }
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

/// RouterNode — 路由节点，详细见 docs/details/注释/agent-runtime/router.md
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

    /// 使用四管线策略创建（A3 便捷方法）
    ///
    /// 自动使用 `pipeline_targets()` 作为路由目标，并接入 `PipelineRoutingStrategy`
    /// （LLM 3s 超时降级关键词 + force_pipeline 强制）。
    pub fn with_pipeline_strategy(
        id: impl Into<String>,
        name: impl Into<String>,
        backend: Arc<dyn NodeBackendAccessor>,
        config: RouterConfig,
    ) -> Self {
        let targets = pipeline_targets();
        Self::new(
            id,
            name,
            targets,
            Arc::new(PipelineRoutingStrategy::new()),
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

    /// 仅做路由决策（供 AgentLoop 发送链路接入）
    ///
    /// 直接调用内部策略返回 `RouteResult`，不产生 `OrchestratorNode::execute` 的
    /// 事件/状态副作用。事件广播与 fallback 处理由调用方（AgentLoop）负责。
    pub async fn decide(
        &self,
        input: &str,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<RouteResult, RoutingError> {
        self.strategy.route(input, &self.targets, backend).await
    }
}

#[async_trait]
impl RouterDecider for RouterNode {
    /// 仅做路由决策（供 AgentLoop 发送链路接入）
    ///
    /// 复用 `RoutingStrategy::route`，把 `RouteResult` 适配为底座侧
    /// `RouterDecision`（补充 target_name）。不产生节点副作用。
    async fn decide(
        &self,
        input: &str,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<RouterDecision, String> {
        let result = self
            .strategy
            .route(input, &self.targets, backend)
            .await
            .map_err(|e| e.to_string())?;
        let target_name = self
            .find_target(&result.target_id)
            .map(|t| t.name.clone())
            .unwrap_or_else(|| result.target_id.clone());
        Ok(RouterDecision {
            target_id: result.target_id,
            target_name,
            reason: result.reason,
        })
    }

    fn id(&self) -> String {
        self.id.clone()
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
            ..Default::default()
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

#[cfg(test)]
#[path = "router_tests.rs"]
mod tests;
