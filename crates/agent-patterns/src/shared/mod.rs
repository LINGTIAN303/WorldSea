//! 扩展模式共享类型与工具
//!
//! 承载「非底座、被多个扩展模式复用」的类型与函数，避免模式间直接 import 内部符号
//! （matrix §4 GoT/Reflection 解耦落点）。目前含：
//! - `thoughts`：思维域共享类型（ThoughtNode/ToTConfig/ToTError/ToTTerminationReason + 策略 trait）
//! - `json`：JSON 解析公共工具（原散落于 plan.rs / tot error.rs）

pub mod json;
pub mod thoughts;

pub use json::*;
pub use thoughts::*;