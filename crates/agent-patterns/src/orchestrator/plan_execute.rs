//! Plan-and-Execute 计划与执行（设计 §5.3）— 计划—执行—重规划三元循环
//!
//! 核心状态：`pne.plan`（步骤数组，当前值语义）与 `pne.cursor`（游标，表 3-1）。
//! 每步执行经 `inner`（Box<dyn OrchestratorNode>，常为 ReAct/SingleAgent 黑盒，
//! 设计 5.3：executor 按游标执行当前步，可内嵌 ReAct）。
//!
//! 终止条件三分（设计 5.3）：
//! ① 游标越过末步且全部验收过 → `Done`；
//! ② 重规划次数上限 → `Fatal("replan")`（伪代码语义）；
//! ③ 步骤连续失败且重规划无改善 → 归入②的上限治理。
//!
//! LLM 面说明：make_plan / assess_step / replan 走 `complete` + JSON 约定
//! （LlmHandle 保持 §8.5 方法集不膨胀，M2 决策）；计划 JSON：
//! `{"steps":["s1","s2",…]}`；验收 JSON：`{"passed":bool,"reason":"…"}`。

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::observer::PhaseStatus;
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, Usage};

/// 计划（步骤数组；每步含意图与验收，M2 以字符串步骤承载——
/// 设计 5.3「每步含意图与验收」的验收由 assess 阶段给出）
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Plan {
    pub steps: Vec<String>,
}

pub struct PlanExecuteNode {
    id: String,
    meta: NodeMeta,
    /// 每步的执行器（常为 ReAct/SingleAgent 黑盒，设计 5.3 `executor`）
    inner: std::sync::Arc<dyn OrchestratorNode>,
    /// 重规划次数上限（终止②闸门）
    max_replans: u32,
    /// 2026-09-02 步骤钩子：每步执行前后回调（step_index, step_text, in_progress_bool）。
    /// 命令层注入，用于把 B 轨步骤进度广播为 PlanStepUpdate（前端 plan 步骤行驱动）。
    on_step: Option<Arc<dyn Fn(usize, &str, bool) + Send + Sync>>,
    /// 2026-09-02 计划生成钩子：make_plan 成功后回调（steps 全量）。
    /// 命令层注入，用于广播 PlanCreated（前端据此生成 plan 步骤行）。
    on_plan: Option<Arc<dyn Fn(Vec<String>) + Send + Sync>>,
    /// 生成计划的 system 提示
    plan_prompt: String,
    /// 验收判定的 system 提示（assess_step）
    assess_prompt: String,
    /// 已执行游标
    cursor: Mutex<usize>,
    /// 已发生的重规划次数
    replans: Mutex<u32>,
}

impl PlanExecuteNode {
    pub fn new(
        id: impl Into<String>,
        inner: std::sync::Arc<dyn OrchestratorNode>,
        plan_prompt: impl Into<String>,
        assess_prompt: impl Into<String>,
        max_replans: u32,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("plan_execute", "计划与执行"),
            inner,
            max_replans,
            on_step: None,
            on_plan: None,
            plan_prompt: plan_prompt.into(),
            assess_prompt: assess_prompt.into(),
            cursor: Mutex::new(0),
            replans: Mutex::new(0),
        }
    }

    /// 2026-09-02 注入步骤钩子（命令层：每步进度 → PlanStepUpdate 广播）
    pub fn with_on_step(
        mut self,
        cb: Arc<dyn Fn(usize, &str, bool) + Send + Sync>,
    ) -> Self {
        self.on_step = Some(cb);
        self
    }

    /// 2026-09-02 注入计划生成钩子（命令层：计划全量 → PlanCreated 广播）
    pub fn with_on_plan(mut self, cb: Arc<dyn Fn(Vec<String>) + Send + Sync>) -> Self {
        self.on_plan = Some(cb);
        self
    }

    async fn make_plan(&self, ctx: &NodeCtx<'_>, intent: &str) -> Result<(Plan, Usage), NodeError> {
        let req = Request::new(
            self.plan_prompt.clone(),
            format!("任务意图：{intent}\n\n请输出 JSON：{{\"steps\":[\"步骤1\",\"步骤2\",…]}}，步骤携带可验收的明确动作。"),
        );
        let resp = ctx.llm.complete(&req).await?;
        let usage = resp.usage;
        let plan = serde_json::from_str::<Plan>(resp.text.trim())
            .map_err(|e| NodeError::fatal("schema", format!("计划输出非约定 JSON：{e}")))?;
        // 2026-09-02 计划生成钩子：广播 PlanCreated（前端据此生成 plan 步骤行）
        if let Some(cb) = &self.on_plan {
            cb(plan.steps.clone());
        }
        Ok((plan, usage))
    }

    /// 验收当前步（assess_step：Passed / NeedsReplan(reason)）；
    /// 返回验收结论与本次 LLM 用量（纪律 5：用量如实上报）
    async fn assess_step(
        &self,
        ctx: &NodeCtx<'_>,
        step: &str,
    ) -> Result<(Result<(), String>, Usage), NodeError> {
        let result_text = ctx
            .state
            .read("result.draft")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let req = Request::new(
            self.assess_prompt.clone(),
            format!("步骤：{step}\n\n步骤产出：\n{result_text}\n\n请输出 JSON：{{\"passed\":true}} 或 {{\"passed\":false,\"reason\":\"…\"}}。"),
        );
        #[derive(serde::Deserialize)]
        struct Verdict {
            passed: bool,
            #[serde(default)]
            reason: String,
        }
        // 2026-09-02 B 类迁移试点：优先经决策工具强制调用（tool-use-as-JSON），
        // 失败（句柄未实现/未返回 tool_call）时回退旧 complete + from_str 解析。
        let mut usage = Usage::default();
        let verdict: Verdict = match ctx.llm.decide(&req, crate::orchestrator::decision::step_assess_decision_tool()).await {
            Ok(v) => serde_json::from_value(v)
                .map_err(|e| NodeError::fatal("schema", format!("验收决策参数非约定结构：{e}")))?,
            Err(_e) => {
                let resp = ctx.llm.complete(&req).await?;
                usage = resp.usage;
                serde_json::from_str(resp.text.trim())
                    .map_err(|e| NodeError::fatal("schema", format!("验收输出非约定 JSON：{e}")))?
            }
        };
        let outcome = if verdict.passed {
            Ok(())
        } else if verdict.reason.is_empty() {
            Err("未通过".to_string())
        } else {
            Err(verdict.reason)
        };
        Ok((outcome, usage))
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for PlanExecuteNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done, Port::Fatal("replan".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let mut usage = Usage::default();

        // S1 适配层：plan 阶段进入（命令层桥到 TracePhaseEntered）
        ctx.observe_phase(&self.id, "plan", None, "生成执行计划");
        // plan：生成步骤化计划（写 pne.plan 当前值，表 3-1）
        let (mut plan, plan_usage) = self.make_plan(ctx, &intent).await?;
        usage.saturating_add(&plan_usage);
        ctx.state.write("pne.plan", &plan);
        if plan.steps.is_empty() {
            ctx.observe_phase(&self.id, "plan", Some(PhaseStatus::Failed), "计划为空");
            return Err(NodeError::fatal("plan", "计划为空"));
        }
        // S1 适配层：plan 阶段结果（产物 Plan 物由命令层从黑板翻译）
        ctx.observe_phase(
            &self.id,
            "plan",
            Some(PhaseStatus::Success),
            format!("生成 {} 个步骤", plan.steps.len()),
        );

        // S1 适配层：execute 阶段进入
        ctx.observe_phase(&self.id, "execute", None, "按计划执行");
        loop {
            let cursor = { *self.cursor.lock().unwrap() };
            // 终止①：游标越过末步 → Done
            if cursor >= plan.steps.len() {
                ctx.observe_phase(
                    &self.id,
                    "execute",
                    Some(PhaseStatus::Success),
                    format!("执行完成 {} 步", plan.steps.len()),
                );
                return Ok(NodeResult { port: Port::Done, usage, progress: None });
            }
            let step = plan.steps[cursor].clone();
            ctx.state.write("pne.cursor", cursor as u64);
            ctx.state.write("pne.step.current", step.clone());
            // 2026-09-02 步骤钩子·开工：广播该步 in_progress（前端 plan 步骤行置「执行中」）
            if let Some(cb) = &self.on_step {
                cb(cursor, &step, true);
            }

            // execute：按游标执行当前步（内嵌 ReAct/SingleAgent 黑盒，设计 5.3）
            let r = self.inner.execute(ctx).await?;
            usage.saturating_add(&r.usage);

            // gate.replan 判定：验收当前步
            match self.assess_step(ctx, &step).await {
                Ok((Ok(()), assess_usage)) => {
                    usage.saturating_add(&assess_usage);
                    // 2026-09-02 步骤钩子·收工：广播该步 completed（前端置「已完成」）
                    if let Some(cb) = &self.on_step {
                        cb(cursor, &step, false);
                    }
                    { *self.cursor.lock().unwrap() += 1; }
                }
                Ok((Err(reason), assess_usage)) => {
                    usage.saturating_add(&assess_usage);
                    let replans = { *self.replans.lock().unwrap() };
                    // 终止②：重规划次数上限 → Fatal("replan")（伪代码语义）
                    if replans >= self.max_replans {
                        ctx.observe_phase(
                            &self.id,
                            "execute",
                            Some(PhaseStatus::Failed),
                            format!("重规划 {replans} 次仍失败：{reason}"),
                        );
                        return Ok(NodeResult {
                            port: Port::Fatal("replan".into()),
                            usage,
                            progress: Some(progress_note_note(replans, &reason)),
                        });
                    }
                    { *self.replans.lock().unwrap() = replans + 1; }
                    // replan：携带已完成步与失败原因重新规划（写回 pne.plan）
                    let req = Request::new(
                        self.plan_prompt.clone(),
                        format!(
                            "任务意图：{intent}\n原计划：{:?}\n已完成到第 {cursor} 步；第 {cursor} 步「{step}」失败原因：{reason}\n\n请重新输出剩余计划 JSON：{{\"steps\":[…]}}（从当前进度继续）。",
                            plan.steps
                        ),
                    );
                    let resp = ctx.llm.complete(&req).await?;
                    usage.saturating_add(&resp.usage);
                    plan = serde_json::from_str::<Plan>(resp.text.trim())
                        .map_err(|e| NodeError::fatal("schema", format!("重规划输出非约定 JSON：{e}")))?;
                    ctx.state.write("pne.plan", &plan);
                    { *self.cursor.lock().unwrap() = 0; } // 新计划从头部继续（含已完成上下文）
                    // 快照点：重规划是高成本动作（设计 4.6 精神），计数已随执行器快照
                }
                Err(e) => return Err(e),
            }
        }
    }

    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot {
            payload: json!({
                "cursor": *self.cursor.lock().unwrap(),
                "replans": *self.replans.lock().unwrap(),
            }),
        })
    }

    async fn restore(&self, snap: NodeSnapshot) -> Result<(), NodeError> {
        if let Some(v) = snap.payload.get("cursor").and_then(|v| v.as_u64()) {
            *self.cursor.lock().unwrap() = v as usize;
        }
        if let Some(v) = snap.payload.get("replans").and_then(|v| v.as_u64()) {
            *self.replans.lock().unwrap() = v as u32;
        }
        Ok(())
    }
}

// ── 内部辅助 ────────────────────────────────────────────

fn progress_note_note(replans: u32, reason: &str) -> crate::orchestrator::types::ProgressNote {
    crate::orchestrator::types::ProgressNote::Note(format!(
        "重规划 {replans} 次仍失败：{reason}"
    ))
}
