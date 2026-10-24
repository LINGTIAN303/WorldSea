<template>
  <div ref="surfaceRef" class="home-surface" @scroll="onScroll">
    <div class="home-inner">
      <section class="home-hero">
        <img
          v-if="profile.coverImage && !coverFailed"
          class="home-hero-img"
          :src="profile.coverImage"
          :alt="`${projectName} 封面`"
          @error="coverFailed = true"
        />
        <div class="home-hero-shade" aria-hidden="true"></div>
        <div class="home-hero-body">
          <p class="home-eyebrow">WorldSea · 项目首页</p>
          <h1 ref="heroTitle" tabindex="-1">{{ projectName }}</h1>
          <p class="home-tagline">{{ tagline }}</p>
          <p v-if="about" class="home-about">{{ about }}</p>
          <p v-if="data" class="home-meta">
            最后更新 {{ lastUpdatedText }} · 已启用芽
            {{ data.snapshot.activeSproutCount }}/{{ data.snapshot.totalSproutCount }}
          </p>
          <div class="home-hero-actions">
            <TuiButton
              variant="primary"
              icon="arrow-right"
              :disabled="!continueTarget"
              @click="onContinue"
            >{{ continueLabel }}</TuiButton>
            <TuiButton variant="ghost" icon="edit" @click="onEditProfile">编辑简介</TuiButton>
            <TuiButton variant="ghost" icon="search" @click="onOpenSearch">搜索世界</TuiButton>
          </div>
          <p v-if="isEmpty" class="home-empty-hint">从下方资产地图进入任意域，或按 Ctrl+K 搜索。</p>
          <p v-if="profile.coverImage && coverFailed" class="home-cover-hint">封面文件不可用，可在「编辑简介」中重新选择。</p>
        </div>
      </section>

      <div v-if="error" class="home-inline-error" role="alert">
        <span>{{ error }}</span>
        <TuiButton size="sm" variant="secondary" @click="reload">重试</TuiButton>
      </div>

      <template v-if="loading">
        <section class="home-section">
          <h2 class="home-sr-only">世界速览</h2>
          <div class="home-kpi-grid">
            <WsSkeleton v-for="n in 4" :key="n" variant="card" label="正在载入世界速览" :aria-hidden="n > 1 || undefined" />
          </div>
        </section>
        <section class="home-section">
          <div class="home-domain-grid">
            <WsSkeleton v-for="n in 8" :key="n" variant="card" label="正在载入资产地图" :aria-hidden="n > 1 || undefined" />
          </div>
        </section>
        <div class="home-split">
          <section class="home-section home-recent">
            <header class="home-section-head">
              <h2>最近动态</h2>
              <span class="home-section-note">最近 10 条 · 当前启用的芽</span>
            </header>
            <WsSkeleton v-for="n in 6" :key="n" variant="row" label="正在载入最近动态" :aria-hidden="n > 1 || undefined" />
          </section>
          <section class="home-section home-featured">
            <header class="home-section-head">
              <h2>近期写作</h2>
              <span class="home-section-note">正文</span>
            </header>
            <WsSkeleton variant="card" label="正在载入近期写作" />
          </section>
        </div>
        <section class="home-section">
          <h2 class="home-sr-only">字段矩阵</h2>
          <WsSkeleton variant="card" label="正在载入字段矩阵" />
        </section>
      </template>

      <template v-else-if="data">
        <section class="home-section home-snapshot">
          <h2 class="home-sr-only">世界速览</h2>
          <div class="home-kpi-grid">
            <component
              :is="kpi.action ? 'button' : 'div'"
              v-for="kpi in kpis"
              :key="kpi.key"
              class="home-kpi"
              :class="{ 'is-link': !!kpi.action }"
              :type="kpi.action ? 'button' : undefined"
              :title="kpi.hint"
              @click="onKpi(kpi)"
            >
              <span class="home-kpi-value">{{ kpi.value }}</span>
              <span class="home-kpi-label">{{ kpi.label }}</span>
            </component>
          </div>
          <div class="home-kpi-secondary">
            <button
              type="button"
              class="home-kpi-side is-link"
              title="芽 = 可直接打开的功能模块"
              @click="openSettingsPlugins"
            >已启用芽 <strong>{{ data.snapshot.activeSproutCount }}/{{ data.snapshot.totalSproutCount }}</strong></button>
            <span class="home-kpi-side" title="Schema 字段实例数（当前注册类型）">字段 <strong>{{ data.snapshot.fieldCount }}</strong></span>
          </div>
        </section>

        <HomeAssetMap :domains="data.domains" @enter="onEnterView" @entity="onEnterEntity" />

        <div class="home-split" :class="{ 'is-single': !data.featuredBook }">
          <section class="home-section home-recent">
            <header class="home-section-head">
              <h2>最近动态</h2>
              <span class="home-section-note">最近 10 条 · 当前启用的芽</span>
            </header>
            <ul v-if="data.recent.length" id="home-recent-list" class="home-recent-list">
              <li v-for="item in visibleRecent" :key="item.id">
                <button type="button" class="home-recent-row" :title="item.description || item.name" @click="onEnterEntity(item.viewId, item.id)">
                  <span class="home-recent-time">{{ relativeTime(item.updatedAt) }}</span>
                  <span class="home-recent-main">
                    <span class="home-recent-name"><WsIcon :name="item.icon" size="xs" />{{ item.name }}</span>
                    <span class="home-recent-desc">
                      {{ item.typeLabel }}<template v-if="item.description"> · {{ item.description }}</template>
                    </span>
                  </span>
                </button>
              </li>
            </ul>
            <WsEmpty v-else title="还没有最近修改" description="在工作台写下第一条内容后，这里会出现动态。" />
            <button
              v-if="data.recent.length > 6"
              type="button"
              class="home-recent-more"
              :aria-expanded="showAllRecent"
              aria-controls="home-recent-list"
              @click="showAllRecent = !showAllRecent"
            >{{ showAllRecent ? '收起' : `展开更多（${data.recent.length - 6}）` }}</button>
          </section>

          <section v-if="data.featuredBook" class="home-section home-featured">
            <header class="home-section-head">
              <h2>近期写作</h2>
              <span class="home-section-note">正文</span>
            </header>
            <div class="home-book">
              <div class="home-book-cover">
                <img v-if="data.featuredBook.coverImage" :src="data.featuredBook.coverImage" alt="" />
                <WsIcon v-else name="book" size="lg" />
              </div>
              <div class="home-book-body">
                <span class="home-book-name">{{ data.featuredBook.name }}</span>
                <span class="home-book-desc" :title="data.featuredBook.description || undefined">{{ data.featuredBook.description || '尚无简介' }}</span>
                <span class="home-book-meta">{{ data.featuredBook.chapterCount }} 章 · {{ data.featuredBook.wordCount }} 字</span>
              </div>
            </div>
            <div v-if="data.featuredBook.latestChapter" class="home-book-latest">
              <span class="home-book-latest-label">最近章节</span>
              <button
                type="button"
                class="home-book-latest-name"
                @click="onEnterEntity(data.featuredBook.viewId, data.featuredBook.latestChapter.id)"
              >{{ data.featuredBook.latestChapter.name }}</button>
              <span class="home-book-latest-time">{{ relativeTime(data.featuredBook.latestChapter.updatedAt) }}</span>
            </div>
            <TuiButton
              class="home-book-cta"
              size="sm"
              variant="secondary"
              icon="edit"
              @click="onContinueWriting"
            >继续写作</TuiButton>
          </section>
        </div>

        <HomeMatrixDigest
          :rows="data.matrixRows"
          :stats="data.matrixStats"
          :relation-type-count="data.matrixRelationTypeCount"
          :matrix-view-id="data.matrixViewId"
          @open="onOpenMatrix"
        />
      </template>

      <WsEmpty
        v-else-if="!error"
        title="暂时没有可展示的世界数据"
        description="可在工作台创建内容后回到首页。"
      />

      <footer class="home-footer">WorldSea · 项目首页</footer>
    </div>
    <button
      v-if="canBackTop"
      type="button"
      class="home-back-top"
      aria-label="回到顶部"
      title="回到顶部"
      @click="backToTop"
    ><WsIcon name="arrow-up" size="sm" /></button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { TuiButton, WsEmpty, WsIcon, WsSkeleton } from '@worldsea/ui-kit'
import { useUIStore } from '@/stores/uiStore'
import { useHomeProfileStore } from '@/stores/homeProfileStore'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
import { relativeTime } from './homeData'
import { useHomeData } from './useHomeData'
import { useHomeNavigation } from './useHomeNavigation'
import HomeAssetMap from './HomeAssetMap.vue'
import HomeMatrixDigest from './HomeMatrixDigest.vue'

const ui = useUIStore()
const project = useProjectSwitcher()
const profileStore = useHomeProfileStore()
const { data, loading, error, reload } = useHomeData()
const { openWorkspace } = useHomeNavigation()

const heroTitle = ref<HTMLElement | null>(null)
const surfaceRef = ref<HTMLElement | null>(null)
const canBackTop = ref(false)
const profile = computed(() => profileStore.profile)
/** 封面加载失败（跨机器迁移后 asset URL 失效）→ 回落默认视觉，不留破图 */
const coverFailed = ref(false)
watch(() => profile.value.coverImage, () => { coverFailed.value = false })

const fallbackProjectName = computed(() => {
  const p = project.currentProject.value
  return p?.isDefault ? '默认工作区' : (p?.name || '默认工作区')
})
const projectName = computed(() => data.value?.projectName ?? fallbackProjectName.value)
const tagline = computed(() => data.value?.tagline ?? '')
const about = computed(() => data.value?.profile.about ?? '')
const continueTarget = computed(() => data.value?.continueTarget ?? null)
const isEmpty = computed(() => (data.value?.snapshot.entityCount ?? 0) === 0)
const continueLabel = computed(() => {
  const target = continueTarget.value
  if (!target) return '进入工作台'
  return isEmpty.value ? `开始创建：${target.label}` : `继续上次：${target.label}`
})
const lastUpdatedText = computed(() => data.value?.snapshot.lastUpdatedAt
  ? relativeTime(data.value.snapshot.lastUpdatedAt)
  : '暂无内容')

/** 最近动态默认只露 6 条，避免把右栏拉成大片空白；行内展开，不新增页面 */
const showAllRecent = ref(false)
const visibleRecent = computed(() => {
  const recent = data.value?.recent ?? []
  return showAllRecent.value ? recent : recent.slice(0, 6)
})

const kpis = computed(() => {
  if (!data.value) return []
  const s = data.value.snapshot
  return [
    { key: 'entities', label: '实体', value: s.entityCount, action: null as string | null, hint: '实体总数（全量）' },
    { key: 'relations', label: '关系', value: s.relationCount, action: null, hint: '关系实例总数（全量；关系类型见字段矩阵）' },
    { key: 'outline', label: '大纲', value: s.outlineCount, action: data.value.outlineViewId ? 'outline' : null, hint: '大纲节点数' },
    { key: 'manuscript', label: '正文', value: s.manuscriptCount, action: data.value.manuscriptViewId ? 'manuscript' : null, hint: '正文数（仅正文类型，不含书籍）' },
  ]
})

function onContinue() {
  if (continueTarget.value) openWorkspace(continueTarget.value.viewId)
}
function onEnterView(viewId: string) {
  openWorkspace(viewId)
}
function onEnterEntity(viewId: string, entityId: string) {
  openWorkspace(viewId, entityId)
}
/** 继续写作：有最近章节时直接打开该章，否则回到正文视图 */
function onContinueWriting() {
  const book = data.value?.featuredBook
  if (!book) return
  if (book.latestChapter) openWorkspace(book.viewId, book.latestChapter.id)
  else openWorkspace(book.viewId)
}
function onOpenMatrix() {
  if (data.value?.matrixViewId) openWorkspace(data.value.matrixViewId)
}
function openSettingsPlugins() {
  ui.settingsTarget = { section: 'plugins' }
  window.dispatchEvent(new CustomEvent('ws-open-settings'))
}
function onKpi(kpi: { action: string | null }) {
  if (kpi.action === 'outline' && data.value?.outlineViewId) openWorkspace(data.value.outlineViewId)
  if (kpi.action === 'manuscript' && data.value?.manuscriptViewId) openWorkspace(data.value.manuscriptViewId)
}
function onEditProfile() {
  ui.settingsTarget = { section: 'home' }
  window.dispatchEvent(new CustomEvent('ws-open-settings'))
}
function onOpenSearch() {
  window.dispatchEvent(new CustomEvent('ws-open-search'))
}

/** 长页导航：滚动超过约一屏后出现回到顶部；reduced-motion 下直接跳转 */
function onScroll() {
  canBackTop.value = (surfaceRef.value?.scrollTop ?? 0) > 600
}
function backToTop() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
  surfaceRef.value?.scrollTo?.({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

/** 项目包导入在切换项目之后才写入 home.json，此时首轮 load 可能读到空资料；由写入方广播刷新 */
function onProfileChanged() {
  void profileStore.load()
}

onMounted(() => {
  void profileStore.load()
  window.addEventListener('ws-home-profile-changed', onProfileChanged)
  void nextTick(() => heroTitle.value?.focus())
})
onBeforeUnmount(() => window.removeEventListener('ws-home-profile-changed', onProfileChanged))
watch(() => ui.bootState, state => {
  if (state === 'ready') void profileStore.load()
}, { immediate: true })
watch(() => project.currentProject.value?.id, () => { void profileStore.load() })
</script>

<style src="./home.css"></style>
