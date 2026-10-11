import type { PluginView } from '../../types'
import type { Serializer, ImportStrategy } from './types'

export function createViewSerializer(
  getViews: () => PluginView[],
): Serializer {
  return {
    id: 'views',
    label: '视图注册',
    dependsOn: [],

    async collect(): Promise<Record<string, unknown>> {
      const views = getViews()
      return {
        version: 1,
        total: views.length,
        views: views.map(v => ({
          id: v.id,
          label: v.label,
          icon: v.icon,
        })),
      }
    },

    async import(_data: Record<string, unknown>, _strategy: ImportStrategy): Promise<void> {
      console.log('[ViewSerializer] 视图注册由各芽 activate 时重建（导入后重播种）')
    },
  }
}
