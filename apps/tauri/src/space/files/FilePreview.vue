<template>
  <div class="fpv">
    <!-- 头部：文件名 + 大小 + 返回；HTML 渲染视图例外提供「居中显示」切换（默认全宽，2026-09-03） -->
    <div class="fpv-header">
      <span class="fpv-name" :title="path">{{ name }}</span>
      <button
        v-if="kind === 'html'"
        class="fpv-close"
        :class="{ active: htmlCentered }"
        :title="htmlCentered ? '取消居中（全宽渲染）' : '居中显示（左右各留 10%）'"
        :aria-pressed="htmlCentered"
        @click="htmlCentered = !htmlCentered"
      ><WsIcon name="grid" size="xs" /></button>
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

    <!-- Markdown 渲染预览（复用消息流渲染管线：marked + DOMPurify + Prism 代码块；ws-agent-md 提供样式与复制委托）。
         2026-09-03 二期：内容区左右各留 10% 边距，左侧空白放标题目录树——顶部下拉显示当前可见标题（scrollspy 滚动联动），点开浮层跳转 -->
    <div v-else-if="kind === 'markdown'" class="fpv-md-stage">
      <aside
        class="fpv-toc"
        @mouseenter="onTocEnter"
        @mouseleave="onTocLeave"
      >
        <button
          class="fpv-toc-trigger"
          :class="{ open: tocOpen, pinned: tocPinned }"
          :title="activeTitle ? `当前标题：${activeTitle}` : '标题目录'"
          @click="toggleTocPin"
        >
          <span class="fpv-toc-current">{{ activeTitle || '目录' }}</span>
        </button>
        <Transition name="dropdown">
          <div v-if="tocOpen" class="fpv-toc-menu">
            <button
              v-for="item in tocItems"
              :key="item.id"
              class="fpv-toc-item"
              :class="{ on: item.id === activeId }"
              :style="{ paddingLeft: (item.level - 1) * 9 + 8 + 'px' }"
              :title="item.text"
              @click="jumpTo(item.id)"
            >{{ item.text }}</button>
            <div v-if="tocItems.length === 0" class="fpv-toc-empty">文档无标题</div>
          </div>
        </Transition>
      </aside>

      <div ref="mdEl" class="fpv-md ws-agent-md" @click="onMdClick" @scroll="onMdScroll" v-html="mdHtml"></div>
    </div>

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
        :class="{ centered: htmlCentered }"
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
import { ref, computed, watch, onMounted, nextTick } from 'vue'
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
/** HTML 渲染视图居中开关（默认关=全宽；文件名旁图标切换） */
const htmlCentered = ref(false)
/** 当前代码语言（模板 language-* 类用） */
const codeLangName = ref('text')

// ── Markdown 标题目录树（2026-09-03 二期）：提取 → scrollspy 滚动联动 → 浮层跳转 ──
interface TocItem { id: string; text: string; level: number }
const mdEl = ref<HTMLElement | null>(null)
const tocItems = ref<TocItem[]>([])
const activeId = ref('')
const activeTitle = computed(() => tocItems.value.find(t => t.id === activeId.value)?.text ?? '')
/** 浮层可见性（悬停临时 / 点击固定常驻） */
const tocOpen = ref(false)
/** 点击触发框后的固定态：移出不关闭，再次点击解除 */
const tocPinned = ref(false)
let tocLeaveTimer: number | null = null

/** 悬停进入：出现浮层（清除延迟关闭计时） */
function onTocEnter(): void {
  if (tocLeaveTimer !== null) {
    clearTimeout(tocLeaveTimer)
    tocLeaveTimer = null
  }
  tocOpen.value = true
}

/** 悬停移出：固定态保持常驻；非固定态延迟 150ms 关闭（留出移入浮层的间隙） */
function onTocLeave(): void {
  if (tocPinned.value) return
  if (tocLeaveTimer !== null) clearTimeout(tocLeaveTimer)
  tocLeaveTimer = window.setTimeout(() => {
    tocOpen.value = false
    tocLeaveTimer = null
  }, 150)
}

/** 点击触发框：切换固定态（固定=浮层持续；解除=关闭） */
function toggleTocPin(): void {
  tocPinned.value = !tocPinned.value
  tocOpen.value = tocPinned.value
}

/** v-html 渲染后从 DOM 提取 h1-h4：注入锚点 id + 收集目录项 */
function extractHeadings(): void {
  const el = mdEl.value
  if (!el) return
  const heads = el.querySelectorAll('h1, h2, h3, h4')
  const items: TocItem[] = []
  heads.forEach((h, i) => {
    const id = `fpv-h-${i}`
    h.id = id
    items.push({ id, text: (h.textContent ?? '').trim(), level: Number(h.tagName[1]) })
  })
  tocItems.value = items
  activeId.value = items[0]?.id ?? ''
}

/** 滚动联动：以「视口顶部附近最后一个越过阈值的标题」为当前标题 */
function onMdScroll(): void {
  const el = mdEl.value
  if (!el || tocItems.value.length === 0) return
  const threshold = el.scrollTop + 64
  let current = tocItems.value[0]?.id ?? ''
  el.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    if ((h as HTMLElement).offsetTop <= threshold) current = h.id
  })
  activeId.value = current
}

/** 目录点击：平滑滚到对应标题，浮层收起并解除固定 */
function jumpTo(id: string): void {
  tocOpen.value = false
  tocPinned.value = false
  if (tocLeaveTimer !== null) {
    clearTimeout(tocLeaveTimer)
    tocLeaveTimer = null
  }
  const el = mdEl.value?.querySelector(`#${CSS.escape(id)}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(mdHtml, () => nextTick(extractHeadings))

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
/* 居中切换开启态（HTML 渲染视图） */
.fpv-close.active {
  color: var(--color-primary);
  background: var(--color-primary-muted);
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

/* Markdown 渲染：stage 左右各留 10% 边距（右 10% 由 ::after 占位），左空白放标题目录树 */
.fpv-md-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 6px;
}
.fpv-md-stage::after {
  content: '';
  display: block;
  width: 12.5%;
  flex-shrink: 0;
}
.fpv-md {
  flex: 1;
  min-width: 0;
  position: relative; /* 标题 offsetTop 的 offsetParent，scrollspy 依赖 */
  overflow-y: auto;
  padding: 12px 8px;
  color: var(--color-text);
  user-select: text;
}
/* 标题目录树（左 10% 空白内）：顶部触发钮显示当前可见标题，点开浮层 */
.fpv-toc {
  width: 12.5%;
  min-width: 52px;
  flex-shrink: 0;
  align-self: flex-start;
  position: sticky;
  top: 0;
  padding-top: 12px;
}
/* 触发框：无框无底，仅标题文字本身承担高亮（hover/开启/固定 → 主色） */
.fpv-toc-trigger {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 3px 4px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
  text-align: left;
}
.fpv-toc-trigger:hover .fpv-toc-current,
.fpv-toc-trigger.open .fpv-toc-current,
.fpv-toc-trigger.pinned .fpv-toc-current {
  color: var(--color-primary);
}
.fpv-toc-current {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  transition: color 0.15s;
}
/* 目录浮层：实色底（--color-surface-elevated 为不透明令牌），与内容区视觉隔离 */
.fpv-toc-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 200px;
  max-width: 260px;
  max-height: 55vh;
  overflow-y: auto;
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 4px;
  z-index: 20;
}
.fpv-toc-item {
  display: block;
  width: 100%;
  padding: 5px 8px;
  border: none;
  background: transparent;
  border-radius: var(--radius-xs);
  color: var(--color-text-secondary);
  font-size: var(--font-size-2xs);
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.12s, color 0.12s;
}
.fpv-toc-item:hover {
  background: var(--color-surface);
  color: var(--color-text);
}
.fpv-toc-item.on {
  color: var(--color-primary);
  background: var(--color-primary-muted);
  font-weight: 600;
}
.fpv-toc-empty {
  padding: 12px;
  text-align: center;
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
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
/* 居中开关开启：左右各留 10%（文件名旁图标切换，默认关） */
.fpv-html-frame.centered {
  width: 80%;
  margin: 0 auto 12px;
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
