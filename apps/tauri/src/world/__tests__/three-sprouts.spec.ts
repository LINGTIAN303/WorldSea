/**
 * 三芽批（图库 / 设定集 / 生物图鉴）：manifest 声明、apply 登记语义、关系注册——
 * 模式对齐 batch3/batch5-plugins.spec。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  entitySchemaRegistryV2,
  pluginAPI,
  relationshipRegistry,
} from '@worldsea/entity-core'

import { manifest as galleryManifest, apply as galleryApply } from '../plugins/gallery'
import { manifest as codexManifest, apply as codexApply } from '../plugins/codex'
import { manifest as creaturesManifest, apply as creaturesApply } from '../plugins/creatures'
import { createPluginApi } from '../api'
import { runPluginCleanups } from '../registry'

afterEach(() => {
  for (const id of ['official.gallery', 'official.codex', 'official.creatures']) {
    runPluginCleanups(id)
  }
})

describe('三芽 manifest 声明', () => {
  it('图库：tool 域纯视图（entityTypes 显式空）', () => {
    expect(galleryManifest.id).toBe('official.gallery')
    expect(galleryManifest.domain).toBe('tool')
    expect(galleryManifest.kind).toBe('sprout')
    expect(galleryManifest.entityTypes).toEqual([])
  })

  it('设定集：tool 主域 + knowledge 副域纯视图', () => {
    expect(codexManifest.id).toBe('official.codex')
    expect(codexManifest.domain).toBe('tool')
    expect(codexManifest.secondaryDomains).toEqual(['knowledge'])
    expect(codexManifest.entityTypes).toEqual([])
  })

  it('生物图鉴：life 主域 + goods 副域，声明与注册一致', () => {
    expect(creaturesManifest.id).toBe('official.creatures')
    expect(creaturesManifest.domain).toBe('life')
    expect(creaturesManifest.secondaryDomains).toEqual(['goods'])
    expect(creaturesManifest.entityTypes).toEqual(['creature'])
  })
})

describe('三芽 apply 登记', () => {
  it('图库 / 设定集各登记一个视图，pluginId 锁定', () => {
    galleryApply(undefined, createPluginApi('official.gallery'))
    codexApply(undefined, createPluginApi('official.codex'))
    const views = pluginAPI.getViews()
    const gallery = views.find(v => v.id === 'gallery')
    const codex = views.find(v => v.id === 'codex')
    expect(gallery?.pluginId).toBe('official.gallery')
    expect(gallery?.icon).toBe('image')
    expect(codex?.pluginId).toBe('official.codex')
    expect(codex?.icon).toBe('book-open')
  })

  it('生物图鉴登记 creature 类型（trait + ownFields 编译）与视图', () => {
    creaturesApply(undefined, createPluginApi('official.creatures'))
    const schema = entitySchemaRegistryV2.get('creature')
    expect(schema).toBeTruthy()
    expect(schema!.label).toBe('生物')
    expect(schema!.ownFields.map(f => f.key)).toEqual([
      'creatureType', 'dangerLevel', 'diet', 'size', 'temperament', 'habitat', 'abilities', 'weakness', 'yield',
    ])
    // trait 字段合并后包含 physical 的外观系字段（label 已覆写）
    const appearance = schema!._compiledFields?.find(f => f.key === 'appearance')
    expect(appearance?.label).toBe('外观')
    const view = pluginAPI.getViews().find(v => v.id === 'creatures')
    expect(view?.pluginId).toBe('official.creatures')
    expect(view?.icon).toBe('paw')
  })

  it('清理函数撤视图（卸载语义）', () => {
    galleryApply(undefined, createPluginApi('official.gallery'))
    runPluginCleanups('official.gallery')
    expect(pluginAPI.getViews().find(v => v.id === 'gallery')).toBeUndefined()
  })
})

describe('生物图鉴关系类型', () => {
  it('四条新关系注册且逆类型成对', () => {
    const cases = [
      { type: 'inhabits', inverse: 'habitat_of', target: 'region' },
      { type: 'drops', inverse: 'dropped_by', target: 'item' },
      { type: 'hunts', inverse: 'hunted_by', target: 'creature' },
      { type: 'tames', inverse: 'tamed_by', target: 'creature' },
    ] as const
    for (const item of cases) {
      const schema = relationshipRegistry.get(item.type)
      expect(schema, item.type).toBeTruthy()
      expect(schema!.inverseType).toBe(item.inverse)
      expect(schema!.targetTypes).toContain(item.target)
    }
    // belongs_to 源端已扩展 creature（生物→种族/组织）
    expect(relationshipRegistry.get('belongs_to')!.sourceTypes).toContain('creature')
  })
})
