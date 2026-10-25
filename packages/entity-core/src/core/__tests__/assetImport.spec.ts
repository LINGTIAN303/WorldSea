// assetImport 纯函数守卫（2026-10-25 形象图批 A）：类别判定与上限表是上传链路的
// 准入门禁；IO 函数（dialog/copy/write）依赖 Tauri 运行时，不在 jsdom 覆盖，靠真机走查。
import { describe, it, expect } from 'vitest'
import { detectAssetKind, ASSET_KIND_EXTS, ASSET_KIND_LIMITS, FILE_LINK_MAX_BYTES } from '../assetImport'

describe('detectAssetKind —— 扩展名 → 类别', () => {
  it.each([
    ['hero.png', 'static'],
    ['hero.JPG', 'static'],
    ['photo.webp', 'static'], // 动图 WebP 同扩展归 static，UI 可改判
    ['dance.gif', 'animated'], // gif 必动图，优先于图像表
    ['anim.json', 'lottie'],
    ['char.glb', 'model'],
    ['char.GLTF', 'model'],
    ['intro.mp4', 'video'],
    ['clip.webm', 'video'],
  ])('%s → %s', (name, kind) => {
    expect(detectAssetKind(name)).toBe(kind)
  })

  it('不认识的扩展名 → null（拒收）', () => {
    expect(detectAssetKind('virus.exe')).toBeNull()
    expect(detectAssetKind('noext')).toBeNull()
  })
})

describe('上限表一致性', () => {
  it('每类别都有扩展名表与上限', () => {
    for (const kind of ['static', 'animated', 'lottie', 'model', 'video'] as const) {
      expect(ASSET_KIND_EXTS[kind].length).toBeGreaterThan(0)
      expect(ASSET_KIND_LIMITS[kind]).toBeGreaterThan(0)
    }
  })

  it('模型/视频上限高于 File 链路硬上限（超 30MB 必须走对话框直传）', () => {
    expect(ASSET_KIND_LIMITS.model).toBeGreaterThan(FILE_LINK_MAX_BYTES)
    expect(ASSET_KIND_LIMITS.video).toBeGreaterThan(FILE_LINK_MAX_BYTES)
  })
})
