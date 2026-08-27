//! Reflection / Self-Refine 模式节点（ReflectionNode + RefineNode），详细见 docs/details/注释/agent-runtime/reflection.md
//!
//! 链路：ReflectionNode 评审上一条 assistant 输出 → 评分低于阈值时 continue 到 RefineNode →
//! RefineNode 依据评审反馈修正 → continue 回 ReflectionNode 再评审，直至收敛。
//! 收敛条件由 RefineNode 判断（max_iterations / min_score / no_improvement_rounds）。

use async_trait::async_trait;
use serde_json::Value;

use agent_kernel::event::OrchestratorEvent;
use agent_kernel::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
use crate::shared::json::extract_json_object;
use agent_kernel::types::{MessageRole, OrchestratorMessage, ReflectionIssue, ReflectionResult, ReflectionSeverity};

// ─── 评审维度 ─────────────────────────────────────────────────────────

/// 评审维度元数据（注入 prompt 引导 LLM 评审）
#[derive(Debug, Clone)]
pub struct ReflectionDimension {
    /// 维度键名（如 "correctness"）
    pub key: String,
    /// 维度中文名（如 "正确性"）
    pub label: String,
    /// 该维度的评审说明
    pub description: String,
}

/// 默认评审维度
pub fn default_dimensions() -> Vec<ReflectionDimension> {
    vec![
        ReflectionDimension {
            key: "correctness".into(),
            label: "正确性".into(),
            description: "事实是否准确、推理是否合理、逻辑是否自洽".into(),
        },
        ReflectionDimension {
            key: "completeness".into(),
            label: "完整性".into(),
            description: "是否覆盖了用户任务的所有需求点，是否有遗漏".into(),
        },
        ReflectionDimension {
            key: "style".into(),
            label: "风格".into(),
            description: "输出格式、表达方式、语言风格是否符合期望".into(),
        },
    ]
}

/// 默认评审 prompt 模板
const DEFAULT_REFLECTION_PROMPT_TEMPLATE: &str = "请对以下内容进行严格评审。

原始任务：{{input}}

待评审内容：
{{target}}

评审维度：
{{dimensions}}

要求：
1. 对每个维度进行评估
2. 给出综合评分（0-100，越高越好）
3. 列出识别的问题（severity: info/warning/error）
4. 给出具体的改进建议

输出 JSON 格式：
```json
{
  \"score\": 85,
  \"issues\": [
    { \"severity\": \"warning\", \"description\": \"具体问题描述\" }
  ],
  \"suggestions\": [\"具体可执行的改进建议1\", \"改进建议2\"]
}
```

只输出 JSON，不要额外解释。";

// ─── ReflectionNode ───────────────────────────────────────────────────

/// ReflectionNode 配置
#[derive(Debug, Clone)]
pub struct ReflectionNodeConfig {
    /// 节点唯一 ID
    pub id: String,
    /// 人类可读名称
    pub name: String,
    /// 自定义 prompt 模板（占位符 {{input}}/{{target}}/{{dimensions}}/{{lastMessage}}）
    pub prompt_template: Option<String>,
    /// 评审维度（默认 correctness/completeness/style）
    pub dimensions: Vec<ReflectionDimension>,
    /// 通过评分阈值（score >= threshold 视为通过返回 done，默认 70）
    pub pass_threshold: u32,
    /// 是否把生成的 prompt 写入 state.messages（默认 true）
    pub record_user_message: bool,
    /// 是否把评审结果作为 system 消息写入 state.messages（默认 true，供 RefineNode 参考）
    pub record_reflection_as_message: bool,
    /// 未通过（score < threshold）时跳转的下一节点（默认 None = 由 Orchestrator 边/结束决定）
    pub next_node_id: Option<String>,
}

impl Default for ReflectionNodeConfig {
    fn default() -> Self {
        Self {
            id: "reflection".into(),
            name: "ReflectionNode".into(),
            prompt_template: None,
            dimensions: default_dimensions(),
            pass_threshold: 70,
            record_user_message: true,
            record_reflection_as_message: true,
            next_node_id: None,
        }
    }
}

/// ReflectionNode — 评审节点，评估上一条 assistant 输出质量
pub struct ReflectionNode {
    id: String,
    name: String,
    config: ReflectionNodeConfig,
}

impl ReflectionNode {
    /// 创建 ReflectionNode
    pub fn new(config: ReflectionNodeConfig) -> Self {
        let name = if config.name.is_empty() {
            format!("ReflectionNode:{}", config.id)
        } else {
            config.name.clone()
        };
        Self {
            id: config.id.clone(),
            name,
            config,
        }
    }

    /// 默认评审目标：最后一条非空 assistant 消息
    fn select_target(&self, ctx: &NodeContext<'_>) -> Option<String> {
        ctx.state
            .messages
            .iter()
            .rev()
            .find(|m| m.role == MessageRole::Assistant && !m.content.trim().is_empty())
            .map(|m| m.content.clone())
    }

    fn render_prompt(&self, ctx: &NodeContext<'_>, target: &str) -> String {
        let template = self
            .config
            .prompt_template
            .as_deref()
            .unwrap_or(DEFAULT_REFLECTION_PROMPT_TEMPLATE);
        let dimensions = self
            .config
            .dimensions
            .iter()
            .map(|d| format!("- {}（{}）：{}", d.label, d.key, d.description))
            .collect::<Vec<_>>()
            .join("\n");
        template
            .replace("{{input}}", &ctx.state.input)
            .replace("{{target}}", target)
            .replace("{{dimensions}}", &dimensions)
            .replace(
                "{{lastMessage}}",
                ctx.state
                    .messages
                    .last()
                    .map(|m| m.content.as_str())
                    .unwrap_or(""),
            )
    }
}

#[async_trait]
impl OrchestratorNode for ReflectionNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::Reflection
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        if ctx.is_aborted() {
            return NodeResult::aborted();
        }

        let Some(target) = self.select_target(&ctx) else {
            return NodeResult::done_with_summary("没有可评审的内容");
        };

        let iteration = ctx.state.reflections.as_ref().map(|r| r.len() as u32).unwrap_or(0) + 1;
        let threshold = self.config.pass_threshold;

        let prompt = self.render_prompt(&ctx, &target);
        if prompt.trim().is_empty() {
            return NodeResult::error("渲染后的评审 prompt 为空");
        }
        if self.config.record_user_message {
            ctx.state
                .messages
                .push(make_msg(MessageRole::User, prompt.clone()));
        }

        let response = match ctx.backend.prompt(prompt, None).await {
            Ok(r) => r.text,
            Err(e) => return NodeResult::error(format!("ReflectionNode LLM 调用失败: {e}")),
        };
        if ctx.is_aborted() {
            return NodeResult::aborted();
        }
        ctx.state
            .messages
            .push(make_msg(MessageRole::Assistant, response.clone()));

        let Some(result) = parse_reflection(&response, &target, iteration) else {
            return NodeResult::error("无法从 LLM 响应解析出评审结果（期望 JSON）");
        };

        // 写状态 + 广播事件
        ctx.state.reflections.get_or_insert_with(Vec::new).push(result.clone());
        ctx.emit(OrchestratorEvent::ReflectionResult { result: result.clone() });

        // 作为 system 消息写入（供 RefineNode 参考历史）
        if self.config.record_reflection_as_message {
            ctx.state
                .messages
                .push(make_msg(MessageRole::System, format_reflection(&result)));
        }

        let passed = result.score >= threshold;
        NodeResult {
            status: if passed {
                NodeStatus::Done
            } else {
                NodeStatus::Continue
            },
            next_node_id: if passed {
                None
            } else {
                self.config.next_node_id.clone()
            },
            error: None,
            summary: Some(format!(
                "评分 {}（阈值 {}），{} 个问题，{}",
                result.score,
                threshold,
                result.issues.len(),
                if passed { "通过" } else { "需改进" }
            )),
            ..Default::default()
        }
    }
}

/// 解析 LLM 评审响应为 ReflectionResult
fn parse_reflection(response: &str, target: &str, iteration: u32) -> Option<ReflectionResult> {
    let v = extract_json_object(response)?;
    Some(ReflectionResult {
        target: target.to_string(),
        score: normalize_score(v.get("score")),
        issues: normalize_issues(v.get("issues")),
        suggestions: normalize_suggestions(v.get("suggestions")),
        iteration,
    })
}

/// 规范化评分（0-100 整数，非法默认 50）
fn normalize_score(v: Option<&Value>) -> u32 {
    match v.and_then(|v| v.as_f64()) {
        Some(f) => f.clamp(0.0, 100.0).round() as u32,
        None => 50,
    }
}

/// 规范化问题列表
fn normalize_issues(v: Option<&Value>) -> Vec<ReflectionIssue> {
    let Some(arr) = v.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let obj = item.as_object()?;
            let severity = match obj.get("severity").and_then(|s| s.as_str()) {
                Some("warning") => ReflectionSeverity::Warning,
                Some("error") => ReflectionSeverity::Error,
                _ => ReflectionSeverity::Info,
            };
            let description = obj
                .get("description")
                .and_then(|d| d.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();
            Some(ReflectionIssue { severity, description })
        })
        .collect()
}

/// 规范化建议列表
fn normalize_suggestions(v: Option<&Value>) -> Vec<String> {
    let Some(arr) = v.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|s| s.as_str().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect()
}

/// 将评审结果格式化为 system 消息内容
fn format_reflection(r: &ReflectionResult) -> String {
    let issues = if r.issues.is_empty() {
        "  （无）".to_string()
    } else {
        r.issues
            .iter()
            .map(|i| format!("  - [{}] {}", severity_str(i.severity), i.description))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let suggestions = if r.suggestions.is_empty() {
        "  （无）".to_string()
    } else {
        r.suggestions
            .iter()
            .map(|s| format!("  - {s}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    format!(
        "[评审结果 第{}轮] 评分: {}/100\n问题:\n{}\n建议:\n{}",
        r.iteration, r.score, issues, suggestions
    )
}

fn severity_str(s: ReflectionSeverity) -> &'static str {
    match s {
        ReflectionSeverity::Info => "info",
        ReflectionSeverity::Warning => "warning",
        ReflectionSeverity::Error => "error",
    }
}

// ─── RefineNode ───────────────────────────────────────────────────────

/// 默认修正 prompt 模板
const DEFAULT_REFINE_PROMPT_TEMPLATE: &str = "请根据评审反馈修正以下内容。

原始任务：{{input}}

待修正内容：
{{target}}

评审结果（第{{iteration}}轮）：
- 评分：{{score}}/100
- 问题：
{{issues}}
- 改进建议：
{{suggestions}}

要求：
1. 针对评审指出的问题逐一修正
2. 落实所有改进建议
3. 保持已正确部分不变，只修正有问题的部分
4. 输出修正后的完整内容（不要输出 diff，不要解释，直接输出修正后的内容）";

/// RefineNode 配置
#[derive(Debug, Clone)]
pub struct RefineNodeConfig {
    /// 节点唯一 ID
    pub id: String,
    /// 人类可读名称
    pub name: String,
    /// 自定义 prompt 模板（占位符见默认模板）
    pub prompt_template: Option<String>,
    /// 最大迭代轮数（默认 3，达到即收敛）
    pub max_iterations: u32,
    /// 评分达标阈值（默认 90，达到即收敛）
    pub min_score: u32,
    /// 连续无改进轮数阈值（默认 2，连续 N 轮分数无提升即收敛）
    pub no_improvement_rounds: u32,
    /// 是否把生成的 prompt 写入 state.messages（默认 true）
    pub record_user_message: bool,
    /// 未收敛时跳转的下一节点 ID（默认 "reflection"，即回到评审节点）
    pub reflection_node_id: String,
}

impl Default for RefineNodeConfig {
    fn default() -> Self {
        Self {
            id: "refine".into(),
            name: "RefineNode".into(),
            prompt_template: None,
            max_iterations: 3,
            min_score: 90,
            no_improvement_rounds: 2,
            record_user_message: true,
            reflection_node_id: "reflection".into(),
        }
    }
}

/// RefineNode — 自我优化节点，依据最新评审反馈修正内容
pub struct RefineNode {
    id: String,
    name: String,
    config: RefineNodeConfig,
}

impl RefineNode {
    /// 创建 RefineNode
    pub fn new(config: RefineNodeConfig) -> Self {
        let name = if config.name.is_empty() {
            format!("RefineNode:{}", config.id)
        } else {
            config.name.clone()
        };
        Self {
            id: config.id.clone(),
            name,
            config,
        }
    }

    /// 默认收敛判断 — 综合三个条件
    fn is_converged(&self, reflections: &[ReflectionResult], iterations: u32) -> bool {
        if iterations >= self.config.max_iterations {
            return true;
        }
        let Some(latest) = reflections.last() else {
            return true;
        };
        if latest.score >= self.config.min_score {
            return true;
        }
        let n = self.config.no_improvement_rounds;
        if reflections.len() >= (n as usize) + 1 {
            let recent = &reflections[reflections.len() - (n as usize + 1)..];
            let no_improvement = recent
                .windows(2)
                .all(|w| w[1].score <= w[0].score);
            if no_improvement {
                return true;
            }
        }
        false
    }

    fn convergence_reason(&self, reflections: &[ReflectionResult], iterations: u32) -> String {
        if iterations >= self.config.max_iterations {
            return format!("达到最大迭代数（{}）", self.config.max_iterations);
        }
        if let Some(latest) = reflections.last() {
            if latest.score >= self.config.min_score {
                return format!("评分 {} 达标（阈值 {}）", latest.score, self.config.min_score);
            }
        }
        format!("连续 {} 轮无改进", self.config.no_improvement_rounds)
    }

    /// 待修正内容：优先最新评审的 target，回退到最后一条 assistant 消息
    fn select_target(&self, ctx: &NodeContext<'_>, latest: &ReflectionResult) -> Option<String> {
        if !latest.target.is_empty() {
            return Some(latest.target.clone());
        }
        ctx.state
            .messages
            .iter()
            .rev()
            .find(|m| m.role == MessageRole::Assistant && !m.content.trim().is_empty())
            .map(|m| m.content.clone())
    }

    fn render_prompt(&self, ctx: &NodeContext<'_>, target: &str, r: &ReflectionResult) -> String {
        let template = self
            .config
            .prompt_template
            .as_deref()
            .unwrap_or(DEFAULT_REFINE_PROMPT_TEMPLATE);
        let issues = if r.issues.is_empty() {
            "  （无）".to_string()
        } else {
            r.issues
                .iter()
                .map(|i| format!("  - [{}] {}", severity_str(i.severity), i.description))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let suggestions = if r.suggestions.is_empty() {
            "  （无）".to_string()
        } else {
            r.suggestions
                .iter()
                .map(|s| format!("  - {s}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        template
            .replace("{{input}}", &ctx.state.input)
            .replace("{{target}}", target)
            .replace("{{iteration}}", &r.iteration.to_string())
            .replace("{{score}}", &r.score.to_string())
            .replace("{{issues}}", &issues)
            .replace("{{suggestions}}", &suggestions)
            .replace(
                "{{lastMessage}}",
                ctx.state
                    .messages
                    .last()
                    .map(|m| m.content.as_str())
                    .unwrap_or(""),
            )
    }
}

#[async_trait]
impl OrchestratorNode for RefineNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::Refine
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        if ctx.is_aborted() {
            return NodeResult::aborted();
        }

        let reflections = ctx.state.reflections.as_ref().cloned().unwrap_or_default();
        if reflections.is_empty() {
            return NodeResult::error("state.reflections 为空，请先运行 ReflectionNode");
        }
        let iterations = reflections.len() as u32;
        let latest = reflections.last().cloned().unwrap();

        // 收敛判断
        if self.is_converged(&reflections, iterations) {
            let reason = self.convergence_reason(&reflections, iterations);
            return NodeResult::done_with_summary(format!("已收敛：{reason}"));
        }

        let Some(target) = self.select_target(&ctx, &latest) else {
            return NodeResult::error("没有可修正的内容（未找到 assistant 消息）");
        };

        let prompt = self.render_prompt(&ctx, &target, &latest);
        if prompt.trim().is_empty() {
            return NodeResult::error("渲染后的修正 prompt 为空");
        }
        if self.config.record_user_message {
            ctx.state
                .messages
                .push(make_msg(MessageRole::User, prompt.clone()));
        }

        let response = match ctx.backend.prompt(prompt, None).await {
            Ok(r) => r.text,
            Err(e) => return NodeResult::error(format!("RefineNode LLM 调用失败: {e}")),
        };
        if ctx.is_aborted() {
            return NodeResult::aborted();
        }
        // 修正后的内容作为新的 assistant 消息
        ctx.state
            .messages
            .push(make_msg(MessageRole::Assistant, response));

        // 未收敛 → continue 回评审节点再迭代
        NodeResult::continue_to(self.config.reflection_node_id.clone())
    }
}

// ─── 通用工具 ─────────────────────────────────────────────────────────

/// 构造消息
pub(crate) fn make_msg(role: MessageRole, content: String) -> OrchestratorMessage {
    OrchestratorMessage {
        role,
        content,
        tool_calls: Vec::new(),
        tool_call_id: None,
        meta: None,
    }
}

