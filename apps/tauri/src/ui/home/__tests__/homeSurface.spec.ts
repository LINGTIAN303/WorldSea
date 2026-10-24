import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useUIStore } from '@/stores/uiStore'
import type { HomeData } from '../homeData'

const openWorkspace = vi.fn()
const reload = vi.fn()
const loadProfile = vi.fn()
const data = ref<HomeData | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const profileState = ref({ version: 1 as const, tagline: '', about: '', coverImage: '', updatedAt: null as string | null })

vi.mock('../useHomeData', () => ({
  useHomeData: () => ({ data, loading, error, reload }),
}))
vi.mock('../useHomeNavigation', () => ({
  useHomeNavigation: () => ({ openHome: vi.fn(), openWorkspace }),
}))
vi.mock('@/stores/homeProfileStore', () => ({
  useHomeProfileStore: () => ({
    get profile() { return profileState.value },
    load: loadProfile,
  }),
}))
vi.mock('@/composables/useProjectSwitcher', () => ({
  useProjectSwitcher: () => ({
    currentProject: ref({ id: 'p1', name: '纯真', dirPath: 'D:/world', isDefault: false }),
  }),
}))

import HomeSurface from '../HomeSurface.vue'

function fixture(): HomeData {
  return {
    projectName: '纯真',
    profile: { version: 1, tagline: '一句话', about: '短文', coverImage: '', updatedAt: null },
    tagline: '一句话',
    autoTagline: '自动句',
    snapshot: { entityCount: 7, relationCount: 0, activeSproutCount: 4, totalSproutCount: 27, fieldCount: 3, outlineCount: 1, manuscriptCount: 2, lastUpdatedAt: '2026-10-23T10:00:00Z' },
    domains: [{
      id: 'life', label: '生命与族群', icon: 'species', question: '谁生活在这个世界',
      entityCount: 2, firstViewId: 'characters',
      activeSprouts: [{ id: 'official.characters', label: '角色', icon: 'character', viewId: 'characters' }],
      recentEntities: [{ id: 'c1', name: '乔', type: 'character', updatedAt: '2026-10-23T10:00:00Z', viewId: 'characters' }],
    }],
    recent: [{ id: 'c1', type: 'character', name: '乔', description: '简介', updatedAt: '2026-10-23T10:00:00Z', typeLabel: '角色', icon: 'character', viewId: 'characters' }],
    featuredBook: {
      id: 'b1', name: '书', description: '书简介', coverImage: '', chapterCount: 2, wordCount: 2000, viewId: 'manuscript',
      latestChapter: { id: 'm1', name: '第一章', updatedAt: '2026-10-23T10:00:00Z' },
    },
    activity: { daily: {}, dayNames: {}, dayRelationCounts: {}, total: 0, activeDays: 0, maxCount: 0 },
    matrixRows: [{ type: 'character', label: '角色', sproutLabel: '角色', fieldCount: 2, requiredCount: 1, relationTypeCount: 1 }],
    matrixStats: { buds: 27, entities: 1, instances: 3, keys: 2, traits: 0, facets: 0 },
    matrixRelationTypeCount: 1,
    matrixViewId: 'field-matrix',
    continueTarget: { viewId: 'characters', label: '角色', icon: 'character' },
    outlineViewId: 'outline',
    manuscriptViewId: 'manuscript',
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  data.value = null
  loading.value = true
  error.value = null
  profileState.value = { version: 1, tagline: '', about: '', coverImage: '', updatedAt: null }
  openWorkspace.mockClear()
  reload.mockClear()
  loadProfile.mockClear()
})

describe('HomeSurface', () => {
  it('首页有 h1 与唯一 main 地标；矩阵表有 caption', () => {
    data.value = fixture()
    loading.value = false
    const w = mount(HomeSurface)
    expect(w.find('h1').exists()).toBe(true)
    expect(w.find('.home-matrix caption').text()).toContain('实体类型')
    expect(w.find('.home-asset-map .home-section-note').text()).toContain('含跨域')
    // 唯一 main 由 ShellSurface 提供，首页自身不得再嵌套
    expect(w.findAll('main')).toHaveLength(0)
  })

  it('世界速览有屏读标题；封面图 alt 含项目名，装饰遮罩 aria-hidden', () => {
    profileState.value = { ...profileState.value, coverImage: 'asset://cover.png' }
    data.value = fixture()
    loading.value = false
    const w = mount(HomeSurface)
    expect(w.find('.home-snapshot h2.home-sr-only').text()).toBe('世界速览')
    expect(w.find('.home-hero-img').attributes('alt')).toBe('纯真 封面')
    expect(w.find('.home-hero-shade').attributes('aria-hidden')).toBe('true')
  })

  it('加载中显示骨架，Hero 仍渲染项目名；不出现「暂无内容」占位', () => {
    const w = mount(HomeSurface)
    expect(w.find('.home-hero h1').text()).toBe('纯真')
    expect(w.findAll('.home-kpi-grid .ws-skeleton')).toHaveLength(4)
    expect(w.findAll('.home-split .ws-skeleton')).toHaveLength(7)
    expect(w.find('.home-meta').exists()).toBe(false)
    expect(w.find('.home-footer').text()).not.toContain('暂无内容')
  })

  it('封面加载失败回落默认视觉；最后更新只在 Hero 出现一次', async () => {
    profileState.value = { ...profileState.value, coverImage: 'asset://gone.png' }
    data.value = fixture()
    loading.value = false
    const w = mount(HomeSurface)
    expect(w.find('.home-hero-img').exists()).toBe(true)
    await w.find('.home-hero-img').trigger('error')
    expect(w.find('.home-hero-img').exists()).toBe(false)
    expect(w.find('.home-hero').exists()).toBe(true)
    expect(w.find('.home-cover-hint').text()).toContain('重新选择')
    expect(w.find('.home-meta').text()).toContain('最后更新')
    expect(w.find('.home-footer').text()).not.toContain('最后更新')
  })

  it('收到 ws-home-profile-changed 后重读简介', () => {
    data.value = fixture()
    loading.value = false
    mount(HomeSurface)
    loadProfile.mockClear()
    window.dispatchEvent(new CustomEvent('ws-home-profile-changed'))
    expect(loadProfile).toHaveBeenCalled()
  })

  it('数据就绪：Hero/速览/资产地图/最近/写作/矩阵摘要', () => {
    data.value = fixture()
    loading.value = false
    const w = mount(HomeSurface)
    expect(w.find('.home-tagline').text()).toBe('一句话')
    expect(w.findAll('.home-kpi')).toHaveLength(4)
    expect(w.find('.home-domain').exists()).toBe(true)
    expect(w.text()).toContain('乔')
    expect(w.text()).toContain('书')
    expect(w.find('.home-matrix').exists()).toBe(true)
    expect(w.find('.home-activity').exists()).toBe(true)
    expect(w.find('.home-empty-hint').exists()).toBe(false)
  })

  it('最近动态默认 6 条，可展开/收起', async () => {
    const base = fixture()
    data.value = {
      ...base,
      recent: Array.from({ length: 9 }, (_, i) => ({ ...base.recent[0], id: `r${i}`, name: `实体${i}` })),
    }
    loading.value = false
    const w = mount(HomeSurface)
    expect(w.findAll('.home-recent-row')).toHaveLength(6)
    const more = w.find('.home-recent-more')
    expect(more.text()).toContain('展开更多（3）')
    expect(more.attributes('aria-expanded')).toBe('false')
    await more.trigger('click')
    expect(w.findAll('.home-recent-row')).toHaveLength(9)
    expect(w.find('.home-recent-more').text()).toBe('收起')
    expect(w.find('.home-recent-more').attributes('aria-expanded')).toBe('true')
  })

  it('滚动超过阈值出现回到顶部并可跳回', async () => {
    data.value = fixture()
    loading.value = false
    const w = mount(HomeSurface)
    const surface = w.find('.home-surface')
    expect(w.find('.home-back-top').exists()).toBe(false)

    ;(surface.element as HTMLElement).scrollTop = 800
    await surface.trigger('scroll')
    const btn = w.find('.home-back-top')
    expect(btn.exists()).toBe(true)

    const scrollTo = vi.fn()
    ;(surface.element as HTMLElement).scrollTo = scrollTo
    await btn.trigger('click')
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
  })

  it('近期写作显示最近章节与继续写作', async () => {
    data.value = fixture()
    loading.value = false
    const w = mount(HomeSurface)
    expect(w.find('.home-book-latest').text()).toContain('第一章')
    await w.find('.home-book-latest-name').trigger('click')
    expect(openWorkspace).toHaveBeenLastCalledWith('manuscript', 'm1')
    await w.find('.home-book-cta').trigger('click')
    expect(openWorkspace).toHaveBeenLastCalledWith('manuscript', 'm1')
  })

  it('无最近章节时继续写作只开正文视图', async () => {
    const base = fixture()
    data.value = { ...base, featuredBook: { ...base.featuredBook!, latestChapter: null } }
    loading.value = false
    const w = mount(HomeSurface)
    expect(w.find('.home-book-latest').exists()).toBe(false)
    await w.find('.home-book-cta').trigger('click')
    expect(openWorkspace).toHaveBeenLastCalledWith('manuscript')
  })

  it('速览副行：芽入口进设置，字段只读', async () => {
    data.value = fixture()
    loading.value = false
    const spy = vi.spyOn(window, 'dispatchEvent')
    const w = mount(HomeSurface)
    expect(w.find('.home-kpi-secondary').text()).toContain('已启用芽 4/27')
    expect(w.find('.home-kpi-secondary').text()).toContain('字段 3')
    await w.find('.home-kpi-side.is-link').trigger('click')
    expect(useUIStore().settingsTarget).toEqual({ section: 'plugins' })
    expect(spy.mock.calls.some(([e]) => (e as CustomEvent).type === 'ws-open-settings')).toBe(true)
  })

  it('继续上次/实体/矩阵入口都走 openWorkspace', async () => {
    data.value = fixture()
    loading.value = false
    const w = mount(HomeSurface)
    await w.find('.home-hero-actions button').trigger('click')
    expect(openWorkspace).toHaveBeenLastCalledWith('characters')
    await w.find('.home-entity-link').trigger('click')
    expect(openWorkspace).toHaveBeenLastCalledWith('characters', 'c1')
    await w.find('.home-matrix-foot button').trigger('click')
    expect(openWorkspace).toHaveBeenLastCalledWith('field-matrix')
  })

  it('Hero 搜索世界入口派发 ws-open-search', async () => {
    data.value = fixture()
    loading.value = false
    const spy = vi.spyOn(window, 'dispatchEvent')
    const w = mount(HomeSurface)
    const btn = w.findAll('.home-hero-actions button').find(b => b.text().includes('搜索世界'))!
    await btn.trigger('click')
    expect(spy.mock.calls.some(([e]) => (e as CustomEvent).type === 'ws-open-search')).toBe(true)
  })

  it('空项目：CTA 改为开始创建并显示起步提示', async () => {
    const base = fixture()
    data.value = { ...base, snapshot: { ...base.snapshot, entityCount: 0 } }
    loading.value = false
    const w = mount(HomeSurface)
    expect(w.find('.home-hero-actions').text()).toContain('开始创建：角色')
    expect(w.find('.home-empty-hint').text()).toContain('Ctrl+K')
  })

  it('编辑简介：写 settingsTarget 并派发 ws-open-settings', async () => {
    data.value = fixture()
    loading.value = false
    const spy = vi.spyOn(window, 'dispatchEvent')
    const w = mount(HomeSurface)
    const btn = w.findAll('.home-hero-actions button')[1]
    await btn.trigger('click')
    expect(useUIStore().settingsTarget).toEqual({ section: 'home' })
    expect(spy.mock.calls.some(([e]) => (e as CustomEvent).type === 'ws-open-settings')).toBe(true)
  })

  it('错误态显示重试', async () => {
    error.value = '加载失败'
    loading.value = false
    const w = mount(HomeSurface)
    expect(w.find('.home-inline-error').text()).toContain('加载失败')
    expect(w.find('.home-kpi-grid').exists()).toBe(false)
    expect(w.find('.ws-empty').exists()).toBe(false)
    await w.find('.home-inline-error button').trigger('click')
    expect(reload).toHaveBeenCalled()
  })
})
