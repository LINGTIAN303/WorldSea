/**
 * Tauri 端 useAgent 兼容入口（插件迁移用）
 * 复用 useAgentRust（Rust Agent 后端），对外保持 web 端 useAgent() 的函数形态，
 * 使迁移插件（如 manuscript AISidebar）零改动使用。
 */
import { useAgentRust } from './useAgentRust'

export function useAgent() {
  return useAgentRust()
}
