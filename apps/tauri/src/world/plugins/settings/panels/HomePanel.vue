<template>
  <CardDeck :count="1" :flat="!!searchQuery" @change="(i) => emit('card-change', i)" ref="deckRef">
    <template #card="{ idx, cls }">
      <div class="set-card deck-card" :class="cls" :data-index="idx">
        <div class="sc-head"><span>项目首页</span></div>
        <p class="set-hint">这些内容只影响产品域首页，不改变项目名。工作台背景在「外观 → 背景」中设置。</p>

        <div class="hp-field">
          <label class="hp-label" for="home-tagline">一句话简介</label>
          <input
            id="home-tagline"
            v-model="draft.tagline"
            class="set-input"
            :maxlength="HOME_PROFILE_LIMITS.tagline"
            placeholder="例：一个关于…的世界"
            :disabled="!loaded"
            @input="scheduleSave"
            @blur="flushSave"
          />
          <span class="set-hint">{{ draft.tagline.length }}/{{ HOME_PROFILE_LIMITS.tagline }}</span>
        </div>

        <div class="hp-field">
          <label class="hp-label" for="home-about">短文</label>
          <textarea
            id="home-about"
            v-model="draft.about"
            class="set-input hp-textarea"
            :maxlength="HOME_PROFILE_LIMITS.about"
            rows="3"
            placeholder="在封面下展示的一小段自述"
            :disabled="!loaded"
            @input="scheduleSave"
            @blur="flushSave"
          ></textarea>
          <span class="set-hint">{{ draft.about.length }}/{{ HOME_PROFILE_LIMITS.about }}</span>
        </div>

        <div class="hp-field">
          <span id="home-cover-label" class="hp-label">封面</span>
          <div class="hp-cover" role="group" aria-labelledby="home-cover-label">
            <div class="hp-cover-box">
              <img v-if="draft.coverImage" :src="draft.coverImage" alt="首页封面预览" />
              <span v-else class="hp-cover-empty"><WsIcon name="image" size="lg" /></span>
            </div>
            <div class="hp-cover-actions">
              <TuiButton size="sm" variant="secondary" :disabled="!loaded" @click="onPickCover">上传封面</TuiButton>
              <TuiButton v-if="draft.coverImage" size="sm" variant="secondary" :disabled="!loaded" @click="removeCover">移除封面</TuiButton>
            </div>
          </div>
        </div>

        <p class="set-hint" :class="{ 'hp-error': loaded && saveState === 'error' }" aria-live="polite">{{ loaded ? statusText : '正在载入…' }}</p>
      </div>
    </template>
  </CardDeck>
</template>

<script setup lang="ts">
/**
 * HomePanel：全局设置「首页」分区（2026-10-23）。
 * 编辑产品域首页的 tagline / about / cover，失焦与防抖自动保存，封面上传/移除即时落盘。
 * 不接全局 dirty：保存是即时的，无需取消后刷新视图。
 *
 * 【载入守卫】store.save() 以内存态为基准合并 patch，而内存态在 load() 落地前是空默认值；
 * 此时任何一次保存都会把磁盘上的 about / coverImage 覆盖成空串。故统一以 loaded 为闸：
 * 载入完成前字段与封面按钮禁用、四类写操作 no-op、卸载时不补刷防抖。
 *
 * 【草稿唯一来源】载入完成后把 profile 一次性灌入草稿，此后 draft 即唯一输入源，
 * 不再 watch store.profile 回写——否则保存成功后的 normalize（trim/截断）会在写盘在途时
 * 覆盖用户刚敲下的字符（Task 10 评审的竞态）。外部更新 profile 不主动刷新本面板。
 *
 * 【切项目】`currentProject.id` 变化即作废防抖计时器、重新载入并把新项目 profile 灌回草稿；
 * 未载入完成前 loaded=false，所有写操作 no-op——旧项目草稿不会被写进新项目（配合 store 的目录守卫）。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { CardDeck, TuiButton, WsIcon } from '@worldsea/ui-kit'
import { HOME_PROFILE_LIMITS, useHomeProfileStore } from '@/stores/homeProfileStore'
import { useProjectSwitcher } from '@/composables/useProjectSwitcher'
import { writeImageAsset, ASSET_MAX_BYTES } from '@/composables/imageAssets'
import { pickLocalFiles } from '@/composables/pickLocalFiles'

defineProps<{ searchQuery?: string }>()
const emit = defineEmits<{ 'card-change': [index: number] }>()

const store = useHomeProfileStore()
const project = useProjectSwitcher()
const draft = reactive({ tagline: '', about: '', coverImage: '' })
const deckRef = ref<InstanceType<typeof CardDeck> | null>(null)
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const errorText = ref('')
/** 载入守卫：为 true 前不读写，防止用空默认值覆盖磁盘已有内容（也防止旧项目草稿写进新项目） */
const loaded = ref(false)
let timer: number | undefined
/** 载入代际：切项目/重复挂载时只采纳最后一次 load 的结果 */
let hydrateSeq = 0

const statusText = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'error') return `保存失败：${errorText.value}`
  return '已同步'
})

function scheduleSave() {
  if (!loaded.value) return
  saveState.value = 'idle'
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => { void flushSave() }, 400)
}

async function flushSave() {
  if (!loaded.value) return
  if (timer) {
    window.clearTimeout(timer)
    timer = undefined
  }
  saveState.value = 'saving'
  const ok = await store.save({ tagline: draft.tagline, about: draft.about, coverImage: draft.coverImage })
  if (ok) {
    saveState.value = 'saved'
    errorText.value = ''
  } else {
    saveState.value = 'error'
    errorText.value = store.error ?? '未知错误'
  }
}

async function onPickCover() {
  if (!loaded.value) return
  const picked = await pickLocalFiles({
    multiple: false,
    title: '选择首页封面',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
    maxBytes: ASSET_MAX_BYTES,
  })
  if (picked.cancelled) return
  const file = picked.files[0]
  if (!file) {
    saveState.value = 'error'
    errorText.value = picked.reasons[0] ?? '封面上传失败'
    return
  }
  const result = await writeImageAsset(file)
  if (!result.ok || !result.src) {
    saveState.value = 'error'
    errorText.value = result.reason ?? '封面上传失败'
    return
  }
  draft.coverImage = result.src
  await flushSave()
}

async function removeCover() {
  if (!loaded.value) return
  draft.coverImage = ''
  await flushSave()
}

/**
 * 载入并把 profile 灌入草稿（仅此处回写草稿）。
 * 切项目时重入：先作废在途防抖（旧项目草稿不得落盘），再按当前项目目录重载。
 */
async function hydrate() {
  const seq = ++hydrateSeq
  if (timer) {
    window.clearTimeout(timer)
    timer = undefined
  }
  loaded.value = false
  saveState.value = 'idle'
  try {
    await store.load()
  } finally {
    if (seq !== hydrateSeq) return
    // 读取失败也解禁：store.load 内部已回落默认值；此处把 profile 灌入草稿（每次 hydrate 一次）
    const p = store.profile
    draft.tagline = p.tagline
    draft.about = p.about
    draft.coverImage = p.coverImage
    loaded.value = true
  }
}

/** 世界包导入在面板打开时也可能改写 home.json：重读并重灌草稿（会作废未落盘的防抖） */
function onProfileChanged() {
  void hydrate()
}

onMounted(() => {
  window.addEventListener('ws-home-profile-changed', onProfileChanged)
  void hydrate()
})

// 切项目：currentProject 在切换末尾才更新（此时存储根已指向新项目）→ 重新载入并重灌草稿
watch(() => project.currentProject.value?.id, () => { void hydrate() })

onBeforeUnmount(() => {
  window.removeEventListener('ws-home-profile-changed', onProfileChanged)
  if (!timer) return
  window.clearTimeout(timer)
  timer = undefined
  // 未载入完成时不补刷：此时保存会把空默认值写盘
  if (loaded.value) void flushSave()
})

defineExpose({ goToCard: (i: number) => deckRef.value?.goToCard(i) })
</script>

<style scoped>
.hp-field { display: flex; flex-direction: column; gap: 6px; padding: 6px 0; }
.hp-label { font-size: var(--font-size-sm); color: var(--text-secondary); }
.hp-textarea { min-height: 72px; resize: vertical; line-height: 1.5; }
.hp-cover { display: flex; align-items: flex-start; gap: 12px; }
.hp-cover-box {
  display: flex; align-items: center; justify-content: center;
  width: 160px; height: 90px; overflow: hidden;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-muted);
}
.hp-cover-box img { width: 100%; height: 100%; object-fit: cover; }
.hp-cover-empty { color: var(--text-tertiary); }
.hp-cover-actions { display: flex; flex-direction: column; gap: 6px; }
.hp-hidden { display: none; }
.hp-error { color: var(--danger); }
</style>
