# core-api-types — 双端共享契约类型

> 源文件：`packages/core-api-types/src/index.ts`

## 定位

coreBackend（Tauri 后端命令面）的前后端共享契约类型包。前端 `packages/core-api-types` 与宿主侧（Tauri 命令的序列化结构）以同一份类型定义为准，避免双端各自声明后漂移。

## 结构

- `Core*` 前缀类型（CoreValidationError / CoreValidationReport 等）：Tauri 端独有，web 端同源定义见 `apps/web/src/core/worldseaCore.ts`；
- 其余为双端直接共享的接口/枚举，按域分段（注释段头分隔）。

## 约定

- 本包只放类型，不含运行时逻辑；
- 契约变更必须双端同步：改这里的同时改 Tauri 命令的 Rust 结构体与 web 端同源定义，保持字段名与可空性一致。
