//! 子 Agent 编排（sub-agent orchestration）：在主 Agent 工具总线注册委派/列示工具，详细见 docs/details/注释/agent-commands/subagent.md

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use agent_runtime::agent::{AgentLoop, AgentLoopConfig};
use agent_runtime::backend::NodeBackendAccessor;
use agent_runtime::event::{EventBroadcaster, OrchestratorEvent};
use agent_runtime::supervisor::SubAgentSpec;
use agent_runtime::tool::{Tool, ToolBus, ToolError, WhitelistToolBus};
use agent_runtime::types::{MessageRole, OrchestratorMessage};
use async_trait::async_trait;
use tokio::sync::RwLock;

// 当前委派深度（任务本地存储，防递归委派膨胀）
// 子 Agent 复用主 Agent 的 `tool_bus`，因此也能看到 `delegate_to_sub_agent` 工具，
// 理论上可递归委派（孙 Agent）。用 `tokio::task_local!` 在**当前任务**的调用栈上记录
// 委派深度：顶层 `delegate` 未设置时为 0，委派子 Agent 时把子任务放入
// `DELEGATE_DEPTH.scope(depth + 1, ...)` 执行，子 Agent 内再次委派即可看到递增后的深度。
// 用 `try_with` 读取（未设置时按 0 处理），避免 `with` 在非 scope 上下文 panic。
tokio::task_local! {
    static DELEGATE_DEPTH: AtomicUsize;
}

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

/// 子 Agent 实例的对外信息（供前端展示实例状态）
///
/// 用于 `list_instances` 返回：前端据此展示每个子 Agent 实例当前累积的
/// 上下文规模（`message_count`）与是否正在流式执行（`is_streaming`），
/// 便于用户判断哪些实例需要清空（重置上下文）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SubAgentInstanceInfo {
    /// 子 Agent 实例的 id（与规格 id 一致）
    pub sub_agent_id: String,
    /// 子 Agent 名称（来自来源规格）
    pub name: String,
    /// 实例当前累积的消息条数（含 system 消息与工具往返）
    pub message_count: usize,
    /// 实例是否正在流式执行（判断是否可安全清空）
    pub is_streaming: bool,
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
    /// 最大委派深度（防递归委派无限膨胀，默认 3）
    max_delegate_depth: usize,
    /// 事件广播器（可选，委派进度事件透传前端；set_broadcaster 注入），详细见 docs/details/注释/agent-commands/subagent.md
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
            max_delegate_depth: 3,
            broadcaster: std::sync::RwLock::new(None),
        }
    }

    /// 设置子 Agent 单次委派超时（返回 &self 支持链式调用）
    pub fn with_delegate_timeout(mut self, timeout: std::time::Duration) -> Self {
        self.delegate_timeout = timeout;
        self
    }

    /// 设置最大委派深度（返回 &self 支持链式调用）
    ///
    /// 超过该深度后，`delegate` 直接返回错误，防止子 Agent 递归委派无限膨胀。
    pub fn with_max_delegate_depth(mut self, depth: usize) -> Self {
        self.max_delegate_depth = depth;
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

    /// 列出实例池中所有活跃子 Agent 实例的对外信息
    ///
    /// 返回每个实例当前的 `sub_agent_id`、名称、累积消息数与是否流式中。
    /// 前端据此展示实例状态，帮助用户判断哪些实例需要清空（重置上下文）。
    pub async fn list_instances(&self) -> Vec<SubAgentInstanceInfo> {
        // 先收集 (id, name, agent)，释放读锁后再查询消息数/流式状态，
        // 避免持有读锁期间长时间 await 阻塞 delegate 的写锁。
        let snapshots: Vec<(String, String, Arc<AgentLoop>)> = {
            let agents = self.agents.read().await;
            agents
                .iter()
                .map(|(id, cached)| (id.clone(), cached.spec.name.clone(), Arc::clone(&cached.agent)))
                .collect()
        };
        let mut list = Vec::with_capacity(snapshots.len());
        for (id, name, agent) in snapshots {
            list.push(SubAgentInstanceInfo {
                sub_agent_id: id,
                name,
                message_count: agent.get_runtime_messages().await.len(),
                is_streaming: agent.is_streaming(),
            });
        }
        list
    }

    /// 清空单个子 Agent 实例（重置其累积上下文）
    ///
    /// 从实例池移除该实例，下次委派时按当前注册规格懒加载重建（全新上下文）。
    /// 返回是否成功移除（id 不存在时返回 `false`）。
    pub async fn clear_instance(&self, sub_agent_id: &str) -> bool {
        self.agents.write().await.remove(sub_agent_id).is_some()
    }

    /// 清空全部子 Agent 实例（重置所有累积上下文）
    ///
    /// 返回被清空的实例数量。清空后所有子 Agent 下次委派时按最新规格重建。
    pub async fn clear_instances(&self) -> usize {
        let mut agents = self.agents.write().await;
        let count = agents.len();
        agents.clear();
        count
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
    /// - `ToolError::Other`：规格未注册，或委派深度超限（递归委派）
    /// - `ToolError::Timeout`：子 Agent 运行超时
    /// - `ToolError::Execution`：子 Agent 运行失败
    pub async fn delegate(&self, sub_agent_id: &str, task: &str) -> Result<serde_json::Value, ToolError> {
        // 委派深度检查：读取当前任务本地深度，超限则拒绝委派（防递归委派无限膨胀）。
        // 顶层委派未设置 DELEGATE_DEPTH，try_with 失败按 0 处理。
        let current_depth = DELEGATE_DEPTH
            .try_with(|d| d.load(Ordering::Relaxed))
            .unwrap_or(0);
        if current_depth >= self.max_delegate_depth {
            return Err(ToolError::Other(format!(
                "子 Agent 委派深度超限（最大 {}，当前 {}），可能存在递归委派",
                self.max_delegate_depth, current_depth
            )));
        }

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
        // 在 depth+1 的 scope 内运行子 Agent：子 Agent 内再次委派时读到递增后的深度，
        // 实现递归委派深度跟踪。顶层（depth=0）委派 → 子 Agent depth=1 → 孙 depth=2 ...
        let result = DELEGATE_DEPTH
            .scope(AtomicUsize::new(current_depth + 1), async move {
                tokio::time::timeout(self.delegate_timeout, run_fut).await
            })
            .await;
        let result = match result {
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

/// 构建并注册子 Agent 编排工具（delegate + list），详细见 docs/details/注释/agent-commands/subagent.md
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
#[path = "subagent_tests.rs"]
mod tests;
