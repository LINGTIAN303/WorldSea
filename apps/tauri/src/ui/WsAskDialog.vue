<template>
  <Teleport to="body">
    <Transition name="ws-scale-fade">
      <!-- Q1 提问面板（2026-09-20 走查后改版：停靠输入栏——宽度跟随输入栏、底边对齐可覆盖输入栏）。
           逐题作答：单选点选即前进 / 多选 toggle + 下一步 / 上一步可回看 / 自定义 / 跳过 / 取消（拒绝作答） -->
      <div
        v-if="state.show && question"
        class="ws-ask-overlay"
        @click.self="cancel"
      >
        <div
          ref="askRef"
          class="ws-ask"
          :class="{ 'ws-ask--docked': !!dockedStyle }"
          :style="dockedStyle"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ws-ask-title"
          :aria-describedby="state.incomplete ? 'ws-ask-hint' : undefined"
        >
          <div class="ws-ask__head">
            <span class="ws-ask__progress">问题 {{ state.index + 1 }} / {{ state.questions.length }}</span>
            <span v-if="question.header" class="ws-ask__header">{{ question.header }}</span>
          </div>
          <h3 id="ws-ask-title" class="ws-ask__title">{{ question.question }}</h3>

          <!-- 选项列表（无选项题不渲染，直接走自定义输入） -->
          <div v-if="question.options && question.options.length" class="ws-ask__options">
            <button
              v-for="opt in question.options"
              :key="opt.label"
              type="button"
              class="ws-ask__option"
              :class="{ 'ws-ask__option--selected': draft && draft.selected.includes(opt.label) }"
              :aria-pressed="draft ? draft.selected.includes(opt.label) : false"
              @click="onOptionClick(opt.label)"
            >
              <span class="ws-ask__option-label">{{ opt.label }}</span>
              <span v-if="opt.description" class="ws-ask__option-desc">{{ opt.description }}</span>
            </button>
          </div>

          <!-- 自定义输入（无选项题默认展开） -->
          <div v-if="draft && draft.showCustom" class="ws-ask__custom">
            <textarea
              ref="customRef"
              v-model="customText"
              class="ws-ask__input"
              rows="2"
              placeholder="输入自定义回答…（Enter 继续，Shift+Enter 换行）"
              @keydown.enter.exact="onCustomEnter"
            />
          </div>
          <button
            v-else
            type="button"
            class="ws-ask__toggle-custom"
            @click="toggleCustom"
          >自定义回答</button>

          <p v-if="state.incomplete" id="ws-ask-hint" class="ws-ask__hint">
            请选择选项、输入自定义回答，或点击「跳过」
          </p>

          <div class="ws-ask__actions">
            <TuiButton variant="ghost" size="sm" @click="cancel">取消</TuiButton>
            <!-- 上一步/下一步（2026-09-20 走查后新增）：回看与逐题推进；末题主键为「提交」 -->
            <TuiButton
              variant="ghost"
              size="sm"
              icon="arrow-left"
              :disabled="state.index === 0"
              title="返回上一题（已填内容保留）"
              @click="prev"
            >上一步</TuiButton>
            <TuiButton variant="ghost" size="sm" @click="skip">跳过</TuiButton>
            <TuiButton
              variant="primary"
              size="sm"
              :icon="isLast ? '' : 'arrow-right'"
              @click="advance"
            >{{ isLast ? '提交' : '下一步' }}</TuiButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { TuiButton, useAsk } from '@worldsea/ui-kit'
import { useFocusTrap } from '@/composables/useFocusTrap'
import { useDockPanelRect } from '@/composables/useDockPanelRect'

const {
  state,
  chooseOption,
  toggleOption,
  setCustom,
  toggleCustom,
  skip,
  advance,
  prev,
  cancel,
  currentQuestion,
  currentDraft,
} = useAsk()

const askRef = ref<HTMLElement | null>(null)
const customRef = ref<HTMLTextAreaElement | null>(null)

const question = computed(() => currentQuestion())
const draft = computed(() => currentDraft())
const isLast = computed(() => state.value.index >= state.value.questions.length - 1)

/** 停靠输入栏（宽度跟随 + 底边对齐；无输入栏时回退默认居中态） */
const { dockedStyle } = useDockPanelRect(computed(() => state.value.show))

/** 自定义输入双向绑定（经 useAsk.setCustom：单选下清空已选） */
const customText = computed({
  get: () => draft.value?.custom ?? '',
  set: (v: string) => setCustom(v),
})

/** 选项点击：单选点选即前进；多选 toggle */
function onOptionClick(label: string): void {
  if (question.value?.multiSelect) toggleOption(label)
  else chooseOption(label)
}

/** 自定义输入 Enter 继续（IME 组字中不提交；Shift+Enter 换行由 .exact 排除） */
function onCustomEnter(e: KeyboardEvent): void {
  if (e.isComposing) return
  e.preventDefault()
  advance()
}

/** 展开自定义输入后自动聚焦（含逐题切换后） */
watch(
  () => [state.value.index, draft.value?.showCustom],
  async () => {
    if (!state.value.show || !draft.value?.showCustom) return
    await nextTick()
    customRef.value?.focus()
  },
  { immediate: true },
)

const { activate, deactivate } = useFocusTrap(askRef, {
  active: computed(() => state.value.show),
  restoreFocus: true,
  escapeDeactivates: true,
  onEscape: () => cancel(),
})

watch(() => state.value.show, (v) => {
  if (v) nextTick(() => activate())
  else deactivate()
})
</script>

<style scoped>
.ws-ask-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: none;
  pointer-events: none; /* 不拦截其他区域操作（面板本体可交互） */
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 16px 104px; /* 未停靠（无输入栏）时的回退：底部留白 ≈ 输入栏高度 */
}

.ws-ask {
  pointer-events: auto;
  background: var(--sf-modal-bg);
  border: 1px solid var(--sf-overlay-edge);
  border-radius: calc(var(--radius-lg) * var(--sf-radius-scale));
  box-shadow: var(--sf-overlay-shadow);
  backdrop-filter: var(--sf-overlay-filter, none);
  padding: 20px;
  width: 460px;
  max-width: 100%;
}

/* ── 停靠态（2026-09-20）：宽度/横向位置/底边由 useDockPanelRect 内联给出 ── */
.ws-ask--docked {
  position: absolute; /* overlay 为 fixed inset:0 → absolute 即视口坐标 */
  width: auto;
  max-width: none;
  box-sizing: border-box;
  padding: 14px 16px 12px;
  border-radius: var(--radius-2xl);
  display: flex;
  flex-direction: column;
  max-height: 60vh;
}

.ws-ask__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.ws-ask__progress {
  font-size: var(--fs-xs, 11px);
  color: var(--text-tertiary, var(--text-secondary));
}

.ws-ask__header {
  font-size: var(--fs-xs, 11px);
  color: var(--text-secondary);
  background: var(--bg-subtle);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
}

.ws-ask__title {
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 10px;
  line-height: 1.5;
}

.ws-ask__options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  overflow-y: auto; /* 停靠态面板 max-height 内滚动 */
}

.ws-ask__option {
  display: flex;
  align-items: baseline;
  gap: 10px;
  text-align: left;
  background: var(--bg-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  cursor: pointer;
  transition: border-color var(--dur-sm, 0.12s) var(--ease), background var(--dur-sm, 0.12s) var(--ease);
}

.ws-ask__option:hover {
  border-color: var(--accent);
}

.ws-ask__option--selected {
  border-color: var(--accent);
  background: var(--accent-subtle, var(--bg-subtle));
}

.ws-ask__option-label {
  font-size: var(--fs-sm);
  color: var(--text-primary);
  flex-shrink: 0;
}

.ws-ask__option-desc {
  font-size: var(--fs-xs, 11px);
  color: var(--text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-ask__custom {
  margin-bottom: 10px;
}

.ws-ask__input {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-input, var(--bg-subtle));
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  font-size: var(--fs-sm);
  color: var(--text-primary);
  outline: none;
  resize: vertical;
  font-family: inherit;
}

.ws-ask__input:focus {
  border-color: var(--accent);
}

.ws-ask__toggle-custom {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--accent);
  font-size: var(--fs-sm);
  cursor: pointer;
  padding: 0 0 10px;
}

.ws-ask__toggle-custom:hover {
  text-decoration: underline;
}

.ws-ask__hint {
  font-size: var(--fs-xs, 11px);
  color: var(--danger, var(--text-secondary));
  margin: 0 0 6px;
}

.ws-ask__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 2px;
}

</style>