<script setup lang="ts">
/**
 * MessageContent：消息富渲染组件（Markdown→HTML）
 *
 * 用 `marked`(GFM) 解析 + `DOMPurify` 消毒后渲染，支持代码块/表格/引用等。
 * 代码块带语言标签 + 复制按钮（事件委托实现）；流式输出时显示闪烁光标；
 * 若存在未闭合代码围栏（``` 数量为奇数），退化为纯文本渲染，
 * 避免打字机过程中把后续内容吞进代码块；完成后自动转 Markdown。
 * 详细why请见 docs/details/注释/tauri/MessageContent.md
 */
import { computed } from 'vue'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{
  /** 消息原文（Markdown 或纯文本）；历史数据可能缺失，缺省按空字符串处理 */
  content?: string
  /** 是否处于流式输出中（打字机） */
  streaming?: boolean
}>()

/* 模块级单例：避免每条消息实例化一个 Marked（长对话性能，批次93） */
const marked = new Marked({ gfm: true, breaks: true })

/**
 * 自定义 code renderer：为代码块包裹 header（语言标签 + 复制按钮）。
 * data-copy 存转义后的代码文本，复制动作由根元素事件委托处理。
 */
marked.use({
  renderer: {
    code({ text, lang }) {
      const language = lang || 'text'
      const code = escapeHtml(String(text))
      const safeLang = escapeHtml(language)
      return [
        '<div class="code-block">',
        '<div class="code-head">',
        `<span class="code-lang">${safeLang}</span>`,
        `<button type="button" class="code-copy" data-copy="${code}">复制</button>`,
        '</div>',
        `<pre><code>${code}</code></pre>`,
        '</div>',
      ].join('')
    },
    // 链接在外部打开：Tauri WebView 内无 target 会导航替换应用 UI（丢失对话状态），
    // noopener noreferrer 防反向 tab 劫持（安全实践）
    link({ href, title, text }) {
      const hrefAttr = escapeHtml(String(href))
      const titleAttr = title ? ` title="${escapeHtml(String(title))}"` : ''
      return `<a href="${hrefAttr}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`
    },
  },
})

/** 是否含未闭合代码围栏（``` 数量为奇数） */
function hasUnclosedFence(text: string): boolean {
  const fences = text.split('```').length - 1
  return fences % 2 === 1
}

/** 渲染后的安全 HTML */
const html = computed(() => {
  const text = props.content ?? ''
  if (!text) return ''
  // 流式中代码围栏未闭合 → 纯文本（换行转 <br>），避免误吞噬后续内容
  if (props.streaming && hasUnclosedFence(text)) {
    return escapeHtml(text)
  }
  return DOMPurify.sanitize(marked.parse(text) as string)
})

/** HTML 转义（纯文本回退 / 代码块内嵌用） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 复制按钮事件委托：v-html 内的按钮无法直接绑定，捕获根元素 click，
 * 命中 .code-copy 时读取 data-copy 写入剪贴板，按钮短暂显示"已复制"。
 */
let copyTimer: ReturnType<typeof setTimeout> | null = null
async function onRootClick(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest?.('.code-copy') as HTMLElement | null
  if (!btn) return
  const text = btn.dataset.copy ?? ''
  try {
    await navigator.clipboard.writeText(text)
    btn.textContent = '已复制'
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      btn.textContent = '复制'
    }, 1600)
  } catch {
    // 剪贴板不可用时静默（桌面 WebView2 一般可用）
  }
}
</script>

<template>
  <div class="md-wrap">
    <div class="md" :class="{ streaming }" v-html="html" @click="onRootClick" />
    <span v-if="streaming" class="stream-cursor" aria-hidden="true" />
  </div>
</template>

<style scoped>
/* Markdown 内容区排版（精致极简） */
.md {
  color: var(--md-text);
  font-size: var(--fs-base);
  line-height: var(--lh-base);
  word-break: break-word;
}
.md.streaming {
  /* 流式中保留光标感：轻微闪烁 */
  caret-color: transparent;
}
.md :deep(p) {
  margin: 0 0 0.75em;
}
.md :deep(p:last-child) {
  margin-bottom: 0;
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4),
.md :deep(h5),
.md :deep(h6) {
  color: var(--md-heading);
  font-weight: 600;
  line-height: var(--lh-tight);
  margin: 1.2em 0 0.6em;
}
.md :deep(h1) {
  font-size: 1.35em;
}
.md :deep(h2) {
  font-size: 1.2em;
}
.md :deep(h3) {
  font-size: 1.08em;
}
.md :deep(h4),
.md :deep(h5),
.md :deep(h6) {
  font-size: 1em;
}
.md :deep(ul),
.md :deep(ol) {
  padding-left: 1.4em;
  margin: 0 0 0.75em;
}
.md :deep(li) {
  margin: 0.25em 0;
}
.md :deep(li > p) {
  margin: 0;
}
/* GFM 任务列表：复选框与强调色呼应，垂直对齐微调 */
.md :deep(li input[type='checkbox']) {
  margin-right: 0.4em;
  accent-color: var(--accent);
  transform: translateY(1px);
}
/* 键盘键帽：弱化键视觉（Agent 输出快捷键说明时使用） */
.md :deep(kbd) {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: var(--md-code-bg);
  border: 1px solid var(--md-code-border);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  padding: 0.05em 0.4em;
  color: var(--md-text);
}
.md :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--md-code-bg);
  border: 1px solid var(--md-code-border);
  border-radius: var(--radius-sm);
  padding: 0.1em 0.35em;
}
/* 代码块（含语言标签 + 复制按钮） */
.md :deep(.code-block) {
  margin: 0 0 0.9em;
  border: 1px solid var(--md-block-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--md-block-bg);
}
.md :deep(.code-head) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 12px;
  background: var(--md-table-head-bg);
  border-bottom: 1px solid var(--md-block-border);
}
.md :deep(.code-lang) {
  font-family: var(--font-mono);
  font-size: 0.78em;
  color: var(--text-muted);
  text-transform: lowercase;
  letter-spacing: 0.3px;
}
.md :deep(.code-copy) {
  border: none;
  background: transparent;
  font-family: var(--font-sans);
  font-size: 0.8em;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
}
.md :deep(.code-copy:hover) {
  color: var(--accent);
  background: var(--accent-soft);
}
.md :deep(pre) {
  margin: 0;
  padding: 0.9em 1em;
  overflow-x: auto;
  background: transparent;
}
.md :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 0.88em;
  line-height: 1.55;
}
.md :deep(blockquote) {
  margin: 0 0 0.9em;
  padding: 0.4em 0.9em;
  border-left: 3px solid var(--md-quote-border);
  background: var(--md-quote-bg);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  color: var(--text-secondary);
}
.md :deep(blockquote p:last-child) {
  margin-bottom: 0;
}
.md :deep(a) {
  color: var(--md-link);
  text-decoration: none;
}
.md :deep(a:hover) {
  text-decoration: underline;
}
.md :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 0.9em;
  font-size: 0.95em;
}
.md :deep(th),
.md :deep(td) {
  border: 1px solid var(--md-table-border);
  padding: 0.45em 0.7em;
  text-align: left;
}
.md :deep(th) {
  background: var(--md-table-head-bg);
  font-weight: 600;
}
.md :deep(hr) {
  border: none;
  border-top: 1px solid var(--md-block-border);
  margin: 1em 0;
}
.md :deep(strong) {
  font-weight: 600;
}
.md :deep(img) {
  max-width: 100%;
  border-radius: var(--radius-sm);
}

/* 流式光标：末尾闪烁竖线，克制不抢眼 */
.stream-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--accent);
  border-radius: 1px;
  animation: cursor-blink 0.9s steps(2, start) infinite;
}
/* 光标闪烁：组件专属 keyframe（非全端共享动画，不移入 theme.css 注册表） */
@keyframes cursor-blink {
  to {
    visibility: hidden;
  }
}
</style>
