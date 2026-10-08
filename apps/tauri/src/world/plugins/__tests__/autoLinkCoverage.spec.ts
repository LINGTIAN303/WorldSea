/**
 * ③ 挂账收尾批护栏（2026-10-07）：
 * - 时间线详情必须挂载关联建议面板（源码契约守卫：摘挂载即红；断言调用形状防裸词假绿）
 * - 图谱触发开关已撤：store 无该字段、设置面板无该行（登记与实现一致）
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '@worldsea/entity-core'

const timelineView = readFileSync('apps/tauri/src/world/plugins/timeline/TimelineView.vue', 'utf-8')
const relationsPanel = readFileSync(
  'packages/ui-kit/src/components/settings/panels/RelationsPanel.vue',
  'utf-8',
)

describe('AutoLink 覆盖面与登记一致（③ 批）', () => {
  it('时间线详情挂载关联建议面板（调用形状守卫）', () => {
    // 断言「挂载调用形状」而非裸字面量：`:entity-id="selectedEvent.id"` 在同文件
    // EntityRelationSelector 处也出现——首版守卫因此被旁证满足而漏报（2026-10-07 变异轮抓到）
    expect(timelineView).toMatch(/<AutoLinkSuggestions\s+v-if="selectedEvent && !isEditing"/)
    expect(timelineView).toContain(':properties="selectedEvent.properties"')
  })

  it('图谱触发开关已撤：store 无字段、设置面板无该行', () => {
    setActivePinia(createPinia())
    const store = useSettingsStore()
    expect('autoCreateGraphEnabled' in store).toBe(false)
    expect(relationsPanel).not.toContain('图谱视图中触发')
  })
})
