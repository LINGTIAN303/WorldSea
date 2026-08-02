/**
 * # worldsmith-agent 包入口（Phase 4 清理后）
 *
 * 本包是 `@worldsmith/agent-runtime` 的薄包装：
 * - 重新导出 agent-runtime 的所有端无关 API（Agent 核心、工具、会话、上下文、技能等）
 * - 额外提供端特定 ExecutionAdapter 实现（Node/Tauri/WebSocket）
 * - 自动注册三个端适配器到 ExecutionAdapter 工厂（副作用导入）
 *
 * ## 已清理（2026-07-31）
 * - CLI 代码已迁移到 apps/cli/src/cli/
 * - worldsmith-agent/src/cli/ 目录已删除
 * - worldsmith-agent/bin/cli.mjs 已删除
 *
 * ## 后续清理（Phase 6）
 * - root src 迁移到直接使用 @worldsmith/agent-runtime 后，本文件可删除
 *
 * ## 收敛状态（2026-08-02）
 * - 主应用 `@agent/*` 已统一指向 `packages/agent-runtime/src`（不再经本文件）
 * - 本包冻结：仅保留 src/execution/{tauri,ws,node}-adapter.ts 供主应用显式引用（端适配器宿主）
 * - 副作用注册（import './execution'）已由主应用 main.ts 显式 registerExecutionAdapterFactory 替代
 */

// ═══ 重新导出 agent-runtime 的端无关 API ═══
export * from '@worldsmith/agent-runtime'

// ═══ 端特定 ExecutionAdapter 实现 ═══
// 这三个适配器是端特定的，不放在 agent-runtime 中
// 注意：NodeExecutionAdapter 不在此静态导出——它依赖 child_process（Node-only），
// 静态导出会导致浏览器链（@agent/index → node-adapter → child_process）加载失败。
// Node 端通过 execution/index.ts 的动态 import 获取（apps/cli 有独立实现）。
export { TauriExecutionAdapter } from './execution/tauri-adapter'
export { WebSocketExecutionAdapter } from './execution/ws-adapter'

// ═══ 自动注册端适配器（副作用导入） ═══
// 导入即注册：Node/Tauri/WebSocket 三个适配器自动注册到 ExecutionAdapterFactory
// 现有调用方无需修改即可继续工作（向后兼容）
import './execution'
