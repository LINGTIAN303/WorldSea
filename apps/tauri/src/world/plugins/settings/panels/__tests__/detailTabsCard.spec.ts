/**
 * DetailTabsCard「Tab 管理」行为测试（2026-10-08 Tab 优化批 C）。
 *
 * 锁：全量列出行（含隐藏项）、info/relations 钉底禁隐、上移改序、隐藏开关、
 * 保存载荷（order + hidden）、恢复默认清覆写。落 localStorage 的 store ⇒ spec 必须 clear。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useDetailLayoutStore } from '@worldsea/entity-core'

import DetailTabsCard from '../DetailTabsCard.vue'

let pinia: Pinia

function mountCard(entityType = 'character') {
  return mount(DetailTabsCard, {
    props: { entityType, typeLabel: '角色' },
    global: { plugins: [pinia] },
  })
}

function rowLabels(w: ReturnType<typeof mountCard>): string[] {
  return w.findAll('.ds-tab-label').map(el => el.text())
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.clear()
})

describe('DetailTabsCard', () => {
  it('列出行含全部 tab（info/自定义/relations；钉底行标注「固定」）', () => {
    const w = mountCard()
    const labels = rowLabels(w)
    expect(labels[0]).toBe('信息')
    expect(labels).toContain('家谱')
    expect(labels).toContain('关系图')
    expect(labels[labels.length - 1]).toBe('关联')
    expect(w.findAll('.ds-count').map(el => el.text())).toEqual(['固定', '固定'])
  })

  it('钉底行禁隐（checkbox disabled）；普通行可关', async () => {
    const w = mountCard()
    const checkboxes = w.findAll('.ds-tab-toggle')
    expect((checkboxes[0].element as HTMLInputElement).disabled).toBe(true)
    const familyIdx = rowLabels(w).indexOf('家谱')
    expect((checkboxes[familyIdx].element as HTMLInputElement).disabled).toBe(false)
  })

  it('上移改序并入保存载荷（order）', async () => {
    const w = mountCard()
    const idx = rowLabels(w).indexOf('家谱')
    // 前提：家谱初始排在「信息」之后（测试环境无 character schema ⇒ 无 cover）
    expect(idx).toBeGreaterThan(rowLabels(w).indexOf('信息'))
    await w.findAll('.ds-tab-row')[idx].find('.ds-btn[title="上移"]').trigger('click')
    const save = w.findAll('.set-btn').find(b => b.text() === '保存')!
    await save.trigger('click')
    const order = useDetailLayoutStore().tabOverrides.character!.order!
    // 上移一格后：家谱应排到「信息」之前
    expect(order.indexOf('family')).toBeLessThan(order.indexOf('info'))
  })

  it('隐藏开关入保存载荷（hidden，钉底除外）', async () => {
    const w = mountCard()
    const idx = rowLabels(w).indexOf('家谱')
    await w.findAll('.ds-tab-toggle')[idx].trigger('change')
    const save = w.findAll('.set-btn').find(b => b.text() === '保存')!
    await save.trigger('click')
    expect(useDetailLayoutStore().tabOverrides.character?.hidden).toEqual(['family'])
  })

  it('隐藏后仍在列（可恢复）；恢复默认清覆写', async () => {
    useDetailLayoutStore().setTabOverride('character', { order: ['relations'], hidden: ['family'] })
    const w = mountCard()
    expect(rowLabels(w)).toContain('家谱')
    const familyIdx = rowLabels(w).indexOf('家谱')
    expect((w.findAll('.ds-tab-toggle')[familyIdx].element as HTMLInputElement).checked).toBe(false)

    const reset = w.findAll('.set-btn').find(b => b.text() === '恢复默认')!
    await reset.trigger('click')
    expect(useDetailLayoutStore().tabOverrides.character).toBeUndefined()
  })
})
