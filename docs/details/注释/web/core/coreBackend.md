# coreBackend.ts 详细注释

> 来源：`apps/web/src/core/coreBackend.ts`
> 说明：本文件为 Web 端 coreBackend 内长注释块的「详细」层（why/how）归档。代码文件内仅保留一行简要注释并指向本文件。

## 注释块 1（原文件第 1-12 行）

```
/**
 * Web 端 coreBackend — Phase 3 端分离
 *
 * 改造自 src/core/coreBackend.ts（1298 行）
 * - 移除 Tauri 检测分支与 @tauri-apps/api 依赖
 * - 移除 tauriCall / getTauriInvoke
 * - 移除 backendCall / algoCall 中的 Tauri 分支
 * - 移除 retrofit 内联 Tauri 分支
 * - 移除 7 个 algo 函数的内联 Tauri 分支
 * - Tauri-only 函数（checkStorageHealth / validatePluginManifest / checkPluginHealth / spatial*）保留签名返回降级值
 * - 对外 API 签名 100% 兼容（main.ts 无需改动）
 */
```

## 2026-08-06 收敛改造（coreBackend → api/ 领域拆分）

- coreBackend.ts 收敛为聚合 re-export（`export * from './api'`），全部内联类型（71 个）改为从 `@worldsmith/core-api-types` 共享包 import / re-export
- 函数按领域拆至 `apps/web/src/core/api/`：
  - runtime.ts：web 特有调用层（wasmCall / getCoreCached / callViaWorker / isHeavyMethod / detectBackend）
  - schema.ts：契约校验 validatePack + Schema API（schemaRegisterEntityType 等）
  - retrofit.ts：retrofit 会话函数
  - entity.ts：实体校验（validateEntity / validateEntities / checkReferences / migrate / runDiagnostics）
  - algo.ts：空间索引 + 几何/图/CRDT/地形算法（与 tauri 端同构）
  - health.ts：checkStorageHealth / validatePluginManifest / checkPluginHealth
- 对外导出名集合与签名不变，`import * as coreBackend` 调用方零改动
