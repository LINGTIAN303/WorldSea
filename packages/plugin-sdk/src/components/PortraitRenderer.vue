<template>
  <!-- 有运动编排的静态/动态图 → MotionStage（区域分层动效，D3）；模型/Lottie 不参与 -->
  <MotionStage
    v-if="motion && motion.tracks.length && (kind === 'static' || kind === 'animated')"
    :src="src"
    :motion="motion"
    ref="stageRef"
    class="pr-media"
    :alt="alt"
  />
  <img v-else-if="kind === 'static' || kind === 'animated'" :src="src" class="pr-media" :alt="alt" />
  <div v-else-if="kind === 'lottie'" ref="lottieBox" class="pr-media"></div>
  <div v-else-if="kind === 'model'" class="pr-media pr-model-box">
    <!-- camera-controls 按 Alt 动态启停（D2 走查后恢复拖拽缩放）：常开会捕获指针干扰卡片
         hover 判定（C 批教训），故仅按住 Alt 时插入属性（绑 null 即移除）；Alt+拖拽=旋转、
         Alt+滚轮=缩放。disable-pan 保留（只要旋转缩放不要平移） -->
    <model-viewer
      v-if="mvReady"
      ref="mvEl"
      :src="src"
      class="pr-model"
      :camera-controls="altHeld ? 'true' : null"
      interaction-prompt="none"
      disable-pan
      disable-tap
    ></model-viewer>
    <div v-else class="pr-loading">模型加载中…</div>
    <span v-if="mvReady" class="pr-alt-hint">按住 Alt 拖拽旋转 · 滚轮缩放</span>
  </div>
</template>

<script setup lang="ts">
/**
 * 形象图渲染核心（2026-10-25 形象图批计划 B 批）：按 portraitKind 四分支分发——
 * static/animated 复用 <img>（gif/apng/动图 webp 浏览器自播）；lottie 走 lottie-web
 * （fetch asset URL 的 JSON——asset 协议带 CORS 许可，CDP 实证可 fetch）；model 走
 * @google/model-viewer（web component，模块懒加载注册）。三处消费：悬停预览 / 卡片
 * 封面（后续批次） / 追踪浮层。play(trigger) 对应原始需求 #12/#13 的非跟踪播放行为：
 * model 随机/指定播自带动作（指定来自 D2 的 portraitMeta.model 配置，本批随机）、
 * 动图/Lottie 重头播固定动画、静态 no-op。
 */
import { ref, watch, onBeforeUnmount, onMounted } from 'vue'
import type { PortraitKind, MotionConfig, ModelActionConfig } from '@worldsea/entity-core'
import MotionStage from './MotionStage.vue'
import { createModelSequence } from './modelSequence'

const props = withDefaults(
  defineProps<{
    src: string
    kind: PortraitKind
    alt?: string
    /** 挂载即播（悬停预览场景）；关则等 play() 调用 */
    autoplay?: boolean
    /** 模型动作绑定（D2/F4）：hover/click 单动作或序列（序列优先） */
    actions?: ModelActionConfig
    /** 区域运动编排（D3）：静态/动态图的区域动效 */
    motion?: MotionConfig
  }>(),
  { alt: '形象图', autoplay: true, actions: undefined, motion: undefined },
)

const stageRef = ref<InstanceType<typeof MotionStage> | null>(null)

// ── model-viewer：懒加载注册 + 动作枚举/播放 ──
const mvReady = ref(false)
const mvEl = ref<HTMLElement | null>(null)
/** 模型自带动作清单（load 后填充；供 D2 配置 UI 枚举） */
const availableAnimations = ref<string[]>([])

/** Alt 按住态：动态启停 camera-controls（拖拽旋转/滚轮缩放），避免常开捕获指针干扰 hover */
const altHeld = ref(false)
if (props.kind === 'model') {
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Alt') {
      altHeld.value = true
      e.preventDefault() // 防 Alt 激活菜单栏
    }
  }
  const onKeyup = (e: KeyboardEvent) => {
    if (e.key === 'Alt') altHeld.value = false
  }
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('keyup', onKeyup)
  })
}

function readAnimations() {
  const mv = mvEl.value as (HTMLElement & { availableAnimations?: readonly string[] }) | null
  availableAnimations.value = mv?.availableAnimations ? [...mv.availableAnimations] : []
}

/** 播单个动作（序列/单动作共用；currentTime 归零保证重复触发从头） */
function playAnimationName(name: string) {
  const mv = mvEl.value as (HTMLElement & { play: () => void; currentTime?: number }) | null
  if (!mv) return
  mv.setAttribute('animation-name', name)
  if (typeof mv.currentTime === 'number') mv.currentTime = 0
  mv.play()
}

const sequence = createModelSequence(playAnimationName)

function watchMvLoad() {
  const mv = mvEl.value as (HTMLElement & { availableAnimations?: readonly string[]; addEventListener: (t: string, l: () => void) => void }) | null
  mv?.addEventListener('load', readAnimations)
  mv?.addEventListener('finished', () => sequence.finished())
}

if (props.kind === 'model') {
  // 懒加载：three 内核约 1MB+，仅存在模型形象时拉取（失败保持占位文案，不崩溃）
  void import('@google/model-viewer').then(() => {
    mvReady.value = true
  }).catch(() => { /* 加载失败：维持「模型加载中…」占位 */ })
}

/** 按触发选动作：actions[trigger] 指定则用，缺省/失配则随机 */
function pickAction(trigger: 'hover' | 'click'): string {
  const names = availableAnimations.value
  const want = props.actions?.[trigger]
  if (want && want !== 'random' && names.includes(want)) return want
  return names.length ? names[Math.floor(Math.random() * names.length)] : ''
}

function playModel(trigger: 'hover' | 'click') {
  const mv = mvEl.value as (HTMLElement & { play: () => void }) | null
  if (!mv) return
  // F4：序列优先（仅取模型实际拥有的动作；全部失配时回落单动作）
  const seq = (props.actions?.sequence ?? []).filter(name => availableAnimations.value.includes(name))
  if (seq.length) {
    sequence.start(seq)
    return
  }
  sequence.cancel()
  const pick = pickAction(trigger)
  if (pick) mv.setAttribute('animation-name', pick)
  mv.play()
}

// ── lottie：fetch JSON + lottie-web 实例生命周期 ──
const lottieBox = ref<HTMLElement | null>(null)
let lottieInstance: {
  destroy: () => void
  goToAndPlay: (frame: number, isFrame: boolean) => void
  pause: () => void
  play: () => void
} | null = null

async function loadLottie() {
  if (!lottieBox.value) return
  try {
    const [lottie, res] = await Promise.all([import('lottie-web'), fetch(props.src)])
    if (!res.ok) return
    const animationData = await res.json()
    if (!lottieBox.value) return // 竞态：组件已卸载
    lottieInstance = lottie.default.loadAnimation({
      container: lottieBox.value,
      renderer: 'svg',
      loop: true,
      autoplay: props.autoplay,
      animationData,
    })
  } catch {
    // 加载失败保持空容器（上层显示空白而非崩溃）
  }
}

if (props.kind === 'lottie') {
  watch(lottieBox, (el) => { if (el) void loadLottie() }, { immediate: true })
}

/**
 * 触发播放（需求 #12/#13 非跟踪播放行为）。
 * model：按 actions[trigger] 指定或随机播自带动作；animated/lottie：重头播固定动画；
 * static/animated 带 motion：触发 hover/click 轨迹（loop 轨 MotionStage 自动跑）。
 */
function play(trigger: 'hover' | 'click' = 'click') {
  if (props.kind === 'model') playModel(trigger)
  else if (props.kind === 'lottie' || props.kind === 'animated') lottieInstance?.goToAndPlay(0, true)
  stageRef.value?.playTrigger(trigger)
}

/** Lottie 控制（F4）：lottie-web 用 pause/play 映射暂停/恢复 */
function pause() {
  if (props.kind === 'lottie') lottieInstance?.pause()
}
function resume() {
  if (props.kind === 'lottie') lottieInstance?.play()
}

defineExpose({ play, availableAnimations, pause, resume })

// autoplay 对 motion 图=挂载即播 hover 轨（悬停框场景出现即动；loop 轨自动）
onMounted(() => {
  if (props.autoplay && props.motion?.tracks.length) stageRef.value?.playTrigger('hover')
})

// 模型就绪后挂 load 监听读动作清单（D2 配置 UI 枚举用）
watch(mvEl, (el) => { if (el) watchMvLoad() })

// autoplay 语义对 model = 动作清单就绪即播 hover 绑定动作（需求 #13 悬停预览播放）
if (props.kind === 'model' && props.autoplay) {
  watch(availableAnimations, (list) => { if (list.length) play('hover') }, { once: true })
}

onBeforeUnmount(() => {
  lottieInstance?.destroy()
  lottieInstance = null
})
</script>

<style scoped>
.pr-media {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pr-model-box {
  position: relative;
  width: 100%;
  height: 100%;
}
.pr-model {
  width: 100%;
  height: 100%;
  background: transparent;
  --poster-color: transparent;
  --progress-bar-color: transparent;
}
.pr-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs, 12px);
}
.pr-alt-hint {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 8px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 10px;
  pointer-events: none;
  white-space: nowrap;
}
</style>
