<template>
  <div class="chat-input-area" ref="inputAreaRef">
    <!-- 召唤菜单（四符号统一，固定定位，Teleport 到 body） -->
    <SummonMenu
      ref="summonMenuRef"
      :visible="summonMenuVisible"
      :items="summonItems"
      :filter="activeFilter"
      :position="menuStyle"
      :loading="referenceLoading"
      :empty-hint="menuMode === 'references' ? referenceEmptyHint : undefined"
      @select="handleSummonSelect"
      @cancel="handleSummonCancel"
    />

    <!-- 手动压缩回执提示条（/compact 指令或上下文面板触发；6s 自动消失） -->
    <Transition name="compact-hint">
      <div
        v-if="compactHintVisible && latestCompaction"
        class="compact-hint"
        :class="{ 'is-err': !latestCompaction.ok }"
        role="status"
      >
        <WsIcon name="collapse" size="xs" class="compact-hint-icon" />
        <span class="compact-hint-text">{{ latestCompaction.text }}</span>
        <button
          class="compact-hint-close"
          type="button"
          aria-label="关闭提示"
          @click="dismissCompactHint()"
        >
          <WsIcon name="x" size="xs" />
        </button>
      </div>
    </Transition>

    <!-- 双层输入框：上层胶囊输入区 + 下层常驻工具栏 -->
    <div
      class="chat-input-box"
      :class="{ expanded: isExpanded, focused: isFocused, 'drag-over': isDragOver }"
      @dragover.prevent="isDragOver = true"
      @dragleave.prevent="isDragOver = false"
      @drop.prevent="onDrop"
    >
      <!-- ── 上层：胶囊输入区 ── -->
      <div class="input-capsule">
        <div class="input-stack">
          <!-- 召唤 chips（/技能 + @引用，随消息发送） -->
          <div v-if="summonChips.length" class="chips-area">
            <div
              v-for="(chip, i) in summonChips"
              :key="chip.id"
              class="chip"
              :class="`chip-${chip.kind}`"
            >
              <span class="chip-prefix">{{ chip.prefix }}</span>
              <span class="chip-label">{{ chip.name }}</span>
              <button
                class="chip-remove"
                type="button"
                :aria-label="`移除 ${chip.name}`"
                @click.stop="removeChip(i)"
              >
                <WsIcon name="x" size="xs" />
              </button>
            </div>
          </div>
          <!-- 知识墙注入 chips -->
          <div v-if="kbChips.length" class="chips-area">
            <div v-for="(chip, i) in kbChips" :key="i" class="chip chip-kb">
              <WsIcon name="file" size="xs" />
              <span class="chip-label">{{ chip.label }}</span>
              <button
                class="chip-remove"
                type="button"
                :aria-label="`移除知识条目 ${chip.label}`"
                @click.stop="removeKbChip(i)"
              >
                <WsIcon name="x" size="xs" />
              </button>
            </div>
          </div>
          <!-- 附件预览 -->
          <div v-if="attachments.length" class="attachments-preview">
            <div
              v-for="(att, i) in attachments"
              :key="i"
              class="att-item"
              :class="{ 'att-image': att.type === 'image', 'att-file': att.type === 'file' }"
            >
              <img v-if="att.type === 'image' && att.previewUrl" :src="att.previewUrl" class="att-thumb" />
              <span v-if="att.type === 'file'" class="att-file-icon"><WsIcon name="file" size="xs" /></span>
              <span class="att-name">{{ att.name }}</span>
              <button class="att-remove" type="button" :aria-label="`移除附件 ${att.name}`" @click.stop="removeAttachment(i)">
                <WsIcon name="x" size="xs" />
              </button>
            </div>
          </div>
          <!-- textarea + 占位符轮播 overlay -->
          <div class="textarea-wrap">
            <textarea
              ref="textareaRef"
              v-model="inputText"
              class="chat-textarea"
              rows="1"
              aria-label="消息输入框"
              @focus="onFocus"
              @blur="onBlur"
              @keydown="onKeydown"
              @input="onInput"
              @paste="onPaste"
            ></textarea>
            <Transition name="ph" mode="out-in">
              <span v-if="!inputText" :key="currentPlaceholder" class="ph-overlay">{{ currentPlaceholder }}</span>
            </Transition>
          </div>
        </div>
        <input
          ref="fileInputRef"
          type="file"
          class="hidden-file-input"
          multiple
          @change="onFileInputChange"
        />
      </div>

      <!-- ── 下层：常驻工具栏 ── -->
      <div class="input-toolbar">
        <div class="toolbar-left">
          <!-- [E1] 左侧控件收缩到 附件；语音键已移至右区发送键旁（2026-09-06）；@//!/~/# 符号入口移除（功能保留：可直接输入符号触发召唤系统） -->
          <button class="tool-btn" type="button" title="附件（图片/文件）" aria-label="添加附件" @click="triggerFileInput">
            <WsIcon name="paperclip" size="sm" />
          </button>
          <!-- P0-4 迭代：权限分级改为图标下拉（手动确认/自动判断/完全通过），外部点击关闭 -->
          <!-- I1 修复：菜单 Teleport 到 body + 固定定位（原非传送被输入区层叠/裁剪，三选项仅残影不可点） -->
          <div class="perm-dd" ref="permRef">
            <button
              class="tool-btn perm-dd-trigger"
              :class="{ on: permOpen, warn: permissionLevel === 'off' }"
              type="button"
              :title="`权限分级：${permLabel}`"
              :aria-label="`权限分级：${permLabel}`"
              :aria-expanded="permOpen"
              @click.stop="togglePermMenu"
            ><WsIcon name="shield" size="sm" /></button>
            <Teleport to="body">
              <div v-if="permOpen" class="perm-backdrop" @click="permOpen = false"></div>
              <Transition name="perm-fade">
                <div v-if="permOpen" class="perm-dd-menu" :style="permMenuStyle">
                  <button
                    v-for="p in PERMISSION_LEVELS"
                    :key="p.value"
                    class="perm-dd-item"
                    :class="{ on: permissionLevel === p.value, warn: p.value === 'autopilot' }"
                    @click="pickPermission(p.value)"
                  >
                    <span class="perm-dd-label">{{ p.label }}</span>
                    <span class="perm-dd-desc">{{ p.desc }}</span>
                  </button>
                </div>
              </Transition>
            </Teleport>
          </div>
        </div>
        <div class="toolbar-center">
        </div>
        <div class="toolbar-right">
          <ModelSwitcher :is-expanded="isExpanded" @change="onModelChange" />
          <!-- 语音输入（2026-09-06 移至发送键旁；tabler IconMicrophone 替换原 volume-on） -->
          <button class="tool-btn" :class="{ 'voice-active': isListening }" type="button" title="语音输入（麦克风转文字）" aria-label="语音输入" @click="toggleVoice">
            <IconMicrophone :size="16" :stroke-width="1.5" />
          </button>
          <button
            class="send-btn"
            type="button"
            :class="{ 'stop-btn': isStreaming }"
            :disabled="sendDisabled"
            :aria-label="isStreaming ? '停止生成' : '发送消息'"
            :title="isStreaming ? '停止生成' : '发送消息'"
            :data-ws-tip-keys="sendKeysLabel"
            @click="isStreaming ? onStop() : onSend()"
          >
            <!-- 2026-09-05 改造：发送/停止统一 tabler 虚线箭头（原 send 实心 + square 停止 retired） -->
            <IconArrowNarrowUpDashed class="send-icon" :class="{ spinning: isStreaming }" :size="16" :stroke-width="1.6" />
          </button>
        </div>
      </div>
    </div>

    <Transition name="warning-fade">
      <div v-if="voiceHint" class="vision-warning voice-hint">{{ voiceHint }}</div>
    </Transition>
    <Transition name="warning-fade">
      <div v-if="visionWarning" class="vision-warning">{{ visionWarning }}</div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue'
import { invoke } from '@/agent/composables/transport'
import { isTauri, hasTauriInvoke } from '@worldsea/entity-core/core'
import { IconArrowNarrowUpDashed, IconMicrophone } from '@tabler/icons-vue'
import { WsIcon, toastInfo, toastWarn, useShortcuts, normalizeKeys, formatKeysForDisplay } from '@worldsea/ui-kit'
import { useSpaceStore, type InputInjectionChip } from '../stores/space-store'
import { useSessionViewState } from '@/agent/composables/useSessionViewState'
import { useAgent } from '@/agent/composables/useAgent'
import { modelSupportsVision } from '@worldsea/agent-runtime'
import { useSettingsStore } from '@/stores/settingsStore'
import { usePluginStore, useEntityStore } from '@worldsea/entity-core'
import { useUIStore } from '@/stores/uiStore'
import { extractDocumentText } from '@/composables/useFileExtract'
import ModelSwitcher from './ModelSwitcher.vue'
import SummonMenu from './SummonMenu.vue'
import {
  buildSummonItems, filterByPrefix, getReferenceEntries, matchesFilter,
  type SummonItem, type ChatMode,
} from './summon-registry'

interface FileAttachment {
  type: 'image' | 'file'
  name: string
  mimeType: string
  data: string
  previewUrl?: string
  textContent?: string
}

/** 实体引用载荷：随消息发送，携带 id/名称/类型供 Agent 读取实体上下文 */
interface ReferencePayload {
  id: string
  name: string
  type: string
}

type MenuMode = 'primary' | 'params' | 'references'

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGE_SIZE = 20 * 1024 * 1024
const MAX_IMAGE_COUNT = 10
const MAX_IMAGE_DIMENSION = 2048
/** 音频/视频 MIME 前缀（走桌面端 whisper 转录） */
const AUDIO_VIDEO_RE = /^(audio|video)\//

const emit = defineEmits<{
  send: [text: string, attachments: FileAttachment[], references?: ReferencePayload[]]
}>()

const spaceStore = useSpaceStore()
// 聊天模式按会话隔离（viewState 权威）：占位符轮播 / 模式标签 / 模型参数弹窗回写均用当前会话模式
const sessionView = useSessionViewState()
const sessionMode = computed(() => sessionView.activeState.value?.chatMode ?? 'normal')
const settingsStore = useSettingsStore()
const pluginStore = usePluginStore()
const uiStore = useUIStore()
const { isStreaming, abort, setSecurityLevel, securityLevel: sessionSecurityLevel } = useAgent()
// 手动压缩回执（/compact 指令或上下文面板触发）：输入框上方提示条，6s 自动消失
const { latestCompaction, clearCompactionHint } = useAgent()
const compactHintVisible = ref(false)
let compactHintTimer: ReturnType<typeof setTimeout> | null = null
watch(latestCompaction, (c) => {
  if (!c) {
    compactHintVisible.value = false
    return
  }
  compactHintVisible.value = true
  if (compactHintTimer) clearTimeout(compactHintTimer)
  compactHintTimer = setTimeout(() => {
    compactHintVisible.value = false
  }, 6000)
})
onBeforeUnmount(() => {
  if (compactHintTimer) clearTimeout(compactHintTimer)
})
/** 关闭提示条（手动关闭同时清全局回执，避免切换到上下文面板后残留旧结果） */
function dismissCompactHint(): void {
  compactHintVisible.value = false
  clearCompactionHint()
}

// P0-4 迭代：权限分级图标下拉（v2 三档 2026-09-03：plan/interact/autopilot）；value=后端 security level
// 只读研究=plan｜交互确认=interact（默认，含危险三键 + 可学习白名单）｜自动巡航=autopilot
const PERMISSION_LEVELS = [
  { value: 'plan', label: '只读研究', desc: '仅研究分析，禁用写/命令操作' },
  { value: 'interact', label: '交互确认', desc: '危险操作需确认，可添加白名单自动放行' },
  { value: 'autopilot', label: '自动巡航', desc: '白名单放行 + 上锁名单拦截，不逐条确认' },
]
// A7 档位：会话级运行时状态（useAgentRust；新会话初始 interact，不继承）——UI 与后端强一致
const permissionLevel = computed(() => sessionSecurityLevel.value)
const permOpen = ref(false)
const permRef = ref<HTMLElement>()
const permMenuStyle = ref<Record<string, string>>({})
const permLabel = computed(() => PERMISSION_LEVELS.find((p) => p.value === permissionLevel.value)?.label || '权限分级')
/** I1 修复：向上弹出的固定定位（底边对齐触发器顶边 + 6px） */
function updatePermMenuPosition(): void {
  const el = permRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  permMenuStyle.value = {
    bottom: `${window.innerHeight - rect.top + 6}px`,
    right: `${window.innerWidth - rect.right}px`,
  }
}
function togglePermMenu(): void {
  permOpen.value = !permOpen.value
  if (permOpen.value) updatePermMenuPosition()
}
/** I1 修复：全局 Escape 关闭（原无任何 Escape 处理，打开后仅能点选项/背景关闭） */
function onPermDocKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') permOpen.value = false
}
watch(permOpen, (open) => {
  // capture 阶段监听：抢在 useShortcuts（document 冒泡，命中即 stopImmediatePropagation）之前消费 Esc
  if (open) document.addEventListener('keydown', onPermDocKeydown, true)
  else document.removeEventListener('keydown', onPermDocKeydown, true)
})
async function pickPermission(v: string): Promise<void> {
  if (permissionLevel.value === v) { permOpen.value = false; return }
  permOpen.value = false
  try {
    await setSecurityLevel(v)
  } catch (e) {
    toastWarn('切换权限分级失败')
  }
}

function currentModelId(): string {
  return settingsStore.aiProviderMode === 'cloud'
    ? settingsStore.aiCloudModel
    : settingsStore.aiCustomModel
}

/* ── 基础状态 ── */
const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement>()
const fileInputRef = ref<HTMLInputElement>()
const inputAreaRef = ref<HTMLElement>()
const isExpanded = ref(false)
const isFocused = ref(false)
const isDragOver = ref(false)
const attachments = ref<FileAttachment[]>([])
const visionWarning = ref('')
const kbChips = ref<InputInjectionChip[]>([])
/** 召唤 chips（/技能 + @引用，随消息发送） */
const summonChips = ref<SummonItem[]>([])

/* ── 召唤菜单状态 ── */
const summonMenuVisible = ref(false)
const summonPrefix = ref('')
const summonFilter = ref('')
const summonMenuRef = ref<InstanceType<typeof SummonMenu>>()
const menuStyle = ref<{ left: string; bottom: string; width: string }>({ left: '0px', bottom: '0px', width: '360px' })
let summonSymbolStart = -1
let summonRafId: number | null = null
const menuMode = ref<MenuMode>('primary')
const pendingCommand = ref<SummonItem | null>(null)
const paramFilter = ref('')
const pendingReference = ref<SummonItem | null>(null)
const referenceFilter = ref('')
const referenceItems = ref<SummonItem[]>([])
const referenceLoading = ref(false)
const referenceEmptyHint = ref('')

/* ── 占位符轮播 ── */
const placeholderByMode: Record<ChatMode, string[]> = {
  // 三模式移除（2026-08-31）：统一 normal 占位，group-chat 保留群聊占位
  normal: ['问题越具体，洞察越深刻…', '多轮推理：层层推演，深挖本质'],
  'group-chat': ['群聊模式…', '邀请 Agent 参与讨论'],
}
const placeholderList = computed(() => placeholderByMode[sessionMode.value] ?? placeholderByMode.normal)
const placeholderIndex = ref(0)
let placeholderTimer: ReturnType<typeof setInterval> | null = null
const currentPlaceholder = computed(
  () => placeholderList.value[placeholderIndex.value % placeholderList.value.length],
)

/* ── 召唤菜单可选项（按模式） ── */

/** 创作区视图源：芽视图注册表（不含 Agent 主界面） */
const creationViews = computed<{ id: string; label: string; icon: string }[]>(() =>
  pluginStore.views.map((v) => ({ id: v.id, label: v.label, icon: v.icon })),
)

/** 统一召唤条目（# 面板 / ~ 资产 / / 指令+技能 / ！创作区），@ 另行动态生成 */
const allSummonItems = computed<SummonItem[]>(() => buildSummonItems(creationViews.value))

const summonItems = computed<SummonItem[]>(() => {
  if (menuMode.value === 'references') return referenceItems.value
  if (menuMode.value === 'params' && pendingCommand.value?.params?.[0]?.type === 'enum') {
    const param = pendingCommand.value.params[0]
    const cmd = pendingCommand.value
    return (param.enum_values || []).map((val, idx) => ({
      id: `param-${cmd.id}-${idx}`,
      prefix: cmd.prefix,
      name: val,
      description: '',
      icon: 'chat',
      kind: 'command' as const,
      payload: val,
    }))
  }
  if (!summonPrefix.value) return []
  if (summonPrefix.value === '@') return getReferenceEntries().filter((i) => matchesFilter(i, summonFilter.value))
  return filterByPrefix(allSummonItems.value, summonPrefix.value).filter((i) => matchesFilter(i, summonFilter.value))
})

const activeFilter = computed(() => {
  if (menuMode.value === 'params') return paramFilter.value
  if (menuMode.value === 'references') return referenceFilter.value
  return summonFilter.value
})

const hasSummonMatches = computed(() => {
  if (menuMode.value === 'references' && referenceLoading.value) return true
  return summonItems.value.some((i) => matchesFilter(i, activeFilter.value))
})

const sendDisabled = computed(
  () => !isStreaming.value && !inputText.value.trim() && !attachments.value.length
    && !summonChips.value.length && !kbChips.value.length,
)

/* ── 占位符轮播 ── */
function startPlaceholderRotation() {
  if (placeholderTimer) return
  placeholderTimer = setInterval(() => {
    if (!inputText.value && placeholderList.value.length > 0) {
      placeholderIndex.value = (placeholderIndex.value + 1) % placeholderList.value.length
    }
  }, 3000)
}
function stopPlaceholderRotation() {
  if (placeholderTimer) {
    clearInterval(placeholderTimer)
    placeholderTimer = null
  }
}

/* ── 输入处理（轻量立即 + 重量召唤检测 rAF 节流） ── */
function onInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  const value = target.value
  const cursorPos = target.selectionStart ?? value.length
  inputText.value = value
  isExpanded.value = true
  if (summonRafId !== null) cancelAnimationFrame(summonRafId)
  summonRafId = requestAnimationFrame(() => {
    summonRafId = null
    detectSummon(value, cursorPos)
  })
}

function detectSummon(value: string, cursorPos: number) {
  // references 模式：提取光标前的引用过滤
  if (menuMode.value === 'references' && pendingReference.value) {
    const refPrefix = `${pendingReference.value.prefix}${pendingReference.value.name} `
    const idx = value.lastIndexOf(refPrefix, cursorPos)
    if (idx >= 0) {
      referenceFilter.value = value.slice(idx + refPrefix.length, cursorPos)
      summonSymbolStart = idx
    } else {
      exitReferencesMode()
    }
  }
  // params 模式：提取光标前的参数过滤
  if (menuMode.value === 'params' && pendingCommand.value) {
    const cmdPrefix = `${pendingCommand.value.prefix}${pendingCommand.value.name} `
    const idx = value.lastIndexOf(cmdPrefix, cursorPos)
    if (idx >= 0) {
      paramFilter.value = value.slice(idx + cmdPrefix.length, cursorPos)
      summonSymbolStart = idx
    } else {
      exitParamsMode()
    }
  }
  // primary 模式：检测召唤符号（任意位置，符号前须单词边界）
  if (menuMode.value === 'primary') {
    const beforeCursor = value.slice(0, cursorPos)
    const m = beforeCursor.match(/(^|\s)([#/~!！@])([^#/~!！@\s]*)$/)
    if (m) {
      const prefix = m[2] === '!' ? '！' : m[2]
      const filter = m[3]
      const items = prefix === '@' ? getReferenceEntries() : filterByPrefix(allSummonItems.value, prefix)
      // filter 无匹配时不弹菜单：让 /compact 等保留指令（及无意义的过滤输入）直接走
      // 普通发送路径，不悬停空菜单
      const matched = filter ? items.filter((i) => matchesFilter(i, filter)) : items
      if (matched.length > 0) {
        summonSymbolStart = cursorPos - filter.length - 1
        summonPrefix.value = prefix
        summonFilter.value = filter
        summonMenuVisible.value = true
        updateMenuPosition()
        return
      }
    }
    if (summonMenuVisible.value) closeSummonMenu()
  }
}

function updateMenuPosition() {
  const el = inputAreaRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  menuStyle.value = {
    left: `${Math.max(8, rect.left + rect.width / 2 - 180)}px`,
    bottom: `${window.innerHeight - rect.top + 8}px`,
    width: '360px',
  }
}

/* ── 草稿保留辅助 ── */
function removeSummonSymbolKeepDraft() {
  const value = inputText.value
  if (summonSymbolStart < 0 || summonSymbolStart >= value.length) {
    inputText.value = ''
    summonSymbolStart = -1
    return
  }
  inputText.value = value.slice(0, summonSymbolStart).replace(/\s+$/, '')
  summonSymbolStart = -1
  nextTick(() => focusInputEnd())
}

function keepDraftAndAppend(suffix: string) {
  const value = inputText.value
  if (summonSymbolStart < 0) {
    inputText.value = suffix
    nextTick(() => focusInputEnd())
    return
  }
  const draft = value.slice(0, summonSymbolStart).replace(/\s+$/, '')
  inputText.value = draft ? `${draft} ${suffix}` : suffix
  summonSymbolStart = -1
  nextTick(() => focusInputEnd())
}

/* ── 键盘 ── */
const { getRegisteredKeys } = useShortcuts()
/** 发送按钮 Tooltip 的键位块（读注册表当前值，改键后自动同步） */
const sendKeysLabel = computed(() => formatKeysForDisplay(getRegisteredKeys('chat.send') ?? ['enter']))
/** 发送/换行键位匹配：读注册表（chat.send / chat.newline，AgentSpace 常驻注册、
    设置面板可改键，默认 Enter / Shift+Enter），回退注册处默认值 */
function matchesKeys(e: KeyboardEvent, id: string, fallback: string[]): boolean {
  const keys = getRegisteredKeys(id) ?? fallback
  const pressed = [...normalizeKeys(e)].sort()
  const want = [...keys].sort()
  return pressed.length === want.length && pressed.every((k, i) => k === want[i])
}

function onKeydown(e: KeyboardEvent) {
  // IME 组合期（中文输入法确认候选词）不发送、不导航
  if (e.isComposing || e.keyCode === 229) return
  // 菜单可见且有关键导航键时，交给菜单
  if (summonMenuVisible.value && hasSummonMatches.value
    && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
    summonMenuRef.value?.handleKeydown(e)
    return
  }
  // Escape 始终关闭/回退菜单
  if (summonMenuVisible.value && e.key === 'Escape') {
    summonMenuRef.value?.handleKeydown(e)
    return
  }
  // 发送（键位可配置，默认 Enter）；换行（默认 Shift+Enter）走 textarea 默认行为放行
  if (matchesKeys(e, 'chat.send', ['enter'])) {
    e.preventDefault()
    onSend()
  }
}

/* ── 召唤菜单选中路由 ── */
function handleSummonSelect(item: SummonItem) {
  // params 模式：选中枚举值 → 执行命令
  if (menuMode.value === 'params' && pendingCommand.value) {
    executeCommand(pendingCommand.value, item.payload)
    removeSummonSymbolKeepDraft()
    closeSummonMenu()
    return
  }
  // references 模式：选中引用 → 添加 chip
  if (menuMode.value === 'references' && pendingReference.value) {
    addReferenceChip(item)
    return
  }
  switch (item.kind) {
    case 'command':
      if (item.params && item.params.length > 0 && item.params[0].type === 'enum') {
        enterParamsMode(item)
        return
      }
      executeCommand(item)
      removeSummonSymbolKeepDraft()
      closeSummonMenu()
      break
    case 'skill':
    case 'pipeline':
      addChip(item)
      break
    case 'panel':
    case 'asset':
    case 'region':
      summonRegion(item)
      removeSummonSymbolKeepDraft()
      closeSummonMenu()
      break
    case 'reference':
      enterReferencesMode(item)
      break
  }
}

function executeCommand(item: SummonItem, _paramValue?: string) {
  if (item.payload === 'help') {
    const summary = allSummonItems.value.map((i) => `${i.prefix}${i.name}`).join('  ')
    toastInfo(`召唤指令：${summary}；输入 @ 可引用世界设定实体`)
  }
}

function summonRegion(item: SummonItem) {
  // # 应用层面板
  if (item.kind === 'panel') {
    switch (item.payload) {
      case 'exec': spaceStore.toggleExecPanel(); break
      case 'config': spaceStore.toggleConfigMemory(); break
      case 'sessions': spaceStore.toggleSessionSidebar(); break
    }
    return
  }
  // ~ Agent 持久化资产
  if (item.kind === 'asset') {
    switch (item.payload) {
      case 'knowledge':
        spaceStore.setSessionSidebarOpen(true)
        spaceStore.setSessionSidebarTab('knowledge')
        break
      case 'memory': spaceStore.toggleConfigMemory(); break
    }
    return
  }
  // ！创作区视图 → 切换到芽视图
  if (item.kind === 'region') {
    const view = pluginStore.getView(item.payload)
    if (view) {
      uiStore.setView(view.id)
      uiStore.viewComponent = view.component
    }
    return
  }
}

function addChip(item: SummonItem) {
  if (summonChips.value.some((c) => c.id === item.id)) {
    removeSummonSymbolKeepDraft()
    closeSummonMenu()
    return
  }
  summonChips.value = [...summonChips.value, item]
  removeSummonSymbolKeepDraft()
  closeSummonMenu()
}

function addReferenceChip(item: SummonItem) {
  if (summonChips.value.some((c) => c.referenceId && c.referenceId === item.referenceId)) {
    removeSummonSymbolKeepDraft()
    closeSummonMenu()
    return
  }
  summonChips.value = [...summonChips.value, item]
  removeSummonSymbolKeepDraft()
  closeSummonMenu()
}

function removeChip(index: number) {
  summonChips.value = summonChips.value.filter((_, i) => i !== index)
}

function enterParamsMode(item: SummonItem) {
  menuMode.value = 'params'
  pendingCommand.value = item
  paramFilter.value = ''
  keepDraftAndAppend(`${item.prefix}${item.name} `)
  summonMenuVisible.value = true
  updateMenuPosition()
}

function exitParamsMode() {
  menuMode.value = 'primary'
  pendingCommand.value = null
  paramFilter.value = ''
}

async function enterReferencesMode(item: SummonItem) {
  menuMode.value = 'references'
  pendingReference.value = item
  referenceFilter.value = ''
  referenceItems.value = []
  referenceLoading.value = true
  referenceEmptyHint.value = ''
  keepDraftAndAppend(`${item.prefix}${item.name} `)
  summonMenuVisible.value = true
  updateMenuPosition()
  try {
    const entityStore = useEntityStore()
    let list = entityStore.entities
    if (!list.length) {
      await entityStore.loadAll()
      list = entityStore.entities
    }
    // 按所选引用类型过滤（all 为全部）
    const refType = item.payload
    if (refType !== 'all') list = list.filter((e) => e.type === refType)
    referenceItems.value = list.map((e) => ({
      id: `ref-${e.id}`,
      prefix: '@',
      name: e.name || e.id,
      description: e.type,
      icon: 'document',
      kind: 'reference' as const,
      payload: e.type, // 携带实体类型，发送时随载荷传给 Agent
      referenceId: e.id,
      referenceName: e.name || e.id,
    }))
    if (!referenceItems.value.length) {
      referenceEmptyHint.value = refType === 'all' ? '暂无可用实体，可在世界设定中创建' : `暂无「${item.name}」实体`
    }
  } catch (err) {
    console.error('[summon] 加载引用失败:', err)
    referenceEmptyHint.value = '加载失败，请稍后重试'
  } finally {
    referenceLoading.value = false
  }
  nextTick(() => focusInputEnd())
}

function exitReferencesMode() {
  menuMode.value = 'primary'
  pendingReference.value = null
  referenceFilter.value = ''
  referenceItems.value = []
  referenceLoading.value = false
  referenceEmptyHint.value = ''
}

function handleSummonCancel() {
  if (menuMode.value === 'references') {
    exitReferencesMode()
    keepDraftAndAppend(summonPrefix.value)
    summonFilter.value = ''
    return
  }
  if (menuMode.value === 'params') {
    exitParamsMode()
    keepDraftAndAppend(summonPrefix.value)
    summonFilter.value = ''
    return
  }
  removeSummonSymbolKeepDraft()
  closeSummonMenu()
}

function closeSummonMenu() {
  summonMenuVisible.value = false
  summonPrefix.value = ''
  summonFilter.value = ''
  summonSymbolStart = -1
  menuMode.value = 'primary'
  pendingCommand.value = null
  paramFilter.value = ''
  pendingReference.value = null
  referenceFilter.value = ''
  referenceItems.value = []
  referenceLoading.value = false
  referenceEmptyHint.value = ''
}

function focusInputEnd() {
  const ta = textareaRef.value
  if (!ta) return
  ta.focus()
  const len = ta.value.length
  ta.setSelectionRange(len, len)
}

/* ── 工具栏符号插入（已移除按钮，保留符号直接输入触发召唤系统） ── */

/* ── 语音输入（Web Speech API 实时转文字）── */
const isListening = ref(false)
const voiceHint = ref('')
let recognition: any = null

function ensureRecognition(): any {
  if (recognition) return recognition
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SR) return null
  recognition = new SR()
  recognition.interimResults = true
  recognition.onresult = (e: any) => {
    let interim = ''
    let final = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) final += t
      else interim += t
    }
    if (final) {
      // 最终结果提交进输入框
      inputText.value += final
      isExpanded.value = true
    }
    voiceHint.value = interim ? `正在聆听：${interim}` : '正在聆听…'
  }
  recognition.onend = () => {
    // 连续模式：识别会话自然结束后自动重启（除非用户已手动停止，isListening 为 false）
    if (isListening.value && settingsStore.voiceContinuous) {
      try {
        recognition?.start()
        return
      } catch {}
    }
    isListening.value = false
    voiceHint.value = ''
  }
  recognition.onerror = (e: any) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      isListening.value = false
      voiceHint.value = ''
      toastWarn('麦克风权限被拒绝，请在系统设置中允许后重试')
    } else if (e.error !== 'no-speech') {
      isListening.value = false
      voiceHint.value = ''
      toastWarn(`语音识别失败：${e.error || '未知错误'}`)
    }
    // no-speech 等非致命错误保持识别状态，交由 onend 决定是否（连续模式）重启
  }
  return recognition
}

function toggleVoice() {
  if (isListening.value) {
    isListening.value = false // 标记停止，阻止 onend 自动重启
    voiceHint.value = ''
    try { recognition?.stop() } catch {}
    return
  }
  const sr = ensureRecognition()
  if (!sr) {
    toastWarn('当前环境不支持语音识别，请使用 Chrome / Edge 浏览器')
    return
  }
  // 应用设置：识别语言（auto 交由浏览器默认）+ 连续模式
  sr.lang = settingsStore.voiceLang === 'auto' ? undefined : settingsStore.voiceLang
  sr.continuous = settingsStore.voiceContinuous
  try {
    sr.start()
    isListening.value = true
    isExpanded.value = true
    voiceHint.value = '正在聆听…'
  } catch {
    toastWarn('语音启动失败，请重试')
  }
}

function stopVoice() {
  if (recognition) {
    try { recognition.abort() } catch {}
  }
}

/* ── 发送 ── */
function buildFullText(): string {
  const kbPrefix = kbChips.value.map((c) => c.ref).join('')
  // 管线前缀必须在最前（作为消息首 token，供后端 extract_force_pipeline 命中）
  const pipelinePrefix = summonChips.value.filter((c) => c.kind === 'pipeline').map((c) => c.payload).join('')
  const skillPrefix = summonChips.value.filter((c) => c.kind === 'skill').map((c) => c.payload).join('')
  return (kbPrefix + pipelinePrefix + skillPrefix + inputText.value.trim()).trim()
}

function collectReferences(): ReferencePayload[] {
  return summonChips.value
    .filter((c) => c.kind === 'reference' && c.referenceId)
    .map((c) => ({
      id: c.referenceId as string,
      name: c.referenceName || c.name,
      type: c.payload,
    }))
}

function onSend() {
  const fullText = buildFullText()
  if ((!fullText && !attachments.value.length && !summonChips.value.length) || isStreaming.value) return
  if (menuMode.value === 'params' || menuMode.value === 'references') return
  if (summonMenuVisible.value && hasSummonMatches.value) return
  const hasImages = attachments.value.some((a) => a.type === 'image')
  if (hasImages && !visionSupported()) {
    showVisionWarning('当前模型不支持图片理解，请切换到支持视觉的模型')
    return
  }
  const currentAttachments = [...attachments.value]
  const currentReferences = collectReferences()
  inputText.value = ''
  kbChips.value = []
  summonChips.value = []
  attachments.value = []
  // 2026-08-12：高度固定由 CSS 控制（4.5em），无需行内重置，否则会覆盖固定三行高
  emit('send', fullText, currentAttachments, currentReferences.length ? currentReferences : undefined)
}

function onStop() {
  abort()
}

function onModelChange(_provider: string, _modelId: string) {
  // 模型已由 ModelSwitcher 内部更新，此处留空供扩展
}

function onFocus() {
  isFocused.value = true
  isExpanded.value = true
}

function onBlur() {
  isFocused.value = false
  if (summonMenuVisible.value) closeSummonMenu()
  if (!inputText.value.trim() && !attachments.value.length && !summonChips.value.length && !kbChips.value.length) {
    isExpanded.value = false
  }
}

/* ── 附件（图片 / 文件） ── */
function visionSupported(): boolean {
  const model = currentModelId()
  return !!model && modelSupportsVision(model)
}

function showVisionWarning(msg: string): void {
  visionWarning.value = msg
  setTimeout(() => { visionWarning.value = '' }, 4000)
}

async function compressImage(dataUrl: string, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
        resolve({ base64: dataUrl.split(',')[1], mimeType })
        return
      }
      const scale = MAX_IMAGE_DIMENSION / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve({ base64: dataUrl.split(',')[1], mimeType })
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      const compressed = canvas.toDataURL(mimeType, 0.9)
      resolve({ base64: compressed.split(',')[1], mimeType })
    }
    img.onerror = () => resolve({ base64: dataUrl.split(',')[1], mimeType })
    img.src = dataUrl
  })
}

/** 音频/视频转录：调用桌面端 whisper 后端，返回文本后作为附件 */
function transcribeMedia(file: File): void {
  if (!(isTauri() && hasTauriInvoke())) {
    showVisionWarning('音频/视频转录需在桌面端使用，浏览器预览不支持')
    return
  }
  const reader = new FileReader()
  reader.onload = async () => {
    const dataUrl = reader.result as string
    const base64 = dataUrl.split(',')[1] || ''
    showVisionWarning(`正在转录「${file.name}」，请稍候…`)
    try {
      const text = (await invoke('transcribe_media', { data: base64, name: file.name })) as string
      attachments.value.push({
        type: 'file',
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        data: '',
        textContent: text && text.trim() ? text : '[转录结果为空]',
      })
      isExpanded.value = true
    } catch (err) {
      console.error('[transcribe] 转录失败:', err)
      showVisionWarning(`转录失败：${String(err)}`)
    }
  }
  reader.readAsDataURL(file)
}

function processFile(file: File): void {
  if (IMAGE_TYPES.includes(file.type)) {
    if (!visionSupported()) {
      showVisionWarning('当前模型不支持图片理解，请切换到支持视觉的模型')
      return
    }
    const currentImageCount = attachments.value.filter((a) => a.type === 'image').length
    if (currentImageCount >= MAX_IMAGE_COUNT) {
      showVisionWarning(`最多同时发送 ${MAX_IMAGE_COUNT} 张图片`)
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      showVisionWarning(`图片大小不能超过 ${MAX_IMAGE_SIZE / 1024 / 1024}MB`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      compressImage(dataUrl, file.type).then((compressed) => {
        attachments.value.push({
          type: 'image',
          name: file.name,
          mimeType: compressed.mimeType,
          data: compressed.base64,
          previewUrl: dataUrl,
        })
      })
    }
    reader.readAsDataURL(file)
    return
  }

  // 音频/视频：桌面端调用 whisper 转录成文本后作为附件发送
  if (AUDIO_VIDEO_RE.test(file.type)) {
    transcribeMedia(file)
    return
  }

  extractDocumentText(file).then((extracted) => {
    if (extracted) {
      attachments.value.push({
        type: 'file',
        name: extracted.name,
        mimeType: extracted.mimeType,
        data: '',
        textContent: extracted.textContent,
      })
      return
    }
    attachments.value.push({
      type: 'file',
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      data: '',
      textContent: `[不支持的文件类型: ${file.type || '未知'}，已作为附件记录]`,
    })
  })
}

function removeAttachment(index: number): void {
  attachments.value.splice(index, 1)
}

function onPaste(e: ClipboardEvent): void {
  if (!e.clipboardData?.items) return
  const imageItems = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith('image/'))
  if (imageItems.length === 0) return
  if (!visionSupported()) {
    showVisionWarning('当前模型不支持图片理解，请切换到支持视觉的模型')
    return
  }
  const currentCount = attachments.value.filter((a) => a.type === 'image').length
  const remaining = MAX_IMAGE_COUNT - currentCount
  if (remaining <= 0) {
    showVisionWarning(`最多同时发送 ${MAX_IMAGE_COUNT} 张图片`)
    return
  }
  const toProcess = imageItems.slice(0, remaining)
  for (const item of toProcess) {
    const file = item.getAsFile()
    if (file) processFile(file)
  }
  if (imageItems.length > remaining) {
    showVisionWarning(`已添加 ${remaining} 张图片，已达上限 ${MAX_IMAGE_COUNT}`)
  }
}

function onDrop(e: DragEvent): void {
  isDragOver.value = false
  if (!e.dataTransfer?.files.length) return
  for (const file of Array.from(e.dataTransfer.files)) {
    processFile(file)
  }
  isExpanded.value = true
  nextTick(() => textareaRef.value?.focus())
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

function onFileInputChange(e: Event): void {
  const target = e.target as HTMLInputElement
  if (!target.files?.length) return
  for (const file of Array.from(target.files)) {
    processFile(file)
  }
  target.value = ''
  isExpanded.value = true
}

function removeKbChip(index: number): void {
  kbChips.value.splice(index, 1)
  if (!inputText.value.trim() && !attachments.value.length && !kbChips.value.length && !summonChips.value.length) {
    isExpanded.value = false
  }
}

/* ── 监听知识墙挂载注入 ── */
watch(() => spaceStore.inputInjection, (injection) => {
  if (injection) {
    kbChips.value.push(injection)
    spaceStore.inputInjection = null
    isExpanded.value = true
    nextTick(() => {
      textareaRef.value?.focus()
    })
  }
})

onMounted(() => {
  startPlaceholderRotation()
  // Phase 4：刷新目录实体列表，供输入栏目录选择器下拉候选（浏览器 preview 走 mock 兜底）
  const backend = useAgent()
  if (typeof backend.loadWorkdirs === 'function') void backend.loadWorkdirs()
})

onBeforeUnmount(() => {
  stopPlaceholderRotation()
  stopVoice()
  if (summonRafId !== null) cancelAnimationFrame(summonRafId)
  document.removeEventListener('keydown', onPermDocKeydown)
})
</script>

<style scoped>
.chat-input-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 16px 14px;
  background: transparent;
  position: relative;
}

/* ── 手动压缩回执提示条（/compact 指令与上下文面板共用回执）── */
.compact-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  width: min(var(--conv-w), calc(100% - 2vw));
  max-width: min(var(--conv-w), calc(100% - 2vw));
  box-sizing: border-box;
  margin: 0 0 6px;
  padding: 5px 8px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-primary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.compact-hint.is-err {
  border-left-color: var(--color-warning);
  color: var(--color-warning);
}
.compact-hint-icon { flex-shrink: 0; color: var(--color-primary); }
.compact-hint.is-err .compact-hint-icon { color: var(--color-warning); }
.compact-hint-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.compact-hint-close {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-tertiary);
  cursor: pointer;
}
.compact-hint-close:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.compact-hint-enter-active,
.compact-hint-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.compact-hint-enter-from,
.compact-hint-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
:root[data-anim-panels='off'] .compact-hint-enter-from,
:root[data-anim-panels='off'] .compact-hint-leave-to {
  transform: none;
}

/* ── 双层输入框（[C] 宽度联动：以 W=75vw 为上限（原55vw向左右各扩10%）；主区被左栏/右栏挤窄时收缩到主区-2vw，左右各留 1vw 缝） ── */
.chat-input-box {
  width: min(var(--conv-w), calc(100% - 2vw));
  max-width: min(var(--conv-w), calc(100% - 2vw));
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s,
              width 0.35s cubic-bezier(0.4, 0, 0.2, 1), max-width 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  contain: layout paint style;
}

/* 任务1（2026-09-05）：空会话居中态左右外边距各扩大10%（75vw→55vw，与 55→75 扩宽口径对称）；
   首条消息发送进入下沉态后移除本覆盖，恢复 75vw（.docked 由 SpaceChat 按消息数驱动） */
.chat-input-area:not(.docked) .chat-input-box {
  width: min(55vw, calc(100% - 2vw));
  max-width: min(55vw, calc(100% - 2vw));
}

.chat-input-box.focused {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-muted);
}

.chat-input-box.drag-over {
  border-color: var(--color-primary);
  background: var(--color-primary-muted);
  box-shadow: 0 0 0 2px var(--color-primary);
}

/* ── 上层胶囊输入区 ──
   08-13：textarea 垂直 padding 归零，垂直留白由本层 padding 提供（上12 下4）；
   上层固定 70px = 12 + textarea 54 + 4；首行落位固定于胶囊顶 12px 处，滚动不再偏移 */
.input-capsule {
  display: flex;
  padding: 12px 12px 4px;
  height: 70px;
  box-sizing: border-box;
}

.input-stack {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.chips-area {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 0 4px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px 2px 8px;
  background: var(--color-primary-muted);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  color: var(--color-primary);
  max-width: 180px;
  line-height: 1.4;
}

.chip-kb {
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-color: var(--color-border);
}

.chip-reference {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-success) 40%, transparent);
}

/* 四管线 Chip（force_pipeline 强制路由）——琥珀色区分，前缀加粗 */
.chip-pipeline {
  color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
}
.chip-pipeline .chip-prefix {
  font-weight: 700;
}

.chip-prefix {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-weight: 600;
  opacity: 0.8;
}

.chip-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.chip-remove {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  padding: 0;
  opacity: 0.6;
}

.chip-remove:hover {
  opacity: 1;
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

/* 附件 */
.attachments-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 6px;
}

.att-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xl);
  font-size: var(--font-size-xs);
  color: var(--color-text);
  max-width: 220px;
}

.att-image {
  background: transparent;
  border: 1px dashed var(--color-border);
  padding: 2px;
}

.att-thumb {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: var(--radius-mid);
  flex-shrink: 0;
}

.att-file-icon {
  display: flex;
  flex-shrink: 0;
}

.att-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.att-remove {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex-shrink: 0;
  padding: 0;
}

.att-remove:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

/* textarea + 占位符
   08-13：textarea 撑满上层剩余空间（flex），上层固定高度容纳约 4 行，
   textarea 底部贴合上层底部，超出 4 行再滚动 */
.textarea-wrap {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
}

.chat-textarea {
  flex: none;
  resize: none;
  border: none;
  border-radius: var(--radius-2xl);
  /* 08-13：垂直 padding 归零、仅留水平；垂直留白由外层胶囊控制，
     避免溢出滚动时浏览器压缩 padding 导致首行落位偏移 */
  padding: 0 8px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  background: transparent;
  color: var(--color-text);
  line-height: 1.5;
  /* 精确 3 行（54px），第 4 行滚动且完全不可见 */
  height: 54px;
  box-sizing: border-box;
  overflow-y: auto;
  outline: none;
  width: 100%;
}

/* 2026-08-12：豁免全局 textarea:focus 光环（theme.css 全局规则），
   聚焦态统一由外层 .chat-input-box.focused 的 2px 主色环指示，避免双重胶囊长条 */
.chat-textarea:focus {
  box-shadow: none;
  border-color: transparent;
}

.ph-overlay {
  position: absolute;
  top: 0;
  left: 8px;
  /* 08-13：与 textarea 首行对齐（首行顶于内容区顶部，padding 归零） */
  padding: 0;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--color-text-tertiary);
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: calc(100% - 16px);
}

.ph-enter-active,
.ph-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.ph-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.ph-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ── 下层常驻工具栏（2026-08-12：中线移除；08-13 缩短 padding，中线下沉） ── */
.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-center {
  flex: 1;
  min-width: 0;
  text-align: center;
  overflow: hidden;
}

.mode-label {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  white-space: nowrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tool-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}

.tool-btn:hover {
  background: var(--color-surface);
  color: var(--color-primary);
}

.tool-btn.voice-active {
  color: var(--color-danger);
  background: color-mix(in srgb, var(--color-danger) 12%, transparent);
  animation: stop-pulse 1.2s ease-in-out infinite;
}

/* P0-4 迭代：权限分级图标下拉 */
.perm-dd { position: relative; display: flex; align-items: center; margin-left: 6px; }
.perm-dd-trigger.on { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 14%, transparent); }
.perm-dd-trigger.warn { color: var(--color-warning); }
.perm-dd-trigger.warn.on { background: color-mix(in srgb, var(--color-warning) 16%, transparent); }
.perm-backdrop { position: fixed; inset: 0; z-index: 1000; }
/* I1 修复：菜单随 backdrop 一同 Teleport 到 body，改 absolute→fixed（bottom/right 由内联定位注入） */
.perm-dd-menu {
  position: fixed;
  min-width: 150px;
  display: flex; flex-direction: column; gap: 2px;
  padding: 4px;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  z-index: 1001;
  backdrop-filter: blur(16px);
}
.perm-dd-item {
  display: flex; flex-direction: column; gap: 1px; align-items: flex-start;
  padding: 6px 9px; border: none; background: transparent; border-radius: var(--radius-sm, 6px);
  cursor: pointer; text-align: left; transition: background 0.12s;
}
.perm-dd-item:hover { background: var(--color-surface); }
.perm-dd-item.on { background: color-mix(in srgb, var(--color-primary) 14%, transparent); }
.perm-dd-label { font-size: var(--font-size-xs); color: var(--color-text); }
.perm-dd-desc { font-size: var(--font-size-2xs, 10px); color: var(--color-text-tertiary); }
.perm-dd-item.on .perm-dd-label { color: var(--color-primary); }
.perm-dd-item.warn .perm-dd-label { color: var(--color-warning); }
.perm-fade-enter-active, .perm-fade-leave-active { transition: opacity 0.12s ease; }
.perm-fade-enter-from, .perm-fade-leave-to { opacity: 0; }

.voice-hint {
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
  color: var(--color-primary);
}

/* 发送按钮（2026-09-05 改造）：原实底方框移除，改描边图标态——
   待发=主色虚线箭头，悬停浮出 surface 高亮底；运行态=红色箭头以自身中心八角步进旋转（steps(8)，45°/步） */
.send-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--color-primary);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s, opacity 0.2s;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.send-btn:not(:disabled):hover {
  background: var(--color-surface);
}

.send-btn.stop-btn {
  color: var(--color-danger);
}

.send-icon {
  transform-origin: center;
}

.send-icon.spinning {
  animation: send-octo-spin 1.6s steps(8) infinite;
}

@keyframes send-octo-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.hidden-file-input {
  display: none;
}

.vision-warning {
  margin-top: 8px;
  padding: 6px 12px;
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
  border-radius: var(--radius-mid);
  font-size: var(--font-size-xs);
  color: var(--warning);
  text-align: center;
  max-width: 80%;
}

.warning-fade-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.warning-fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.warning-fade-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}
.warning-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

:root[data-anim-messages='off'] .send-icon.spinning {
  animation: none;
}
:root[data-anim-messages='off'] .ph-enter-from,
:root[data-anim-messages='off'] .ph-leave-to {
  transform: none;
}
</style>
