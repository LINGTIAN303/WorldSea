//! `WorldSea` 核心库 — 世界构建数据的模型、验证、迁移、诊断与存储。
//! 模块概览、feature 矩阵与快速上手示例见 docs/details/注释/worldsea-core/lib.md。

pub mod algo;
pub mod schema;
pub mod doctor;
pub mod error;
pub mod migrate;
pub mod models;
pub mod retrofit;
pub mod validate;
pub mod workflow;

#[cfg(feature = "sqlite")]
pub mod storage;

#[cfg(feature = "wasm")]
mod wasm_export;

#[cfg(feature = "wasm")]
pub use wasm_export::WorldSeaCore;

pub use error::CoreError;
