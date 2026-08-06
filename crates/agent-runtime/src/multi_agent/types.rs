use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

// ─── Agent 角色 ────────────────────────────────────────────

/// Agent 角色枚举（语义化标签，影响默认行为与 UI 展示）
///
/// 角色仅作为元数据标签，不强制约束 Agent 行为（行为由 system_prompt 决定）。
/// 前端可据此渲染不同图标/颜色。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    /// 协调者（负责调度其他 Agent，类似 mini-supervisor）
    Coordinator,
    /// 执行者（具体任务执行）
    Worker,
    /// 评审者（评审其他 Agent 的输出）
    Critic,
    /// 研究者（信息检索与分析）
    Researcher,
    /// 创意者（生成创意方案）
    Creative,
    /// 自定义角色（通过 system_prompt 定义）
    Custom,
}

impl Default for AgentRole {
    fn default() -> Self {
        Self::Worker
    }
}

impl AgentRole {
    /// 转为字符串标识（用于序列化/日志）
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Coordinator => "coordinator",
            Self::Worker => "worker",
            Self::Critic => "critic",
            Self::Researcher => "researcher",
            Self::Creative => "creative",
            Self::Custom => "custom",
        }
    }
}

// ─── Agent 规格 ────────────────────────────────────────────

/// Agent 规格 — 描述一个参与协作的 Agent
///
/// 由用户在创建 MultiAgentNode 时提供，定义 Agent 的角色、能力与配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSpec {
    /// Agent 唯一 ID（用于消息路由 `AgentMessage.from/to` 引用）
    pub id: String,
    /// 人类可读名称
    pub name: String,
    /// 角色（语义标签，影响默认行为与 UI 展示）
    #[serde(default)]
    pub role: AgentRole,
    /// 能力描述（供其他 Agent 了解其专长，写入 Blackboard 的 agents 索引）
    pub description: String,
    /// 系统提示词（定义 Agent 的专长与行为边界）
    pub system_prompt: String,
    /// 工具白名单（None=继承 ToolBus 中所有工具）
    ///
    /// 注意：阶段 1.2 的 ToolBus 不支持按白名单筛选，此字段仅作元数据记录。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tools_whitelist: Option<Vec<String>>,
    /// Agent 最大迭代次数（None=用 `AgentLoopConfig` 默认值）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_iterations: Option<u32>,
    /// 初始消息（None=不主动启动，等待其他 Agent 发消息）
    ///
    /// 配置后会作为该 Agent 的首轮输入，用于启动协作链。
    /// 典型用法：Coordinator 配置 initial_message = 用户任务，其他 Agent 留空。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub initial_message: Option<String>,
}

// ─── Agent 间消息 ────────────────────────────────────────────

/// Agent 间消息（通过 mpsc 通道传递）
///
/// 设计：消息驱动 + 状态共享分离
/// - 消息（本类型）：定向通信，触发 Agent 行动
/// - 状态（SharedBlackboard）：全局共享，Agent 可读写
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMessage {
    /// 任务消息（请求接收方执行某任务）
    Task {
        /// 发送方 Agent ID
        from: String,
        /// 接收方 Agent ID（broadcast 时为 "all"）
        to: String,
        /// 任务内容
        content: String,
    },
    /// 结果消息（任务执行完成后的响应）
    Result {
        /// 发送方 Agent ID
        from: String,
        /// 接收方 Agent ID
        to: String,
        /// 结果内容
        content: String,
    },
    /// 广播消息（一对多）
    Broadcast {
        /// 发送方 Agent ID
        from: String,
        /// 广播内容
        content: String,
    },
    /// 查询消息（请求接收方提供信息）
    Query {
        /// 发送方 Agent ID
        from: String,
        /// 接收方 Agent ID
        to: String,
        /// 查询内容
        query: String,
    },
    /// 同步信号（用于 Agent 间状态同步）
    Synchronize {
        /// 发送方 Agent ID
        from: String,
    },
}

impl AgentMessage {
    /// 获取消息的发送方 ID
    pub fn from(&self) -> &str {
        match self {
            Self::Task { from, .. } => from,
            Self::Result { from, .. } => from,
            Self::Broadcast { from, .. } => from,
            Self::Query { from, .. } => from,
            Self::Synchronize { from } => from,
        }
    }

    /// 获取消息的接收方 ID（broadcast 返回 "all"）
    pub fn to(&self) -> &str {
        match self {
            Self::Task { to, .. } => to,
            Self::Result { to, .. } => to,
            Self::Broadcast { .. } => "all",
            Self::Query { to, .. } => to,
            Self::Synchronize { .. } => "all",
        }
    }

    /// 获取消息内容（Synchronize 返回空字符串）
    pub fn content(&self) -> &str {
        match self {
            Self::Task { content, .. } => content,
            Self::Result { content, .. } => content,
            Self::Broadcast { content, .. } => content,
            Self::Query { query, .. } => query,
            Self::Synchronize { .. } => "",
        }
    }

    /// 消息类型字符串标识（用于事件 payload）
    pub fn message_type(&self) -> &'static str {
        match self {
            Self::Task { .. } => "task",
            Self::Result { .. } => "result",
            Self::Broadcast { .. } => "broadcast",
            Self::Query { .. } => "query",
            Self::Synchronize { .. } => "synchronize",
        }
    }
}

// ─── 拓扑结构 ────────────────────────────────────────────

/// 拓扑结构枚举 — 控制 Agent 间的可通信关系
///
/// 拓扑决定 `build_sender_network` 生成的 sender 映射：
/// - 每个 Agent 持有 `HashMap<peer_id, mpsc::Sender>`
/// - 发消息时按 peer_id 查找 sender，找不到则丢弃
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Topology {
    /// 全连接（mesh）— 每个 Agent 可向其他所有 Agent 发消息
    ///
    /// 适用：小规模协作（N ≤ 5），消息量随 N² 增长
    Mesh,
    /// 环形（ring）— A→B→C→A，每个 Agent 只能向下一个发消息
    ///
    /// 适用：流水线式协作（分析→设计→实现→评审→分析）
    Ring,
    /// 中心辐射（star）— 中心 Agent 可向所有其他 Agent 发消息，其他 Agent 只能向中心发
    ///
    /// 适用：中心协调者场景（类似 Supervisor 但保持对等通信）
    Star {
        /// 中心 Agent ID
        hub_id: String,
    },
    /// 流水线（pipeline）— A→B→C，单向传递，末端可循环回首端（可选）
    ///
    /// 适用：阶段性处理，每个 Agent 处理一个阶段
    Pipeline,
    /// 自定义拓扑 — 显式声明每个 Agent 的 peers
    ///
    /// 适用：复杂协作图（如：Coordinator 可达所有人，Worker 间互不可达）
    Custom {
        /// peers 映射：agent_id → [可通信的 peer_id 列表]
        peers: HashMap<String, Vec<String>>,
    },
}

impl Default for Topology {
    fn default() -> Self {
        Self::Mesh
    }
}

impl Topology {
    /// 构建发送方网络 — 返回每个 Agent 的 peer sender 映射
    ///
    /// # 参数
    /// - `agent_ids`：所有参与 Agent 的 ID 列表
    /// - `senders`：每个 Agent 的 mpsc::Sender（用于 peers 向其发消息）
    ///
    /// # 返回
    /// - `HashMap<agent_id, HashMap<peer_id, Sender>>`：每个 Agent 持有可通信 peers 的 sender
    pub(super) fn build_sender_network(
        &self,
        agent_ids: &[String],
        senders: &HashMap<String, mpsc::Sender<AgentMessage>>,
    ) -> HashMap<String, HashMap<String, mpsc::Sender<AgentMessage>>> {
        let mut network: HashMap<String, HashMap<String, mpsc::Sender<AgentMessage>>> =
            HashMap::new();

        match self {
            Self::Mesh => {
                // 全连接：每个 Agent 可向其他所有 Agent 发消息
                for id in agent_ids {
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    for other in agent_ids {
                        if other != id {
                            if let Some(sender) = senders.get(other) {
                                peers.insert(other.clone(), sender.clone());
                            }
                        }
                    }
                    network.insert(id.clone(), peers);
                }
            }
            Self::Ring => {
                // 环形：每个 Agent 只能向下一个 Agent 发消息
                let n = agent_ids.len();
                for (i, id) in agent_ids.iter().enumerate() {
                    let next_id = &agent_ids[(i + 1) % n];
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    if let Some(sender) = senders.get(next_id) {
                        peers.insert(next_id.clone(), sender.clone());
                    }
                    network.insert(id.clone(), peers);
                }
            }
            Self::Star { hub_id } => {
                // 星型：中心可向所有其他 Agent 发，其他只能向中心发
                for id in agent_ids {
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    if id == hub_id {
                        // 中心：可向所有其他 Agent 发消息
                        for other in agent_ids {
                            if other != id && other != hub_id {
                                if let Some(sender) = senders.get(other) {
                                    peers.insert(other.clone(), sender.clone());
                                }
                            }
                        }
                    } else {
                        // 非中心：只能向中心发消息
                        if let Some(sender) = senders.get(hub_id) {
                            peers.insert(hub_id.clone(), sender.clone());
                        }
                    }
                    network.insert(id.clone(), peers);
                }
            }
            Self::Pipeline => {
                // 流水线：A→B→C，单向传递（末端不循环回首端）
                let n = agent_ids.len();
                for (i, id) in agent_ids.iter().enumerate() {
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    if i + 1 < n {
                        let next_id = &agent_ids[i + 1];
                        if let Some(sender) = senders.get(next_id) {
                            peers.insert(next_id.clone(), sender.clone());
                        }
                    }
                    network.insert(id.clone(), peers);
                }
            }
            Self::Custom { peers: custom_peers } => {
                // 自定义：按用户声明的 peers 映射构建
                for id in agent_ids {
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    if let Some(peer_ids) = custom_peers.get(id) {
                        for peer_id in peer_ids {
                            if let Some(sender) = senders.get(peer_id) {
                                peers.insert(peer_id.clone(), sender.clone());
                            }
                        }
                    }
                    network.insert(id.clone(), peers);
                }
            }
        }

        network
    }
}
