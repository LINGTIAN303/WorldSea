import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { CardDeck } from '@worldsea/ui-kit'
import { defaultHomeProfile } from '@/stores/homeProfileStore'

const save = vi.fn(async () => true)
const load = vi.fn(async () => {})
const profile = ref(defaultHomeProfile())
const storeError = ref<string | null>(null)
const currentProject = ref<{ id: string; name: string } | null>({ id: 'p1', name: '项目一' })
const writeImageAsset = vi.fn(async () => ({ ok: true, src: 'asset://cover.png' }))

vi.mock('@/stores/homeProfileStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/homeProfileStore')>()
  return {
    ...actual,
    useHomeProfileStore: () => ({
      get profile() { return profile.value },
      loading: false,
      saving: false,
      get error() { return storeError.value },
      get load() { return load },
      get save() { return save },
      reset: vi.fn(),
    }),
  }
})
vi.mock('@/composables/useProjectSwitcher', () => ({
  useProjectSwitcher: () => ({ currentProject }),
}))
vi.mock('@/composables/imageAssets', () => ({
  get writeImageAsset() { return writeImageAsset },
  ASSET_MAX_BYTES: 2 * 1024 * 1024,
}))

import HomePanel from '../HomePanel.vue'

/** 等 onMounted 里的 await store.load() 落地（fake timers 不影响微任务） */
async function settleLoad() {
  await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
  profile.value = defaultHomeProfile()
  storeError.value = null
  currentProject.value = { id: 'p1', name: '项目一' }
  save.mockClear()
  load.mockClear()
  writeImageAsset.mockClear()
})

// 面板持有 currentProject 侦听：测试间必须卸载，否则旧实例的 watcher 会跟着切项目重载
enableAutoUnmount(afterEach)

afterEach(() => {
  vi.useRealTimers()
})

describe('HomePanel', () => {
  it('渲染卡片；输入防抖后自动保存', async () => {
    const w = mount(HomePanel)
    await settleLoad()
    expect(w.find('.sc-head').text()).toContain('项目首页')
    await w.find('#home-tagline').setValue('新的简介')
    await vi.advanceTimersByTimeAsync(450)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ tagline: '新的简介' }))
  })

  it('上传封面写资产并保存', async () => {
    const w = mount(HomePanel)
    await settleLoad()
    const input = w.find('input[type=file]')
    const file = new File(['x'], 'cover.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await vi.advanceTimersByTimeAsync(0)
    expect(writeImageAsset).toHaveBeenCalledWith(file)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ coverImage: 'asset://cover.png' }))
  })

  it('移除封面保存空值；搜索模式平铺', async () => {
    profile.value = { ...defaultHomeProfile(), coverImage: 'asset://old.png' }
    const w = mount(HomePanel, { props: { searchQuery: '封面' } })
    await settleLoad()
    expect(w.find('.card-deck').classes()).toContain('card-deck--flat')
    const remove = w.findAll('button').find(b => b.text() === '移除封面')!
    await remove.trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ coverImage: '' }))
  })

  it('收到 ws-home-profile-changed 后重读并重灌草稿', async () => {
    const w = mount(HomePanel)
    await settleLoad()
    load.mockClear()
    profile.value = { ...defaultHomeProfile(), tagline: '导入后的简介' }
    window.dispatchEvent(new CustomEvent('ws-home-profile-changed'))
    await vi.waitFor(() => {
      expect(load).toHaveBeenCalled()
      expect((w.find('#home-tagline').element as HTMLInputElement).value).toBe('导入后的简介')
    })
  })

  it('载入完成前字段/封面按钮禁用且不保存；载入后解禁', async () => {
    let resolveLoad!: () => void
    load.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveLoad = resolve }))
    const w = mount(HomePanel)
    await settleLoad()

    const tagline = () => w.find('#home-tagline').element as HTMLInputElement
    const upload = w.findAll('button').find(b => b.text() === '上传封面')!
    expect(w.text()).toContain('正在载入…')
    expect(tagline().disabled).toBe(true)
    expect(upload.attributes('disabled')).toBeDefined()

    // 载入前的输入不排防抖计时器 → 不落盘
    await w.find('#home-tagline').setValue('载入前输入')
    await vi.advanceTimersByTimeAsync(450)
    expect(save).not.toHaveBeenCalled()

    resolveLoad()
    await settleLoad()
    expect(w.text()).not.toContain('正在载入…')
    expect(tagline().disabled).toBe(false)
    expect(upload.attributes('disabled')).toBeUndefined()

    await w.find('#home-tagline').setValue('载入后输入')
    await vi.advanceTimersByTimeAsync(450)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ tagline: '载入后输入' }))
  })

  it('载入后把 profile 灌入草稿，之后外部修改 profile 不覆盖当前输入', async () => {
    profile.value = { ...defaultHomeProfile(), tagline: '磁盘简介' }
    const w = mount(HomePanel)
    await settleLoad()
    expect((w.find('#home-tagline').element as HTMLInputElement).value).toBe('磁盘简介')

    await w.find('#home-tagline').setValue('正在输入')
    // 模拟保存成功后的外部回写（normalize 会 trim）：草稿不得被覆盖
    profile.value = { ...defaultHomeProfile(), tagline: '外部写入', about: '外部写入' }
    await nextTick()
    expect((w.find('#home-tagline').element as HTMLInputElement).value).toBe('正在输入')
    expect((w.find('#home-about').element as HTMLTextAreaElement).value).toBe('')
  })

  it('封面分组有可访问名称；状态行 aria-live 且空闲文案为已同步', async () => {
    const w = mount(HomePanel)
    await settleLoad()
    const cover = w.find('.hp-cover')
    expect(cover.attributes('role')).toBe('group')
    expect(cover.attributes('aria-labelledby')).toBe('home-cover-label')
    expect(w.find('#home-cover-label').text()).toBe('封面')
    const status = w.find('[aria-live="polite"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toBe('已同步')
  })

  it('载入未完成即卸载：不补刷保存', async () => {
    let resolveLoad!: () => void
    load.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveLoad = resolve }))
    const w = mount(HomePanel)
    await settleLoad()
    expect(w.text()).toContain('正在载入…')

    w.unmount()
    resolveLoad()
    await settleLoad()
    expect(save).not.toHaveBeenCalled()
  })

  it('保存失败：保留草稿并显示失败原因', async () => {
    save.mockImplementationOnce(async () => false)
    storeError.value = '磁盘只读'
    const w = mount(HomePanel)
    await settleLoad()
    await w.find('#home-tagline').setValue('写不进去')
    await vi.advanceTimersByTimeAsync(450)

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ tagline: '写不进去' }))
    expect((w.find('#home-tagline').element as HTMLInputElement).value).toBe('写不进去')
    const status = w.find('[aria-live="polite"]')
    expect(status.text()).toContain('保存失败')
    expect(status.text()).toContain('磁盘只读')
  })

  it('卡片切换透传 card-change', async () => {
    const w = mount(HomePanel)
    await settleLoad()
    w.findComponent(CardDeck).vm.$emit('change', 0)
    expect(w.emitted('card-change')?.[0]).toEqual([0])
  })

  it('切项目：作废旧项目未落盘的草稿，重载并重灌新项目 profile', async () => {
    profile.value = { ...defaultHomeProfile(), tagline: '项目一简介' }
    const w = mount(HomePanel)
    await settleLoad()
    const tagline = () => (w.find('#home-tagline').element as HTMLInputElement).value
    expect(tagline()).toBe('项目一简介')

    // 只敲字、没等到防抖落盘就切项目
    await w.find('#home-tagline').setValue('项目一草稿')
    profile.value = { ...defaultHomeProfile(), tagline: '项目二简介' }
    currentProject.value = { id: 'p2', name: '项目二' }
    await nextTick()
    await settleLoad()

    expect(load).toHaveBeenCalledTimes(2)
    expect(tagline()).toBe('项目二简介')
    await vi.advanceTimersByTimeAsync(450)
    expect(save).not.toHaveBeenCalled()
  })
})
