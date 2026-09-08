//! `WorldSea` 核心库 (v0.2.0) — 世界构建数据的模型、验证、迁移、诊断与存储
//!
//! # 模块概览
//!
//! - [`error`] — 统一错误类型 [`CoreError`]，支持错误链传播
//! - [`models`] — 数据模型：实体、关系、包、模块、插件清单
//! - [`validate`] — 实体/关系/包/引用完整性验证引擎
//! - [`migrate`] — 包数据版本迁移引擎（含快照回滚）
//! - [`doctor`] — 存储与插件健康诊断
//! - [`retrofit`] — AI 安全改造协议（意图/目录/会话/变更日志/引擎）
//! - [`storage`] — `StorageBackend` trait + `SQLite` 实现（需 `sqlite` feature）
//! - `wasm_export` — WebAssembly 导出绑定（需 `wasm` feature）
//!
//! # Feature Flags
//!
//! | Feature | 描述 |
//! |---------|------|
//! | `sqlite` | 启用 `SQLite` 存储后端（`rusqlite` bundled） |
//! | `wasm`   | 启用 WASM 导出（`wasm-bindgen`） |
//!
//! # 快速开始
//!
//! ```rust,ignore
//! use worldsea_core::validate::entity::validate_entity;
//! use worldsea_core::models::entity::Entity;
//!
//! let entity = Entity { id: "e1".into(), entity_type: "character".into(), ... };
//! let report = validate_entity(&entity, None);
//! println!("验证错误: {}, 警告: {}", report.errors.len(), report.warnings.len());
//! ```

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
