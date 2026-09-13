<template>
  <div class="fpv">
    <!-- 头部：文件名 + 大小 + 返回；HTML 渲染视图例外提供「居中显示」切换（默认全宽，2026-09-03） -->
    <div class="fpv-header">
      <span class="fpv-name" :title="path">
        <FileIcon :name="name" class="fpv-file-icon" />
        {{ name }}<span v-if="dirty" class="fpv-dirty" title="有未保存的修改"></span>
      </span>
      <!-- 编辑态工具：一键结构化（indentRange 语法树缩进重排，2026-09-07）+ 脏态对比审查 -->
      <button v-if="mode === 'edit'" class="fpv-view-btn" title="按语法树重排全文缩进" @click="codeEditorRef?.formatIndent()">缩进</button>
      <button v-if="mode !== 'preview' && dirty" class="fpv-view-btn" :class="{ on: mode === 'diff' }" title="对比磁盘基准与当前改动" @click="switchMode('diff')">对比</button>
      <!-- 预览/编辑切换：仅保留有特殊渲染效果的 md/html（code/text 无预览价值，点开即编辑 2026-09-07） -->
      <template v-if="editable && (kind === 'markdown' || kind === 'html')">
        <button class="fpv-view-btn" :class="{ on: mode === 'preview' }" title="只读预览" @click="switchMode('preview')">预览</button>
        <button class="fpv-view-btn" :class="{ on: mode === 'edit' }" title="切换到编辑" @click="switchMode('edit')">编辑</button>
      </template>
      <button
        v-if="kind === 'html'"
        class="fpv-close"
        :class="{ active: htmlCentered }"
        :title="htmlCentered ? '取消居中（全宽渲染）' : '居中显示（左右各留 10%）'"
        :aria-pressed="htmlCentered"
        @click="htmlCentered = !htmlCentered"
      ><WsIcon name="grid" size="xs" /></button>
      <span class="fpv-size">{{ formatSize(size) }}</span>
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

    <!-- Word 预览（2026-09-14 文档格式一期）：docx-preview 保真渲染，只读 -->
    <DocxPreview v-else-if="kind === 'docx' && fileBytes" :data="fileBytes" />

    <!-- Excel 预览（2026-09-14）：SheetJS 解析 → 通用 DataTable 渲染，只读 -->
    <XlsxPreview v-else-if="kind === 'xlsx' && fileBytes" :data="fileBytes" />

    <!-- PDF 预览（2026-09-14）：pdfjs 逐页 canvas，只读 -->
    <PdfPreview v-else-if="kind === 'pdf' && fileBytes" :data="fileBytes" />

    <!-- 编辑态（2026-09-06 编辑器内核一期）：CM6 源码编辑，Ctrl+S 落盘（CodeEditor 内 keymap）；
         file-path 供 B1 LSP（语言服务器按真实路径工作，无路径时回落 tsAssist 单文件模式） -->
    <CodeEditor
      v-else-if="mode === 'edit'"
      ref="codeEditorRef"
      :model-value="editBuf"
      :lang="editLang"
      :file-path="props.path"
      @update:model-value="onEditInput"
      @save="saveFile"
    />

    <!-- 对比态（2026-09-07）：磁盘基准 vs 编辑缓冲，只读审查 -->
    <CodeDiff
      v-else-if="mode === 'diff'"
      :original="text ?? ''"
      :modified="editBuf"
      :lang="editLang"
    />

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

    <!-- HTML 预览：渲染（iframe，脚本禁用）/ 源码（CM 只读渲染，语法着色与编辑态同源）切换 -->
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
      <CodeEditor v-else minimal :model-value="text ?? ''" :lang="ext()" class="fpv-code-cm" />
    </template>

    <!-- 代码预览：CM 只读渲染（语法着色与编辑态同源；JSON 压缩文件 previewCode 重排） -->
    <CodeEditor v-else-if="kind === 'code'" minimal :model-value="previewCode" :lang="ext()" class="fpv-code-cm" />

    <!-- 纯文本预览（txt/log/yaml 等兜底） -->
    <pre v-else class="fpv-text">{{ text ?? '加载中…' }}</pre>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { WsIcon, toastInfo, toastWarn } from '@worldsea/ui-kit'
import { useConfirm } from '@worldsea/plugin-sdk'
import { invoke } from '@/agent/composables/transport'
import { renderMarkdownHtml, handleCodeCopyClick } from '@worldsea/shared-ui/agent/bubbles'
import '@worldsea/shared-ui/agent/bubbles/agent-markdown.css'
import CodeEditor from './CodeEditor.vue'
import CodeDiff from './CodeDiff.vue'
import FileIcon from './FileIcon.vue'
import DocxPreview from './DocxPreview.vue'
import XlsxPreview from './XlsxPreview.vue'
import PdfPreview from './PdfPreview.vue'
import { fileTabsState } from './fileTabsStore'

const props = defineProps<{ path: string; name: string; size: number }>()
const emit = defineEmits<{ close: []; 'dirty-change': [v: boolean] }>()

/** 编辑器实例（编辑态「缩进」按钮 → CodeEditor.formatIndent） */
const codeEditorRef = ref<InstanceType<typeof CodeEditor> | null>(null)

/** 大文件阈值（2026-09-03 用户建议）：文本与图片统一 >10MB 才守卫 */
const TEXT_GUARD = 10 * 1024 * 1024
const IMAGE_GUARD = 10 * 1024 * 1024

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
}
/**
 * 已知不可预览二进制扩展名：直接提示，不走大文件守卫。
 *
 * 注意：`docx / xlsx / pdf` 已有只读渲染器（见下方 DOCX_EXT / XLSX_EXT / PDF_EXT），
 * **不在此列**。此处保留两类：
 * ① 前端无实用方案的旧二进制格式（`.doc`/`.ppt` 是 OLE 容器、非 OOXML，mammoth /
 *    docx-preview 均不读）；
 * ② `.xls` —— 该扩展名在实际数据里常是「HTML 表格改名」，而 SheetJS 对它是宽容解析，
 *    与「垃圾内容也会被当成表」同属一个口子，无法用文件头确定性区分（详见 XlsxPreview）；
 * ③ 尚未接渲染器的 `.pptx`（计划三期：本机 LibreOffice 转 PDF）。
 */
const BINARY_EXT = new Set([
  'exe', 'dll', 'so', 'dylib', 'bin', 'dat', 'db', 'sqlite', 'sqlite3', 'lock',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img',
  'doc', 'xls', 'ppt', 'pptx', 'ico', 'woff', 'woff2', 'ttf', 'otf',
])

/** Word（OOXML）—— docx-preview 保真渲染 */
const DOCX_EXT = new Set(['docx'])
/** Excel（.xlsx，OOXML/ZIP）—— SheetJS 解析 → 通用 DataTable */
const XLSX_EXT = new Set(['xlsx'])
/** PDF —— pdfjs 逐页渲染 */
const PDF_EXT = new Set(['pdf'])

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

/** 预览类别：image / markdown / html / docx / xlsx / pdf / code / text（二进制以独立标志表达） */
type PreviewKind = 'image' | 'markdown' | 'html' | 'docx' | 'xlsx' | 'pdf' | 'code' | 'text'
const kind = ref<PreviewKind>('text')
const guard = ref(false)
const forced = ref(false)
const binary = ref(false)
const text = ref<string | null>(null)
/** 二进制文档（docx/xlsx/pdf）原始字节：本组件读取后交给子渲染器（子组件保持纯渲染、无 IO） */
const fileBytes = ref<ArrayBuffer | null>(null)
const imgSrc = ref<string | null>(null)
/** Markdown 渲染产物（v-html） */
const mdHtml = ref('')
/** HTML 预览视图：渲染（iframe）/ 源码 */
const htmlView = ref<'render' | 'source'>('render')
/** HTML 渲染视图居中开关（默认关=全宽；文件名旁图标切换） */
const htmlCentered = ref(false)

/** code 预览文本：JSON 压缩单行文件先 parse → 2 空格重排（parse 失败保留原文，容错 jsonc/损坏） */
const previewCode = computed(() => {
  const src = text.value ?? ''
  const e = ext()
  if (e === 'json' || e === 'jsonc') {
    try {
      return JSON.stringify(JSON.parse(src), null, 2)
    } catch {
      return src
    }
  }
  return src
})

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

// ── 预览 / 编辑切换（2026-09-06 编辑器内核一期）──
const { confirm } = useConfirm()
/** 编辑上限：>1MB 不提供编辑（预览守卫阈值 10MB 不变，两者不重叠） */
const EDIT_MAX = 1024 * 1024
/** 视图模式：预览（原五类渲染）/ 编辑（CM6 源码）/ 对比（磁盘基准 vs 编辑缓冲，只读审查） */
const mode = ref<'preview' | 'edit' | 'diff'>('preview')
/** 编辑缓冲（CodeEditor v-model；进入编辑时以磁盘内容为起点） */
const editBuf = ref('')
/** 内容有改动未保存：头部圆点提示 + 切换/关闭前确认 */
const dirty = ref(false)
const saving = ref(false)
/** CM 语言扩展键（=扩展名，CodeEditor 内映射语言包；未收录=纯文本编辑） */
const editLang = ref('')

/** 可编辑条件：非图片、非二进制文档渲染器、非二进制（含读取后判定）、非大文件守卫态、未超编辑上限 */
const editable = computed(() => !binary.value && !guard.value && !isImage() && !isRenderedDoc() && props.size <= EDIT_MAX)

/** 进入编辑：秒点竞态防护——内容未加载完先等待（仍失败则不进编辑，防空起点覆盖）；
 *  缓冲恢复：有未保存缓冲（右栏切 Tab 后重挂）优先于磁盘文本 */
async function enterEdit(): Promise<void> {
  if (text.value === null) {
    await loadingPromise?.catch(() => {})
    if (text.value === null) return
  }
  const buf = fileTabsState.buffers.get(props.path)
  editBuf.value = buf ?? text.value
  editLang.value = ext()
  mode.value = 'edit'
  dirty.value = editBuf.value !== text.value
}

/** 编辑内容回传：写持久缓冲（切 Tab 不丢）+ 与磁盘文本比对判定脏态 */
function onEditInput(v: string): void {
  editBuf.value = v
  fileTabsState.buffers.set(props.path, v)
  dirty.value = v !== (text.value ?? '')
}

/** 丢弃编辑缓冲（放弃修改/移除 tab 时）：持久缓冲与脏标记一并清理 */
function discardBuffer(): void {
  fileTabsState.buffers.delete(props.path)
  dirty.value = false
}

/** 保存落盘：cmd_fs_write 现成链路（后端零改动）；成功后同步比对基准，返回是否成功 */
async function saveFile(): Promise<boolean> {
  if (saving.value) return false
  saving.value = true
  try {
    await invoke('cmd_fs_write', { path: props.path, content: editBuf.value })
    dirty.value = false
    text.value = editBuf.value
    fileTabsState.buffers.delete(props.path)
    toastInfo('已保存')
    return true
  } catch (err) {
    console.warn('[FilePreview] 保存失败:', err)
    toastWarn(`保存失败：${err}`)
    return false
  } finally {
    saving.value = false
  }
}

/** 脏态离开确认（三键，主键=保存）：保存(主色) / 放弃修改 / 继续编辑；
 *  返回 stay=留在编辑，discard=放弃修改，saved=保存成功（保存失败已提示并留在编辑） */
async function confirmLeave(): Promise<'stay' | 'discard' | 'saved'> {
  let discard = false
  const proceed = await confirm({
    type: 'warning',
    title: '未保存的修改',
    description: '是否保存当前修改后再继续？',
    confirmText: '保存',
    cancelText: '继续编辑',
    extraActions: [{ label: '放弃修改', run: () => { discard = true } }],
  })
  if (!proceed) return 'stay'
  return discard ? 'discard' : 'saved'
}

/** 切换视图；预览↔编辑的脏态离开走三键确认（对比为只读审查可自由进出）
 *  （WsConfirmDialog——Tauri WebView2 禁用原生 confirm，不能用 window.confirm） */
async function switchMode(m: 'preview' | 'edit' | 'diff'): Promise<void> {
  if (m === mode.value) return
  if (m === 'diff') {
    mode.value = 'diff'
    return
  }
  if (m === 'edit') {
    if (mode.value === 'preview') enterEdit() // 预览态进编辑：以磁盘文本为起点
    else mode.value = 'edit' // 对比态回编辑：缓冲保留
    return
  }
  if (dirty.value) {
    const d = await confirmLeave()
    if (d === 'stay') return
    if (d === 'discard') discardBuffer()
    else if (!(await saveFile())) return // 保存失败：toast 已提示，留在原视图
  }
  mode.value = 'preview'
  void load()
}

/** 关闭前检查（多文件栏 tab× 用）：脏态走三键确认（保存/放弃/继续编辑）；
 *  返回是否可以关闭（保存成功或放弃 = 可关，继续编辑 = 不可关） */
async function tryClose(): Promise<boolean> {
  if (!dirty.value) return true
  const d = await confirmLeave()
  if (d === 'stay') return false
  if (d === 'discard') discardBuffer()
  return true
}

// 脏态变化上抛（父组件 tab 栏脏点数据源；内容编辑时置位，保存/放弃后复位）
watch(dirty, (v) => emit('dirty-change', v))

defineExpose({ tryClose })

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
  if (DOCX_EXT.has(ext())) return 'docx'
  if (XLSX_EXT.has(ext())) return 'xlsx'
  if (PDF_EXT.has(ext())) return 'pdf'
  if (CODE_LANG_BY_EXT[ext()]) return 'code'
  return 'text'
}

/** 是否走「二进制文档渲染器」：只读呈现，不可进 CodeMirror 编辑，也无预览/编辑切换 */
function isRenderedDoc(): boolean {
  const k = kind.value
  return k === 'docx' || k === 'xlsx' || k === 'pdf'
}

/** base64 → ArrayBuffer（cmd_fs_read 仅提供 utf-8 / base64 两种编码，二进制文档走后者） */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
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

/** Markdown 容器点击委托：代码块复制按钮（handleCodeCopyClick 返回是否已处理） */
function onMdClick(e: MouseEvent): void {
  handleCodeCopyClick(e)
}

/** 当前读取任务（enterEdit 秒点竞态等待用） */
let loadingPromise: Promise<void> | null = null

/** 读取并按类别渲染（包装 doLoad 以留存进行中任务，供 enterEdit 等待） */
function load(): Promise<void> {
  loadingPromise = doLoad()
  return loadingPromise
}

async function doLoad(): Promise<void> {
  binary.value = false
  text.value = null
  fileBytes.value = null
  imgSrc.value = null
  mdHtml.value = ''
  // 已知二进制（exe/压缩包/旧 office 等）：直接提示不可预览（T11）
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
  // 二进制文档（docx/xlsx/pdf）：读 base64 → ArrayBuffer，交给对应子渲染器
  if (k === 'docx' || k === 'xlsx' || k === 'pdf') {
    try {
      const b64 = await invoke<string>('cmd_fs_read', { path: props.path, encoding: 'base64' })
      fileBytes.value = base64ToArrayBuffer(b64)
    } catch (err) {
      console.warn('[FilePreview] 读取文档失败（可能为损坏或加密文件）:', err)
      binary.value = true
    }
    return
  }
  // 文本族统一 utf-8 读取后按类别渲染
  // code/text 无特殊预览效果：点开即编辑（预览/编辑合并，2026-09-07）；
  // markdown 走富文本渲染；html 默认渲染视图（源码视图模板直读 text 走 CM 只读）
  try {
    const content = await invoke<string>('cmd_fs_read', { path: props.path, encoding: 'utf-8' })
    text.value = content
    if (k === 'markdown') {
      mdHtml.value = renderMarkdownHtml(content)
    } else if (k === 'code' || k === 'text') {
      void enterEdit()
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
  // 编辑态 Ctrl+S 兜底：焦点在编辑器外时，注册表分发（space.fileEditor.save）→
  // AgentSpace handler dispatch 本事件 → 此处执行保存（同 §2-9 模式的事件总线触达，
  // 先例 ws-open-settings；监听非命令注册，键位仍以注册表为唯一权威）
  window.addEventListener('ws-file-editor-save', onEditorSaveRequest)
})

onBeforeUnmount(() => {
  window.removeEventListener('ws-file-editor-save', onEditorSaveRequest)
})

/** 编辑器外保存请求：仅编辑态且有改动时响应（预览态忽略，无副作用） */
function onEditorSaveRequest(): void {
  if (mode.value === 'edit' && dirty.value) void saveFile()
}

// 路径变化时重置状态并重新判定
watch(
  () => props.path,
  () => {
    forced.value = false
    binary.value = false
    fileBytes.value = null
    htmlView.value = 'render'
    mode.value = 'preview'
    dirty.value = false
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
/* 头部文件类型图标：跟随名字基线，色取映射身份色 */
.fpv-file-icon {
  flex-shrink: 0;
  margin-right: 4px;
  vertical-align: -2px;
}
/* 脏态圆点：文件名后跟随的小圆点（有未保存修改时显示） */
.fpv-dirty {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 5px;
  border-radius: 50%;
  background: var(--color-warning, #e8a33d);
  vertical-align: middle;
}
/* 预览/编辑切换按钮（复用 HTML bar 的 fpv-view-btn 风格） */
.fpv-header .fpv-view-btn {
  flex-shrink: 0;
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
  /* sticky 必创建堆叠上下文：不给显式 z-index 时，DOM 靠后的 .fpv-md 会整块画在浮层之上
     （即“浮层全透明”的真因）。提到 md 之上，浮层实色底/阴影才能正常呈现 */
  z-index: 30;
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
