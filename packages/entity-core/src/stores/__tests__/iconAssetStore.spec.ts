import { describe, expect, it } from 'vitest'
import { pickNewerIconAssetState, sanitizeIconAssets, type IconAssetState } from '../iconAssetStore'

describe('sanitizeIconAssets', () => {
  it('过滤非法项、去重、归一扩展名与展示名', () => {
    const assets = sanitizeIconAssets([
      { id: 'a', name: '  我的图标  ', ext: 'svg', bytes: 10, createdAt: 1 },
      { id: 'a', name: '重复', ext: 'png', bytes: 20, createdAt: 2 },
      { id: '', name: '缺 id', ext: 'png' },
      { id: '../evil', name: '路径穿越', ext: 'png' },
      { id: 'b', name: '', ext: 'gif' },
      { id: 'c', ext: 'webp' },
      null,
    ])
    expect(assets).toHaveLength(2)
    expect(assets[0]).toMatchObject({ id: 'a', name: '我的图标', ext: 'svg', bytes: 10 })
    expect(assets[1]).toMatchObject({ id: 'c', name: '自定义图标', ext: 'webp', bytes: 0 })
  })
})

describe('pickNewerIconAssetState', () => {
  const older: IconAssetState = { version: 1, assets: [], updatedAt: 1 }
  const newer: IconAssetState = { version: 1, assets: [], updatedAt: 2 }

  it('取 updatedAt 较新者；缺失回退另一侧', () => {
    expect(pickNewerIconAssetState(older, newer)).toBe(newer)
    expect(pickNewerIconAssetState(newer, older)).toBe(newer)
    expect(pickNewerIconAssetState(null, older)).toBe(older)
    expect(pickNewerIconAssetState(older, null)).toBe(older)
    expect(pickNewerIconAssetState(null, null)).toBeNull()
  })
})
