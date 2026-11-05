import type { WorldPluginApi } from '../../api'
import type { CordisContext } from '@deepseek-ai/cordis'
import type { WorldProjectExtrasService } from '../../services'
import TimelineView from './TimelineView.vue'
import { createTimelinePackSerializer, timelineProjectExtraProvider } from './calendar/projectExtras'

export const manifest = {
  id: 'official.timeline',
  domain: 'time',
  entityTypes: ['event'],
  secondaryDomains: ['society'],
  name: '时间线',
  version: '2.0.0',
  description: '管理世界观中的历史事件与时间线',
  author: 'WorldSea',
  /** 历法与打包分区必须接进项目迁移链——依赖树提供的迁移扩展点服务（阶段 2-B）。 */
  requires: ['world.projectExtras'],
}

export function apply(ctx: CordisContext, api: WorldPluginApi) {
  // 经服务登记迁移扩展点：返回值是 disposer，交给 ctx.effect 后卸载即回卷
  // （旧实现是模块级幂等布尔 + 全局 Map 写入，卸载后条目永久残留）。
  const extras = ctx.get('world.projectExtras') as WorldProjectExtrasService
  ctx.effect(() => extras.registerPackSerializer(createTimelinePackSerializer()))
  ctx.effect(() => extras.registerProjectExtraProvider(timelineProjectExtraProvider))

  api.registerEntityV2({
    type: 'event',
    label: '事件',
    icon: 'timeline',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'datable', fieldOverrides: {
        date: { label: '日期/纪年' },
        dateEnd: { label: '结束日期' },
      } },
    ],
    ownFields: [
      // 日期文本由历法内核解析；calendarId 指向项目级历法，dateCertainty 承载模糊语义
      { key: 'calendarId', label: '历法', fieldType: 'text' },
      { key: 'dateCertainty', label: '日期确定度', fieldType: 'select', options: [
        { value: 'exact', label: '精确' },
        { value: 'approx', label: '约' },
        { value: 'before', label: '早于' },
        { value: 'after', label: '晚于' },
        { value: 'legend', label: '传说' },
      ] },
      // 周期规则是工具内部 JSON（同 R6-c 的编排步骤），不参与字段矩阵解读
      { key: 'recurrence', label: '周期规则', fieldType: 'textarea' },
      { key: 'importance', label: '重要程度', fieldType: 'select', options: ['关键', '重要', '普通', '细微'].map(s => ({ value: s, label: s })) },
      { key: 'status', label: '状态', fieldType: 'select', options: ['正史', '废案', '备选'].map(s => ({ value: s, label: s })) },
      // 事件树以 properties.parentId 为准；刻意不声明 relationType（不建关系边，区别于大纲的 parent_child）
      { key: 'parentId', label: '父级事件', fieldType: 'entityRef', refType: 'event' },
      { key: 'location', label: '发生地点', fieldType: 'text' },
    ],
  })

  api.registerView({ id: 'timeline', label: '时间线', icon: 'timeline', component: TimelineView })
}

export default { manifest, apply }
