# main.ts 详细注释文档（tauri）

> 来源：`apps/tauri/src/main.ts` 中连续 ≥ 10 行的长注释块，按文件内出现顺序迁移至此。
> 代码内原位置已替换为一行简要注释 + 相对路径。

## 注释块 1（原文件第 1-11 行）

Tauri 端入口（Phase 3 — 端入口硬编码后端）

端分离策略：
- 硬编码 Tauri IPC 后端（移除 getBackendType 运行时检测）
- 通过 Tauri invoke 调用 Rust 命令
- 不需要 /api/* 代理（IPC 直连系统能力）

当前状态：业务 UI 已在 `apps/tauri/src/`（App.vue），本入口为完整应用入口
（createApp + initializeBackend 注册 registerBackend/registerValidationApi/
registerAllManifests/injectAllKeyframes 等），不再区分 Phase 3/4。
