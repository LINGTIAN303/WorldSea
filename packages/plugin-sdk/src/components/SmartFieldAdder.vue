<template>
  <Teleport to="body">
    <div v-if="visible" class="sfa-backdrop" @click.self="cancel">
      <div ref="dialogRef" class="sfa-dialog" role="dialog" aria-modal="true" aria-labelledby="sfa-title" tabindex="-1">
        <div class="sfa-header">
          <span id="sfa-title" class="sfa-title">添加自定义字段</span>
          <button class="sfa-close" @click="cancel"><WsIcon name="x" size="sm" /></button>
        </div>

        <div class="sfa-body">
          <!-- 字段名输入 -->
          <div class="sfa-field">
            <label class="sfa-label">字段名</label>
            <input
              ref="keyInput"
              v-model="fieldKey"
              class="sfa-input"
              placeholder="输入字段名，如：故乡、武器、势力"
              @input="onKeyInput"
            />
          </div>

          <!-- 语义推断结果 -->
          <div v-if="inferenceResult" class="sfa-inference">
            <WsIcon name="zap" size="xs" class="sfa-inference-icon" />
            <span class="sfa-inference-text">
              检测到语义：<strong>{{ inferenceResult.label }}</strong>
              <template v-if="inferenceResult.targetLabel"> → 关联 <strong>{{ inferenceResult.targetLabel }}</strong></template>
            </span>
            <button class="sfa-adopt-btn" @click="adoptInference">采纳</button>
          </div>

          <!-- 字段类型 -->
          <div class="sfa-field">
            <label class="sfa-label">字段类型</label>
            <select v-model="fieldType" class="sfa-select">
              <option value="text">文本</option>
              <option value="textarea">长文本</option>
              <option value="number">数字</option>
              <option value="boolean">开关</option>
              <option value="date">日期</option>
              <option value="select">选项</option>
              <option value="color">颜色</option>
            </select>
          </div>

          <!-- 选项（select 类型时显示） -->
          <div v-if="fieldType === 'select'" class="sfa-field">
            <label class="sfa-label">选项列表</label>
            <input v-model="fieldOptions" class="sfa-input" placeholder="用逗号分隔，如：金,木,水,火,土" />
          </div>

          <!-- 关联设置 -->
          <div class="sfa-section">
            <div class="sfa-section-header" @click="showLinkConfig = !showLinkConfig">
              <WsIcon :name="showLinkConfig ? 'chevron-down' : 'chevron-right'" size="xs" />
              <span>关联设置</span>
              <span v-if="linkTargetType" class="sfa-section-badge">已配置</span>
            </div>
            <div v-if="showLinkConfig" class="sfa-section-body">
              <div class="sfa-field">
                <label class="sfa-label">目标实体类型</label>
                <select v-model="linkTargetType" class="sfa-select">
                  <option value="">无（不关联）</option>
                  <option v-for="t in entityTypes" :key="t.type" :value="t.type">{{ t.label }}</option>
                </select>
              </div>
              <div v-if="linkTargetType" class="sfa-field">
                <label class="sfa-label">关系类型</label>
                <input v-model="linkRelationType" class="sfa-input" placeholder="如：belongs_to, located_in" />
              </div>
            </div>
          </div>

          <!-- 记住映射 -->
          <label v-if="fieldKey.trim() && (linkTargetType || inferenceResult)" class="sfa-remember">
            <input type="checkbox" v-model="rememberMapping" />
            <span>记住此映射，后续同名字段自动识别</span>
          </label>
        </div>

        <div class="sfa-footer">
          <button class="sfa-btn sfa-btn-cancel" @click="cancel">取消</button>
          <button class="sfa-btn sfa-btn-confirm" :disabled="!canConfirm" @click="confirm">添加</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import {
  inferSemanticHintFromKey,
  inferDirectTargetFromKey,
  userFieldMappingStore,
  autoLinkStrategyRegistry,
  entitySchemaRegistryV2,
} from '@worldsea/entity-core'
import type { FieldSchema, SemanticHintName, UserFieldMapping } from '@worldsea/entity-core'

const props = defineProps<{
  visible: boolean
  entityType: string
}>()

const emit = defineEmits<{
  'confirm': [data: {
    fieldDef: FieldSchema
    linkConfig?: { targetType: string; relationType: string }
    rememberMapping: boolean
  }]
  'cancel': []
}>()

const keyInput = ref<HTMLInputElement | null>(null)
const dialogRef = ref<HTMLElement | null>(null)
let previousFocus: HTMLElement | null = null

const fieldKey = ref('')
const fieldType = ref<FieldSchema['fieldType']>('text')
const fieldOptions = ref('')
const linkTargetType = ref('')
const linkRelationType = ref('')
const rememberMapping = ref(false)
const showLinkConfig = ref(false)

// 推断结果
interface InferenceResult {
  type: 'hint' | 'direct' | 'user'
  label: string
  targetLabel?: string
  hint?: SemanticHintName
  targetType?: string
  relationType: string
}

const inferenceResult = ref<InferenceResult | null>(null)

// 实体类型列表
const entityTypes = computed(() =>
  entitySchemaRegistryV2?.getAll().map(s => ({ type: s.type, label: s.label })) ?? []
)

// 语义标签的中文映射
const HINT_LABELS: Record<string, string> = {
  origin: '来源/产地',
  creator: '制作者',
  owner: '持有者',
  location: '位置',
  date: '时间',
  appearance: '外貌',
  material: '材质',
  birthDate: '诞生时间',
  deathDate: '消亡时间',
}

const canConfirm = computed(() => fieldKey.value.trim().length > 0)

// 字段名输入时实时推断
function onKeyInput() {
  const key = fieldKey.value.trim()
  if (!key) {
    inferenceResult.value = null
    linkTargetType.value = ''
    linkRelationType.value = ''
    return
  }

  // 1. 优先查用户映射
  const userMapping = userFieldMappingStore.get(key)
  if (userMapping) {
    inferenceResult.value = {
      type: 'user',
      label: '已记住的映射',
      hint: userMapping.hint,
      targetType: userMapping.targetType,
      relationType: userMapping.relationType,
      targetLabel: userMapping.targetType
        ? entityTypes.value.find(t => t.type === userMapping.targetType)?.label ?? userMapping.targetType
        : userMapping.hint ? HINT_LABELS[userMapping.hint] : undefined,
    }
    // 自动填充关联设置
    if (userMapping.targetType) {
      linkTargetType.value = userMapping.targetType
      linkRelationType.value = userMapping.relationType
    }
    return
  }

  // 2. 直接目标推断
  const directTarget = inferDirectTargetFromKey(key)
  if (directTarget) {
    const targetLabel = entityTypes.value.find(t => t.type === directTarget.targetType)?.label ?? directTarget.targetType
    inferenceResult.value = {
      type: 'direct',
      label: '关键词匹配',
      targetType: directTarget.targetType,
      relationType: directTarget.relationType,
      targetLabel,
    }
    linkTargetType.value = directTarget.targetType
    linkRelationType.value = directTarget.relationType
    return
  }

  // 3. 语义标签推断
  const hint = inferSemanticHintFromKey(key)
  if (hint) {
    const strategies = autoLinkStrategyRegistry.getByHint(hint)
    const targetTypes = strategies.length > 0 ? strategies[0].matchTargets : []
    const targetLabel = targetTypes.map(t => entityTypes.value.find(et => et.type === t)?.label ?? t).join('、')
    inferenceResult.value = {
      type: 'hint',
      label: HINT_LABELS[hint] ?? hint,
      hint,
      relationType: strategies.length > 0 ? strategies[0].relationType : 'associated_with',
      targetLabel: targetLabel || undefined,
    }
    // 不自动填充，等用户采纳
    return
  }

  inferenceResult.value = null
  linkTargetType.value = ''
  linkRelationType.value = ''
}

// 采纳推断结果
function adoptInference() {
  if (!inferenceResult.value) return
  const r = inferenceResult.value
  if (r.targetType) {
    linkTargetType.value = r.targetType
    linkRelationType.value = r.relationType
  } else if (r.hint) {
    const strategies = autoLinkStrategyRegistry.getByHint(r.hint)
    if (strategies.length > 0) {
      linkTargetType.value = strategies[0].matchTargets[0] ?? ''
      linkRelationType.value = strategies[0].relationType
    }
  }
  showLinkConfig.value = true
}

function confirm() {
  const key = fieldKey.value.trim()
  if (!key) return

  const fieldDef: FieldSchema = {
    key,
    label: key,
    fieldType: fieldType.value,
    options: fieldType.value === 'select'
      ? fieldOptions.value.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ value: s, label: s }))
      : undefined,
  }

  let linkConfig: { targetType: string; relationType: string } | undefined
  if (linkTargetType.value && linkRelationType.value) {
    linkConfig = { targetType: linkTargetType.value, relationType: linkRelationType.value }
  }

  // 记住映射
  if (rememberMapping.value && linkConfig) {
    const mapping: UserFieldMapping = {
      key,
      relationType: linkConfig.relationType,
    }
    if (inferenceResult.value?.hint && !linkTargetType.value) {
      mapping.hint = inferenceResult.value.hint
    } else {
      mapping.targetType = linkConfig.targetType
    }
    userFieldMappingStore.register(mapping)
  }

  emit('confirm', { fieldDef, linkConfig, rememberMapping: rememberMapping.value })
  resetForm()
}

function cancel() {
  emit('cancel')
  resetForm()
}

function resetForm() {
  fieldKey.value = ''
  fieldType.value = 'text'
  fieldOptions.value = ''
  linkTargetType.value = ''
  linkRelationType.value = ''
  rememberMapping.value = false
  showLinkConfig.value = false
  inferenceResult.value = null
}

// 弹窗打开时聚焦输入框 + 焦点陷阱
function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    cancel()
    return
  }
  if (e.key === 'Tab') {
    const box = dialogRef.value
    if (!box) return
    const focusables = box.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !box.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }
}

watch(() => props.visible, (v) => {
  if (v) {
    previousFocus = document.activeElement as HTMLElement
    window.addEventListener('keydown', onKeydown)
    nextTick(() => {
      keyInput.value?.focus()
    })
  } else {
    window.removeEventListener('keydown', onKeydown)
    if (previousFocus) {
      previousFocus.focus()
      previousFocus = null
    }
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.sfa-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10001;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sfa-dialog {
  background: var(--color-surface, #1e1e2e);
  border: 1px solid var(--color-border, #3a3a5a);
  border-radius: 12px;
  width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
.sfa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border, #3a3a5a);
}
.sfa-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text, #e0e0e0);
}
.sfa-close {
  background: none;
  border: none;
  color: var(--color-text-secondary, #888);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
}
.sfa-close:hover { background: var(--color-border, #3a3a5a); }

.sfa-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 14px; }

.sfa-field { display: flex; flex-direction: column; gap: 4px; }
.sfa-label { font-size: 12px; color: var(--color-text-secondary, #888); font-weight: 500; }
.sfa-input {
  padding: 8px 12px;
  border: 1px solid var(--color-border, #3a3a5a);
  border-radius: 8px;
  font-size: 13px;
  background: var(--color-input-bg, #2a2a3e);
  color: var(--color-text, #e0e0e0);
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}
.sfa-input:focus { border-color: var(--color-primary, #6c5ce7); }
.sfa-select {
  padding: 8px 12px;
  border: 1px solid var(--color-border, #3a3a5a);
  border-radius: 8px;
  font-size: 13px;
  background: var(--color-input-bg, #2a2a3e);
  color: var(--color-text, #e0e0e0);
  font-family: inherit;
  outline: none;
  cursor: pointer;
}

/* 推断结果 */
.sfa-inference {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--color-primary, #6c5ce7) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary, #6c5ce7) 30%, transparent);
  border-radius: 8px;
  font-size: 12px;
  color: var(--color-primary, #6c5ce7);
  animation: sfa-fade-in 0.2s ease;
}
@keyframes sfa-fade-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
.sfa-inference-icon { flex-shrink: 0; }
.sfa-inference-text { flex: 1; }
.sfa-inference-text strong { color: var(--color-primary-light, #a29bfe); }
.sfa-adopt-btn {
  padding: 3px 10px;
  background: var(--color-primary, #6c5ce7);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.sfa-adopt-btn:hover { background: var(--color-primary-hover, #7d6ff0); }

/* 折叠区块 */
.sfa-section { border: 1px solid var(--color-border, #3a3a5a); border-radius: 8px; overflow: hidden; }
.sfa-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-secondary, #888);
  user-select: none;
}
.sfa-section-header:hover { background: var(--color-border, #3a3a5a); }
.sfa-section-badge {
  font-size: 10px;
  padding: 1px 6px;
  background: color-mix(in srgb, var(--color-success, #00b894) 20%, transparent);
  color: var(--color-success, #00b894);
  border-radius: 4px;
  margin-left: auto;
}
.sfa-section-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--color-border, #3a3a5a); }

/* 记住映射 */
.sfa-remember {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary, #888);
  cursor: pointer;
}
.sfa-remember input[type="checkbox"] { accent-color: var(--color-primary, #6c5ce7); }

/* 底部按钮 */
.sfa-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--color-border, #3a3a5a);
}
.sfa-btn {
  padding: 7px 18px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.sfa-btn-cancel { background: var(--color-border, #3a3a5a); color: var(--color-text-secondary, #888); }
.sfa-btn-cancel:hover { background: var(--color-border-hover, #4a4a6a); }
.sfa-btn-confirm { background: var(--color-primary, #6c5ce7); color: #fff; }
.sfa-btn-confirm:hover { background: var(--color-primary-hover, #7d6ff0); }
.sfa-btn-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
