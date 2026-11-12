<template>
  <!--
    脚本式（ScriptForm）—— 就地型表现形式（2026-10-19 新增，结构化三字段）
    理论取值：脚本式（文档 §一 表现形式 9 取值之一）。
    · 一个节点 = 一场戏：场景（properties.scene）/ 台词（properties.dialogue）/ 动作（properties.action）
    · 三段**各自独立**编辑与导出；双击任一段就地编辑（用户 2026-10-19 拍板 B 方案）
    · 长度语义：场景 ≤100 / 台词 ≤1000 / 动作 ≤500（计数提示，不硬截断）
  -->
  <div class="scf">
    <!-- 场景（单行） -->
    <div class="scf-scene">
      <span class="scf-tag">场景</span>
      <input
        v-if="editingField === 'scene'"
        :ref="setSceneRef"
        v-model="draft"
        class="scf-input"
        placeholder="内景 / 外景 · 地点 · 时间"
        @keydown.enter="guardEnter($event, commit)"
        @keydown.esc="guardEsc($event, cancel)"
        @blur="commit"
        @dblclick.stop
      />
      <span
        v-else
        class="scf-scene-text"
        :class="{ 'scf-empty': !hasScene }"
        :title="scene"
        @dblclick.stop="startEdit('scene')"
      >{{ displayScene }}</span>
    </div>

    <!-- 台词（多行） -->
    <div v-if="showDialogue" class="scf-block">
      <span class="scf-tag">台词</span>
      <textarea
        v-if="editingField === 'dialogue'"
        :ref="setDialogueRef"
        v-model="draft"
        class="scf-input scf-input--multi"
        :rows="rowsOf(draft, 3, 12)"
          @keydown.enter="guardEnter($event, commit, { ctrl: true })"
          @keydown.esc="guardEsc($event, cancel)"
        @blur="commit"
        @dblclick.stop
      />
      <pre
        v-else
        class="scf-text"
        :class="{ 'scf-empty': !hasDialogue }"
        :title="dialogue"
        @dblclick.stop="startEdit('dialogue')"
      >{{ displayDialogue }}</pre>
    </div>

    <!-- 动作（多行） -->
    <div v-if="showAction" class="scf-block">
      <span class="scf-tag">动作</span>
      <textarea
        v-if="editingField === 'action'"
        :ref="setActionRef"
        v-model="draft"
        class="scf-input scf-input--multi"
        :rows="rowsOf(draft, 2, 8)"
          @keydown.enter="guardEnter($event, commit, { ctrl: true })"
          @keydown.esc="guardEsc($event, cancel)"
        @blur="commit"
        @dblclick.stop
      />
      <pre
        v-else
        class="scf-text"
        :class="{ 'scf-empty': !hasAction }"
        :title="action"
        @dblclick.stop="startEdit('action')"
      >{{ displayAction }}</pre>
    </div>

    <div v-if="editingField" class="scf-count" :class="{ 'scf-count--over': over }">
      {{ draftChars }} / {{ limitOf(editingField) }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 脚本式：场景 / 台词 / 动作三段，各自就地编辑（同一时刻只有一个编辑态）。
 *
 * 2026-10-19 用户拍板 B 方案（结构化三字段）而非单字段长文本：
 * 场景标题可单独检索与跳转，台词/动作分别可导出——合并成一坨会丢掉这些能力。
 *
 * Q1′ 依据：三段都是「形式专属内容字段」——ownFields 已声明、本组件唯一写入入口、各自有软上限。
 */
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { resolveFormConfig } from './registry'
import { injectBoardUndo } from '../composables/useBoardUndo'
import { guardEnter, guardEsc } from './enterGuard'
import { entitiesSvc } from '../../serviceAccess'

const WRITE_DEBOUNCE = 400

/** 各段软上限（计数提示，不硬截断） */
const LIMITS = { scene: 100, dialogue: 1000, action: 500 } as const

type EditField = 'scene' | 'dialogue' | 'action'

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = entitiesSvc()
const boardUndo = injectBoardUndo()

const node = computed(() => (es.list() ?? []).find(e => e.id === props.nodeId))
const cfg = computed(() => resolveFormConfig('script', props.config))
const showDialogue = computed(() => cfg.value.showDialogue !== false)
const showAction = computed(() => cfg.value.showAction !== false)

function valueOf(field: EditField): string {
  return String(node.value?.properties?.[field] ?? '')
}

const scene = computed(() => valueOf('scene'))
const dialogue = computed(() => valueOf('dialogue'))
const action = computed(() => valueOf('action'))
const hasScene = computed(() => !!scene.value.trim())
const hasDialogue = computed(() => !!dialogue.value.trim())
const hasAction = computed(() => !!action.value.trim())

const displayScene = computed(() => scene.value.trim() || '双击写场景（内景 / 外景 · 地点 · 时间）')
const displayDialogue = computed(() => dialogue.value.trim() || '双击写台词（角色：台词）')
const displayAction = computed(() => action.value.trim() || '双击写动作描述')

function limitOf(field: EditField): number {
  return LIMITS[field]
}

// ── 就地编辑（三段共用一个编辑态） ──
const editingField = ref<EditField | null>(null)
const draft = ref('')
const sceneEl = ref<HTMLInputElement | null>(null)
const dialogueEl = ref<HTMLTextAreaElement | null>(null)
const actionEl = ref<HTMLTextAreaElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let sessionPrev = ''

function setSceneRef(el: Element | ComponentPublicInstance | null): void {
  sceneEl.value = (el as HTMLInputElement | null) ?? null
}
function setDialogueRef(el: Element | ComponentPublicInstance | null): void {
  dialogueEl.value = (el as HTMLTextAreaElement | null) ?? null
}
function setActionRef(el: Element | ComponentPublicInstance | null): void {
  actionEl.value = (el as HTMLTextAreaElement | null) ?? null
}

const draftChars = computed(() => (draft.value ?? '').length)
const over = computed(() => (editingField.value ? draftChars.value > limitOf(editingField.value) : false))

function rowsOf(value: string, min: number, max: number): number {
  const lines = String(value ?? '').split(/\r?\n/).length
  return Math.min(Math.max(lines, min), max)
}

/** 写 properties.<field>：实体更新对 properties 是整体替换，必须先合并 */
function writeField(field: EditField, value: string): void {
  const next = value.trim()
  if (next === valueOf(field).trim()) return
  const nextProps = { ...(node.value?.properties ?? {}), [field]: next }
  void es.update(props.nodeId, { properties: nextProps }, 'user', { skipUndo: true })
}

const FIELD_LABEL: Record<EditField, string> = { scene: '改场景', dialogue: '改台词', action: '改动作' }

async function startEdit(field: EditField): Promise<void> {
  if (!node.value || editingField.value) return
  editingField.value = field
  sessionPrev = valueOf(field)
  draft.value = sessionPrev
  await nextTick()
  const el = field === 'scene' ? sceneEl.value : field === 'dialogue' ? dialogueEl.value : actionEl.value
  el?.focus()
  if (field === 'scene') sceneEl.value?.select()
}

function commit(): void {
  const field = editingField.value
  if (!field) return
  if (timer) { clearTimeout(timer); timer = null }
  writeField(field, draft.value)
  const next = (draft.value ?? '').trim()
  if (sessionPrev.trim() !== next) {
    const prevProps = { ...(node.value?.properties ?? {}), [field]: sessionPrev }
    const nextProps = { ...(node.value?.properties ?? {}), [field]: next }
    boardUndo?.recordContentEdit(props.nodeId, { properties: prevProps }, { properties: nextProps }, FIELD_LABEL[field])
  }
  editingField.value = null
  sessionPrev = ''
}

function cancel(): void {
  const field = editingField.value
  if (timer) { clearTimeout(timer); timer = null }
  if (field && valueOf(field) !== sessionPrev) writeField(field, sessionPrev)
  editingField.value = null
  sessionPrev = ''
}

watch(draft, v => {
  const field = editingField.value
  if (!field) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { if (editingField.value === field) writeField(field, v) }, WRITE_DEBOUNCE)
})

watch(() => props.nodeId, () => {
  if (timer) { clearTimeout(timer); timer = null }
  editingField.value = null
  sessionPrev = ''
})

defineExpose({ startEdit, commit, cancel })
</script>

<style scoped>
.scf {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0 4px 8px;
  border-left: 2px solid var(--border-color);
  min-width: 0;
}
.scf-scene { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.scf-tag {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  letter-spacing: 0.05em;
}
.scf-scene-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--text-color);
  cursor: text;
}
.scf-block { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.scf-text {
  margin: 0;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: var(--font-size-2xs);
  line-height: 1.6;
  color: var(--text-secondary);
  cursor: text;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}
.scf-empty { font-style: italic; color: var(--text-tertiary); }
.scf-input {
  width: 100%;
  min-width: 60px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-family: inherit;
  font-size: var(--font-size-xs);
  padding: 1px 4px;
  outline: none;
}
.scf-input--multi {
  font-size: var(--font-size-2xs);
  line-height: 1.6;
  resize: vertical;
}
.scf-count { align-self: flex-end; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.scf-count--over { color: var(--warning, #d97706); }
</style>
