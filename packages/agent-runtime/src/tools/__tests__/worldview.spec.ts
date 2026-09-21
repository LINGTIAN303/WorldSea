/**
 * worldview 工具契约测试（2026-09-21 芽工具整合 · 批 1）
 *
 * 覆盖：芽名清单（随登记动态）/ 改名跟随 / 解析三形态 / 说明渲染（含动作目录）/
 * 无动作芽兜底 / 错误契约（fail loud）/ 动作路由 / 旧域工具薄壳转发 / 说明中性守卫。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { IToolContext } from '../../toolbus/types'
import {
  worldviewTool,
  registerWorldviewSprout,
  clearWorldviewSprouts,
  resolveWorldviewSprout,
  renderSproutGuide,
  SPROUT_ACTIONS,
} from '../worldview'
import { PLUGIN_BACKEND_TOOLS } from '../plugin-backend-tools'

const fakeCtx = {} as unknown as IToolContext

function registerSampleSprouts(): void {
  registerWorldviewSprout({ id: 'official.outline', name: '大纲', description: '大纲管理与章节规划' })
  registerWorldviewSprout({ id: 'official.timeline', name: '时间线', description: '时间线与事件管理' })
  registerWorldviewSprout({ id: 'official.regions', name: '区域图谱', description: '区域实体管理' })
}

beforeEach(() => {
  clearWorldviewSprouts()
  registerSampleSprouts()
})

describe('worldview：芽名清单（渐进披露第一级）', () => {
  it('不传 sprout：返回全部已登记芽（名字 + id + 定位）', async () => {
    const parsed = JSON.parse(await worldviewTool.execute({}, fakeCtx))
    expect(parsed.ok).toBe(true)
    expect(parsed.count).toBe(3)
    expect(parsed.sprouts.map((s: { sprout: string }) => s.sprout)).toEqual(['大纲', '时间线', '区域图谱'])
    expect(parsed.sprouts[0].id).toBe('official.outline')
    expect(parsed.sprouts[0].summary).toBe('大纲管理与章节规划')
  })

  it('改芽名 → 清单与解析自动跟随（「随已有芽的注册」）', async () => {
    registerWorldviewSprout({ id: 'official.outline', name: '叙事结构', description: '大纲管理与章节规划' })
    const parsed = JSON.parse(await worldviewTool.execute({}, fakeCtx))
    expect(parsed.sprouts[0].sprout).toBe('叙事结构')
    expect(resolveWorldviewSprout('大纲')).toBeUndefined()
    expect(resolveWorldviewSprout('叙事结构')?.id).toBe('official.outline')
  })

  it('解析支持 芽名 / 短 id / 完整 id 三形态', () => {
    expect(resolveWorldviewSprout('大纲')?.id).toBe('official.outline')
    expect(resolveWorldviewSprout('outline')?.id).toBe('official.outline')
    expect(resolveWorldviewSprout('official.outline')?.id).toBe('official.outline')
  })
})

describe('worldview：使用方法（渐进披露第二级）', () => {
  it('传 sprout：返回概述 + 动作目录 + 执行方式', async () => {
    const text = await worldviewTool.execute({ sprout: '大纲' }, fakeCtx)
    expect(text).toContain('# 大纲（official.outline）')
    expect(text).toContain('大纲管理与章节规划')
    expect(text).toContain('## 动作')
    expect(text).toContain('**create_node**')
    expect(text).toContain("执行方式：worldview(sprout='大纲'")
  })

  it('动作目录含参数说明（必填标注）', async () => {
    const text = await worldviewTool.execute({ sprout: '大纲' }, fakeCtx)
    expect(text).toContain('title（必填）')
    expect(text).toContain('parentId：父节点 ID')
  })

  it('无专属动作的芽：兜底为「通用工具读写」说明', async () => {
    const text = await worldviewTool.execute({ sprout: '区域图谱' }, fakeCtx)
    expect(text).toContain('该芽无专属动作')
    expect(text).toContain('entity_list')
  })
})

describe('worldview：错误契约（fail loud）', () => {
  it('未知芽：ok:false + 可用芽名清单', async () => {
    const parsed = JSON.parse(await worldviewTool.execute({ sprout: '不存在的芽' }, fakeCtx))
    expect(parsed.ok).toBe(false)
    expect(parsed.available).toContain('大纲')
  })

  it('未知动作：ok:false + 该芽 availableActions', async () => {
    const parsed = JSON.parse(await worldviewTool.execute({ sprout: '大纲', action: 'no_such_action' }, fakeCtx))
    expect(parsed.ok).toBe(false)
    expect(parsed.availableActions).toContain('create_node')
  })
})

describe('worldview：动作执行（渐进披露第三级）', () => {
  it('路由到动作表 handler 且 params 透传', async () => {
    const table = SPROUT_ACTIONS['official.outline']
    const original = table.get_structure.run
    const spy = vi.fn(async (_args: Record<string, unknown>) => JSON.stringify({ ok: true, echoed: true }))
    table.get_structure.run = spy
    try {
      const raw = await worldviewTool.execute(
        { sprout: '大纲', action: 'get_structure', params: { foo: 1 } },
        fakeCtx,
      )
      expect(JSON.parse(raw).echoed).toBe(true)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toEqual({ foo: 1 })
    } finally {
      table.get_structure.run = original
    }
  })

  it('params 缺省时传空对象（不炸）', async () => {
    const table = SPROUT_ACTIONS['official.outline']
    const original = table.get_structure.run
    const spy = vi.fn(async (_args: Record<string, unknown>) => JSON.stringify({ ok: true }))
    table.get_structure.run = spy
    try {
      await worldviewTool.execute({ sprout: '大纲', action: 'get_structure' }, fakeCtx)
      expect(spy.mock.calls[0][0]).toEqual({})
    } finally {
      table.get_structure.run = original
    }
  })
})

describe('旧域工具薄壳（单一事实源转发）', () => {
  it('timeline 薄壳转发到动作表（args 原样透传）', async () => {
    const shell = PLUGIN_BACKEND_TOOLS.find(t => t.name === 'timeline')
    expect(shell).toBeDefined()
    const table = SPROUT_ACTIONS['official.timeline']
    const original = table.get_events.run
    const spy = vi.fn(async (_args: Record<string, unknown>) => JSON.stringify({ ok: true, from: 'actions' }))
    table.get_events.run = spy
    try {
      const raw = await shell!.execute({ action: 'get_events', limit: 5 }, fakeCtx)
      expect(JSON.parse(raw).from).toBe('actions')
      expect(spy.mock.calls[0][0]).toMatchObject({ action: 'get_events', limit: 5 })
    } finally {
      table.get_events.run = original
    }
  })

  it('entity_type 薄壳按实体类型路由到对应芽', async () => {
    const shell = PLUGIN_BACKEND_TOOLS.find(t => t.name === 'entity_type')
    expect(shell).toBeDefined()
    const table = SPROUT_ACTIONS['official.characters']
    const original = table.list.run
    const spy = vi.fn(async () => JSON.stringify({ ok: true, from: 'characters' }))
    table.list.run = spy
    try {
      const raw = await shell!.execute({ action: 'list', entity_type: 'character' }, fakeCtx)
      expect(JSON.parse(raw).from).toBe('characters')
    } finally {
      table.list.run = original
    }
  })

  it('entity_type 未知类型：fail loud', async () => {
    const shell = PLUGIN_BACKEND_TOOLS.find(t => t.name === 'entity_type')!
    const parsed = JSON.parse(await shell.execute({ action: 'list', entity_type: 'no_such' }, fakeCtx))
    expect(parsed.ok).toBe(false)
    expect(parsed.available).toContain('character')
  })
})

describe('说明中性守卫（无引导词）', () => {
  it('全部芽的使用方法不含 建议/推荐/优先/首选/应该/务必/最好', () => {
    const banned = ['建议', '推荐', '优先', '首选', '应该', '务必', '最好']
    for (const sproutId of Object.keys(SPROUT_ACTIONS)) {
      const text = renderSproutGuide({ id: sproutId, name: sproutId, description: '' })
      for (const word of banned) {
        expect(text.includes(word), `${sproutId} 的说明含引导词「${word}」`).toBe(false)
      }
    }
  })
})
