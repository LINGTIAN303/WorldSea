/**
 * ImportExportModal 的展示层纯函数（从该组件抽出，控制单文件规模）。
 *
 * 三块内容：加载阶段的文案构建、序列化器图标映射、导入包条目计数。
 * 都不依赖组件实例——组件里用 computed 包装即可。
 */

import type { LoadingStage } from '../feedback/loading/types'
import { serializerRegistry } from '@worldsea/entity-core'
import type { ImportStrategy } from '@worldsea/entity-core'

/** 导出进度（done/total 与 useAsyncTask 的进度回调口径一致） */
export interface StageProgress {
  done: number
  total: number
}

/** 导出阶段文案（两阶段：收集 → 打包/编码，按格式区分文案） */
export function buildExportStages(format: 'json' | 'yaml' | 'ws', progress: StageProgress): LoadingStage[] {
  const { done, total } = progress
  return [
    {
      short: '收集',
      full: '收集导出数据…',
      detail: total > 0 ? `已收集 ${done} / ${total} 类` : '读取实体 / 关系 / 字段',
    },
    {
      short: format === 'ws' ? '打包' : '编码',
      full: format === 'ws' ? '打包并下载 .ws…' : '编码并下载…',
      detail: format === 'ws' ? '包含媒体文件' : format === 'yaml' ? 'YAML' : 'JSON',
    },
  ]
}

/** 导入阶段文案：overwrite 策略前插「备份」阶段（覆盖前自动备份），merge 直接写入 */
export function buildImportStages(strategy: ImportStrategy, progress: StageProgress): LoadingStage[] {
  const { done, total } = progress
  const write: LoadingStage = {
    short: '写入',
    full: '写入导入数据…',
    detail: total > 0 ? `已写入 ${done} / ${total} 类` : '实体 / 关系 / 字段',
  }
  const refresh: LoadingStage = {
    short: '刷新',
    full: '刷新实体 / 关系 / 文件…',
    detail: '重新加载工作区数据',
  }
  if (strategy === 'overwrite') {
    return [
      { short: '备份', full: '备份当前数据…', detail: '覆盖前自动备份' },
      write,
      refresh,
    ]
  }
  return [write, refresh]
}

/** 序列化器图标映射（未登记 id 回退手稿图标） */
export function serializerIcon(id: string): string {
  const icons: Record<string, string> = {
    'entities': 'item',
    'relations': 'link',
    'entity-types': 'outline',
    'relation-types': 'settings',
    'views': 'image',
    'custom-fields': 'tag',
  }
  return icons[id] ?? 'manuscript'
}

/** 序列化器展示名（未登记 id 原样返回） */
export function serializerLabel(id: string): string {
  return serializerRegistry.get(id)?.label ?? id
}

/** 导入包内某序列化器分区的条目数（total 字段优先，各分区按数组长度兜底） */
export function itemCount(data: unknown): number {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.total === 'number') return d.total
    if (Array.isArray(d.entities)) return d.entities.length
    if (Array.isArray(d.relations)) return d.relations.length
    if (Array.isArray(d.schemas)) return d.schemas.length
    if (Array.isArray(d.views)) return d.views.length
  }
  return 0
}
