/**
 * ProjectFS — 向后兼容 re-export
 *
 * Phase 5a: 实现已迁移到 @worldsmith/entity-core/core/ProjectFS。
 * 此文件保留以维持现有 import 路径兼容性（P3-W4 续迁入）。
 *
 * 依赖注入说明：
 * - entity-core/core/ProjectFS 通过 ModuleStoreApi 和 ProjectSwitcherApi 接口
 *   访问根项目的 moduleStore 和 useProjectSwitcher。
 * - 应用启动时需调用 registerModuleStoreApi() 和 registerProjectSwitcherApi()
 *   注册实现（apps/web main.ts 已注册）。
 */
export {
  exportProjectToDir,
  importProjectFromDir,
  type ProjectManifest,
  type ProjectCache,
  type ExportProgressCallback,
  type ImportProgressCallback,
} from '@worldsmith/entity-core/core'
