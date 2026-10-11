/**
 * boardShortcuts 单测 —— 白板快捷键「注册处 ↔ 设置面板目录」一致性守卫。
 *
 * 【为什么需要】快捷键要在两处出现：`useShortcuts.register()`（权威、参与分发）与
 * ui-kit 的 `SHORTCUT_CATALOG`（设置面板展示目录）。2026-09-16 批次 4 就是只在注册处
 * 写了七条、目录里没写 —— 结果是**快捷键能按，但在「设置 → 快捷键」里完全看不到**；
 * 同时目录里还留着旧大纲视图死掉后无人注册的 `outline.close-detail`。
 * 本守卫把两处绑定在一起：目录缺条目、目录留死条目、元数据重复 id 都会失败。
 *
 * 说明：本文件只 import 纯数据模块（shortcuts.ts 与 ui-kit 的 settings/utils），
 * 不 import 任何 .vue，故不引入渲染依赖、几乎不增加测试耗时。
 */
import { describe, it, expect } from 'vitest'
import { BOARD_SHORTCUT_IDS, BOARD_SHORTCUT_META } from '../board/shortcuts'
import { SHORTCUT_CATALOG } from '@worldsea/ui-kit/components/settings/utils'

/** 白板快捷键的 id 前缀（目录里属于本芽的条目） */
const PREFIX = 'outline-board.'

describe('boardShortcuts / 元数据自身', () => {
  it('id 唯一且都以 outline-board. 前缀命名', () => {
    const ids = BOARD_SHORTCUT_META.map(m => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith(PREFIX)).toBe(true)
  })

  it('每条都有键位与非空描述', () => {
    for (const m of BOARD_SHORTCUT_META) {
      expect(m.keys.length, `${m.id} 无键位`).toBeGreaterThan(0)
      expect(m.description.trim().length, `${m.id} 描述为空`).toBeGreaterThan(0)
    }
  })

  it('BOARD_SHORTCUT_IDS 与元数据表同源（注销用）', () => {
    expect(BOARD_SHORTCUT_IDS).toEqual(BOARD_SHORTCUT_META.map(m => m.id))
  })

  it('键位写法符合 normalizeKeys 的归一规则：Shift+数字应写单键符号', () => {
    // 反例守卫：写 ['shift','1'] 永不匹配（非字母可打印字符不叠加 shift 修饰）
    for (const m of BOARD_SHORTCUT_META) {
      const hasShiftPlusPrintable = m.keys.includes('shift')
        && m.keys.some(k => k.length === 1 && !/[a-z]/i.test(k))
      expect(hasShiftPlusPrintable, `${m.id} 的组合键写法与 normalizeKeys 不符`).toBe(false)
    }
  })
})

describe('boardShortcuts / 与设置面板目录一致（防漂移）', () => {
  const catalogBoardIds = SHORTCUT_CATALOG
    .filter(s => s.id.startsWith(PREFIX))
    .map(s => s.id)

  it('注册处有的条目，目录里必须有（否则设置面板看不到）', () => {
    for (const id of BOARD_SHORTCUT_IDS) {
      expect(catalogBoardIds, `目录缺少 ${id}`).toContain(id)
    }
  })

  it('目录里不能有注册处没有的死条目', () => {
    for (const id of catalogBoardIds) {
      expect(BOARD_SHORTCUT_IDS, `目录存在死条目 ${id}`).toContain(id)
    }
  })

  it('目录条目的键位与描述必须与元数据一致', () => {
    for (const meta of BOARD_SHORTCUT_META) {
      const item = SHORTCUT_CATALOG.find(s => s.id === meta.id)
      expect(item, `目录缺少 ${meta.id}`).toBeTruthy()
      expect(item?.keys, `${meta.id} 键位不一致`).toEqual(meta.keys)
      expect(item?.description, `${meta.id} 描述不一致`).toBe(meta.description)
      expect(item?.scope, `${meta.id} scope 应为 view`).toBe('view')
    }
  })

  it('旧大纲视图的死条目已清除（视图下线后无人注册）', () => {
    expect(SHORTCUT_CATALOG.some(s => s.id === 'outline.close-detail')).toBe(false)
  })
})
