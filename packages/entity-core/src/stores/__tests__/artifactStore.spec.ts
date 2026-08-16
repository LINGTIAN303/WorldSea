import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getProjectManager } from '../../core/ProjectManager'
import { useArtifactStore } from '../artifactStore'

describe('artifactStore — C1 多版本 + 回滚', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await getProjectManager().initialize()
  })

  it('create → 写入 artifact 与 version=1 快照', async () => {
    const store = useArtifactStore()
    const id = await store.create({ title: '世界观草稿', content: 'v1', artifact_type: 'document' })

    expect(id).toBeTruthy()
    expect(store.artifacts).toHaveLength(1)
    expect(store.artifacts[0].version).toBe(1)
    expect(store.artifacts[0].artifact_type).toBe('document')

    const versions = await store.getVersions(id)
    expect(versions).toHaveLength(1)
    expect(versions[0].version).toBe(1)
    expect(versions[0].content).toBe('v1')
  })

  it('update 内容变化 → 自动追加新版本', async () => {
    const store = useArtifactStore()
    const id = await store.create({ title: 't', content: 'v1' })

    await store.update(id, { content: 'v2' })

    expect(store.artifacts[0].version).toBe(2)
    expect(store.artifacts[0].content).toBe('v2')
    const versions = (await store.getVersions(id)).map(v => v.version)
    expect(versions).toEqual([2, 1])
  })

  it('update 仅改标题 → 不新增版本', async () => {
    const store = useArtifactStore()
    const id = await store.create({ title: 't', content: 'v1' })

    await store.update(id, { title: '新标题' })

    expect(store.artifacts[0].version).toBe(1)
    expect(store.artifacts[0].title).toBe('新标题')
    expect(await store.getVersions(id)).toHaveLength(1)
  })

  it('rollback 到旧版本 → 内容恢复并追加新版本（保留完整历史）', async () => {
    const store = useArtifactStore()
    const id = await store.create({ title: 't', content: 'v1' })
    await store.update(id, { content: 'v2' })

    await store.rollback(id, 1)

    expect(store.artifacts[0].content).toBe('v1')
    expect(store.artifacts[0].version).toBe(3)
    const versions = (await store.getVersions(id)).map(v => v.version)
    expect(versions).toEqual([3, 2, 1])
  })

  it('remove → 删除 artifact 及其全部版本', async () => {
    const store = useArtifactStore()
    const id = await store.create({ title: 't', content: 'v1' })
    await store.update(id, { content: 'v2' })

    await store.remove(id)

    expect(store.artifacts).toHaveLength(0)
    expect(await store.getVersions(id)).toHaveLength(0)
  })
})