/**
 * worldview 工具契约测试（2026-09-21 芽工具整合 · 批 1）
 *
 * 覆盖：芽名清单（随登记动态）/ 改名跟随 / 解析三形态 / 说明渲染（含动作目录）/
 * 无动作芽兜底 / 错误契约（fail loud）/ 动作路由 / 旧域工具薄壳转发 / 说明中性守卫。
 *
 * 零漂移轮（2026-09-21）追加：实体字段段（自运行时 schema 生成）/ 无 schema 不输出 /
 * guides 不内嵌字段清单守卫。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { entitySchemaRegistry } from '@worldsea/entity-core'
import type { IToolContext } from '../../toolbus/types'
import {
  worldviewTool,
  registerWorldviewSprout,
  clearWorldviewSprouts,
  resolveWorldviewSprout,
  renderSproutGuide,
  SPROUT_ACTIONS,
  SPROUT_GUIDES,
} from '../worldview'

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
    expect(text).toContain('大纲节点与叙事结构的维护')
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

describe('说明中性守卫（无引导词）', () => {
  it('全部芽的使用方法不含 建议/推荐/优先/首选/应该/务必/最好', () => {
    const banned = ['建议', '推荐', '优先', '首选', '应该', '务必', '最好']
    // 覆盖范围：有说明的芽（guides）+ 有动作的芽（actions）的并集——批 2 后为全部 27 芽
    const allSproutIds = new Set([...Object.keys(SPROUT_GUIDES), ...Object.keys(SPROUT_ACTIONS)])
    expect(allSproutIds.size).toBeGreaterThanOrEqual(27)
    for (const sproutId of allSproutIds) {
      const text = renderSproutGuide({ id: sproutId, name: sproutId, description: '' })
      for (const word of banned) {
        expect(text.includes(word), `${sproutId} 的说明含引导词「${word}」`).toBe(false)
      }
    }
  })

  it('全部 27 芽均有说明数据（guides 覆盖）', () => {
    expect(Object.keys(SPROUT_GUIDES)).toHaveLength(27)
  })
})

describe('实体字段（运行时 schema 生成，零漂移）', () => {
  afterEach(() => {
    entitySchemaRegistry.unregister('region')
  })

  it('芽有注册实体类型时：说明自动带出字段 / 取值 / 必填 / 关联', async () => {
    entitySchemaRegistry.register({
      typeKey: 'region',
      label: '区域',
      pluginId: 'official.regions',
      fields: [
        { key: 'climate', label: '气候', fieldType: 'text' },
        {
          key: 'terrainType',
          label: '地形',
          fieldType: 'select',
          options: [
            { value: 'mountain', label: '山地' },
            { value: 'plain', label: '平原' },
          ],
        },
        { key: 'capital', label: '首府', fieldType: 'entity-ref', refType: 'building', required: true },
      ],
    })
    const text = await worldviewTool.execute({ sprout: '区域图谱' }, fakeCtx)
    expect(text).toContain('## 实体字段（运行时）')
    expect(text).toContain('- **region**（区域）')
    expect(text).toContain('climate（气候，text）')
    expect(text).toContain('terrainType（地形，select，取值：山地 / 平原）')
    expect(text).toContain('capital（首府，entity-ref，必填，关联：building）')
  })

  it('芽未注册实体类型：不输出字段段（静默省略）', async () => {
    const text = await worldviewTool.execute({ sprout: '大纲' }, fakeCtx)
    expect(text).not.toContain('## 实体字段')
  })
})

describe('零漂移守卫：guides 不内嵌字段清单', () => {
  it('除 module-builder 例外外，全部 guides 不含「——字段：」', () => {
    // module-builder 例外：custom_module 无运行时实体类型注册（字段说明保留手写）
    for (const [id, guide] of Object.entries(SPROUT_GUIDES)) {
      if (id === 'official.module-builder') continue
      expect(guide.overview.includes('——字段：'), `${id} 仍内嵌字段清单`).toBe(false)
    }
  })
})

describe('工具描述：发现路径（2026-09-21 A+C 轮）', () => {
  it('描述含用户域词汇与用法语义（「某领域怎么用」可语义命中）', () => {
    const desc = worldviewTool.description
    expect(desc).toContain('使用方法')
    // 工具列表里扫到「道具」「实体字段」这类词 → 命中「道具实体怎么用」类问法
    expect(desc).toContain('道具')
    expect(desc).toContain('实体字段')
    expect(worldviewTool.parameters.sprout.description).toContain('道具')
  })

  it('描述不写死领域清单（示例 + 以运行时返回为准）', () => {
    expect(worldviewTool.description).toContain('示例')
    expect(worldviewTool.description).toContain('以不带参数的调用返回为准')
  })

  it('描述与参数说明不含引导词（与芽说明同口径）', () => {
    const banned = ['建议', '推荐', '优先', '首选', '应该', '务必', '最好']
    const texts = [
      worldviewTool.description,
      ...Object.values(worldviewTool.parameters).map(p => p.description),
    ]
    for (const text of texts) {
      for (const word of banned) {
        expect(text.includes(word), `工具描述含引导词「${word}」：${text}`).toBe(false)
      }
    }
  })
})
