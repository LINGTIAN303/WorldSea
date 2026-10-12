<template>
  <NodeViewWrapper class="ws-cb" :class="{ 'ws-cb--selected': selected }">
    <div class="ws-cb-head">
      <select
        class="ws-cb-lang"
        :value="node.attrs.language || ''"
        aria-label="代码语言"
        @change="onLangChange"
        @mousedown.stop
      >
        <option v-for="l in CODE_LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
      </select>
      <button class="ws-cb-copy" :title="copied ? '已复制' : '复制代码'" @click="copy">
        <WsIcon :name="copied ? 'check' : 'copy'" size="xs" />
      </button>
    </div>
    <pre class="ws-cb-pre"><code class="ws-cb-hl" aria-hidden="true" v-html="highlighted" /><NodeViewContent as="code" class="ws-cb-input" :class="langClass" /></pre>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { nodeViewProps, NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3'
import { WsIcon } from '@worldsea/ui-kit'
import { highlightCode, escapeHtml } from '@worldsea/shared-ui/markdown'
import { CODE_LANGUAGES } from '../composables/codeBlockExt'

const props = defineProps(nodeViewProps)

const LANG_CLASS_PREFIX = 'language-'

const langClass = computed(() => {
  const lang = props.node.attrs.language
  return lang ? `${LANG_CLASS_PREFIX}${lang}` : null
})

/** 高亮层 HTML：命中 Prism → 高亮 HTML；未命中/失败 → 转义原文（与 highlightCode 降级语义一致） */
const highlighted = computed(() => {
  const text = props.node.textContent
  const lang = props.node.attrs.language || ''
  return highlightCode(text, lang) ?? escapeHtml(text)
})

// 语言切换后文本内容不变（attrs 变化即可），无需手动触发高亮 —— computed 依赖 node（引用）+ attrs.language。
// node 对象在事务中被替换（immutable），computed 自动重算。

const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.node.textContent)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copied.value = false }, 1600)
  } catch {
    /* 剪贴板不可用静默（与 handleCodeCopyClick 同口径） */
  }
}

function onLangChange(e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  props.updateAttributes({ language: value || null })
}
// 语言变更无需手动触发高亮：node 在事务中被替换（immutable），computed 依赖自动重算
</script>

<style scoped>
/* 结构样式在此；视觉细节（配色/圆角/双主题）由 prose.css 统一 token 化 */
.ws-cb { position: relative; margin: 8px 0; }
.ws-cb-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 4px 8px; border: 1px solid var(--color-border-subtle); border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: var(--color-bg-muted);
}
.ws-cb-lang {
  padding: 2px 6px; border: 1px solid var(--color-border); border-radius: var(--radius-2xs);
  background: var(--color-bg-base); color: var(--color-text-secondary);
  font-size: var(--font-size-2xs); outline: none; cursor: pointer;
}
.ws-cb-copy {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 22px; padding: 0; border: none; border-radius: var(--radius-2xs);
  background: transparent; color: var(--color-text-tertiary); cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.ws-cb-copy:hover { background: var(--color-bg-hover); color: var(--color-text-secondary); }
.ws-cb-pre {
  position: relative; margin: 0; padding: 0;
  border: 1px solid var(--color-border-subtle); border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  background: var(--color-bg-hover);
  overflow-x: auto; tab-size: 4;
}
/* 双层 overlay：两层必须同盒（同 font/white-space/box zero），由 prose.css 的非 scoped 规则约束 */
.ws-cb-pre :deep(code) { display: block; padding: 0; margin: 0; background: transparent; }
</style>
