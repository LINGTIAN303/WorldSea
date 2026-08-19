//! Plan-and-Execute 模式节点（PlanNode + ExecuteNode），详细见 docs/details/注释/agent-runtime/plan.md
//!
//! 链路：PlanNode 把用户任务分解为计划项（写 `state.plan`）→ ExecuteNode 逐个执行。
//! ExecuteNode 采用「内部循环」：一次 execute 跑完所有 pending 项（每项独立 LLM 调用并广播
//! `PlanStepUpdate`），避免 Orchestrator 循环访问超阈值（MAX_VISIT_PER_NODE=5）触发疑似循环检测。
//! 与 TS 版 execute-node 的差异：TS 是"每次 execute 执行一个步骤 + continue 回自身"，
//! Rust 版改为内部循环（对前端事件流行为一致，仅执行容器不同）。

use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use serde_json::Value;

use crate::event::OrchestratorEvent;
use crate::node::{EventEmitter, NodeContext, NodeResult, NodeType, OrchestratorNode};
use crate::types::{MessageRole, OrchestratorMessage, PlanItem, PlanItemStatus};

// ─── 通用 JSON 容错解析（Plan 用数组版，Reflection 用对象版）────────────────────────

/// 提取响应中的 ```code``` 块内容（无块则 None）
fn extract_code_block(response: &str) -> Option<String> {
    let marker = "```";
    let start = response.find(marker)? + marker.len();
    let rest = &response[start..];
    // 跳过可选的 language 标识（直到换行）
    let content_start = rest.find('\n').map(|i| i + 1).unwrap_or(0);
    let content = &rest[content_start..];
    let end = content.find(marker)?;
    Some(content[..end].trim().to_string())
}

/// 容错解析 JSON 数组 — 三级降级：
/// 1. 直接 parse（若顶层是数组）
/// 2. 提取 ```json ... ``` 代码块
/// 3. 提取首个 `[...]` 片段
pub(crate) fn extract_json_array(response: &str) -> Option<Vec<Value>> {
    if let Ok(v) = serde_json::from_str::<Value>(response) {
        if let Some(arr) = v.as_array() {
            return Some(arr.clone());
        }
    }
    if let Some(block) = extract_code_block(response) {
        if let Ok(v) = serde_json::from_str::<Value>(&block) {
            if let Some(arr) = v.as_array() {
                return Some(arr.clone());
            }
        }
    }
    if let (Some(start), Some(end)) = (response.find('['), response.rfind(']')) {
        if end > start {
            if let Ok(v) = serde_json::from_str::<Value>(&response[start..=end]) {
                if let Some(arr) = v.as_array() {
                    return Some(arr.clone());
                }
            }
        }
    }
    None
}

/// 容错解析 JSON 对象 — 三级降级（Reflection 评审结果用）
pub(crate) fn extract_json_object(response: &str) -> Option<Value> {
    if let Ok(v) = serde_json::from_str::<Value>(response) {
        if v.is_object() {
            return Some(v);
        }
    }
    if let Some(block) = extract_code_block(response) {
        if let Ok(v) = serde_json::from_str::<Value>(&block) {
            if v.is_object() {
                return Some(v);
            }
        }
    }
    if let (Some(start), Some(end)) = (response.find('{'), response.rfind('}')) {
        if end > start {
            if let Ok(v) = serde_json::from_str::<Value>(&response[start..=end]) {
                if v.is_object() {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// 生成计划项 ID（避免引入 uuid 依赖）
fn gen_item_id(prefix: &str, idx: usize) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{prefix}-{ts}-{idx}")
}

// ─── PlanNode ─────────────────────────────────────────────────────────

/// 默认计划生成 prompt 模板（引导 LLM 输出 JSON 数组）
const DEFAULT_PLAN_PROMPT_TEMPLATE: &str = "请将以下任务分解为可执行的步骤计划。

任务：{{input}}

要求：
1. 输出一个 JSON 数组，每个元素包含 \"title\"（步骤标题）和 \"description\"（步骤描述，可选）
2. 步骤数量控制在 {{maxItems}} 个以内
3. 步骤顺序应逻辑合理，前序步骤的输出可作为后续步骤的输入
4. 只输出 JSON，不要额外解释

输出格式示例：
```json
[
  { \"title\": \"分析需求\", \"description\": \"理解任务的核心目标\" },
  { \"title\": \"设计方案\", \"description\": \"确定技术实现路径\" }
]
```";

/// PlanNode 配置
#[derive(Debug, Clone)]
pub struct PlanNodeConfig {
    /// 节点唯一 ID（Orchestrator 图中唯一）
    pub id: String,
    /// 人类可读名称
    pub name: String,
    /// 自定义 prompt 模板（占位符 {{input}} / {{maxItems}}），省略用默认
    pub prompt_template: Option<String>,
    /// 最大计划项数（默认 10）
    pub max_items: usize,
    /// 是否把生成的 prompt 写入 state.messages（默认 true，保持消息历史完整）
    pub record_user_message: bool,
    /// 计划生成完成后跳转的下一节点（默认 None = 由 Orchestrator 按边/结束决定）
    pub next_node_id: Option<String>,
}

impl Default for PlanNodeConfig {
    fn default() -> Self {
        Self {
            id: "plan".into(),
            name: "PlanNode".into(),
            prompt_template: None,
            max_items: 10,
            record_user_message: true,
            next_node_id: None,
        }
    }
}

/// PlanNode — 计划生成节点，把用户任务分解为 PlanItem 列表
pub struct PlanNode {
    id: String,
    name: String,
    config: PlanNodeConfig,
}

impl PlanNode {
    /// 创建 PlanNode
    pub fn new(config: PlanNodeConfig) -> Self {
        let name = if config.name.is_empty() {
            format!("PlanNode:{}", config.id)
        } else {
            config.name.clone()
        };
        Self {
            id: config.id.clone(),
            name,
            config,
        }
    }
}

#[async_trait]
impl OrchestratorNode for PlanNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::Plan
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        if ctx.is_aborted() {
            return NodeResult::aborted();
        }

        let max_items = self.config.max_items;
        let last_message = ctx
            .state
            .messages
            .last()
            .map(|m| m.content.as_str())
            .unwrap_or("");
        let prompt = render_template(
            self.config
                .prompt_template
                .as_deref()
                .unwrap_or(DEFAULT_PLAN_PROMPT_TEMPLATE),
            &ctx.state.input,
            last_message,
            &[("maxItems", &max_items.to_string())],
        );
        if prompt.trim().is_empty() {
            return NodeResult::error("渲染后的计划 prompt 为空");
        }

        if self.config.record_user_message {
            ctx.state
                .messages
                .push(make_msg(MessageRole::User, prompt.clone()));
        }

        let response = match ctx.backend.prompt(prompt, None).await {
            Ok(r) => r.text,
            Err(e) => {
                return NodeResult::error(format!("PlanNode LLM 调用失败: {e}"));
            }
        };
        if ctx.is_aborted() {
            return NodeResult::aborted();
        }
        ctx.state
            .messages
            .push(make_msg(MessageRole::Assistant, response.clone()));

        let items = parse_plan(&response, max_items);
        if items.is_empty() {
            return NodeResult::error("无法从 LLM 响应解析出计划（期望 JSON 数组）");
        }

        ctx.state.plan = Some(items.clone());
        ctx.emit(OrchestratorEvent::PlanCreated { items: items.clone() });

        NodeResult {
            status: crate::node::NodeStatus::Continue,
            next_node_id: self.config.next_node_id.clone(),
            error: None,
            summary: Some(format!("生成 {} 个计划项", items.len())),
        }
    }
}

/// 解析 LLM 响应为 PlanItem 列表（过滤空标题、截断到 max_items）
fn parse_plan(response: &str, max_items: usize) -> Vec<PlanItem> {
    let Some(arr) = extract_json_array(response) else {
        return Vec::new();
    };
    arr.into_iter()
        .enumerate()
        .filter_map(|(idx, v)| {
            let title = v
                .get("title")
                .and_then(|t| t.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())?;
            Some(PlanItem {
                id: gen_item_id("plan", idx),
                title: title.to_string(),
                description: v
                    .get("description")
                    .and_then(|d| d.as_str())
                    .map(|s| s.to_string()),
                status: PlanItemStatus::Pending,
                order: idx as i32,
                output: None,
            })
        })
        .take(max_items)
        .collect()
}

// ─── ExecuteNode ──────────────────────────────────────────────────────

/// 步骤失败策略
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecuteFailurePolicy {
    /// 跳过该步骤，继续执行下一个（默认）
    Skip,
    /// 整个计划中止
    Abort,
}

/// 默认执行 prompt 模板
const DEFAULT_EXECUTE_PROMPT_TEMPLATE: &str = "请执行以下任务步骤。

原始任务：{{input}}

当前步骤：
- 标题：{{stepTitle}}
- 描述：{{stepDescription}}

已完成步骤：
{{completedSteps}}

剩余步骤：
{{remainingSteps}}

要求：
1. 专注完成当前步骤，不要跳到后续步骤
2. 如果执行过程中发现需要新增步骤，请在回复末尾用以下格式标记：
   <new_tasks>[{\"title\":\"新步骤标题\",\"description\":\"新步骤描述\"}]</new_tasks>
3. 如果不需要新增步骤，无需添加任何标记";

/// ExecuteNode 配置
#[derive(Debug, Clone)]
pub struct ExecuteNodeConfig {
    /// 节点唯一 ID
    pub id: String,
    /// 人类可读名称
    pub name: String,
    /// 自定义 prompt 模板（占位符 {{input}}/{{stepTitle}}/{{stepDescription}}/{{completedSteps}}/{{remainingSteps}}）
    pub prompt_template: Option<String>,
    /// 是否把生成的 prompt 写入 state.messages（默认 true）
    pub record_user_message: bool,
    /// 步骤失败策略（默认 Skip）
    pub on_failure: ExecuteFailurePolicy,
    /// 全部步骤执行完成后的下一节点（默认 None = 结束）
    pub next_node_id: Option<String>,
}

impl Default for ExecuteNodeConfig {
    fn default() -> Self {
        Self {
            id: "execute".into(),
            name: "ExecuteNode".into(),
            prompt_template: None,
            record_user_message: true,
            on_failure: ExecuteFailurePolicy::Skip,
            next_node_id: None,
        }
    }
}

/// ExecuteNode — 计划执行节点，一次 execute 跑完所有 pending 项
pub struct ExecuteNode {
    id: String,
    name: String,
    config: ExecuteNodeConfig,
}

impl ExecuteNode {
    /// 创建 ExecuteNode
    pub fn new(config: ExecuteNodeConfig) -> Self {
        let name = if config.name.is_empty() {
            format!("ExecuteNode:{}", config.id)
        } else {
            config.name.clone()
        };
        Self {
            id: config.id.clone(),
            name,
            config,
        }
    }
}

#[async_trait]
impl OrchestratorNode for ExecuteNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::Execute
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        // 字段级取出（& 引用可 Copy），避免与 state.plan 可变借用冲突
        let backend = ctx.backend;
        let emitter = ctx.emitter;
        let abort_check = ctx.abort_check;

        if abort_check.is_aborted() {
            return NodeResult::aborted();
        }

        let plan = match &mut ctx.state.plan {
            Some(p) if !p.is_empty() => p,
            _ => return NodeResult::error("state.plan 为空，请先运行 PlanNode"),
        };

        // 收集待执行项（不含已完成的）
        let pending_ids: Vec<String> = plan
            .iter()
            .filter(|p| matches!(p.status, PlanItemStatus::Pending | PlanItemStatus::InProgress))
            .map(|p| p.id.clone())
            .collect();
        if pending_ids.is_empty() {
            return match &self.config.next_node_id {
                Some(next) => NodeResult::continue_to(next.clone()),
                None => NodeResult::done_with_summary("所有计划项已完成"),
            };
        }

        for item_id in pending_ids {
            if abort_check.is_aborted() {
                return NodeResult::aborted();
            }
            let Some(item) = plan.iter_mut().find(|p| p.id == item_id) else {
                continue;
            };
            // 已在上轮循环被跳过/失败则不再处理
            if !matches!(
                item.status,
                PlanItemStatus::Pending | PlanItemStatus::InProgress
            ) {
                continue;
            }

            item.status = PlanItemStatus::InProgress;
            emit_step(emitter, item, None);
            // 提取标题/描述（克隆，释放 item 借用后再渲染，避免借用冲突）
            let title = item.title.clone();
            let description = item.description.clone();

            let last_message = ctx
                .state
                .messages
                .last()
                .map(|m| m.content.as_str())
                .unwrap_or("");
            let prompt = render_execute_prompt(
                &self.config,
                &ctx.state.input,
                &title,
                description.as_deref(),
                plan,
                last_message,
            );
            if self.config.record_user_message {
                ctx.state
                    .messages
                    .push(make_msg(MessageRole::User, prompt.clone()));
            }

            let response = match backend.prompt(prompt, None).await {
                Ok(r) => r.text,
                Err(e) => {
                    // 失败策略：Abort 直接中止，Skip 标记跳过并继续
                    if let Some(item) = plan.iter_mut().find(|p| p.id == item_id) {
                        item.status = PlanItemStatus::Failed;
                        emit_step(emitter, item, Some(format!("执行失败: {e}")));
                    }
                    if self.config.on_failure == ExecuteFailurePolicy::Abort {
                        return NodeResult::error(format!("步骤 \"{title}\" 失败: {e}"));
                    }
                    continue;
                }
            };
            if abort_check.is_aborted() {
                return NodeResult::aborted();
            }
            ctx.state
                .messages
                .push(make_msg(MessageRole::Assistant, response.clone()));

            if let Some(item) = plan.iter_mut().find(|p| p.id == item_id) {
                item.status = PlanItemStatus::Completed;
                item.output = Some(response.clone());
                emit_step(emitter, item, Some(response.clone()));
            }

            // 动态调整：解析 <new_tasks> 标记，追加新步骤
            let new_items = parse_new_tasks(&response);
            if !new_items.is_empty() {
                let base_order = plan.len() as i32;
                for (idx, mut t) in new_items.into_iter().enumerate() {
                    t.id = gen_item_id("plan-new", idx);
                    t.order = base_order + idx as i32;
                    t.status = PlanItemStatus::Pending;
                    plan.push(t);
                }
            }
        }

        // 全部执行完后，若有剩余 pending（理论上不存在）走下一节点
        let has_pending = plan
            .iter()
            .any(|p| matches!(p.status, PlanItemStatus::Pending));
        if has_pending {
            return NodeResult::continue_to(self.id.clone());
        }
        match &self.config.next_node_id {
            Some(next) => NodeResult::continue_to(next.clone()),
            None => NodeResult::done_with_summary("所有计划项执行完成"),
        }
    }
}

/// 广播计划步骤更新事件
fn emit_step(emitter: &dyn EventEmitter, item: &PlanItem, output: Option<String>) {
    emitter.emit(OrchestratorEvent::PlanStepUpdate {
        step_id: item.id.clone(),
        status: item.status,
        output,
    });
}

/// 渲染执行 prompt
fn render_execute_prompt(
    config: &ExecuteNodeConfig,
    input: &str,
    step_title: &str,
    step_description: Option<&str>,
    plan: &[PlanItem],
    last_message: &str,
) -> String {
    let completed = plan
        .iter()
        .filter(|p| matches!(p.status, PlanItemStatus::Completed))
        .map(|p| {
            let out = p
                .output
                .as_deref()
                .map(|o| format!("：{}", truncate(o, 100)))
                .unwrap_or_default();
            format!("- [x] {}{}", p.title, out)
        })
        .collect::<Vec<_>>()
        .join("\n");
    let remaining = plan
        .iter()
        .filter(|p| matches!(p.status, PlanItemStatus::Pending))
        .map(|p| format!("- [ ] {}", p.title))
        .collect::<Vec<_>>()
        .join("\n");

    let template = config.prompt_template.as_deref().unwrap_or(DEFAULT_EXECUTE_PROMPT_TEMPLATE);
    render_template(
        template,
        input,
        last_message,
        &[
            ("stepTitle", step_title),
            ("stepDescription", &step_description.unwrap_or("（无描述）").to_string()),
            ("completedSteps", &(if completed.is_empty() { "（无）".to_string() } else { completed })),
            ("remainingSteps", &(if remaining.is_empty() { "（无）".to_string() } else { remaining })),
        ],
    )
}

/// 解析 <new_tasks>[...]</new_tasks> 标记为新计划项（动态调整）
fn parse_new_tasks(response: &str) -> Vec<PlanItem> {
    let start = match response.find("<new_tasks>") {
        Some(i) => i + "<new_tasks>".len(),
        None => return Vec::new(),
    };
    let Some(end) = response[start..].find("</new_tasks>") else {
        return Vec::new();
    };
    let Some(arr) = extract_json_array(&response[start..start + end]) else {
        return Vec::new();
    };
    arr.into_iter()
        .filter_map(|v| {
            let title = v
                .get("title")
                .and_then(|t| t.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())?;
            Some(PlanItem {
                id: String::new(), // 由调用方补 id/order/status
                title: title.to_string(),
                description: v
                    .get("description")
                    .and_then(|d| d.as_str())
                    .map(|s| s.to_string()),
                status: PlanItemStatus::Pending,
                order: 0,
                output: None,
            })
        })
        .collect()
}

// ─── 通用工具 ─────────────────────────────────────────────────────────

/// 渲染模板：替换 {{key}} 占位符；{{input}}/{{lastMessage}} 由调用方提供
fn render_template(template: &str, input: &str, last_message: &str, pairs: &[(&str, &str)]) -> String {
    let mut out = template
        .replace("{{input}}", input)
        .replace("{{lastMessage}}", last_message);
    for (k, v) in pairs {
        out = out.replace(&format!("{{{{{k}}}}}"), v);
    }
    out
}

/// 构造消息
fn make_msg(role: MessageRole, content: String) -> OrchestratorMessage {
    OrchestratorMessage {
        role,
        content,
        tool_calls: Vec::new(),
        tool_call_id: None,
        meta: None,
    }
}

/// 截断字符串（保留字符数 + 省略号）
fn truncate(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        s.to_string()
    } else {
        let cut: String = chars.into_iter().take(max).collect();
        format!("{cut}…")
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::backend::{BackendError, NodeBackendAccessor, PromptCallOptions, PromptResponse};
    use crate::event::OrchestratorEndStatus;
    use crate::node::{AbortCheck, EventEmitter};
    use crate::orchestrator::{DefaultOrchestrator, Orchestrator};
    use async_trait::async_trait;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex, RwLock};

    /// 测试桩后端 — 每次 prompt 弹出队列中的下一条响应
    pub struct ScriptedBackend(pub Mutex<VecDeque<String>>);

    impl ScriptedBackend {
        pub fn new(responses: Vec<String>) -> Self {
            Self(Mutex::new(responses.into_iter().collect()))
        }
        pub fn push(&self, s: impl Into<String>) {
            self.0.lock().unwrap().push_back(s.into());
        }
    }

    #[async_trait]
    impl NodeBackendAccessor for ScriptedBackend {
        async fn prompt(
            &self,
            _prompt: String,
            _options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            match self.0.lock().unwrap().pop_front() {
                Some(text) => Ok(PromptResponse::text_only(text)),
                // 队列耗尽 = 模拟 LLM 调用失败（走 execute 失败分支）
                None => Err(BackendError::Network("测试队列耗尽（模拟 LLM 调用失败）".into())),
            }
        }
        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }
        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
            Vec::new()
        }
        async fn set_messages(&self, _m: Vec<OrchestratorMessage>) -> Result<(), BackendError> {
            Ok(())
        }
        async fn trim_context(&self, _i: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    /// 测试用事件收集器
    pub struct TestEmitter(pub Mutex<Vec<OrchestratorEvent>>);

    impl EventEmitter for TestEmitter {
        fn emit(&self, event: OrchestratorEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    pub struct TestAbort;

    #[async_trait]
    impl AbortCheck for TestAbort {
        fn is_aborted(&self) -> bool {
            false
        }
        async fn wait_if_paused(&self) {}
    }

    /// 构造 NodeContext（供单测直接调 execute）
    pub fn make_ctx<'a>(
        state: &'a mut crate::types::OrchestratorState,
        backend: &'a dyn NodeBackendAccessor,
        emitter: &'a dyn EventEmitter,
    ) -> NodeContext<'a> {
        NodeContext {
            state,
            backend,
            memory: None,
            emitter,
            abort_check: &TestAbort,
        }
    }

    // ─── PlanNode 测试 ────────────────────────────────────────────────

    #[tokio::test]
    async fn plan_parses_direct_json_array() {
        let backend = ScriptedBackend::new(vec![
            r#"[{"title":"第一步","description":"调研"},{"title":"第二步"}]"#.into(),
        ]);
        let mut state = crate::types::OrchestratorState::new("做一个产品调研");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);

        let node = PlanNode::new(PlanNodeConfig {
            id: "plan".into(),
            ..Default::default()
        });
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Continue);
        let plan = state.plan.unwrap();
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0].title, "第一步");
        assert_eq!(plan[0].description.as_deref(), Some("调研"));
        assert_eq!(plan[1].title, "第二步");
        assert_eq!(plan[0].order, 0);
        // 事件：PlanCreated 已广播
        let events = emitter.0.lock().unwrap();
        assert!(
            events.iter().any(|e| matches!(e, OrchestratorEvent::PlanCreated { .. })),
            "应广播 PlanCreated"
        );
    }

    #[tokio::test]
    async fn plan_parses_json_code_block_fallback() {
        let backend = ScriptedBackend::new(vec![
            "好的，计划如下：\n```json\n[{\"title\":\"A\"},{\"title\":\"B\"}]\n```\n完成".into(),
        ]);
        let mut state = crate::types::OrchestratorState::new("任务");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = PlanNode::new(PlanNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Continue);
        assert_eq!(state.plan.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn plan_parse_failure_returns_error() {
        let backend = ScriptedBackend::new(vec!["抱歉，我无法生成计划".into()]);
        let mut state = crate::types::OrchestratorState::new("任务");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = PlanNode::new(PlanNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Error);
        assert!(result.error.is_some());
    }

    #[tokio::test]
    async fn plan_filters_empty_titles_and_truncates() {
        let backend = ScriptedBackend::new(vec![
            r#"[{"title":"  "},{"title":"A"},{"title":"B"},{"title":"C"}]"#.into(),
        ]);
        let mut state = crate::types::OrchestratorState::new("任务");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = PlanNode::new(PlanNodeConfig {
            max_items: 2,
            ..Default::default()
        });
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Continue);
        let plan = state.plan.unwrap();
        assert_eq!(plan.len(), 2, "空标题过滤 + 截断到 max_items");
        assert_eq!(plan[0].title, "A");
    }

    // ─── ExecuteNode 测试 ─────────────────────────────────────────────

    fn plan_state(input: &str, titles: &[&str]) -> crate::types::OrchestratorState {
        let mut state = crate::types::OrchestratorState::new(input);
        state.plan = Some(
            titles
                .iter()
                .enumerate()
                .map(|(i, t)| PlanItem {
                    id: format!("item-{i}"),
                    title: t.to_string(),
                    description: None,
                    status: PlanItemStatus::Pending,
                    order: i as i32,
                    output: None,
                })
                .collect(),
        );
        state
    }

    #[tokio::test]
    async fn execute_runs_all_items_and_done() {
        let backend = ScriptedBackend::new(vec!["结果A".into(), "结果B".into()]);
        let mut state = plan_state("任务", &["步骤一", "步骤二"]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Done);
        let plan = state.plan.unwrap();
        assert!(plan.iter().all(|p| p.status == PlanItemStatus::Completed));
        assert_eq!(plan[0].output.as_deref(), Some("结果A"));
        // PlanStepUpdate 事件数 = 每项 InProgress + Completed = 2*2
        let events = emitter.0.lock().unwrap();
        let steps = events
            .iter()
            .filter(|e| matches!(e, OrchestratorEvent::PlanStepUpdate { .. }))
            .count();
        assert_eq!(steps, 4);
    }

    #[tokio::test]
    async fn execute_empty_plan_returns_error() {
        let backend = ScriptedBackend::new(Vec::new());
        let mut state = crate::types::OrchestratorState::new("任务");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Error);
    }

    #[tokio::test]
    async fn execute_skip_failure_and_complete_rest() {
        // 1 个响应给 2 个步骤：第一步成功，第二步队列耗尽失败（Skip 策略跳过）
        let backend = ScriptedBackend::new(vec!["结果A".into()]);
        let mut state = plan_state("任务", &["步骤一", "步骤二"]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Done);
        let plan = state.plan.unwrap();
        assert_eq!(plan[0].status, PlanItemStatus::Completed, "第一步成功");
        assert_eq!(plan[1].status, PlanItemStatus::Failed, "第二步失败被跳过");
    }

    #[tokio::test]
    async fn execute_abort_failure_stops_plan() {
        let backend = ScriptedBackend::new(Vec::new());
        let mut state = plan_state("任务", &["步骤一", "步骤二"]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig {
            on_failure: ExecuteFailurePolicy::Abort,
            ..Default::default()
        });
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Error);
    }

    #[tokio::test]
    async fn execute_appends_new_tasks_dynamically() {
        let backend = ScriptedBackend::new(vec![
            "完成第一步 <new_tasks>[{\"title\":\"新增步骤\"}]</new_tasks>".into(),
        ]);
        let mut state = plan_state("任务", &["步骤一"]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig::default());
        let result = node.execute(ctx).await;
        // 动态追加的新步骤本轮未处理 → continue 回自身（下次 execute 继续）
        assert_eq!(result.status, crate::node::NodeStatus::Continue);
        assert_eq!(result.next_node_id.as_deref(), Some("execute"));
        let plan = state.plan.unwrap();
        assert_eq!(plan.len(), 2, "应追加新步骤");
        assert_eq!(plan[1].title, "新增步骤");
        assert_eq!(plan[1].order, 1);
        assert_eq!(plan[1].status, PlanItemStatus::Pending, "新步骤保持 pending");
    }

    // ─── 编排图集成测试（Plan→Execute 走 DefaultOrchestrator）────────────

    #[tokio::test]
    async fn plan_execute_via_orchestrator_graph() {
        // LLM 队列：计划 JSON + 两个步骤的执行结果
        let backend = Arc::new(ScriptedBackend::new(vec![
            r#"[{"title":"第一步"},{"title":"第二步"}]"#.into(),
            "结果A".into(),
            "结果B".into(),
        ]));
        let mut orch = DefaultOrchestrator::new().with_backend(backend);
        orch.add_node(Box::new(PlanNode::new(PlanNodeConfig {
            id: "plan".into(),
            next_node_id: Some("execute".into()),
            ..Default::default()
        })));
        orch.add_node(Box::new(ExecuteNode::new(ExecuteNodeConfig {
            id: "execute".into(),
            ..Default::default()
        })));
        orch.set_entry("plan");

        let result = orch.run("做一个调研".into(), None).await.unwrap();
        assert_eq!(result.status, OrchestratorEndStatus::Completed);
        assert_eq!(result.iterations, 2, "Plan + Execute 各执行一次");
        let plan = result.final_state.plan.unwrap();
        assert_eq!(plan.len(), 2);
        assert!(plan.iter().all(|p| p.status == PlanItemStatus::Completed));
        // final_message 提取最后一条 assistant（Execute 的最后输出）
        assert_eq!(result.final_message.as_deref(), Some("结果B"));
    }

    // ─── JSON 容错解析工具测试 ─────────────────────────────────────────

    #[test]
    fn extract_array_from_raw_and_block() {
        assert_eq!(extract_json_array(r#"[{"a":1}]"#).unwrap().len(), 1);
        assert_eq!(
            extract_json_array("说明\n```json\n[1,2]\n```\n结束").unwrap().len(),
            2
        );
        assert_eq!(extract_json_array("前缀[{\"t\":\"x\"}]后缀").unwrap().len(), 1);
        assert!(extract_json_array("没有数组").is_none());
    }

    #[test]
    fn extract_object_from_block() {
        let v = extract_json_object("```json\n{\"score\": 85}\n```").unwrap();
        assert_eq!(v["score"], 85);
        assert!(extract_json_object("plain text").is_none());
    }

    #[test]
    fn render_template_replaces_placeholders() {
        let out = render_template(
            "输入={{input}} 上条={{lastMessage}} 值={{k}}",
            "输入",
            "上一条",
            &[("k", "v")],
        );
        assert_eq!(out, "输入=输入 上条=上一条 值=v");
    }
}
