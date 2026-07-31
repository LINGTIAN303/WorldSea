// Phase 4 迁移：实现已下沉到 @worldsmith/entity-core/stores/fontStore
// 此文件保留作为向后兼容的 re-export，避免 12+ 处根目录 import 被破坏
// 后续 Phase 5/6 将逐步将根目录 import 直接指向 @worldsmith/entity-core
export * from '@worldsmith/entity-core/stores/fontStore'
