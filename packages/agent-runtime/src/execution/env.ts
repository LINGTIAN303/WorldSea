/**
 * 环境检测 — 独立模块，不依赖任何 Node 内置模块
 *
 * 从 node-adapter.ts 拆分出来，避免浏览器加载 execution/index.ts 时
 * 连带加载 child_process（node-adapter.ts 顶层 import 'child_process'）
 */

/** 检测当前是否在 Node.js 环境中（非浏览器） */
export function isNodeEnv(): boolean {
  return (
    typeof process !== 'undefined' &&
    !!process.versions?.node &&
    typeof (globalThis as any).window === 'undefined'
  )
}
