/**
 * 「思维导图」插件（C 批）：迁移后的三件事各有一处守卫——
 * ① 清单合法且身份 = `official.mindmap`（与其余芽同口径，进芽面板启停）；② 视图注册走作用域（pluginId 正确）；
 * ③ 5 条 `world.mindmap.*` 能力声明形状 + list/create/read 在 localStorage 回退下的真跑通；
 * ④ 清理：拆树后视图消失（能力撤登记在无壳桥环境为本地移除，真机另证）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { pluginAPI } from '@worldsea/entity-core'
import { validateManifest } from '../manifest'
import { runPluginCleanups } from '../registry'
import { createPluginApi } from '../api'
import mindmapPlugin from '../plugins/mindmap'
import { WORLD_MINDMAP_CAPABILITIES } from '../plugins/mindmap/capabilities'

afterEach(() => {
  runPluginCleanups('official.mindmap')
  pluginAPI.clearViews()
  localStorage.clear()
})

describe('mindmap 插件（official.mindmap）', () => {
  it('清单合法、身份为 official.mindmap（与官方芽清单同键，供芽面板启停）', () => {
    const check = validateManifest(mindmapPlugin.manifest)
    expect(check.ok).toBe(true)
    expect(mindmapPlugin.manifest.id).toBe('official.mindmap')
    expect(mindmapPlugin.manifest.description.length).toBeGreaterThan(0)
  })

  it('apply 后视图入真源，pluginId 恒为 official.mindmap（作用域原语）', () => {
    pluginAPI.setPluginId('official.characters') // 模拟全局值被官方芽污染
    mindmapPlugin.apply({} as never, createPluginApi('official.mindmap'))
    const view = pluginAPI.getViews().find(v => v.id === 'mindmap')
    expect(view?.pluginId).toBe('official.mindmap')
    expect(pluginAPI.getPluginId()).toBe('official.characters') // 调用后不污染全局
  })

  it('5 条能力声明：world.mindmap.* / acl=[main] / 参数形状', () => {
    const ids = WORLD_MINDMAP_CAPABILITIES.map(c => c.id)
    expect(ids).toEqual([
      'world.mindmap.list',
      'world.mindmap.read',
      'world.mindmap.create',
      'world.mindmap.append',
      'world.mindmap.write',
    ])
    for (const capability of WORLD_MINDMAP_CAPABILITIES) {
      expect(capability.acl).toEqual(['main'])
      expect(capability.summary.length).toBeGreaterThan(0)
    }
    const byId = new Map(WORLD_MINDMAP_CAPABILITIES.map(c => [c.id, c]))
    expect(byId.get('world.mindmap.list')?.params ?? []).toEqual([])
    for (const id of ['world.mindmap.read', 'world.mindmap.create', 'world.mindmap.append', 'world.mindmap.write']) {
      expect(byId.get(id)?.params?.length, `${id} 应有参数声明`).toBeGreaterThan(0)
    }
  })

  it('能力真跑：create → list → read 走通（localStorage 回退路径）', async () => {
    const byId = new Map(WORLD_MINDMAP_CAPABILITIES.map(c => [c.id, c]))
    const created = (await byId.get('world.mindmap.create')!.handler({
      name: '测试导图',
      markdown: '# 中心\n- 分支一\n  - 子项\n- 分支二',
    })) as { ok: boolean; id?: string }
    expect(created.ok).toBe(true)

    const listed = (await byId.get('world.mindmap.list')!.handler({})) as { ok: boolean; docs: Array<{ id: string; name: string }> }
    expect(listed.docs.map(d => d.name)).toContain('测试导图')

    const read = (await byId.get('world.mindmap.read')!.handler({ id: created.id })) as { ok: boolean; markdown?: string }
    expect(read.ok).toBe(true)
    expect(read.markdown).toContain('分支一')
  })

  it('清理：拆树后视图自真源消失', () => {
    mindmapPlugin.apply({} as never, createPluginApi('official.mindmap'))
    expect(pluginAPI.getViews().some(v => v.id === 'mindmap')).toBe(true)

    runPluginCleanups('official.mindmap')

    expect(pluginAPI.getViews().some(v => v.id === 'mindmap')).toBe(false)
  })
})
