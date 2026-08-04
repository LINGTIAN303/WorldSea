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
use agent_runtime::supervisor::SubAgentSpec;
use agent_runtime::tool::{Tool, ToolBus, ToolError, WhitelistToolBus};
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
    /// # 错误
    /// - `ToolError::Other`：规格未注册
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

        let agent = self.get_or_create_agent(&spec).await;
        let result = agent
            .run(task.to_string())
            .await
            .map_err(|e| ToolError::Execution(format!("子 Agent '{}' 执行失败: {e}", spec.name)))?;

        Ok(serde_json::json!({
            "sub_agent_id": spec.id,
            "name": spec.name,
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
    use agent_runtime::tool::SimpleToolBus;

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
}