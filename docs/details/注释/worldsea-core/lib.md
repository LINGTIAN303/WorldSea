# worldsea-core 库概览

> 源文件：`worldsea-core/src/lib.rs`

## 模块概览

- `error` — 统一错误类型 `CoreError`，支持错误链传播
- `models` — 数据模型：实体、关系、包、模块、插件清单
- `validate` — 实体/关系/包/引用完整性验证引擎
- `migrate` — 包数据版本迁移引擎（含快照回滚）
- `doctor` — 存储与插件健康诊断
- `retrofit` — AI 安全改造协议（意图/目录/会话/变更日志/引擎）
- `algo` — 算法集：geometry、graph（树布局、PageRank、Louvain 社区、介数中心性）、spatial（RTree 空间索引）、collab（CRDT：向量钟、LWW 寄存器、ORSet、RGA）、terrain、draft
- `schema` — 实体/关系类型 Schema：类型定义（EntityTypeSchema / FieldSchema / RelationTypeSchema / ViewDeclaration）、视图动画配置、SchemaRegistry 注册表
- `workflow` — 工作流定义（types）、解析（YAML / JSON / 自动侦测）、校验、Sqlite 存储
- `storage` — `StorageBackend` trait + `SQLite` 实现（需 `sqlite` feature）
- `wasm_export` — WebAssembly 导出绑定（需 `wasm` feature）

## Feature Flags

| Feature | 描述 |
|---------|------|
| `sqlite` | 启用 `SQLite` 存储后端（`rusqlite` bundled） |
| `wasm`   | 启用 WASM 导出（`wasm-bindgen`） |

## 快速上手

```rust,ignore
use worldsea_core::validate::entity::validate_entity;
use worldsea_core::models::entity::Entity;

let entity = Entity { id: "e1".into(), entity_type: "character".into(), /* ... */ };
let report = validate_entity(&entity, None);
// ValidationReport 无独立 warnings 字段：警告是 errors 中 severity == "warning" 的条目
let warnings = report.errors.iter().filter(|e| e.severity == "warning").count();
println!("验证错误: {}, 警告: {}", report.errors.len() - warnings, warnings);
```
