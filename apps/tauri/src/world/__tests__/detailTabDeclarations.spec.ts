/**
 * 详情 Tab 声明守卫（2026-10-08 Tab 优化批 C）。
 *
 * 声明单点里的 icon 名必须可解析（lucide 名写错会**静默渲空**——本仓通用坑）；
 * id 不得与内置 tab 撞名（原 character 的 customTab 用 'relations' 与内置「关联」同名——
 * Vue 同名具名槽后者覆盖，「关系图」页实际渲染关联面板，随本批修），类型内不得重复。
 */
import { describe, it, expect } from 'vitest'
import { hasLucideIcon } from '@worldsea/ui-kit/components/lucideMap'
import { DETAIL_TAB_DECLARATIONS } from '../detailTabDeclarations'

/** resolveDetailTabs 的内置页（不得被芽声明顶替） */
const BUILTIN_IDS = ['info', 'cover', 'relations']

describe('detailTabDeclarations', () => {
  it('每个声明的 icon 名都能解析（防静默渲空）', () => {
    for (const [type, decl] of Object.entries(DETAIL_TAB_DECLARATIONS)) {
      for (const t of [...(decl.custom ?? []), ...(decl.extras ?? [])]) {
        if (!t.icon) continue
        expect(hasLucideIcon(t.icon), `${type} 的 ${t.id} 写了未注册的图标 ${t.icon}`).toBe(true)
      }
    }
  })

  it('id 不与内置撞名、类型内不重复（同名槽覆盖的存量缺陷不得回插）', () => {
    for (const [type, decl] of Object.entries(DETAIL_TAB_DECLARATIONS)) {
      const ids = [...(decl.custom ?? []), ...(decl.extras ?? [])].map(t => t.id)
      expect(new Set(ids).size, `${type} 内 id 重复：${ids.join('、')}`).toBe(ids.length)
      for (const id of ids) {
        expect(BUILTIN_IDS, `${type} 的 ${id} 与内置 tab 撞名`).not.toContain(id)
      }
    }
  })

  it('声明覆盖面锁定（防单点被搬空；新增类型须显式补声明）', () => {
    expect(Object.keys(DETAIL_TAB_DECLARATIONS).sort()).toEqual(['character', 'event', 'organization', 'region'])
  })
})
