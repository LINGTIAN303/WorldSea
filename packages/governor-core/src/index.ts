/**
 * @worldsmith/governor-core — Barrel Exports
 *
 * 调控器核心包入口：纯逻辑、无 Vue/Pinia 依赖。
 * 主应用（src/governor）与 Agent 包（worldsmith-agent）共享此包。
 *
 * 子路径导出：
 *   - @worldsmith/governor-core          → 本文件（全部导出）
 *   - @worldsmith/governor-core/types    → 类型定义
 *   - @worldsmith/governor-core/registry → 注册表与依赖解析
 *   - @worldsmith/governor-core/environment → 环境检测
 *   - @worldsmith/governor-core/governor → createGovernor 工厂
 */
export * from './types'
export * from './environment'
export * from './registry'
export * from './governor'
