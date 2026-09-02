//! Reflection + Self-Refine 编排模式（反射域，单文件升目录拆分）
//!
//! node.rs 承载 ReflectionNode（评审）+ RefineNode（收敛迭代，三收敛条件）；
//! tests.rs 自带共享测试桩（ScriptedBackend/TestEmitter/make_ctx，S4 迁移自
//! plan_execute::tests，2026-09-01），JSON 解析经 patterns/shared::json
//! （matrix §4 Reflection 卡片解耦）。

mod node;
#[cfg(test)]
mod tests;

pub use node::*;