import { describe, expect, it } from 'vitest'
import {
  ICON_ASSET_LIMITS,
  base64ToBytes,
  bytesToBase64,
  customIconId,
  customIconValue,
  iconDisplayName,
  isCustomIconValue,
  isSafeIconAssetId,
  validateIconAsset,
} from '../customIcons'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>')

describe('customIcons', () => {
  it('custom: 值助手只认带 id 的前缀', () => {
    expect(customIconValue('abc')).toBe('custom:abc')
    expect(isCustomIconValue('custom:abc')).toBe(true)
    expect(isCustomIconValue('custom:')).toBe(false)
    expect(isCustomIconValue('user')).toBe(false)
    expect(customIconId('custom:abc')).toBe('abc')
    expect(customIconId('user')).toBeNull()
  })

  it('展示名去扩展名、压空白、限长', () => {
    expect(iconDisplayName('  我的  图标.svg')).toBe('我的 图标')
    expect(iconDisplayName('.png')).toBe('自定义图标')
    expect(iconDisplayName(`${'a'.repeat(80)}.png`)).toHaveLength(40)
  })

  it('SVG / PNG / WebP 魔数通过，错误头被拒', () => {
    expect(validateIconAsset('a.svg', SVG).ok).toBe(true)
    expect(validateIconAsset('a.png', PNG).ok).toBe(true)
    expect(validateIconAsset('a.webp', WEBP).ok).toBe(true)
    expect(validateIconAsset('a.png', SVG)).toMatchObject({ ok: false })
    expect(validateIconAsset('a.webp', PNG)).toMatchObject({ ok: false })
  })

  it('SVG 拒绝 DOCTYPE / script / 非 SVG 文本', () => {
    expect(validateIconAsset('a.svg', new TextEncoder().encode('<!DOCTYPE svg><svg></svg>')).ok).toBe(false)
    expect(validateIconAsset('a.svg', new TextEncoder().encode('<svg><script>alert(1)</script></svg>')).ok).toBe(false)
    expect(validateIconAsset('a.svg', new TextEncoder().encode('not svg')).ok).toBe(false)
  })

  it('扩展名白名单与体积上限', () => {
    expect(validateIconAsset('a.gif', PNG).ok).toBe(false)
    expect(validateIconAsset('a.svg', new Uint8Array(ICON_ASSET_LIMITS.svg + 1)).ok).toBe(false)
    expect(validateIconAsset('a.png', new Uint8Array(ICON_ASSET_LIMITS.png + 1)).ok).toBe(false)
  })

  it('资产 id 只允许安全字符，拒绝路径穿越', () => {
    expect(isSafeIconAssetId('a1-b2_c3')).toBe(true)
    expect(isSafeIconAssetId('../evil')).toBe(false)
    expect(isSafeIconAssetId('a/b')).toBe(false)
    expect(isSafeIconAssetId('')).toBe(false)
  })

  it('base64 往返', () => {
    expect([...base64ToBytes(bytesToBase64(SVG))!]).toEqual([...SVG])
    expect(base64ToBytes('***')).toBeNull()
  })
})
