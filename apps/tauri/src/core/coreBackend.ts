/** Tauri 端 coreBackend（Phase 3 端分离：纯 invoke 路径、签名兼容），详细见 docs/details/注释/tauri/coreBackend.md */

// coreBackend 收敛为 api/ 按领域拆分文件的聚合 re-export（类型统一来自 @worldsmith/core-api-types）
export * from './api'
