<template>
  <div class="cmed">
    <Codemirror
      :model-value="modelValue"
      :extensions="exts"
      :autofocus="!minimal"
      :disabled="minimal"
      class="cmed-cm"
      @change="onDocChange"
      @ready="onReady"
    />
    <!-- LSP 生命周期角标（非 ready 常驻右下小字）：给「索引中」一个可见预期，不再静默死等 -->
    <div v-if="lspStatusText" class="cmed-lsp-chip" :data-status="lspStatus">{{ lspStatusText }}</div>
  </div>
</template>

<!--
  CodeEditor.vue（2026-09-06 编辑器内核一期）：
  CM6 薄封装——v-model 内容 / 语言扩展（ext 键映射，未收录语言纯文本编辑）/
  令牌主题（--color-* 容器 + --agent-* 语法配色，明暗自适应）/ Ctrl+S 保存键位。
  保存键位读注册表 space.fileEditor.save（可改键，参照 ChatInput §2-9 模式：
  注册表分发对 contentEditable 输入焦点跳过，真正匹配在此处 keymap 内）。
-->
<script setup lang="ts">
import { ref, shallowRef, computed, watch, onBeforeUnmount } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { EditorView, keymap, ViewPlugin, Decoration, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { type Extension, type Range, type EditorState } from '@codemirror/state'
import { indentUnit, indentRange } from '@codemirror/language'
import { showMinimap } from '@replit/codemirror-minimap'
import { useShortcuts } from '@worldsea/ui-kit'
import { cmLangOf } from './cmLangs'
import { wsEditorTheme, wsSyntax } from './cmTheme'
import { entityAssistExts } from './entitySchemaAssist'
import { tsAssistExts, tsAssistLintExts } from './tsAssist'
import {
  LSP_CANDIDATE_LANGS,
  lspAssistExts,
  lspAvailable,
  lspStatusOf,
  lspNoProjectOf,
  type LspStatus,
} from './lspAssist'

const props = defineProps<{ modelValue: string; lang: string; minimal?: boolean; filePath?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string]; save: [] }>()

// v-model 桥接：内部输入经 change 事件上抛；外部注入（换文件/进入编辑）由
// vue-codemirror 内部 watch modelValue 处理（值与 doc 一致时自动跳过，无回环）
function onDocChange(v: string): void {
  emit('update:modelValue', v)
}

// 语法配色与容器主题：抽至共享 cmTheme.ts（CodeDiff 对比视图同源消费）

// ── Ctrl+S 保存：读注册表（可改键），注册表键值 → CM 键名（['ctrl','s'] → 'Mod-s'） ──
const { getRegisteredKeys } = useShortcuts()
/** 注册表键值转 CM keymap 键名；非「修饰符+单键」形态返回 null（不挂键位） */
function regToCmKey(keys: string[]): string | null {
  let mod = ''
  const rest: string[] = []
  for (const k of keys) {
    if (k === 'ctrl') mod += 'Mod-'
    else if (k === 'shift') mod += 'Shift-'
    else if (k === 'alt') mod += 'Alt-'
    else rest.push(k)
  }
  return rest.length === 1 ? mod + rest[0] : null
}

/** 保存键位（编辑器挂载后从注册表读取一次；改键后下次进入编辑生效） */
const saveKey = ref(regToCmKey(getRegisteredKeys('space.fileEditor.save') ?? ['ctrl', 's']) ?? 'Mod-s')

/** keymap 命中保存键：emit save 并消费（preventDefault 阻止浏览器保存对话框） */
function makeSaveKeymap(): Extension {
  return keymap.of([{
    key: saveKey.value,
    preventDefault: true,
    run: () => {
      emit('save')
      return true
    },
  }])
}

// ── 缩进参考线（2026-09-07）：按行首空白宽度分级，视口内每行画 (级数-1) 根竖线。
//  纯前端 decoration（零依赖）：等宽 ch 单位对齐缩进列，tab 按 indentUnit 折算 ──
class GuideWidget extends WidgetType {
  readonly col: number
  constructor(col: number) {
    super()
    this.col = col
  }
  override eq(o: GuideWidget): boolean {
    return o.col === this.col
  }
  override toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-indent-guide'
    s.style.left = `calc(${this.col}ch)`
    return s
  }
  override ignoreEvent(): boolean {
    return true
  }
}

function buildGuides(view: EditorView): DecorationSet {
  const unit = view.state.facet(indentUnit).length || 2
  const ranges: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos)
      if (line.text.trim().length > 0) {
        const leading = /^\s*/.exec(line.text)?.[0] ?? ''
        let spaces = 0
        for (const ch of leading) spaces += ch === '\t' ? unit : 1
        const levels = Math.floor(spaces / unit)
        for (let i = 1; i < levels; i++) {
          ranges.push(Decoration.widget({ widget: new GuideWidget(i * unit), side: -1 }).range(line.from))
        }
      }
      if (line.to >= to) break
      pos = line.to + 1
    }
  }
  return Decoration.set(ranges, true)
}

/** 缩进参考线扩展：视口重建（滚动/编辑时自动刷新） */
const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildGuides(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = buildGuides(u.view)
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)

/** TS 智能提示（二期 A）：ts/tsx/js/jsx 编辑态懒挂载（tsAssistExts 首调才创建 worker，
 *  typescript 引擎独立 chunk 不进主包）；语言/预览态切换时重建或卸载 */
const TS_LANGS = new Set(['ts', 'tsx', 'js', 'jsx'])
// shallowRef：Extension 是递归类型，ref 的 UnwrapRef 深度展开会 TS2589 爆实例化
const tsExts = shallowRef<Extension[] | null>(null)
const lspExts = shallowRef<Extension[] | null>(null)
// 诊断回填（A5 遗留）：LSP 接管补全/悬停但诊断缺失时补挂的 tsAssist 诊断源
const tsLintExts = shallowRef<Extension[] | null>(null)
/** 回落判定延迟：等 LSP 首轮 diagnostics（tsls 无工程上下文时永不到 → 到点即回落） */
const LINT_FALLBACK_MS = 8_000
let lintFallbackTimer: number | null = null
function clearLintFallback(): void {
  if (lintFallbackTimer !== null) {
    clearTimeout(lintFallbackTimer)
    lintFallbackTimer = null
  }
}
// watch 竞态防护：async 回调 await 期间又触发新一轮时，旧回调结果作废（序号失配即丢弃）
let assistWatchSeq = 0
watch(
  [() => props.lang, () => props.minimal, () => props.filePath] as const,
  async ([lang, minimal, filePath]) => {
    const seq = ++assistWatchSeq
    tsExts.value = null
    lspExts.value = null
    tsLintExts.value = null
    clearLintFallback()
    if (minimal) return
    // B1 仲裁（立项 §六）：已装语言服务器 → LSP 优先（需真实文件路径）；启动失败回落 tsAssist
    if (filePath && LSP_CANDIDATE_LANGS.has(lang) && (await lspAvailable(lang))) {
      const lExts = await lspAssistExts(lang, filePath)
      if (seq !== assistWatchSeq) return
      if (lExts) {
        lspExts.value = lExts
        if (TS_LANGS.has(lang)) {
          clearLintFallback()
          lintFallbackTimer = window.setTimeout(() => {
            lintFallbackTimer = null
            if (seq !== assistWatchSeq) return
            if (lspStatusOf(lang) === 'ready') return // LSP 诊断已到达，无需回落
            tsLintExts.value = tsAssistLintExts(`/virtual/main.${lang}`, props.modelValue)
          }, LINT_FALLBACK_MS)
        }
        return
      }
      // lspAssistExts 返回 null（启动失败/初始化异常）→ 继续走下方 tsAssist（.ts/.js）或纯高亮（.rs 等）
    }
    if (TS_LANGS.has(lang)) {
      // tsAssistExts 首调才创建 worker（引擎 chunk 懒加载）；置入 ref 触发 exts 重建
      tsExts.value = tsAssistExts(`/virtual/main.${lang}`, props.modelValue)
    }
  },
  { immediate: true },
)

/** LSP 生命周期角标：ready（诊断已到达）隐藏；其余状态给可见预期，不再静默死等 */
const lspStatus = computed<LspStatus | undefined>(() => lspStatusOf(props.lang))
const lspNoProject = computed(() => lspNoProjectOf(props.lang))
const lspStatusText = computed(() => {
  if (lspStatus.value === 'ready') return ''
  // 孤儿目录（root 上溯未命中任何工程清单）：server 大概率不产诊断，直说不转圈
  if (lspNoProject.value) return '未找到工程配置，语言服务提示可能受限'
  switch (lspStatus.value) {
    case 'starting':
      return '语言服务连接中…'
    case 'loading':
      return '语言服务索引中（大项目首次可达 1 分钟以上）'
    case 'slow':
      return '语言服务仍在索引（大项目可达 1 分钟以上）'
    case 'failed':
      return '语言服务不可用，已回落基础提示'
    case 'closed':
      return '语言服务已断开（重新打开文件可重建）'
    default:
      return ''
  }
})

/** LSP 诊断到达后撤回落诊断源（避免 LSP 与 tsAssist 双份下划线） */
watch(lspStatus, (s) => {
  if (s === 'ready' && tsLintExts.value) tsLintExts.value = null
})

/** 语义化键位兜底：saveKey 变化（改键）时重挂 keymap —— 简化处理：语言/键位变化整体重建 extensions。
 *  minimal（预览只读渲染，2026-09-07）：仅主题+语法高亮+语言，无保存键/缩进线/minimap——
 *  预览态语法着色与编辑态同源，缩进线按需求仅编辑态显示 */
const exts = computed<Extension[]>(() => {
  const list: Extension[] = [wsEditorTheme, wsSyntax]
  if (props.minimal) {
    const lang = cmLangOf(props.lang)
    if (lang) list.push(lang)
    return list
  }
  list.push(
    makeSaveKeymap(),
    indentGuides,
    // 实体 JSON schema 辅助（智能提示一期 D）：仅 json 语言编辑态，非实体文件自动静默
    ...(props.lang === 'json' ? entityAssistExts() : []),
    ...(tsExts.value ? tsExts.value : []),
    ...(lspExts.value ? lspExts.value : []),
    ...(tsLintExts.value ? tsLintExts.value : []),
    // 右侧滑动预览窗（minimap）：replit 包——0.5.x API = showMinimap Facet，
    // create 仅提供容器 DOM；块高随内容由容器内联样式控制（updateMinimapHeight）
    showMinimap.of({
      create: () => {
        const dom = Object.assign(document.createElement('div'), { className: 'cmed-minimap-dom' })
        minimapEl.value = dom
        dom.style.height = minimapHeight.value
        return { dom }
      },
      displayText: 'characters',
      showOverlay: 'always',
    }),
  )
  const mk = cmLangOf(props.lang)
  if (mk) list.push(mk)
  return list
})

// ── minimap 块高随内容：高度 = 文档行数 × minimap 行高（编辑器行高 / 包内缩放常量
//  SizeRatio=4），钳位 [32px, 编辑器高]；包内画布强制 minHeight=编辑器高，由容器
//  overflow:hidden 裁剪；容器定版：不透明底、无分割线（2026-09-07 恢复 replit 包）──
const viewRef = ref<EditorView | null>(null)
const MINIMAP_SIZE_RATIO = 4
const minimapEl = ref<HTMLElement | null>(null)
const minimapHeight = ref('32px')

function updateMinimapHeight(): void {
  if (props.minimal) return
  const view = viewRef.value
  if (!view) return
  // 行高实测首行 .cm-line 盒高（used px）：主题 line-height 为无单位倍数（1.55），
  // getComputedStyle 在部分环境返回倍数本身而非像素，parseFloat 会得到 1.55 → 块高恒被钳 32px
  const lineEl = view.dom.querySelector('.cm-line')
  const linePx = lineEl ? lineEl.getBoundingClientRect().height : 0
  const lineH = (linePx || 18) / MINIMAP_SIZE_RATIO
  const editorH = view.dom.getBoundingClientRect().height
  const h = Math.min(view.state.doc.lines * lineH, editorH)
  minimapHeight.value = `${Math.max(32, Math.round(h))}px`
}

watch(minimapHeight, (h) => {
  if (minimapEl.value) minimapEl.value.style.height = h
})

watch(() => props.modelValue, () => updateMinimapHeight())

/** 编辑器盒高跟踪：面板分栏/折叠/窗口缩放都会改变钳位上限（window resize 事件覆盖不到分栏） */
let minimapRO: ResizeObserver | null = null
onBeforeUnmount(() => {
  minimapRO?.disconnect()
  minimapRO = null
  clearLintFallback()
})

// ── 一键结构化（2026-09-07）：indentRange 基于语法树重排全文缩进（内核原生能力，零外部引擎）──
// （viewRef 声明见上方 minimap 段，格式化与 minimap 共用）

function onReady(payload: { view: EditorView }): void {
  viewRef.value = payload.view
  // 初算块高：初次挂载时 modelValue 已是全文（FilePreview 先填 editBuf 再进编辑态），
  // watch(modelValue) 不会触发——这是「块高恒 32px」的根因；rAF 等一帧布局稳定。
  // RO 跟踪编辑器盒高（初始观测也会回调一次，双保险）
  minimapRO = new ResizeObserver(() => updateMinimapHeight())
  minimapRO.observe(payload.view.dom)
  requestAnimationFrame(updateMinimapHeight)
}

/** 重排全文缩进（无语法树的语言安全降级：缩进保持原样不破坏内容）。
 *  state 断言桥接：vue-codemirror ready 的 state 与 @codemirror/language 声明的 EditorState
 *  为同一运行时对象、TS 模块实例重复，结构一致仅 nominal 视角不合 */
function formatIndent(): void {
  const view = viewRef.value
  if (!view) return
  view.dispatch({ changes: indentRange(view.state as EditorState, 0, view.state.doc.length) })
}

defineExpose({ formatIndent })

// ── IME/编辑键约束：编辑键全交 CM6 自管（组件局部键规范），此处不抢键 ──

</script>

<style scoped>
.cmed {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: text;
}
/* LSP 状态角标：右下小字浮层，不遮内容区交互（pointer-events none） */
.cmed-lsp-chip {
  position: absolute;
  right: 10px;
  bottom: 8px;
  z-index: 6;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-2xs);
  pointer-events: none;
}
.cmed-lsp-chip[data-status='slow'] {
  opacity: 0.6; /* 索引超预期：淡化，不再抢注意力 */
}
.cmed-lsp-chip[data-status='failed'],
.cmed-lsp-chip[data-status='closed'] {
  color: var(--color-warning, #e8a33d);
}
.cmed-cm {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
/* vue-codemirror 根元素与 CM 容器撑满 */
.cmed-cm :deep(.cm-editor) {
  height: 100%;
}

/* 缩进参考线：widget 绝对定位在行内 ch 列（等宽字体保证对齐） */
.cmed-cm :deep(.cm-line) {
  position: relative;
}
.cmed-cm :deep(.cm-indent-guide) {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-text-tertiary);
  opacity: 0.5;
  pointer-events: none;
}

/* ── 搜索面板（basicSetup 内置 Ctrl+F/H）令牌化：CM 默认浅色样式不适配明暗主题 ── */
.cmed-cm :deep(.cm-panels) {
  background: var(--color-surface-elevated);
  color: var(--color-text-secondary);
  border-color: var(--color-border);
}
.cmed-cm :deep(.cm-panel.cm-search) {
  padding: 6px 34px 6px 10px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
.cmed-cm :deep(.cm-panel.cm-search input.cm-textfield) {
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-xs);
}
.cmed-cm :deep(.cm-panel.cm-search input.cm-textfield:focus) {
  outline: none;
  border-color: var(--color-primary);
}
.cmed-cm :deep(.cm-panel.cm-search label) {
  color: var(--color-text-tertiary);
}
.cmed-cm :deep(.cm-panel.cm-search button) {
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-2xs);
  cursor: pointer;
}
.cmed-cm :deep(.cm-panel.cm-search button:hover) {
  color: var(--color-text);
  background: var(--color-surface);
}
/* 关闭钮：CM 定位在面板右上角，做无边框幽灵化 */
.cmed-cm :deep(.cm-panel.cm-search button[name=close]) {
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-md);
  line-height: 1;
}
.cmed-cm :deep(.cm-panel.cm-search button[name=close]:hover) {
  background: var(--color-surface);
  color: var(--color-text);
}
/* 搜索结果匹配高亮：主色弱底 */
.cmed-cm :deep(.cm-searchMatch) {
  background: var(--color-primary-muted);
}
.cmed-cm :deep(.cm-searchMatch-selected) {
  background: var(--color-primary-muted);
  outline: 1px solid var(--color-primary);
}

/* ── CM tooltip 容器（schema 悬停/诊断悬停共用）与实体 schema 悬停卡，令牌化 ── */
.cmed-cm :deep(.cm-tooltip) {
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
}
.cmed-cm :deep(.ws-schema-tip) {
  padding: 4px 8px;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
.cmed-cm :deep(.ws-schema-tip strong) {
  color: var(--color-text);
  font-weight: 600;
  margin-right: 4px;
}

/* ── minimap（replit 包）容器：块高随内容（内联动态）、不透明底、无分割线；
    包内画布强制全高，由 overflow:hidden 裁剪 ── */
.cmed-cm :deep(.cmed-minimap-dom) {
  width: 96px;
  overflow: hidden;
  background: var(--color-surface-elevated);
  cursor: pointer;
}
</style>
