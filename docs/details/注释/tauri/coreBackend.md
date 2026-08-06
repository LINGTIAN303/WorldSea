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
