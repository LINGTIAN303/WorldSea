//! 图执行器 `DefaultOrchestrator`（设计 §4.1–§4.6）
//!
//! 职责边界（设计 4.1）：**拓扑推进、端口路由、并发调度、动态子图挂接、
//! 预算与钩子、快照与恢复**。它不理解任何具体模式的语义——模式语义全部
//! 落在节点实现与图模板里。
//!
//! M1 并发语义说明：Spawn 按「作用域栈」顺序挂接（子图与父图共享同一黑板
//! 与台账，子图完成后经 return_port_map 回到父图继续点）；车道并发与
//! wait-set 汇合（设计 4.4）留待 M3 随 Multi-Agent/GoT 一起上，届时只扩展
//! 本文件的就绪集合调度，不动节点契约。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use crate::orchestrator::blackboard::Blackboard;
use crate::orchestrator::context::{latest_mem_note, BudgetView, CancelToken, NodeCtx, SubgraphRequest};
use crate::orchestrator::error::NodeError;
use crate::orchestrator::graph::Graph;
use crate::orchestrator::handles::{LlmHandle, MemEntry, MemLayer, MemoryHandle};
use crate::orchestrator::observer::RunObserver;
use crate::orchestrator::types::{NodeSnapshot, NodeId, Port, Usage};

/// 全链路执行配置（设计 4.1 `RunConfig`）
#[derive(Debug, Clone)]
pub struct RunConfig {
    /// 全局用量上限（任一维度超限 → 治理终止，设计 4.2 第 5 步）
    pub budget_cap: Option<Usage>,
    /// 快照间隔：每 N 步强制快照（设计 4.6；Spawn 前另行强制快照）
    pub snapshot_interval: u32,
    /// Retryable 错误的单节点重试上限（设计 4.5：按退避重试，上限内不换路由）
    pub max_retries_per_step: u32,
    /// 并发度上限（设计 4.4：车道并发全局封顶，超出分批排队）
    pub max_concurrency: usize,
}

impl Default for RunConfig {
    fn default() -> Self {
        Self { budget_cap: None, snapshot_interval: 10, max_retries_per_step: 2, max_concurrency: 8 }
    }
}

/// 终局原因（设计 §2.3 终止契约的三分类：自然 / 失败 / 治理）
#[derive(Debug, Clone, PartialEq)]
pub enum TerminalReason {
    /// 自然终局：走到 Done 端口且无后继边
    Done,
    /// 失败终局：Fatal 错误上抛
    Fatal(NodeError),
    /// 治理终止：预算耗尽 / 用户取消 / 悬空出口
    Governed(String),
}

/// 单步记录（设计 §4.3：步序号 + 每步端口 + 用量）
#[derive(Debug, Clone)]
pub struct StepRecord {
    /// 单调递增步序号（恢复后连续不回卷）
    pub step: u64,
    pub node: NodeId,
    pub port: Port,
    pub usage: Usage,
    /// 本步是否为 Spawn 挂接
    pub spawned: bool,
    pub retries: u32,
}

/// 终局输出的全链路报告（设计 §4.3）：调试界面 + 成本审计材料。
#[derive(Debug, Clone)]
pub struct RunReport {
    pub reason: TerminalReason,
    /// 步序列表（步序号 + 端口 + 用量）
    pub steps: Vec<StepRecord>,
    /// 全链路用量台账
    pub usage: Usage,
    /// 终局时黑板结果键（约定键 `result.draft`）的当前值
    pub result: Option<serde_json::Value>,
    /// 终局黑板全量快照（S1 适配层：命令层据此做产物→契约翻译，不侵入 NodeResult）
    pub blackboard: serde_json::Value,
    /// 墙钟耗时
    pub elapsed: std::time::Duration,
}

impl RunReport {
    /// 结果文本便捷读取（`result.draft` 为字符串时）
    pub fn result_text(&self) -> Option<String> {
        self.result.as_ref().and_then(|v| v.as_str().map(|s| s.to_string()))
    }

    pub fn is_done(&self) -> bool {
        matches!(self.reason, TerminalReason::Done)
    }
}

/// 全链路快照（设计 §4.6：黑板全量 + 各有状态节点 snapshot + 步序号 + 台账 + 就绪集合）
#[derive(Debug, Clone)]
pub struct Checkpoint {
    /// 已完成步数（恢复后步序号连续不回卷，设计 4.3）
    pub step_cursor: u64,
    pub blackboard: serde_json::Value,
    pub node_snapshots: HashMap<NodeId, NodeSnapshot>,
    pub used: Usage,
    /// 快照时刻的就绪队列（恢复点 = 断点继续而非重跑）
    pub ready: Vec<NodeId>,
}

/// 车道 future 输出：(黑板分身, 终局(端口, 用量, 步) | Fatal)
type LaneOutput = (Blackboard, Result<(Port, Usage, Vec<StepRecord>), NodeError>);
/// 车道 future（借用执行器与取消令牌；`Send` 约束保证整条 run() Future 可跨线程——tauri 命令要求 Send）
type LaneFuture<'a> = std::pin::Pin<Box<dyn std::future::Future<Output = LaneOutput> + Send + 'a>>;

/// Spawn 挂接的作用域：一张子图 + 它在父图的回接点（设计 §4.4）
struct Scope {
    graph: Graph,
    /// 父图挂接节点（子图终止时按 return_map 从该节点的映射端口继续）
    attach_node: NodeId,
    /// 子图终止端口 → 父图继续端口
    return_map: Vec<(Port, Port)>,
    /// 作用域前缀：快照表 / join 计数的 key 命名空间（消除跨作用域同名覆盖；
    /// 形如 `父挂接节点#序`，与父图前缀叠加保证任意深度唯一）
    prefix: String,
}

impl Scope {
    /// 快照/join key：作用域内节点 → `<prefix><node_id>`
    fn qualified(&self, node_id: &str) -> String {
        format!("{}{}", self.prefix, node_id)
    }
}

/// 全链路执行句柄：持有图与全局资源（设计 §4.1 `DefaultOrchestrator`）。
pub struct DefaultOrchestrator<'g> {
    graph: &'g Graph,
    llm: Arc<dyn LlmHandle>,
    memory: Arc<dyn MemoryHandle>,
    run_config: RunConfig,
    /// 取消信号：治理层或用户置位后，调度循环在下一步边界终止（设计 §3.2）
    cancel: CancelToken,
    /// 运行观察者（S1 适配层；可选，None 时零开销）
    observer: Option<Arc<dyn RunObserver>>,
    /// 初始黑板种子（S1 适配层：`run()` 入口的输入注入，如 `task.intent`）
    seed: Option<serde_json::Value>,
}

impl<'g> DefaultOrchestrator<'g> {
    pub fn new(
        graph: &'g Graph,
        llm: Arc<dyn LlmHandle>,
        memory: Arc<dyn MemoryHandle>,
        run_config: RunConfig,
    ) -> Self {
        Self { graph, llm, memory, run_config, cancel: CancelToken::new(), observer: None, seed: None }
    }

    /// 注入取消令牌（与节点共享同一份；默认内部新建=不可取消）
    pub fn with_cancel(mut self, cancel: CancelToken) -> Self {
        self.cancel = cancel;
        self
    }

    /// 注入运行观察者（S1 适配层：阶段事件 + 终局回调，供命令层桥到迹线通道）
    pub fn with_observer(mut self, observer: Arc<dyn RunObserver>) -> Self {
        self.observer = Some(observer);
        self
    }

    /// 注入初始黑板种子（S1 适配层：`run()` 前预写入，如 `{"task.intent": "…"}`）
    pub fn with_seed(mut self, seed: serde_json::Value) -> Self {
        self.seed = Some(seed);
        self
    }

    /// 跑完整张图：从 entry 推进到 Done/Fatal 或治理终止（设计 §4.2）。
    pub async fn run(&self) -> Result<RunReport, NodeError> {
        let entry = self.graph.entry().to_string();
        let mut bb = Blackboard::new();
        if let Some(seed) = &self.seed {
            bb.restore(seed.clone());
        }
        let rs = RunState {
            used: Usage::default(),
            steps: Vec::new(),
            step_cursor: 0,
            ready: vec![entry],
            join_arrivals: HashMap::new(),
        };
        let rep = self
            .drive(bb, rs, self.cancel.clone())
            .await
            .map(|(r, _)| r)?;
        Ok(self.notify_finished(rep))
    }

    /// 跑完整张图并透出最近一次快照（供外部持久化 / 后续 resume，设计 4.6）。
    pub async fn run_with_checkpoint(
        &self,
    ) -> Result<(RunReport, Option<Checkpoint>), NodeError> {
        let entry = self.graph.entry().to_string();
        let mut bb = Blackboard::new();
        if let Some(seed) = &self.seed {
            bb.restore(seed.clone());
        }
        let rs = RunState {
            used: Usage::default(),
            steps: Vec::new(),
            step_cursor: 0,
            ready: vec![entry],
            join_arrivals: HashMap::new(),
        };
        let (rep, ckpt) = self.drive(bb, rs, self.cancel.clone()).await?;
        Ok((self.notify_finished(rep), ckpt))
    }

    /// 从快照恢复整链（设计 §4.6：restore 节点 → 定位断点 → 继续调度）。
    pub async fn resume(&self, ckpt: Checkpoint) -> Result<RunReport, NodeError> {
        let mut bb = Blackboard::new();
        bb.restore(ckpt.blackboard);
        // 前缀化 key（`作用域::节点id`）取末段定位节点；父图裸 id 直查
        for (id, snap) in &ckpt.node_snapshots {
            let bare = id.rsplit("::").next().unwrap_or(id);
            if let Some(node) = self.graph.node(bare) {
                node.restore(snap.clone()).await?;
            }
        }
        let rs = RunState {
            used: ckpt.used,
            steps: Vec::new(),
            step_cursor: ckpt.step_cursor,
            ready: ckpt.ready,
            join_arrivals: HashMap::new(),
        };
        let rep = self.drive(bb, rs, self.cancel.clone()).await.map(|(r, _)| r)?;
        Ok(self.notify_finished(rep))
    }

    /// 终局统一触发观察者（S1 适配层：on_finished 在三个入口各自收尾时调用一次）
    fn notify_finished(&self, report: RunReport) -> RunReport {
        if let Some(o) = &self.observer {
            o.on_finished(&report);
        }
        report
    }

    // ── 调度循环核心（设计 4.2 九步伪代码的落地）────────

    async fn drive(
        &self,
        mut bb: Blackboard,
        mut rs: RunState,
        cancel: CancelToken,
    ) -> Result<(RunReport, Option<Checkpoint>), NodeError> {
        let started = Instant::now();
        let mut scopes: Vec<Scope> = Vec::new();
        let mut node_snapshots: HashMap<NodeId, NodeSnapshot> = HashMap::new();
        let mut checkpoint: Option<Checkpoint> = None;

        // while ready ≠ ∅ and not cancelled
        while let Some(node_id) = rs.ready.pop() {
            if cancel.is_cancelled() {
                return Ok((
                    Self::report(TerminalReason::Governed("用户取消".into()), &rs, &bb, started),
                    checkpoint,
                ));
            }

            // 查表：从最内层作用域向外（子图节点优先于父图同名 id）
            let node = match scopes.iter().rev().find_map(|s| s.graph.node(&node_id)) {
                Some(n) => n,
                None => match self.graph.node(&node_id) {
                    Some(n) => n,
                    None => {
                        return Err(NodeError::fatal(
                            "graph",
                            format!("就绪队列引用未注册节点 {node_id}"),
                        ));
                    }
                },
            };

            // 2. 记忆前置钩子（执行器统一挂）
            let recalled = self.memory.before(&node_id).await.unwrap_or_default();

            // 3. 受控执行（Retryable 按上限重试，不换路由——设计 4.5）
            let mut retries: u32 = 0;
            let (node_result, spawn_req) = loop {
                let budget = BudgetView { used: rs.used, cap: self.run_config.budget_cap };
                let mut ctx =
                    NodeCtx::new(&mut bb, self.llm.as_ref(), self.memory.as_ref(), budget, cancel.clone());
                // S1 适配层：注入运行观察者（节点内阶段事件经此透出，None 时零开销）
                if let Some(o) = &self.observer {
                    ctx = ctx.with_observer(Arc::clone(o));
                }
                ctx.recalled = recalled.clone();
                match node.execute(&mut ctx).await {
                    Ok(r) => break (r, ctx.pending.take()),
                    Err(e) if e.is_retryable() && retries < self.run_config.max_retries_per_step => {
                        retries += 1;
                        tracing::warn!(node = %node_id, attempt = retries, "Retryable 错误，上限内重试");
                    }
                    // Fatal 立即终局上抛（设计 4.5）
                    Err(e) => return Err(e),
                }
            };

            // 4. 记忆后置钩子（设计 4.2 第 4 步：每节点边界必调）：
            //    沉淀 mem.notes 最新条目；节点未写时以空条目调用（沉淀与否由记忆层裁量）
            let note = latest_mem_note(&bb).unwrap_or_default();
            let entry = MemEntry { layer: MemLayer::Episodic, key: node_id.clone(), content: note };
            let _ = self.memory.after(&node_id, entry).await;

            // 5. 预算门：累计用量并检查（设计 4.2 第 5 步）
            rs.used.saturating_add(&node_result.usage);
            rs.step_cursor += 1;
            rs.steps.push(StepRecord {
                step: rs.step_cursor,
                node: node_id.clone(),
                port: node_result.port.clone(),
                usage: node_result.usage,
                spawned: spawn_req.is_some(),
                retries,
            });
            if let Some(cap) = &self.run_config.budget_cap {
                if rs.used.exceeds(cap) {
                    return Ok((
                        Self::report(
                            TerminalReason::Governed("预算耗尽".into()),
                            &rs, &bb, started,
                        ),
                        checkpoint,
                    ));
                }
            }

            // 快照协议（设计 4.6：每 N 步；Spawn 前强制快照）。
            // 聚合范围：当前节点 + 全部活跃作用域内的子图节点（设计 4.6
            // 「子图内部快照聚合」——CompositeNode 的内层状态经此入检查点）。
            // 已知限制：跨作用域同名节点 id 会在快照表中相互覆盖（M3 后续以
            // 「作用域前缀」消除，见执行计划文档）。
            if spawn_req.is_some()
                || rs.step_cursor % u64::from(self.run_config.snapshot_interval) == 0
            {
                // 作用域内节点以 qualified key 入表（`前缀::节点id`，消除同名覆盖）；
                // 父图节点保持裸 id。resume 还原时取 key 末段定位节点（见 resume）。
                let mut qualified: Vec<(String, String)> = Vec::new(); // (qualified_key, node_id)
                for s in &scopes {
                    for nid in s.graph.node_ids() {
                        qualified.push((s.qualified(nid), nid.to_string()));
                    }
                }
                qualified.push((node_id.clone(), node_id.clone()));
                for (qkey, nid) in qualified {
                    let n = scopes
                        .iter()
                        .rev()
                        .find_map(|s| s.graph.node(&nid))
                        .or_else(|| self.graph.node(&nid));
                    if let Some(n) = n {
                        if let Ok(snap) = n.snapshot().await {
                            node_snapshots.insert(qkey, snap);
                        }
                    }
                }
                checkpoint = Some(Checkpoint {
                    step_cursor: rs.step_cursor,
                    blackboard: bb.snapshot(),
                    node_snapshots: node_snapshots.clone(),
                    used: rs.used,
                    ready: rs.ready.clone(),
                });
            }

            // 6. 动态子图挂接（设计 4.2 第 6 步 / 4.4）
            if let Some(sub) = spawn_req {
                match sub {
                    SubgraphRequest::Single { graph, return_port_map } => {
                        let prefix = format!("{}#{}::", node_id, scopes.len());
                        scopes.push(Scope {
                            graph,
                            attach_node: node_id.clone(),
                            return_map: return_port_map,
                            prefix,
                        });
                        rs.ready.push(scopes.last().unwrap().graph.entry().to_string());
                        continue;
                    }
                    SubgraphRequest::Lanes { lanes, return_port_map } => {
                        // 车道并发（设计 4.4）：车道内顺序、车道间并发；
                        // 黑板「分身 → 汇合合并」（车道写入键按命名空间隔离，6.3）
                        let mut merged_steps: Vec<StepRecord> = Vec::new();
                        let mut lane_terminal: Option<Port> = None;
                        for chunk in lanes.chunks(self.run_config.max_concurrency.max(1)) {
                            let mut futs: Vec<LaneFuture<'_>> = Vec::new();
                            for lane in chunk {
                                let lbb = bb.clone();
                                let ready0 = lane.graph.entry().to_string();
                                let g = &lane.graph;
                                let cancel2 = cancel.clone();
                                let lane_id = lane.id.clone();
                                let llm_ref = self.llm.as_ref();
                                let mem_ref = self.memory.as_ref();
                                futs.push(Box::pin(async move {
                                    Self::run_lane(g, llm_ref, mem_ref, lbb, ready0, &cancel2, &lane_id).await
                                }));
                            }
                            let done = Self::join_futures(futs).await;
                            for (lbb, outcome) in done {
                                match outcome {
                                    Ok((port, usage, steps)) => {
                                        lane_terminal = Some(port);
                                        rs.used.saturating_add(&usage);
                                        merged_steps.extend(steps);
                                        bb.merge_from(lbb);
                                    }
                                    Err(_lbb) => {
                                        return Ok((
                                            Self::report(
                                                TerminalReason::Fatal(NodeError::fatal(
                                                    "lane",
                                                    "车道 Fatal：整链按失败终局（设计 6.2）",
                                                )),
                                                &rs, &bb, started,
                                            ),
                                            checkpoint,
                                        ));
                                    }
                                }
                            }
                        }
                        let lane_step_count = merged_steps.len() as u64;
                        rs.step_cursor += lane_step_count;
                        for (i, mut st) in merged_steps.into_iter().enumerate() {
                            st.step = rs.step_cursor - lane_step_count + i as u64 + 1;
                            rs.steps.push(st);
                        }
                        // 全部车道终局 → 按 return_port_map 回父图（汇合语义由子图内 join 声明）
                        // 车道 Fatal 端口 → 整链失败终局（设计 6.2 车道 Fatal 语义）
                        let term = lane_terminal.unwrap_or(Port::Done);
                        if let Port::Fatal(label) = &term {
                            return Ok((
                                Self::report(
                                    TerminalReason::Fatal(NodeError::fatal(
                                        label.clone(),
                                        "车道以 Fatal 端口终局",
                                    )),
                                    &rs, &bb, started,
                                ),
                                checkpoint,
                            ));
                        }
                        let mapped = return_port_map
                            .iter()
                            .find(|(from, _)| from == &term)
                            .map(|(_, to)| to.clone());
                        match mapped {
                            Some(to_port) => {
                                if let Some(n) = self.graph.route(&node_id, &to_port, &bb) {
                                    rs.ready.push(n.to_string());
                                    continue;
                                }
                                return Ok((
                                    Self::report(
                                        TerminalReason::Governed(format!(
                                            "车道返回端口 {to_port} 在父图节点 {node_id} 上无出边"
                                        )),
                                        &rs, &bb, started,
                                    ),
                                    checkpoint,
                                ));
                            }
                            None => {
                                return Ok((
                                    Self::report(
                                        TerminalReason::Governed(format!(
                                            "车道终局端口 {term} 无 return_map 映射"
                                        )),
                                        &rs, &bb, started,
                                    ),
                                    checkpoint,
                                ));
                            }
                        }
                    }
                }
            }

            // 7-8. 端口路由查表与终局三分（设计 4.2 第 7/8 步；fan-out 多目标入队，4.4）
            let port = node_result.port.clone();
            let targets = self.route_all_from(&node_id, &port, &bb, &scopes);
            if !targets.is_empty() {
                for target in targets {
                    // wait-set 计数（设计 4.4）：目标是汇合节点且未达期望 → 计数不入队，
                    // 第 expect 次到达（全部车道/分支就绪）才调度聚合节点
                    if let Some((expect, join_key)) = self.join_expect_for(&target, &scopes) {
                        let arrived = rs.join_arrivals.entry(join_key.clone()).or_insert(0);
                        *arrived += 1;
                        if *arrived < expect {
                            continue;
                        }
                        rs.join_arrivals.remove(&join_key);
                    }
                    rs.ready.push(target);
                }
                continue;
            }

            // 无出边：先尝试子图回接（Spawn 挂接点语义），再判终局
            if let Some(scope_idx) =
                scopes.iter().rposition(|s| s.graph.contains(&node_id))
            {
                let mapped = scopes[scope_idx]
                    .return_map
                    .iter()
                    .find(|(from, _)| from == &port)
                    .map(|(_, to)| to.clone());
                if let Some(to_port) = mapped {
                    let attach = scopes[scope_idx].attach_node.clone();
                    scopes.remove(scope_idx);
                    // 回接：挂接点可能在更外层的子图作用域内（嵌套组合）——
                    // 从剩余作用域由内向外查，最后落父图（设计 3.4 组合任意深度）
                    let mut next = None;
                    for s in scopes.iter().rev() {
                        if s.graph.contains(&attach) {
                            next = s.graph.route(&attach, &to_port, &bb).map(|s| s.to_string());
                            break;
                        }
                    }
                    let next =
                        next.or_else(|| self.graph.route(&attach, &to_port, &bb).map(|s| s.to_string()));
                    if let Some(n) = next {
                        rs.ready.push(n);
                        continue;
                    }
                    return Err(NodeError::fatal(
                        "graph",
                        format!("子图返回端口 {to_port} 在挂接节点 {attach} 上无出边"),
                    ));
                }
                if let Port::Fatal(label) = &port {
                    return Err(NodeError::fatal(label.clone(), format!("子图节点 {node_id} Fatal")));
                }
                return Ok((
                    Self::report(
                        TerminalReason::Governed(format!(
                            "子图节点 {node_id} 以端口 {port} 终止且无 return_map 映射"
                        )),
                        &rs, &bb, started,
                    ),
                    checkpoint,
                ));
            }

            match &port {
                Port::Done => {
                    return Ok((
                        Self::report(TerminalReason::Done, &rs, &bb, started),
                        checkpoint,
                    ));
                }
                Port::Fatal(label) => {
                    return Ok((
                        Self::report(
                            TerminalReason::Fatal(NodeError::fatal(
                                label.clone(),
                                format!("节点 {node_id} Fatal 且无后继边"),
                            )),
                            &rs, &bb, started,
                        ),
                        checkpoint,
                    ));
                }
                _ => {
                    return Ok((
                        Self::report(
                            TerminalReason::Governed(format!(
                                "节点 {node_id} 端口 {port} 无出边（悬空出口）"
                            )),
                            &rs, &bb, started,
                        ),
                        checkpoint,
                    ));
                }
            }
        }

        // 就绪集合清空：自然完成（无显式 Done 收口图的收敛路径）
        Ok((Self::report(TerminalReason::Done, &rs, &bb, started), checkpoint))
    }

    // ── 查表辅助 ────────────────────────────────────────

    /// 端口路由（全部目标）：内层作用域优先（设计 4.2 第 7 步；fan-out 多目标，4.4）
    fn route_all_from(
        &self,
        node_id: &str,
        port: &Port,
        bb: &Blackboard,
        scopes: &[Scope],
    ) -> Vec<String> {
        for s in scopes.iter().rev() {
            if s.graph.contains(node_id) {
                return s.graph.route_all(node_id, port, bb).into_iter().map(|s| s.to_string()).collect();
            }
        }
        self.graph.route_all(node_id, port, bb).into_iter().map(|s| s.to_string()).collect()
    }

    /// 节点的汇合期望：从内层作用域向外查（与路由同序）。
    /// 返回 (期望次数, 限定的计数 key)——key 带作用域前缀，消除跨作用域同名计数覆盖。
    fn join_expect_for(&self, id: &str, scopes: &[Scope]) -> Option<(usize, String)> {
        for s in scopes.iter().rev() {
            if s.graph.contains(id) {
                return s.graph.join_expect(id).map(|e| (e, s.qualified(id)));
            }
        }
        self.graph.join_expect(id).map(|e| (e, id.to_string()))
    }

    /// 单车道执行（设计 §4.4 车道模型）：对给定图 + 黑板分身跑至终局。
    /// 车道内顺序执行；车道间由调用方并发调度。记忆钩子在车道节点边界照常挂。
    /// 返回 (黑板, 终局)；Err = 车道 Fatal（整链按失败终局，设计 6.2）。
    async fn run_lane(
        graph: &Graph,
        llm: &dyn LlmHandle,
        memory: &dyn MemoryHandle,
        mut lbb: Blackboard,
        entry: String,
        cancel: &CancelToken,
        lane_id: &str,
    ) -> (Blackboard, Result<(Port, Usage, Vec<StepRecord>), NodeError>) {
        let mut used = Usage::default();
        let mut steps: Vec<StepRecord> = Vec::new();
        let mut step_cursor = 0u64;
        let mut ready = vec![entry];
        let mut join_arrivals: HashMap<String, usize> = HashMap::new();

        while let Some(node_id) = ready.pop() {
            if cancel.is_cancelled() {
                return (lbb, Err(NodeError::fatal("lane", format!("车道 {lane_id} 被取消"))));
            }
            let node = match graph.node(&node_id) {
                Some(n) => n,
                None => {
                    return (
                        lbb,
                        Err(NodeError::fatal("graph", format!("车道 {lane_id} 引用未注册节点 {node_id}"))),
                    )
                }
            };
            let recalled = memory.before(&node_id).await.unwrap_or_default();
            let mut retries = 0u32;
            let node_result = loop {
                let budget = BudgetView { used, cap: None };
                let mut ctx = NodeCtx::new(&mut lbb, llm, memory, budget, cancel.clone());
                ctx.recalled = recalled.clone();
                match node.execute(&mut ctx).await {
                    Ok(r) => break r,
                    Err(e) if e.is_retryable() && retries < 2 => {
                        retries += 1;
                        tracing::warn!(lane = %lane_id, node = %node_id, attempt = retries, "车道内 Retryable 重试");
                    }
                    Err(e) => return (lbb, Err(e)),
                }
            };
            if let Some(note) = latest_mem_note(&lbb) {
                let entry_m = MemEntry { layer: MemLayer::Episodic, key: node_id.clone(), content: note };
                let _ = memory.after(&node_id, entry_m).await;
            }
            used.saturating_add(&node_result.usage);
            step_cursor += 1;
            steps.push(StepRecord {
                step: step_cursor,
                node: node_id.clone(),
                port: node_result.port.clone(),
                usage: node_result.usage,
                spawned: false,
                retries,
            });

            let port = node_result.port.clone();
            let targets = graph.route_all(&node_id, &port, &lbb);
            if targets.is_empty() {
                // 车道终局：出口端口即车道终局端口（无出边 = 车道跑完）
                return (lbb, Ok((port, used, steps)));
            }
            for t in targets {
                let target = t.to_string();
                // 车道内 wait-set（设计 4.4）：汇合节点计数到达
                if let Some(expect) = graph.join_expect(&target) {
                    let arrived = join_arrivals.entry(target.clone()).or_insert(0);
                    *arrived += 1;
                    if *arrived < expect {
                        continue;
                    }
                    join_arrivals.remove(&target);
                }
                ready.push(target);
            }
        }
        // 就绪清空：车道自然完成（Done 语义）
        (lbb, Ok((Port::Done, used, steps)))
    }

    /// 车道并发 join（设计 4.4 并发调度）：零依赖手写 join——轮询各 future
    /// （Pending 让出等 waker），全部就绪后按序收集。
    async fn join_futures(mut futs: Vec<LaneFuture<'_>>) -> Vec<LaneOutput> {
        let mut results: Vec<Option<LaneOutput>> = (0..futs.len()).map(|_| None).collect();
        std::future::poll_fn(|cx| {
            let mut pending = false;
            for i in 0..futs.len() {
                if results[i].is_none() {
                    match futs[i].as_mut().poll(cx) {
                        std::task::Poll::Ready(v) => results[i] = Some(v),
                        std::task::Poll::Pending => pending = true,
                    }
                }
            }
            if pending {
                std::task::Poll::Pending
            } else {
                std::task::Poll::Ready(())
            }
        })
        .await;
        results.into_iter().map(|r| r.expect("全部 future 就绪")).collect()
    }

    /// 终局报告装配
    fn report(
        reason: TerminalReason,
        rs: &RunState,
        bb: &Blackboard,
        started: Instant,
    ) -> RunReport {
        RunReport {
            reason,
            steps: rs.steps.clone(),
            usage: rs.used,
            result: bb.read("result.draft").cloned(),
            blackboard: bb.snapshot(),
            elapsed: started.elapsed(),
        }
    }
}

/// 调度循环的可变状态（跨子图共享台账与步号，设计 4.3）
struct RunState {
    used: Usage,
    steps: Vec<StepRecord>,
    step_cursor: u64,
    ready: Vec<NodeId>,
    /// wait-set 到达计数（设计 4.4）：join 节点 id → 已到达次数
    join_arrivals: HashMap<String, usize>,
}
