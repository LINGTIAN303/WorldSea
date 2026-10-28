import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = {
  imported: [] as unknown[],
  collectExportAssets: vi.fn(),
  importExportAssets: vi.fn(),
}
const overrides = {
  state: { version: 1, followGlobal: true, overrides: {}, updatedAt: 0 },
  replaceProjectState: vi.fn(),
}

vi.mock('../../stores/iconAssetStore', () => ({
  useIconAssetStore: () => store,
}))
vi.mock('../../stores/iconOverrideStore', () => ({
  useIconOverrideStore: () => ({
    exportProjectState: () => overrides.state,
    replaceProjectState: (next: unknown) => overrides.replaceProjectState(next),
  }),
}))

import { iconAssetsSerializer } from '../serializers/IconAssetsSerializer'

beforeEach(() => {
  store.collectExportAssets.mockReset()
  store.importExportAssets.mockReset()
  overrides.replaceProjectState.mockReset()
})

describe('iconAssetsSerializer', () => {
  it('collect 带资产 base64 与项目覆盖状态', async () => {
    store.collectExportAssets.mockResolvedValue([{ id: 'a', name: '徽章', ext: 'svg', bytes: 4, createdAt: 1, data: 'c3Zn' }])
    expect(await iconAssetsSerializer.collect()).toMatchObject({
      total: 1,
      assets: [{ id: 'a', data: 'c3Zn' }],
      project: { followGlobal: true },
    })
  })

  it('import 先写资产再恢复覆盖，并返回报告', async () => {
    store.importExportAssets.mockResolvedValue({ imported: 1, skipped: 0 })
    const report = await iconAssetsSerializer.import({
      assets: [{ id: 'a', name: '徽章', ext: 'svg', bytes: 4, data: 'c3Zn' }],
      project: { followGlobal: false, overrides: { 'sprout:x': 'custom:a' } },
    }, 'overwrite')
    expect(store.importExportAssets).toHaveBeenCalledWith(expect.any(Array), 'overwrite')
    expect(overrides.replaceProjectState).toHaveBeenCalledWith({ followGlobal: false, overrides: { 'sprout:x': 'custom:a' } })
    expect(report).toMatchObject({ serializerId: 'icon-assets', total: 1, added: 1, skipped: 0 })
  })
})
