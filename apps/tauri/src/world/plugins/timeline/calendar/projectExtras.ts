/** 时间体系随项目迁移：ProjectFS 目录文件 + WorldSeaPack 打包分区。 */
import type {
  ImportReportItem, ImportStrategy, ProjectExtraProvider, Serializer,
} from '@worldsea/entity-core/core'
import { exportTimelineSettings, importTimelineSettings } from './store'

export const TIMELINE_SETTINGS_PATH = 'settings/timeline.json'

export function createTimelinePackSerializer(): Serializer {
  return {
    id: 'timeline',
    label: '时间体系',
    dependsOn: [],
    async collect(): Promise<Record<string, unknown>> {
      const bundle = await exportTimelineSettings()
      return {
        version: bundle.version,
        total: bundle.calendars.length,
        calendars: bundle.calendars,
        activeId: bundle.activeId,
        migrated: bundle.migrated,
      }
    },
    async import(data: Record<string, unknown>, strategy: ImportStrategy): Promise<ImportReportItem> {
      const total = Array.isArray(data.calendars) ? data.calendars.length : 0
      const added = await importTimelineSettings(data, strategy === 'overwrite' ? 'overwrite' : 'merge')
      return {
        serializerId: 'timeline',
        total,
        added,
        skipped: Math.max(0, total - added),
        updated: 0,
        errors: [],
      }
    },
  }
}

export const timelineProjectExtraProvider: ProjectExtraProvider = {
  id: 'timeline',
  path: TIMELINE_SETTINGS_PATH,
  async exportFile() {
    return {
      path: TIMELINE_SETTINGS_PATH,
      content: JSON.stringify(await exportTimelineSettings(), null, 2),
    }
  },
  async importFile(content: string) {
    try {
      await importTimelineSettings(JSON.parse(content), 'merge')
    } catch {
      // 旧项目/手工改坏的文件不阻断导入
    }
  },
}
