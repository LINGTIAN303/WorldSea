/** Web 端 coreBackend：Phase 3 端分离改造（移除 Tauri 分支，API 兼容），详细见 docs/details/注释/web/core/coreBackend.md */

// 收敛改造：实现已按领域拆分至 core/api/（schema/retrofit/entity/algo/health/runtime），
// 本文件仅作聚合 re-export，原有导出名与签名保持不变（调用方 import './coreBackend' 零改动）
export * from './api'
