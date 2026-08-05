//! # 子 Agent 编排（sub-agent orchestration）
//!
//! 把子 Agent 编排能力接入主对话循环：在主 Agent 的 `AgentLoop` 工具总线上
//! 注册 `delegate_to_sub_agent` / `list_sub_agents` 工具。主 Agent 在 ReAct
//! 循环中遇到子任务时，调用 `delegate_to_sub_agent` 把任务派发给一个专长子
//! Agent（也是一个 `AgentLoop`），等待其返回结果后继续。
//!
//! ## 设计
//! - 子 Agent 复用主 Agent 的 `backend`（同一 LLM 配置）与 `tool_bus`（同一
//!   工具集），不单独创建运行时。
//! - 子 Agent 实例按 `sub_agent_id` 懒加载 + 池化复用（`RwLock<HashMap>`），
//!   首次委派时创建，后续复用，累积专业上下文。
//! - 子 Agent 规格（`SubAgentSpec`）由调用方通过 `register_subagent_spec`
//!   注册，`delegate_to_sub_agent` 按 `sub_agent_id` 查找。
//! - 子 Agent 的流式事件不直接透传前端（Phase 5.4 既定约束），仅最终结果
//!   作为工具结果回填主 Agent。

use std::collections::HashMap;
use std::sync::Arc;

use agent_runtime::agent::{AgentLoop, AgentLoopConfig};
use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventBroadcaster, OrchestratorEvent};
use agent_runtime::supervisor::SubAgentSpec;
use agent_runtime::tool::{Tool, ToolBus, ToolError, WhitelistToolBus};
use agent_runtime::types::{MessageRole, OrchestratorMessage};
use async_trait::async_trait;
use tokio::sync::RwLock;

/// 缓存子 Agent — 记录实例及其来源规格
///
/// 实例池缓存 `Arc<AgentLoop>` 的同时记录创建它所用的 `SubAgentSpec`。委托时若
/// 当前注册的规格与缓存的来源规格不一致（如运行期 `register_subagent_spec`
/// 覆盖了 `tools_whitelist` / `system_prompt` / `max_iterations`），则重建实例，
/// 使规格变更对已缓存实例生效。
struct CachedSubAgent {
    /// 创建该实例时使用的规格快照
    spec: SubAgentSpec,
    /// 实例本身
    agent: Arc<AgentLoop>,
}

/// 子 Agent 编排管理器 — 持有规格注册表 + 实例池
///
/// 由 `AgentCommandService` 构造并共享给主 Agent 的工具总线。
pub struct SubAgentManager {
    /// 共享 LLM 后端（与主 Agent 同一个）
    backend: Arc<dyn NodeBackendAccessor>,
    /// 共享工具总线（与主 Agent 同一个）
    tool_bus: Arc<dyn ToolBus>,
    /// 子 Agent 规格注册表（跨 session 共享，可动态注册）
    specs: Arc<RwLock<Vec<SubAgentSpec>>>,
    /// 子 Agent 实例池（按 sub_agent_id 懒加载缓存，含来源规格）
    agents: Arc<RwLock<HashMap<String, CachedSubAgent>>>,
    /// 子 Agent 默认最大迭代次数（spec 未指定时使用）
    default_max_iterations: u32,
    /// 子 Agent 单次委派超时（防子 Agent 卡死阻塞主循环）
    delegate_timeout: std::time::Duration,
    /// 事件广播器（可选，None 时静默；一般指向主 Agent 的广播器）
    ///
    /// 委派子 Agent 时通过它广播 `SubAgentStarted` / `SubAgentCompleted` /
    /// `SubAgentError`，使订阅主 Agent 事件的监听器（如 Tauri 端）能收到子 Agent
    /// 的委派进度，前端据此展示"子 Agent 正在执行 / 已完成 / 超时"。
    ///
    /// 该字段在 `register_subagent_tools` 调用时尚未存在（主 Agent 的
    /// `AgentLoop` 在其后创建），故由调用方在创建主 Agent 后通过
    /// [`SubAgentManager::set_broadcaster`] 注入。
    ///
    /// 包一层 `std::sync::RwLock` 以支持通过 `&self` 写入（`set_broadcaster`），
    /// `emit` 读取时用 `read()` 快速拿引用。
    broadcaster: std::sync::RwLock<Option<Arc<RwLock<EventBroadcaster>>>>,
}

impl SubAgentManager {
    /// 创建子 Agent 管理器
    pub fn new(
        backend: Arc<dyn NodeBackendAccessor>,
        tool_bus: Arc<dyn ToolBus>,
        specs: Arc<RwLock<Vec<SubAgentSpec>>>,
    ) -> Self {
        Self {
            backend,
            tool_bus,
            specs,
            agents: Arc::new(RwLock::new(HashMap::new())),
            default_max_iterations: 25,
            delegate_timeout: std::time::Duration::from_secs(120),
            broadcaster: std::sync::RwLock::new(None),
        }
    }

    /// 设置子 Agent 单次委派超时（返回 &self 支持链式调用）
    pub fn with_delegate_timeout(mut self, timeout: std::time::Duration) -> Self {
        self.delegate_timeout = timeout;
        self
    }

    /// 注入事件广播器（一般指向主 Agent 的 `AgentLoop::broadcaster_ref()`）
    ///
    /// 在 `register_subagent_tools` 创建管理器后、主 Agent 创建后调用，
    /// 使委派子 Agent 时广播的事件能到达订阅主 Agent 事件的监听器。
    pub fn set_broadcaster(&self, broadcaster: Arc<RwLock<EventBroadcaster>>) {
        *self.broadcaster.write().unwrap() = Some(broadcaster);
    }

    /// 广播子 Agent 编排事件（无广播器时静默丢弃）
    async fn emit(&self, event: OrchestratorEvent) {
        // 先在 std RwLock 读锁内克隆 Arc，避免把非 Send 的读锁守卫跨 await 传递
        let broadcaster = self.broadcaster.read().unwrap().clone();
        if let Some(broadcaster) = broadcaster {
            broadcaster.read().await.broadcast(&event);
        }
    }

    /// 注册一个子 Agent 规格（同名覆盖）
    pub async fn register_spec(&self, spec: SubAgentSpec) {
        let mut specs = self.specs.write().await;
        if let Some(existing) = specs.iter_mut().find(|s| s.id == spec.id) {
            *existing = spec;
        } else {
            specs.push(spec);
        }
    }

    /// 列出所有已注册规格（供 `list_sub_agents` 工具返回）
    pub async fn list_specs(&self) -> Vec<SubAgentSpec> {
        self.specs.read().await.clone()
    }

    /// 获取或创建子 Agent 实例（懒加载 + 池化复用）
    ///
    /// 若实例池中已有同 id 实例，且其来源规格与当前规格一致，则直接复用；
    /// 否则（规格变更，如运行期 `register_spec` 覆盖了 `system_prompt` /
    /// `tools_whitelist` / `max_iterations`）重建实例，使最新规格生效。
    /// **上下文迁移**：规格变更重建时，将旧实例的对话上下文（非 system 消息）迁移到新实例，
    /// 保留子 Agent 已累积的专业对话，只更新 system prompt。
    async fn get_or_create_agent(&self, spec: &SubAgentSpec) -> Arc<AgentLoop> {
        // 读锁快速路径
        {
            let agents = self.agents.read().await;
            if let Some(cached) = agents.get(&spec.id) {
                if &cached.spec == spec {
                    return Arc::clone(&cached.agent);
                }
            }
        }
        // 写锁 + Double-check
        let mut agents = self.agents.write().await;
        if let Some(cached) = agents.get(&spec.id) {
            if &cached.spec == spec {
                return Arc::clone(&cached.agent);
            }
        }

        let mut child_config = AgentLoopConfig {
            system_prompt: Some(spec.system_prompt.clone()),
            ..Default::default()
        };
        if let Some(max_iter) = spec.max_iterations {
            child_config.max_iterations = max_iter;
        } else {
            child_config.max_iterations = self.default_max_iterations;
        }

        // 子 Agent 工具总线：若规格指定了白名单，用 WhitelistToolBus 包装，
        // 限制子 Agent 只能看到/调用白名单内的工具（工具隔离）。
        let child_tool_bus: Arc<dyn ToolBus> = match &spec.tools_whitelist {
            Some(list) if !list.is_empty() => {
                Arc::new(WhitelistToolBus::new(Arc::clone(&self.tool_bus), list.clone()))
            }
            _ => Arc::clone(&self.tool_bus),
        };

        let agent = Arc::new(
            AgentLoop::new(Arc::clone(&self.backend), child_tool_bus).with_config(child_config),
        );

        // 上下文迁移：如果已有旧实例，迁移其非 system 消息到新实例
        // 保留已累积的对话上下文，只替换 system prompt（新规格已自动推入）
        if let Some(old_cached) = agents.get(&spec.id) {
            let old_messages = old_cached.agent.get_runtime_messages().await;
            // 过滤掉旧的 system 消息，只保留 user/assistant/toolResult
            let non_system_messages: Vec<OrchestratorMessage> = old_messages
                .into_iter()
                .filter(|m| m.role != MessageRole::System)
                .collect();

            if !non_system_messages.is_empty() {
                // 新实例已由 with_config 自动推入新 system 消息
                // 在这里追加旧的非 system 消息，完成迁移
                let migrated_count = non_system_messages.len();
                let mut new_messages = agent.get_runtime_messages().await;
                new_messages.extend(non_system_messages);
                if let Err(e) = agent.set_runtime_messages(new_messages).await {
                    tracing::warn!(
                        "子 Agent {} 规格变更上下文迁移失败: {}",
                        spec.id,
                        e
                    );
                    // 迁移失败不阻塞，使用空上下文继续
                } else {
                    tracing::debug!(
                        "子 Agent {} 规格变更上下文迁移完成: 迁移 {} 条非 system 消息",
                        spec.id,
                        migrated_count
                    );
                }
            }
        }

        agents.insert(
            spec.id.clone(),
            CachedSubAgent {
                spec: spec.clone(),
                agent: Arc::clone(&agent),
            },
        );
        agent
    }

    /// 委派任务给指定子 Agent，返回其最终结果
    ///
    /// 应用单次委派超时（`delegate_timeout`），防止子 Agent 卡死无限阻塞主循环。
    ///
    /// # 错误
    /// - `ToolError::Other`：规格未注册
    /// - `ToolError::Timeout`：子 Agent 运行超时
    /// - `ToolError::Execution`：子 Agent 运行失败
    pub async fn delegate(&self, sub_agent_id: &str, task: &str) -> Result<serde_json::Value, ToolError> {
        let spec = self
            .specs
            .read()
            .await
            .iter()
            .find(|s| s.id == sub_agent_id)
            .cloned()
            .ok_or_else(|| ToolError::Other(format!("子 Agent 规格未注册: {sub_agent_id}")))?;

        // node_id：直接委派（非 Supervisor 编排）没有节点维度，用 sub_agent_id 作为标识，
        // 前端通过会话级事件通道路由，node_id 仅用于区分同一会话内多次委派。
        let node_id = spec.id.clone();
        let sub_agent_name = spec.name.clone();
        let task_description = task.to_string();

        // 委派开始：广播 SubAgentStarted，前端据此展示"子 Agent 正在执行..."
        self.emit(OrchestratorEvent::SubAgentStarted {
            node_id: node_id.clone(),
            sub_agent_id: spec.id.clone(),
            sub_agent_name: sub_agent_name.clone(),
            task_description: task_description.clone(),
        })
        .await;

        let started = std::time::Instant::now();
        let agent = self.get_or_create_agent(&spec).await;
        let run_fut = agent.run(task.to_string());
        let result = match tokio::time::timeout(self.delegate_timeout, run_fut).await {
            Ok(Ok(text)) => text,
            Ok(Err(e)) => {
                let err_msg = format!("子 Agent '{}' 执行失败: {e}", spec.name);
                self.emit(OrchestratorEvent::SubAgentError {
                    node_id,
                    sub_agent_id: spec.id.clone(),
                    sub_agent_name: sub_agent_name.clone(),
                    error: err_msg.clone(),
                })
                .await;
                return Err(ToolError::Execution(err_msg));
            }
            Err(_elapsed) => {
                // 超时：`run` future 被 `tokio::time::timeout` 丢弃，循环已停止，但实例
                // 状态需要清理——`run` 尾部复位 `is_streaming` 的语句不会执行（future 被
                // drop），且循环可能留下无 pairing 的 tool_calls 消息。调用
                // `reset_after_timeout` 复位流式标记并裁剪不完整消息，保证下次复用实例
                // 状态正确（注意：不置位 aborted，实例仍可继续复用累积上下文）。
                agent.reset_after_timeout().await;

                let err_msg =
                    format!("子 Agent '{}' 执行超时（>{:?}）", spec.name, self.delegate_timeout);
                self.emit(OrchestratorEvent::SubAgentError {
                    node_id,
                    sub_agent_id: spec.id.clone(),
                    sub_agent_name: sub_agent_name.clone(),
                    error: err_msg,
                })
                .await;
                return Err(ToolError::Timeout);
            }
        };
        let duration_ms = started.elapsed().as_millis() as u64;

        // 委派完成：广播 SubAgentCompleted，前端据此更新"子 Agent 已完成，输出 N 字符"
        self.emit(OrchestratorEvent::SubAgentCompleted {
            node_id,
            sub_agent_id: spec.id.clone(),
            sub_agent_name: spec.name.clone(),
            output_chars: result.chars().count(),
            duration_ms,
        })
        .await;

        Ok(serde_json::json!({
            "sub_agent_id": spec.id.clone(),
            "name": spec.name.clone(),
            "result": result,
        }))
    }
}

// ─── delegate_to_sub_agent 工具 ────────────────────────────────

/// 委派任务给子 Agent 的工具
pub struct DelegateToSubAgentTool {
    manager: Arc<SubAgentManager>,
}

impl DelegateToSubAgentTool {
    pub fn new(manager: Arc<SubAgentManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Tool for DelegateToSubAgentTool {
    fn name(&self) -> &str {
        "delegate_to_sub_agent"
    }
    fn description(&self) -> &str {
        "将子任务委派给一个专长子 Agent 执行。当任务需要某个子 Agent 的专业能力（如代码、写作、分析等）时，先调用 list_sub_agents 查看可用子 Agent，再按 sub_agent_id 委派。子 Agent 会返回其执行结果。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "sub_agent_id": { "type": "string", "description": "目标子 Agent 的 ID（可从 list_sub_agents 获取）" },
                "task": { "type": "string", "description": "要委派给子 Agent 的子任务描述" }
            },
            "required": ["sub_agent_id", "task"]
        })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let sub_agent_id = args
            .get("sub_agent_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 sub_agent_id".into()))?
            .to_string();
        let task = args
            .get("task")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 task".into()))?
            .to_string();
        self.manager.delegate(&sub_agent_id, &task).await
    }
}

// ─── list_sub_agents 工具 ──────────────────────────────────────

/// 列出可用子 Agent 的工具
pub struct ListSubAgentsTool {
    manager: Arc<SubAgentManager>,
}

impl ListSubAgentsTool {
    pub fn new(manager: Arc<SubAgentManager>) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Tool for ListSubAgentsTool {
    fn name(&self) -> &str {
        "list_sub_agents"
    }
    fn description(&self) -> &str {
        "列出当前可用的子 Agent 列表（含 id、名称、能力描述）。在委派任务前调用，确定可用的专业子 Agent。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({ "type": "object", "properties": {} })
    }
    async fn execute(&self, _args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let specs = self.manager.list_specs().await;
        Ok(serde_json::json!({
            "sub_agents": specs.iter().map(|s| serde_json::json!({
                "sub_agent_id": s.id,
                "name": s.name,
                "description": s.description,
            })).collect::<Vec<_>>(),
        }))
    }
}

/// 构建并注册子 Agent 编排工具（delegate + list）
///
/// 调用方：`AgentCommandService::new_agent`，在创建 `SimpleToolBus` 后调用。
///
/// # 参数
/// - `bus`：注册目标工具总线（主 Agent 的 ToolBus）
/// - `backend`：共享 LLM 后端（子 Agent 复用）
/// - `tool_bus`：共享工具总线（子 Agent 复用）
/// - `specs`：共享规格注册表（跨会话共享，由 `AgentCommandService` 持有）
///
/// 返回 `Arc<SubAgentManager>`，其持有与 `specs` 相同的注册表，因此
/// 运行期 `register_subagent_spec` 的变更对所有会话的子 Agent 管理器可见。
pub async fn register_subagent_tools(
    bus: &dyn ToolBus,
    backend: Arc<dyn NodeBackendAccessor>,
    tool_bus: Arc<dyn ToolBus>,
    specs: Arc<RwLock<Vec<SubAgentSpec>>>,
) -> Arc<SubAgentManager> {
    let manager = Arc::new(SubAgentManager::new(backend, tool_bus, specs));
    bus.register(Arc::new(DelegateToSubAgentTool::new(Arc::clone(&manager)))).await;
    bus.register(Arc::new(ListSubAgentsTool::new(Arc::clone(&manager)))).await;
    manager
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_runtime::backend::{BackendError, PromptCallOptions, PromptResponse};
    use agent_runtime::event::EventListener;
    use agent_runtime::tool::SimpleToolBus;

    /// 会阻塞的 mock backend：prompt 前 sleep，用于触发 delegate 超时
    struct SlowBackend {
        delay: std::time::Duration,
    }

    #[async_trait]
    impl NodeBackendAccessor for SlowBackend {
        async fn prompt(
            &self,
            prompt: String,
            _options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            tokio::time::sleep(self.delay).await;
            Ok(PromptResponse::text_only(format!("[slow] {prompt}")))
        }
        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }
        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
            Vec::new()
        }
        async fn set_messages(&self, _messages: Vec<OrchestratorMessage>) -> Result<(), BackendError> {
            Ok(())
        }
        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
        async fn subscribe_events(&self, _listener: Arc<dyn EventListener>) {}
        async fn current_model(&self) -> String {
            "slow-model".into()
        }
        async fn update_provider(
            &self,
            _provider: String,
            _model_id: String,
            _api_key: Option<String>,
            _base_url: Option<String>,
        ) -> Result<(), BackendError> {
            Ok(())
        }
    }

    fn spec(id: &str, name: &str, system_prompt: &str) -> SubAgentSpec {
        SubAgentSpec {
            id: id.into(),
            name: name.into(),
            description: format!("{name} 专长"),
            system_prompt: system_prompt.into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        }
    }

    #[tokio::test]
    async fn register_and_list_specs() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;
        manager.register_spec(spec("writer", "写作助手", "你是写作专家")).await;
        let listed = manager.list_specs().await;
        assert_eq!(listed.len(), 2);
    }

    #[tokio::test]
    async fn delegate_to_unregistered_spec_errors() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;
        let err = manager.delegate("nope", "task").await.unwrap_err();
        assert!(matches!(err, ToolError::Other(_)));
    }

    #[tokio::test]
    async fn delegate_runs_sub_agent_and_returns_result() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        let result = manager.delegate("coder", "帮我写个 hello world").await.unwrap();
        assert_eq!(result["sub_agent_id"], "coder");
        assert_eq!(result["name"], "代码助手");
        assert!(result["result"].as_str().unwrap().contains("收到"));
    }

    /// 规格未变更时应复用池中实例（同一 Arc），规格变更后应重建实例（不同 Arc）
    #[tokio::test]
    async fn get_or_create_agent_reuses_or_rebuilds_by_spec() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;

        let s1 = spec("coder", "代码助手", "你是代码专家");
        manager.register_spec(s1.clone()).await;

        let a1 = manager.get_or_create_agent(&s1).await;
        // 相同规格：复用同一实例
        let a1_again = manager.get_or_create_agent(&s1).await;
        assert!(Arc::ptr_eq(&a1, &a1_again), "相同规格应复用池中实例");

        // 规格变更（system_prompt 不同）：应重建实例
        let s2 = SubAgentSpec {
            system_prompt: "你是资深代码专家（版本2）".into(),
            ..s1.clone()
        };
        manager.register_spec(s2.clone()).await;
        let a2 = manager.get_or_create_agent(&s2).await;
        assert!(!Arc::ptr_eq(&a1, &a2), "规格变更后应重建实例");

        // 变更后再次以 s2 委托，应复用新建的 a2，而非回退到 a1
        let a2_again = manager.get_or_create_agent(&s2).await;
        assert!(Arc::ptr_eq(&a2, &a2_again), "变更后的规格应持续复用新实例");
    }

    /// 规格变更重建实例时，应把旧实例的非 system 上下文迁移到新实例
    #[tokio::test]
    async fn spec_change_migrates_context_to_new_instance() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;

        let s1 = spec("coder", "代码助手", "你是代码专家");
        manager.register_spec(s1.clone()).await;
        let a1 = manager.get_or_create_agent(&s1).await;

        // 给旧实例注入一条 user + assistant 消息（模拟已累积的对话上下文）
        a1.set_runtime_messages(vec![
            OrchestratorMessage {
                role: MessageRole::User,
                content: "帮我写一个排序算法".into(),
                tool_calls: vec![],
                tool_call_id: None,
                meta: None,
            },
            OrchestratorMessage {
                role: MessageRole::Assistant,
                content: "这是之前实现的快速排序".into(),
                tool_calls: vec![],
                tool_call_id: None,
                meta: None,
            },
        ])
        .await
        .expect("注入旧上下文应成功");
        let old_msgs = a1.get_runtime_messages().await;
        assert_eq!(old_msgs.len(), 2, "旧实例应有 2 条非 system 消息");

        // 规格变更（system_prompt 不同）：应重建实例并迁移上下文
        let s2 = SubAgentSpec {
            system_prompt: "你是资深代码专家（版本2）".into(),
            ..s1.clone()
        };
        manager.register_spec(s2.clone()).await;
        let a2 = manager.get_or_create_agent(&s2).await;
        assert!(!Arc::ptr_eq(&a1, &a2), "规格变更后应重建实例");

        // 新实例应保留迁移过来的非 system 上下文
        let migrated = a2.get_runtime_messages().await;
        assert!(
            migrated.iter().any(|m| m.content.contains("排序算法")),
            "新实例应迁移旧实例的 user 消息上下文"
        );
        assert!(
            migrated.iter().any(|m| m.content.contains("快速排序")),
            "新实例应迁移旧实例的 assistant 消息上下文"
        );

        // 迁移后不应残留旧的 system 消息（新 system prompt 应生效）
        let old_system = migrated
            .iter()
            .filter(|m| m.role == MessageRole::System)
            .any(|m| m.content.contains("你是代码专家"));
        assert!(
            !old_system,
            "新实例不应残留旧 system prompt（应使用新规格的 system prompt）"
        );
    }

    /// delegate 应应用超时：子 Agent 阻塞超过 timeout 时返回 ToolError::Timeout，而非无限阻塞
    #[tokio::test]
    async fn delegate_applies_timeout() {
        let bus = Arc::new(SimpleToolBus::new());
        // 子 Agent 每次 prompt 阻塞 500ms，超时设为 50ms：必然触发超时
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(SlowBackend {
            delay: std::time::Duration::from_millis(500),
        });
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone())
            .with_delegate_timeout(std::time::Duration::from_millis(50));
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        let result = manager.delegate("coder", "帮我写个 hello world").await;
        assert!(
            matches!(result, Err(ToolError::Timeout)),
            "阻塞超时的 delegate 应返回 ToolError::Timeout，实际: {result:?}"
        );
    }

    /// 委派超时后，子 Agent 实例状态应被正确清理：is_streaming 复位、aborted 未置位，
    /// 实例可继续复用（而非永久损坏）。
    #[tokio::test]
    async fn timeout_resets_subagent_streaming_state() {
        let bus = Arc::new(SimpleToolBus::new());
        // 子 Agent 每次 prompt 阻塞 500ms，超时设为 50ms：必然触发超时
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(SlowBackend {
            delay: std::time::Duration::from_millis(500),
        });
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone())
            .with_delegate_timeout(std::time::Duration::from_millis(50));

        let s = spec("coder", "代码助手", "你是代码专家");
        manager.register_spec(s.clone()).await;

        let result = manager.delegate("coder", "帮我写个 hello world").await;
        assert!(matches!(result, Err(ToolError::Timeout)));

        // 超时后取回同一实例（池中缓存），应已复位：
        // - is_streaming 必须为 false（否则前端/并发判断误以为仍在流式）
        // - aborted 必须为 false（否则下次 run 立即返回 Aborted，实例永久损坏）
        let agent = manager.get_or_create_agent(&s).await;
        assert!(!agent.is_streaming(), "超时后 is_streaming 应复位为 false");
        let state = agent.get_state().await;
        assert!(!state.aborted, "超时后不应置位 aborted（实例应可继续复用）");
    }

    /// 记录收到的编排事件名（std Mutex，on_event 是同步回调）
    struct RecordingListener {
        events: std::sync::Mutex<Vec<String>>,
    }
    impl EventListener for RecordingListener {
        fn on_event(&self, event: &OrchestratorEvent) {
            let name = match event {
                OrchestratorEvent::SubAgentStarted { .. } => "start",
                OrchestratorEvent::SubAgentCompleted { .. } => "completed",
                OrchestratorEvent::SubAgentError { .. } => "error",
                _ => return,
            };
            self.events.lock().unwrap().push(name.to_string());
        }
    }

    /// 注入广播器后，delegate 成功路径应广播 start → completed 事件
    #[tokio::test]
    async fn delegate_broadcasts_start_then_completed() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone());
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        // 注入广播器 + 订阅记录器
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let rec = Arc::new(RecordingListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        broadcaster.write().await.subscribe(rec.clone());
        manager.set_broadcaster(broadcaster.clone());

        manager.delegate("coder", "帮我写个 hello world").await.unwrap();
        let got = rec.events.lock().unwrap().clone();
        assert_eq!(got, vec!["start".to_string(), "completed".to_string()]);
    }

    /// 注入广播器后，delegate 超时路径应广播 start → error 事件
    #[tokio::test]
    async fn delegate_broadcasts_start_then_error_on_timeout() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(SlowBackend {
            delay: std::time::Duration::from_millis(500),
        });
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone())
            .with_delegate_timeout(std::time::Duration::from_millis(50));
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let rec = Arc::new(RecordingListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        broadcaster.write().await.subscribe(rec.clone());
        manager.set_broadcaster(broadcaster.clone());

        let result = manager.delegate("coder", "帮我写个 hello world").await;
        assert!(matches!(result, Err(ToolError::Timeout)));
        let got = rec.events.lock().unwrap().clone();
        assert_eq!(got, vec!["start".to_string(), "error".to_string()]);
    }
}