<template>
  <div class="fpv">
    <!-- 头部：文件名 + 大小 + 返回 -->
    <div class="fpv-header">
      <span class="fpv-name" :title="path">{{ name }}</span>
      <span class="fpv-size">{{ formatSize(size) }}</span>
      <button class="fpv-close" title="返回目录" @click="emit('close')"><WsIcon name="arrow-left" size="xs" /></button>
    </div>

    <!-- 大文件守卫：先提示 + 仍要预览 -->
    <div v-if="guard" class="fpv-guard">
      <WsIcon name="warning" size="sm" class="fpv-guard-icon" />
      <p class="fpv-guard-text">文件较大（{{ formatSize(size) }}），预览可能会卡顿。</p>
      <button class="fpv-guard-btn" @click="forcePreview">仍要预览</button>
      <button class="fpv-guard-cancel" @click="emit('close')">返回</button>
    </div>

    <!-- 二进制提示 -->
    <div v-else-if="binary" class="fpv-binary">
      <WsIcon name="file" size="lg" class="fpv-binary-icon" />
      <p class="fpv-binary-text">非文本二进制文件，暂不支持预览。</p>
    </div>

    <!-- 图片预览 -->
    <div v-else-if="kind === 'image'" class="fpv-image-wrap">
      <img v-if="imgSrc" :src="imgSrc" class="fpv-image" alt="预览" @error="binary = true; imgSrc = null" />
      <div v-else class="fpv-loading">加载中…</div>
    </div>

    <!-- Markdown 渲染预览（复用消息流渲染管线：marked + DOMPurify + Prism 代码块；ws-agent-md 提供样式与复制委托） -->
    <div
      v-else-if="kind === 'markdown'"
      class="fpv-md ws-agent-md"
      @click="onMdClick"
      v-html="mdHtml"
    />

    <!-- HTML 预览：渲染（iframe，脚本禁用）/ 源码（markup 高亮）切换 -->
    <template v-else-if="kind === 'html'">
      <div class="fpv-html-bar">
        <button class="fpv-view-btn" :class="{ on: htmlView === 'render' }" @click="htmlView = 'render'">渲染</button>
        <button class="fpv-view-btn" :class="{ on: htmlView === 'source' }" @click="htmlView = 'source'">源码</button>
        <span v-if="htmlView === 'render'" class="fpv-html-note" title="预览安全限制：页面内脚本不执行">脚本已禁用</span>
      </div>
      <iframe
        v-if="htmlView === 'render'"
        class="fpv-html-frame"
        sandbox=""
        :srcdoc="text ?? ''"
        title="HTML 预览"
      />
      <pre v-else class="fpv-code ws-agent-md"><code class="language-markup" v-html="highlightedCode"></code></pre>
    </template>

    <!-- 代码预览：Prism 语法高亮（ws-agent-md 提供 token 配色） -->
    <pre v-else-if="kind === 'code'" class="fpv-code ws-agent-md"><code :class="`language-${codeLangName}`" v-html="highlightedCode"></code></pre>

    <!-- 纯文本预览（txt/log/yaml 等兜底） -->
    <pre v-else class="fpv-text">{{ text ?? '加载中…' }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { invoke } from '@/agent/composables/transport'
import { renderMarkdownHtml, handleCodeCopyClick, highlightCode } from '@worldsmith/shared-ui/agent/bubbles'
import '@worldsmith/shared-ui/agent/bubbles/agent-markdown.css'

const props = defineProps<{ path: string; name: string; size: number }>()
const emit = defineEmits<{ close: [] }>()

/** 大文件阈值（2026-09-03 用户建议）：文本与图片统一 >10MB 才守卫 */
const TEXT_GUARD = 10 * 1024 * 1024
const IMAGE_GUARD = 10 * 1024 * 1024

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
}
/** 已知不可预览二进制扩展名：直接提示，不走大文件守卫 */
const BINARY_EXT = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'sqlite3', 'lock',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'ico', 'woff', 'woff2', 'ttf', 'otf',
])

/** Markdown 渲染扩展名 */
const MD_EXT = new Set(['md', 'markdown'])
/** HTML 页面扩展名 */
const HTML_EXT = new Set(['html', 'htm'])
/** 代码扩展名 → Prism 语言（仅 codeHighlight 已注册的语言；未收录走纯文本） */
const CODE_LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  json: 'json', jsonc: 'json',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  html: 'markup', htm: 'markup', xml: 'markup', vue: 'markup',
  css: 'css',
  sql: 'sql',
  go: 'go',
  java: 'java',
  yaml: 'yaml', yml: 'yaml',
}

/** 预览类别：image / markdown / html / code / text（判定后；binary 以独立标志表达） */
type PreviewKind = 'image' | 'markdown' | 'html' | 'code' | 'text'
const kind = ref<PreviewKind>('text')
const guard = ref(false)
const forced = ref(false)
const binary = ref(false)
const text = ref<string | null>(null)
const imgSrc = ref<string | null>(null)
/** Markdown 渲染产物（v-html） */
const mdHtml = ref('')
/** 代码/HTML 源码的高亮产物（v-html） */
const highlightedCode = ref('')
/** HTML 预览视图：渲染（iframe）/ 源码 */
const htmlView = ref<'render' | 'source'>('render')
/** 当前代码语言（模板 language-* 类用） */
const codeLangName = ref('text')

function ext(): string {
  const i = props.name.lastIndexOf('.')
  return i >= 0 ? props.name.slice(i + 1).toLowerCase() : ''
}

/** 是否图片（按扩展名） */
function isImage(): boolean {
  return IMAGE_EXT.has(ext())
}

/** 当前文件的预览类别（不含 binary——调用方先行处理） */
function previewKind(): PreviewKind {
  if (isImage()) return 'image'
  if (MD_EXT.has(ext())) return 'markdown'
  if (HTML_EXT.has(ext())) return 'html'
  if (CODE_LANG_BY_EXT[ext()]) return 'code'
  return 'text'
}

/** 是否需要大文件守卫（已知二进制不守卫——直接提示不可预览） */
function needsGuard(): boolean {
  if (isKnownBinary()) return false
  return props.size > (isImage() ? IMAGE_GUARD : TEXT_GUARD)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function forcePreview(): void {
  forced.value = true
  guard.value = false // 关闭守卫，才会真正进入读取分支
  void load()
}

/** 已知二进制扩展名 → 直接标记不可预览（不再走文本读取/大文件守卫） */
function isKnownBinary(): boolean {
  return BINARY_EXT.has(ext())
}

/** HTML 转义（高亮降级用） */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Markdown 容器点击委托：代码块复制按钮（handleCodeCopyClick 返回是否已处理） */
function onMdClick(e: MouseEvent): void {
  handleCodeCopyClick(e)
}

async function load(): Promise<void> {
  binary.value = false
  text.value = null
  imgSrc.value = null
  mdHtml.value = ''
  highlightedCode.value = ''
  // 已知二进制（exe/压缩包/office 等）：直接提示不可预览（T11）
  if (isKnownBinary()) {
    kind.value = 'text'
    binary.value = true
    return
  }
  const k = previewKind()
  kind.value = k
  if (k === 'image') {
    try {
      const b64 = await invoke<string>('cmd_fs_read', { path: props.path, encoding: 'base64' })
      imgSrc.value = `data:${MIME[ext()] ?? 'image/png'};base64,${b64}`
    } catch (err) {
      console.warn('[FilePreview] 读取图片失败:', err)
      binary.value = true
    }
    return
  }
  // 文本族（markdown/html/code/text）统一 utf-8 读取后按类别渲染
  try {
    const content = await invoke<string>('cmd_fs_read', { path: props.path, encoding: 'utf-8' })
    text.value = content
    if (k === 'markdown') {
      mdHtml.value = renderMarkdownHtml(content)
    } else if (k === 'html') {
      // 预生成 markup 高亮（源码视图用；渲染视图走 iframe srcdoc）
      highlightedCode.value = highlightCode(content, 'markup') ?? escapeHtml(content)
      codeLangName.value = 'markup'
    } else if (k === 'code') {
      const lang = CODE_LANG_BY_EXT[ext()]
      let src = content
      // JSON 结构化：压缩单行文件先 parse → 2 空格缩进重排（parse 失败保留原文，容错 jsonc/损坏）
      if (lang === 'json') {
        try {
          src = JSON.stringify(JSON.parse(content), null, 2)
        } catch {
          /* 保留原文 */
        }
      }
      highlightedCode.value = highlightCode(src, lang) ?? escapeHtml(src)
      codeLangName.value = lang
    }
  } catch (err) {
    console.warn('[FilePreview] 文本读取失败（可能为二进制）:', err)
    binary.value = true
  }
}

onMounted(() => {
  // 大文件守卫：每次打开先提示（除非本次已强制）
  guard.value = needsGuard() && !forced.value
  if (!guard.value) void load()
})

// 路径变化时重置状态并重新判定
watch(
  () => props.path,
  () => {
    forced.value = false
    binary.value = false
    htmlView.value = 'render'
    guard.value = needsGuard() && !forced.value
    if (!guard.value) void load()
  },
)
</script>

<style scoped>
.fpv {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-surface-elevated);
}
.fpv-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.fpv-name {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fpv-size {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.fpv-close {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.fpv-close:hover {
  color: var(--color-text);
  background: var(--color-surface);
}

.fpv-guard {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
}
.fpv-guard-icon {
  color: #e8a33d;
}
.fpv-guard-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-align: center;
}
.fpv-guard-btn {
  padding: 6px 16px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.fpv-guard-btn:hover {
  background: var(--color-primary-muted);
}
.fpv-guard-cancel {
  padding: 6px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.fpv-guard-cancel:hover {
  color: var(--color-text);
}

.fpv-binary {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
}
.fpv-binary-icon {
  color: var(--color-text-tertiary);
  opacity: 0.5;
}
.fpv-binary-text {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.fpv-image-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.fpv-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--radius-sm);
}
.fpv-loading {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

/* Markdown 渲染容器：ws-agent-md（全局样式）提供排版/代码块/表格配色 */
.fpv-md {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
  color: var(--color-text);
  user-select: text;
}

/* HTML 预览：视图切换条 + iframe 渲染区 */
.fpv-html-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.fpv-view-btn {
  padding: 3px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.fpv-view-btn:hover {
  color: var(--color-text);
  background: var(--color-surface);
}
.fpv-view-btn.on {
  color: var(--color-primary);
  background: var(--color-primary-muted);
  font-weight: 600;
}
.fpv-html-note {
  margin-left: auto;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
}
.fpv-html-frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: none;
  background: #fff;
}
.fpv-code {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  font-family: var(--font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.55;
  color: var(--color-text-secondary);
}
.fpv-code code {
  font-family: inherit;
  background: none;
  padding: 0;
  white-space: pre;
}

/* 纯文本预览 */
.fpv-text {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  font-family: var(--font-mono, ui-monospace, 'Cascadia Mono', Consolas, monospace);
  font-size: var(--font-size-xs);
  line-height: 1.55;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
</style>
