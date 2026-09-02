//! 运行观察者（S1 适配层：B 轨引擎接投放契约）
//!
//! B 轨骨架（`orchestrator/`）本身不持有投放概念（run/交接物/迹线事件），
//! 本模块是它向外部（命令层/事件桥）暴露的**轻量回调通道**：
//! - 节点内部的阶段进入/结果（`on_phase`）——命令层据此转投 kernel `TracePhase*` 事件
//! - 全链终局（`on_finished`）——命令层据此收口 run 记录
//!
//! 设计纪律（对齐 executor 头注释「执行器不认模式」）：
//! - 观察者只透传「节点名 + 阶段名 + 结果状态 + 摘要」，不携带黑板/预算/取消
//! - 观察者可选注入：`None` 时全链路零开销（B 轨既有测试不受影响）

use crate::orchestrator::executor::RunReport;

/// 阶段结果状态（命令层映射 kernel `TracePhaseStatus` 的脚本）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhaseStatus {
    /// 阶段正常完成（产出物或正常收敛）
    Success,
    /// 阶段降级（降级支路接管，产出 Degraded 物）
    Degraded,
    /// 阶段失败（不可恢复，run 走 Error 出口）
    Failed,
}

/// 运行观察者。
///
/// `on_phase` 的 `status` 语义：
/// - `None` = 阶段**进入**（对应 kernel `TracePhaseEntered`）
/// - `Some(_)` = 阶段**结果**（对应 kernel `TracePhaseResult`）
#[allow(unused_variables)]
pub trait RunObserver: Send + Sync {
    /// 阶段进入或结果（node_id = 产出该阶段的运行节点）
    fn on_phase(&self, node_id: &str, phase: &str, status: Option<PhaseStatus>, summary: &str);

    /// 全链终局（报告就绪；blackboard 字段为终局黑板快照，供产物翻译）
    #[allow(unused_variables)]
    fn on_finished(&self, report: &RunReport) {}
}