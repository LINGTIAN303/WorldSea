// coreBackend 按领域拆分后的聚合 re-export（原 apps/tauri/src/core/coreBackend.ts 收敛入口）
export * from './schema'
export * from './retrofit'
export * from './entity'
export * from './algo'
export * from './health'
export { setWasmAvailable, getBackendType } from './runtime'
export type * from '@worldsmith/core-api-types'
