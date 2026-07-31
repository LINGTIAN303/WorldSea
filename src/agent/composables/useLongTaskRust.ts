/**
 * re-export 兼容层 — 实际实现已迁移到 apps/tauri/src/agent/composables/useLongTaskRust.ts
 * Phase 3 端分离：本文件保留向后兼容，新代码请直接引用 apps/tauri/src/...
 *
 * 原文件具名导出：RustLongTaskRecord (interface)、useLongTaskRust (function)
 * `export *` 已覆盖所有命名导出（含类型）。
 */
export * from '../../../apps/tauri/src/agent/composables/useLongTaskRust'
