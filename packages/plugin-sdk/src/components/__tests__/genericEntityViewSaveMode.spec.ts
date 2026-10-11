/**
 * GEV 表单保存模式回归测试（「角色模板创建静默失败」修复）
 *
 * 历史缺陷：`openFormWithDefaults(defaults)` 造的是 `id: ''` 的预填假实体，
 * 而 `onFormSave` 按「editingEntity 是否非空」判编辑——空 id 被送进更新分支去
 * `entityStore.update('')`，既不记 undo 也命不中任何实体 ⇒ 表单关掉但实体根本不落地，
 * 连「已创建」提示都不弹（唯一调用者：CharacterList 的模板创建）。
 *
 * 锁定契约：预填新建走 add 且 id 由本人生成；**弹窗不再承担编辑存量实体**（裁定：编辑单轨归抽屉）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { useEntityStore } from '@worldsea/entity-core'

import GenericEntityView from '../GenericEntityView.vue'
import EntityFormModal from '../EntityFormModal.vue'

let pinia: Pinia
let wrapper: VueWrapper | undefined
const targets = ['view-toolbar-search', 'view-toolbar-filter-body', 'view-toolbar-actions', 'view-toolbar-create']

async function drain() {
  await new Promise(r => setTimeout(r, 0))
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  // GEV 的工具条控件经 Teleport 注入 R3 落点，jsdom 里先把四个落点挂上
  for (const id of targets) {
    const el = document.createElement('div')
    el.id = id
    document.body.appendChild(el)
  }
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  for (const id of targets) document.getElementById(id)?.remove()
})

/** script setup + defineExpose 的暴露面在 wrapper.vm 上（test-utils 已代理） */
function openPrefill(w: VueWrapper, defaults?: Record<string, unknown>) {
  ;(w.vm as unknown as { openFormWithDefaults(d?: Record<string, unknown>): void }).openFormWithDefaults(defaults)
}

function mountView() {
  wrapper = mount(GenericEntityView, {
    props: { entityType: 'concept', formFields: [] },
    global: { plugins: [pinia] },
    shallow: true,
  })
  return wrapper
}

function saveViaModal(data: Record<string, unknown>) {
  const modal = wrapper!.findComponent(EntityFormModal)
  modal.vm.$emit('save', { name: '模板角色', description: '', properties: {}, tags: [], ...data })
}

describe('GEV onFormSave —— 预填新建必须落库', () => {
  it('openFormWithDefaults(带默认值) 保存 → 走 add，不走 update', async () => {
    const store = useEntityStore()
    const add = vi.spyOn(store, 'add').mockImplementation(async () => {})
    const update = vi.spyOn(store, 'update').mockImplementation(async () => {})

    openPrefill(mountView(), { role: '主角' })
    saveViaModal({ name: '阿黎', properties: { role: '主角' } })
    await drain()

    expect(update).not.toHaveBeenCalled()
    expect(add).toHaveBeenCalledTimes(1)
    const payload = add.mock.calls[0][0] as unknown as { id: string; name: string; type: string }
    expect(payload.id).toBeTruthy()
    expect(payload.name).toBe('阿黎')
    expect(payload.type).toBe('concept')
  })

  it('openFormWithDefaults() 不带值（等同新建）也走 add', async () => {
    const store = useEntityStore()
    const add = vi.spyOn(store, 'add').mockImplementation(async () => {})

    openPrefill(mountView())
    saveViaModal({ name: '空白新建' })
    await drain()

    expect(add).toHaveBeenCalledTimes(1)
  })

  it('空名保存不落地（查重取消时不应产生实体）', async () => {
    const store = useEntityStore()
    const add = vi.spyOn(store, 'add').mockImplementation(async () => {})
    vi.spyOn(store, 'update').mockImplementation(async () => {})

    openPrefill(mountView(), {})
    saveViaModal({ name: '' })
    await drain()

    expect(add).not.toHaveBeenCalled()
  })
})
