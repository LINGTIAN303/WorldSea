# coreBackend.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/core/coreBackend.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-12 行）

Tauri 端 coreBackend — Phase 3 端分离

改造自 src/core/coreBackend.ts（1298 行）
- 移除 WASM 加载与 Worker 池依赖
- 移除 getCoreCached / wasmCall / callViaWorker / isHeavyMethod
- 简化 detectBackend 为硬编码 'tauri'
- 简化 backendCall / algoCall / tauriCall（移除分支判断）
- 移除 retrofit 内联 WASM 分支
- 移除 7 个 algo 函数的内联 WASM 分支
- 对外 API 签名 100% 兼容

## 2026-08-06 收敛改造（coreBackend → api/ 领域拆分）

- coreBackend.ts 收敛为聚合 re-export（`export * from './api'`），全部内联类型（71 个）改为从 `@worldsmith/core-api-types` 共享包 import / re-export
- 函数按领域拆至 `apps/tauri/src/core/api/`：
  - runtime.ts：tauri 特有调用层（getTauriInvoke / backendCall / tauriCall / algoCall / detectBackend）+ setWasmAvailable（no-op）/ getBackendType
  - schema.ts：契约校验 validatePack + Schema API（schemaRegisterEntityType 等 7 个）
  - retrofit.ts：retrofit 会话 14 个函数
  - entity.ts：实体校验 5 个（validateEntity / validateEntities / checkReferences / migrate / runDiagnostics）
  - algo.ts：空间索引 10 个 + 几何/图/CRDT/地形算法 79 个
  - health.ts：checkStorageHealth / validatePluginManifest / checkPluginHealth
- 对外导出名集合与签名不变，`import * as coreBackend` 调用方零改动
