/**
 * Artifact — 随笔（多版本 + 回滚）
 * 一个 Artifact 代表一篇可演进的随笔（随手记录的文字/图表/代码片段等），内容随更新递增版本号，
 * 完整历史保存在 `artifact_versions`，支持随时回滚到任意历史版本。
 * 定位说明：原为旧 Agent 面时代预留的「Agent 产物」存储（2026-08-16 引入），Agent 侧（旧面与 dsh）
 * 均从未接线写入；2026-10-26 重定位为用户侧「随笔」功能。存储标识符保留 artifact 命名。
 */

/** 随笔主记录。`content` 为当前最新内容，`version` 为当前版本号。 */
export interface Artifact {
  id: string
  /** 随笔标题/名称 */
  title: string
  /** 当前最新内容 */
  content: string
  /** 随笔类型（document / chart / code ...），用于前端分组与图标 */
  artifact_type: string
  /** 当前版本号（>=1） */
  version: number
  /** 归属项目 ID（项目空间隔离，与 entities 表对齐） */
  project_id: string
  created_at: string
  updated_at: string
}

/** 随笔的历史版本快照。每次有内容变更都会追加一条记录。 */
export interface ArtifactVersion {
  id: string
  artifact_id: string
  /** 该版本对应的版本号（>=1，与 Artifact.version 对齐） */
  version: number
  /** 该版本的内容快照 */
  content: string
  created_at: string
}