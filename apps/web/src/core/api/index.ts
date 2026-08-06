/** Web 端 coreBackend 领域聚合入口：按领域拆分后的 re-export 层，详细见 docs/details/注释/web/core/coreBackend.md */

// runtime 内部工具函数（backendCall/algoCall/wasmCall/getCoreCached）仅限领域文件间互调，
// 不透传至 coreBackend 导出面，保持原导出名集合不变
export { setWasmAvailable, getBackendType } from './runtime'
export * from './schema'
export * from './retrofit'
export * from './entity'
export * from './algo'
export * from './health'
