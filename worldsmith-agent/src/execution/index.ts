/**
 * # worldsmith-agent 执行适配器入口（向后兼容层）
 *
 * 本文件是 Phase 1 端分离的过渡层：
 * - 重新导出 @worldsmith/agent-runtime/execution 的端无关 API
 * - 自动注册三个端适配器（Node/Tauri/WebSocket），保持现有调用方无需修改
 *
 * ## 后续清理（Phase 2/3）
 * - CLI 端迁移到 apps/cli 后，仅注册 NodeExecutionAdapter
 * - Tauri 端迁移到 apps/tauri 后，仅注册 TauriExecutionAdapter
 * - Web 端迁移到 apps/web 后，仅注册 WebSocketExecutionAdapter
 * - 本文件届时删除
 */

// 重导出 agent-runtime 的端无关 API
export {
  createExecutionAdapter,
  resetExecutionAdapter,
  registerExecutionAdapterFactory,
  isTauri,
  getWsUrl,
  getWsToken,
  isNodeEnv,
} from '@worldsmith/agent-runtime/execution'

export type {
  ExecutionAdapter,
  ExecOptions,
  ExecResult,
  PtyOptions,
  ShellInfo,
  ShellSessionInfo,
  ShellExecResult,
  ExecutionAdapterFactory,
} from '@worldsmith/agent-runtime/execution'

// ─── 自动注册端适配器（向后兼容） ──────────────────────────────────

import { registerExecutionAdapterFactory, getWsUrl } from '@worldsmith/agent-runtime/execution'
import { TauriExecutionAdapter } from './tauri-adapter'
import { WebSocketExecutionAdapter } from './ws-adapter'

/**
 * 注册所有端适配器
 * - Node adapter: 动态 import，避免浏览器加载 child_process
 * - Tauri adapter: 静态 import（仅使用 window 检测，浏览器安全）
 * - WebSocket adapter: 静态 import（使用浏览器原生 WebSocket）
 */
registerExecutionAdapterFactory({
  createNodeAdapter: async () => {
    // 动态 import：仅在 Node 环境加载 child_process，浏览器不会加载此模块
    const { NodeExecutionAdapter } = await import('./node-adapter')
    return new NodeExecutionAdapter()
  },
  createTauriAdapter: () => new TauriExecutionAdapter(),
  createWsAdapter: (config) =>
    new WebSocketExecutionAdapter({
      url: config.url || getWsUrl(),
      reconnect: config.reconnect ?? true,
      maxRetries: 5,
    }),
})
