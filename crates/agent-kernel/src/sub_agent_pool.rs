//! 子 Agent 实例池 — 底座共享运行时（matrix §7 待决 7 收敛，2026-08-25）
//!
//! 原 `SupervisorNode`（patterns/supervisor）与 `SubAgentManager`（agent-commands/subagent.rs）
//! 各自维护「SubAgentSpec + 懒加载 AgentLoop 池」：两处 get_or_create 实现重复，且
//! Supervisor 侧缺少 Manager 已有的安全能力。本模块把**创建/复用/规格变更重建/
//! 上下文迁移/工具白名单隔离**下沉为共享底层：
//! - `SubAgentSpec`：子 Agent 规格（从 patterns/supervisor 上移，re-export 保兼容）
//! - `SubAgentPool`：懒加载实例池（spec 指纹 + WhitelistToolBus 隔离 + 上下文迁移）
//!
//! 边界：本模块只承载「池」运行时，**不**承载触发语义（Supervisor 图节点显式调度
//! vs delegate 工具隐式委派）与命令层状态（specs 注册表 / list_instances 查询 /
//! 委派深度/超时）——后两者分别留在 SupervisorNode 与 SubAgentManager。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{debug, info};

use crate::agent::{AgentLoop, AgentLoopConfig};
use crate::backend::NodeBackendAccessor;
use crate::tool::{ToolBus, WhitelistToolBus};
use crate::types::{MessageRole, OrchestratorMessage};

/// 子 Agent 规格 — 定义子 Agent 的能力与配置
///
/// 由两类使用方提供：SupervisorNode（图节点 specs，LLM 分配给子 Agent）与
/// SubAgentManager（命令层注册表，主 Agent 经 delegate 工具隐式委派）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubAgentSpec {
    /// 子 Agent 唯一 ID（供派发方引用）
    pub id: String,
    /// 人类可读名称
    pub name: String,
    /// 能力描述（供 LLM 选择时参考，应清晰描述专长）
    pub description: String,
    /// 系统提示词（定义子 Agent 的专长与行为边界）
    pub system_prompt: String,
    /// 工具白名单（None=继承 ToolBus 中所有工具）
    ///
    /// 实际隔离经 `WhitelistToolBus` 生效：白名单非空时子 Agent 只见/能调名单内工具。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tools_whitelist: Option<Vec<String>>,
    /// 子 Agent 最大迭代次数（None=用基础配置的默认值）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_iterations: Option<u32>,
    /// 强隔离可选字段：该子 Agent 的 workdir 迁移到独立临时区（cwd 天然落在区内）。
    ///
    /// 适用于不依赖项目代码的纯子任务（如总结/分析/独立产出）；要求绝对路径；
    /// 缺省 = 目录引导模式（workdir 保持项目根，仅注入「产物写入 agent-tmp/sub-{id}」指引）。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub temp_dir: Option<PathBuf>,
}

/// 缓存子 Agent — 记录实例及其来源规格
///
/// 规格变更（重建检测用）对比用完整 `SubAgentSpec` 指纹（PartialEq）。
struct CachedSubAgent {
    /// 创建该实例时使用的规格快照
    spec: SubAgentSpec,
    /// 实例本身
    agent: Arc<AgentLoop>,
}

/// 子 Agent 实例的对外信息（供命令层 list_instances 展示）
///
/// 前端据此展示每个子 Agent 实例累积的上下文规模（`message_count`）与
/// 是否正在流式执行（`is_streaming`），便于判断哪些实例可安全清空。
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// 子 Agent 委派 run 记账器（M3-RK1 补缺：Supervisor 图节点委派路径子 run 挂接）
///
/// SupervisorNode（patterns 层）不能依赖 commands 层 RunStore；本 trait 把
/// 「建子 run / 收口子 run」抽象为可选注入点，命令层实现并注入闭包。
/// 前端据此可把 Supervisor 委派的每个子 Agent 展示为 run 树子节点。
#[async_trait::async_trait]
pub trait SubRunAccountant: Send + Sync {
    /// 子 Agent 委派开始：建子 run（挂到父 run 下），返回 sub_run_id
    async fn begin(
        &self,
        parent_run_id: Option<String>,
        sub_agent_id: &str,
        sub_agent_name: &str,
    ) -> Option<String>;
    /// 子 Agent 委派收口：更新子 run 状态与结果摘要
    ///
    /// `status`：completed / error / timeout（与 commands 层 RunStatus 对齐的字符串）
    async fn finish(&self, sub_run_id: &str, status: &str, summary: Option<String>);
}

/// 子 Agent 懒加载实例池 — SupervisorNode / SubAgentManager 共用
///
/// 能力（对齐原 SubAgentManager 实现）：
/// - 按 spec 指纹复用；规格变更时重建（新规格生效）
/// - 重建时迁移旧实例的非 system 对话上下文（保留已累积专业对话，只换 system prompt）
/// - 规格指定 `tools_whitelist` 时以 `WhitelistToolBus` 隔离工具视图
pub struct SubAgentPool {
    /// 共享 LLM 后端（与派发方同一个）
    backend: Arc<dyn NodeBackendAccessor>,
    /// 共享工具总线（与派发方同一个）
    tool_bus: Arc<dyn ToolBus>,
    /// spec 未指定 max_iterations 时的默认步数预算（语义=子 Agent 的工具调用轮数上限）
    default_total_steps: u32,
    /// 实例池（按 sub_agent_id 懒加载缓存，含来源规格）
    agents: Arc<RwLock<HashMap<String, CachedSubAgent>>>,
}

impl SubAgentPool {
    /// 创建子 Agent 实例池
    pub fn new(
        backend: Arc<dyn NodeBackendAccessor>,
        tool_bus: Arc<dyn ToolBus>,
        default_total_steps: u32,
    ) -> Self {
        Self {
            backend,
            tool_bus,
            default_total_steps,
            agents: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// 获取或创建子 Agent 实例（懒加载 + 池化复用 + 规格变更重建/上下文迁移）
    ///
    /// `base_config` 作为子 Agent 的基础配置（system_prompt 与 max_iterations 被
    /// 规格覆盖）：SupervisorNode 传共享 `agent_loop_config`（保留其其它默认继承），
    /// SubAgentManager 传 `AgentLoopConfig::default()`。
    ///
    /// 若实例池中已有同 id 实例且来源规格与当前一致则直接复用；否则重建，
    /// 并把旧实例的非 system 消息迁移到新实例（仅替换 system prompt）。
    pub async fn get_or_create(
        &self,
        spec: &SubAgentSpec,
        base_config: AgentLoopConfig,
    ) -> Arc<AgentLoop> {
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

        let mut child_config = base_config;
        child_config.system_prompt = Some(spec.system_prompt.clone());
        // 子 Agent 步数预算（语义=工具调用轮数上限）：spec.max_iterations 保留字段名，
        // 取值映射到 AgentLoopConfig.total_steps
        child_config.total_steps =
            spec.max_iterations.unwrap_or(self.default_total_steps).max(1);

        // 工作区分区（方向2 M1/M2，2026-09-03）：
        // 1) 强隔离：spec.temp_dir 存在 → workdir 迁移到独立临时区（cwd 天然落在区内，
        //    fs/shell 边界自动以新 workdir 为准；写回项目根会触发越界确认）
        if let Some(td) = &spec.temp_dir {
            let _ = std::fs::create_dir_all(td);
            child_config.workdir = Some(td.clone());
        }
        // 2) 目录引导：workdir 存在 → 预建子 Agent 个人临时目录 + system_prompt 注入分区指引。
        //    规格变更重建时 system_prompt 每次重算，幂等。
        if let Some(wd) = &child_config.workdir {
            let tmp = crate::workspace_partition::sub_agent_tmp_dir(wd, &spec.id);
            let _ = std::fs::create_dir_all(&tmp); // 最佳努力预建，失败静默（模型写时会补建）
            let base = child_config.system_prompt.unwrap_or_default();
            child_config.system_prompt = Some(format!(
                "{base}\n\n[工作区分区]\n\
                 任务产物（草稿/中间文件）请写入 {}（该目录专属本 Agent，可自由创建与清理）。\n\
                 entities/ 与 .worldsmith/ 为项目数据区，受写保护，请使用实体语义工具操作。",
                tmp.display()
            ));
        }

        // 子 Agent 工具总线：规格指定白名单时用 WhitelistToolBus 包装（工具隔离）
        let child_tool_bus: Arc<dyn ToolBus> = match &spec.tools_whitelist {
            Some(list) if !list.is_empty() => {
                Arc::new(WhitelistToolBus::new(Arc::clone(&self.tool_bus), list.clone()))
            }
            _ => Arc::clone(&self.tool_bus),
        };

        let agent = Arc::new(
            AgentLoop::new(Arc::clone(&self.backend), child_tool_bus).with_config(child_config),
        );

        // 上下文迁移：规格变更重建时，把旧实例的非 system 消息迁到新实例
        // （新规格 system prompt 已由 with_config 推入，additional 旧上下文）
        if let Some(old_cached) = agents.get(&spec.id) {
            let old_messages = old_cached.agent.get_runtime_messages().await;
            let non_system_messages: Vec<OrchestratorMessage> = old_messages
                .into_iter()
                .filter(|m| m.role != MessageRole::System)
                .collect();
            if !non_system_messages.is_empty() {
                let mut new_messages = agent.get_runtime_messages().await;
                new_messages.extend(non_system_messages);
                if let Err(e) = agent.set_runtime_messages(new_messages).await {
                    debug!("子 Agent {} 规格变更上下文迁移失败: {}", spec.id, e);
                } else {
                    info!("子 Agent {} 规格变更上下文迁移完成", spec.id);
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

    /// 清空实例池（SupervisorNode 重置 / 命令层清空场景）
    ///
    /// 注意：不销毁已返回给调用方的 `Arc<AgentLoop>`，只清空内部缓存。
    /// 返回被清空的实例数。
    pub async fn clear(&self) -> usize {
        let mut agents = self.agents.write().await;
        let count = agents.len();
        agents.clear();
        count
    }

    /// 移除单个实例（重置其累积上下文：下次委派按最新规格懒加载重建）
    ///
    /// 返回是否成功移除（id 不存在时返回 `false`）。
    pub async fn remove(&self, sub_agent_id: &str) -> bool {
        self.agents.write().await.remove(sub_agent_id).is_some()
    }

    /// 池内实例数
    pub async fn len(&self) -> usize {
        self.agents.read().await.len()
    }

    /// 池内实例信息列表（命令层 list_instances 查询用）
    pub async fn instances(&self) -> Vec<SubAgentInstanceInfo> {
        let agents = self.agents.read().await;
        // 先取出 Arc 快照（释放读锁），再逐项 await 查询（避免持锁跨 await）
        let entries: Vec<(String, String, Arc<AgentLoop>)> = agents
            .iter()
            .map(|(id, cached)| (id.clone(), cached.spec.name.clone(), Arc::clone(&cached.agent)))
            .collect();
        drop(agents);

        let mut list = Vec::with_capacity(entries.len());
        for (id, name, agent) in entries {
            let snapshot = agent.get_state_snapshot().await;
            let message_count = agent.get_messages().await.len();
            list.push(SubAgentInstanceInfo {
                sub_agent_id: id,
                name,
                message_count,
                is_streaming: snapshot.is_streaming,
            });
        }
        list.sort_by(|a, b| a.sub_agent_id.cmp(&b.sub_agent_id));
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use tokio::sync::Mutex as TokioMutex;

    use crate::agent::AgentLoopConfig;
    use crate::backend::{BackendError, NodeBackendAccessor, PromptCallOptions, PromptResponse};
    use crate::tool::SimpleToolBus;
    use crate::types::OrchestratorMessage;

    /// 捕获 system_prompt_override 的最小 mock backend（对齐 agent/tests.rs MockBackend 模式）
    #[derive(Default)]
    struct CaptureBackend {
        last_prompt: TokioMutex<Option<String>>,
    }

    #[async_trait]
    impl NodeBackendAccessor for CaptureBackend {
        async fn prompt(
            &self,
            _prompt: String,
            options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            *self.last_prompt.lock().await = options.and_then(|o| o.system_prompt_override);
            Ok(PromptResponse::text_only("完成"))
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

    fn spec_with_temp(id: &str, temp_dir: Option<PathBuf>) -> SubAgentSpec {
        SubAgentSpec {
            id: id.into(),
            name: format!("{id}-助手"),
            description: format!("{id} 专长"),
            system_prompt: format!("你是{id}专家"),
            tools_whitelist: None,
            max_iterations: Some(3),
            temp_dir,
        }
    }

    fn project_dir() -> PathBuf {
        std::env::temp_dir().join(format!("ws-part-test-{}", std::process::id()))
    }

    #[tokio::test]
    async fn guidance_prebuilds_sub_tmp_dir_and_injects_prompt() {
        let proj = project_dir();
        std::fs::create_dir_all(&proj).unwrap();
        let backend = Arc::new(CaptureBackend::default());
        let bus = Arc::new(SimpleToolBus::new());
        let pool = SubAgentPool::new(backend.clone(), bus, 200);

        let base = AgentLoopConfig {
            workdir: Some(proj.clone()),
            ..Default::default()
        };
        let agent = pool.get_or_create(&spec_with_temp("coder", None), base).await;

        // ① 预建子 Agent 个人临时目录
        let sub_tmp = crate::workspace_partition::sub_agent_tmp_dir(&proj, "coder");
        assert!(sub_tmp.exists(), "应预建子 Agent 临时目录: {sub_tmp:?}");

        // ② workdir 保持项目根（目录引导不动 workdir）
        assert_eq!(agent.workdir(), Some(proj.clone()));

        // ③ system_prompt 注入分区指引（含真实 sub-tmp 路径）
        let _ = agent.run("hi".into()).await;
        let sp = backend.last_prompt.lock().await.clone();
        let sp = sp.expect("应收到 system_prompt_override");
        assert!(sp.contains(sub_tmp.to_string_lossy().as_ref()), "应注入 sub-tmp 路径: {sp}");
        assert!(sp.contains("工作区分区"), "应注入分区指引");

        let _ = std::fs::remove_dir_all(&proj);
    }

    #[tokio::test]
    async fn strong_isolation_overrides_workdir() {
        let proj = project_dir();
        std::fs::create_dir_all(&proj).unwrap();
        let backend = Arc::new(CaptureBackend::default());
        let bus = Arc::new(SimpleToolBus::new());
        let pool = SubAgentPool::new(backend.clone(), bus, 200);

        let isolated = proj.join("agent-tmp").join("sub-analysis");
        let base = AgentLoopConfig {
            workdir: Some(proj.clone()),
            ..Default::default()
        };
        let agent = pool
            .get_or_create(&spec_with_temp("analysis", Some(isolated.clone())), base)
            .await;

        // ① workdir 迁移到隔离目录（cwd 天然落在区内）
        assert_eq!(agent.workdir(), Some(isolated.clone()));
        // ② 隔离目录已创建
        assert!(isolated.exists(), "应创建强隔离目录: {isolated:?}");
        // ③ 引导注入的是隔离目录路径（而非项目根 sub-{id}）
        let _ = agent.run("hi".into()).await;
        let sp = backend.last_prompt.lock().await.clone().unwrap_or_default();
        assert!(sp.contains(isolated.to_string_lossy().as_ref()), "应注入隔离目录路径: {sp}");

        let _ = std::fs::remove_dir_all(&proj);
    }
}