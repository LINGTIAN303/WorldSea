/**
 * 长任务模块
 *
 * 包含：
 * - longTaskStore：IndexedDB 持久化层（端无关）
 * - useLongTask：长任务管理器（端无关，模块级单例 composable）
 */
export * from './longTaskStore'
export * from './useLongTask'
