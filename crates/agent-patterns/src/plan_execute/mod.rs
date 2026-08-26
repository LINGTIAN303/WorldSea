//! Plan-and-Execute 编排模式（PlanNode + ExecuteNode，单文件升目录拆分）
//!
//! tests 拆至 tests.rs（含 ScriptedBackend/TestEmitter/make_ctx 共享测试桩，
//! Reflection 模式测试复用，见 matrix §4 Reflection 卡片）。

mod node;
#[cfg(test)]
pub(crate) mod tests;

pub use node::*;