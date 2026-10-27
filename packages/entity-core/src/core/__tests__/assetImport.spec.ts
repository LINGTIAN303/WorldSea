// assetImport 纯函数守卫（2026-10-25 形象图批 A）：类别判定与上限表是上传链路的
// 准入门禁；IO 函数（dialog/copy/write）依赖 Tauri 运行时，不在 jsdom 覆盖，靠真机走查。
import { describe, it, expect } from 'vitest'
import {
  detectAssetKind,
  ASSET_KIND_EXTS,
  ASSET_KIND_LIMITS,
  FILE_LINK_MAX_BYTES,
  selectProjectAssets,
  type AssetDirEntry,
} from '../assetImport'

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

describe('selectProjectAssets —— 资产库列举（F1）', () => {
  const entries: AssetDirEntry[] = [
    { name: 'animated_1700000000000_ab.gif', path: 'D:/w/assets/a.gif', isDir: false, size: 100, modified: '1700000000000' },
    { name: 'static_1700000001000_cd.png', path: 'D:/w/assets/b.png', isDir: false, size: 200, modified: '1700000001000' },
    { name: 'model_1700000002000_ef.glb', path: 'D:/w/assets/c.glb', isDir: false, size: 300, modified: '1700000002000' },
    { name: 'lottie_1700000003000_gh.json', path: 'D:/w/assets/d.json', isDir: false, size: 400, modified: '1700000003000' },
    { name: 'video_1700000004000_ij.mp4', path: 'D:/w/assets/e.mp4', isDir: false, size: 500, modified: '1700000004000' },
    { name: 'notes.txt', path: 'D:/w/assets/notes.txt', isDir: false, size: 10, modified: '1700000005000' },
    { name: 'assets', path: 'D:/w/assets/sub', isDir: true, size: 0, modified: '1700000006000' },
    { name: 'legacy.glb', path: 'D:/w/assets/legacy.glb', isDir: false, size: 600 },
  ]

  it('按请求类别取并集：形象四类都列出，视频/无关文件/目录剔除', () => {
    const list = selectProjectAssets(entries, ['static', 'animated', 'lottie', 'model'])
    expect(list.map((a) => a.name)).toEqual([
      'lottie_1700000003000_gh.json',
      'model_1700000002000_ef.glb',
      'static_1700000001000_cd.png',
      'animated_1700000000000_ab.gif',
      'legacy.glb',
    ])
  })

  it('文件名前缀优先于扩展名判定（animated_*.webp 仍归动图）', () => {
    const list = selectProjectAssets(
      [{ name: 'animated_1_x.webp', path: 'D:/w/assets/x.webp', isDir: false, size: 1, modified: '1' }],
      ['static', 'animated'],
    )
    expect(list[0]?.kind).toBe('animated')
  })

  it('无前缀的存量文件按扩展名兜底', () => {
    const legacy = selectProjectAssets(entries, ['model']).find((a) => a.name === 'legacy.glb')
    expect(legacy?.kind).toBe('model')
  })

  it('原形链上的名字不算类别前缀（constructor_*.png → 按扩展名判静态）', () => {
    const list = selectProjectAssets(
      [{ name: 'constructor_1_x.png', path: 'D:/w/assets/x.png', isDir: false, size: 1, modified: '1' }],
      ['static'],
    )
    expect(list[0]?.kind).toBe('static')
  })

  it('只请求视频时返回视频', () => {
    const list = selectProjectAssets(entries, ['video'])
    expect(list.map((a) => a.name)).toEqual(['video_1700000004000_ij.mp4'])
  })

  it('modified 转数值并降序，缺失排最后', () => {
    const list = selectProjectAssets(entries, ['static', 'animated', 'lottie', 'model'])
    expect(list[0]?.modified).toBe(1700000003000)
    expect(list.at(-1)?.modified).toBeUndefined()
  })

  it('空目录 → 空数组', () => {
    expect(selectProjectAssets([], ['static'])).toEqual([])
  })
})
