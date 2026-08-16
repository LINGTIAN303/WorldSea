/**
 * Artifact — Agent 产物（C1 多版本 + 回滚）
 *
 * 一个 Artifact 代表一份可演进的产物（文档/图表/代码等），
 * 其内容随更新而递增版本号，完整历史保存在 `artifact_versions`，
 * 支持随时回滚到任意历史版本。
 */

/** Agent 产物主记录。`content` 为当前最新内容，`version` 为当前版本号。 */
export interface Artifact {
  id: string
  /** 产物标题/名称 */
  title: string
  /** 当前最新内容 */
  content: string
  /** 产物类型（document / chart / code ...），用于前端分组与图标 */
  artifact_type: string
  /** 当前版本号（>=1） */
  version: number
  /** 归属项目 ID（项目空间隔离，与 entities 表对齐） */
  project_id: string
  created_at: string
  updated_at: string
}

/** Artifact 的历史版本快照。每次有内容变更都会追加一条记录。 */
export interface ArtifactVersion {
  id: string
  artifact_id: string
  /** 该版本对应的版本号（>=1，与 Artifact.version 对齐） */
  version: number
  /** 该版本的内容快照 */
  content: string
  created_at: string
}