import type { Entity } from '@worldsea/entity-core'
import type { EraInfo } from './useDateParser'

/** 纪元分组：竖向时间线的一段（分段标题 + 该段内的事件） */
export interface EraGroup {
  era: string
  range: string
  events: Entity[]
}

/**
 * 按纪元把事件切成分组。三条口径：
 * ① 纪元表为空 → 单一匿名组（不显示分段标题）；
 * ② 事件的纪元不在表内（或没填）→ 归入「未知纪元」尾组；
 * ③ 空组剔除（否则竖向列表出现只有标题、没有事件的分段）。
 *
 * 纯函数、不吃响应式：**喂全量还是喂分页子集由调用方决定**——时序表喂当前页，
 * 大纲树喂全量（分页子集会让树丢页外子节点），见 TimelineChart 的 `verticalEvents`。
 */
export function buildEraGroups(events: Entity[], eras: EraInfo[]): EraGroup[] {
  if (eras.length === 0) {
    return [{ era: '', range: '', events }]
  }
  const eraSet = new Set(eras.map(e => e.name))
  const groups: EraGroup[] = eras.map(era => ({
    era: era.name,
    range: `${era.startYear} ~ ${era.endYear}`,
    events: [],
  }))
  const noEraGroup: EraGroup = { era: '未知纪元', range: '', events: [] }
  let hasNoEra = false
  for (const event of events) {
    const eraName = (event.properties.era as string) || '未知纪元'
    const group = eraSet.has(eraName) ? groups.find(g => g.era === eraName) : undefined
    if (group) group.events.push(event)
    else {
      noEraGroup.events.push(event)
      hasNoEra = true
    }
  }
  const result = groups.filter(g => g.events.length > 0)
  if (hasNoEra) result.push(noEraGroup)
  return result
}
