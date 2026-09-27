/** 端无关环境检测：仅检测是否运行在 Tauri 桌面环境，不调用任何 Tauri API */

/** 检测当前是否在 Tauri 桌面环境中 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && (!!(window as any).__TAURI_INTERNALS__ || !!(window as any).__TAURI__)
}
