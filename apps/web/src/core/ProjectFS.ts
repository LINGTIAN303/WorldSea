/** ProjectFS：向后兼容 re-export（实现已迁 entity-core，依赖注入说明见文档），详细见 docs/details/注释/web/core/ProjectFS.md */
export {
  exportProjectToDir,
  importProjectFromDir,
  type ProjectManifest,
  type ProjectCache,
  type ExportProgressCallback,
  type ImportProgressCallback,
} from '@worldsmith/entity-core/core'
