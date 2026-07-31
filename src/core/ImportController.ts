/**
 * re-export 兼容层 — 实际实现已迁移到 @worldsmith/entity-core/core/io
 * Phase 8a: io 模块下沉
 *
 * 注：原根目录实现依赖 coreBackend.validatePack，
 *     下沉后通过 PackValidator DI 接口注入（main.ts 中 registerPackValidator）
 */
export {
  ImportController,
  importController,
} from '@worldsmith/entity-core'
