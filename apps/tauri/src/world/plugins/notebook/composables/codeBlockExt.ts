/**
 * codeBlockExt — 代码块增强扩展（批 1 V2，2026-10-12）。
 *
 * 在官方 CodeBlock（3.29，自带 language 属性 + ```lang 输入规则 + markdown 往返）之上：
 * ① 换 Vue NodeView（语言下拉 + 复制按钮 + Prism 高亮 overlay）；
 * ② 暴露「常用语言」清单供 NodeView 下拉复用（与 shared-ui codeHighlight 已注册的
 *    Prism 语言集一致，别名归一在其内部完成）。
 *
 * 为什么不引 lowlight：全站语法高亮栈统一为 shared-ui 的 Prism 轻量接入（聊天/文件预览/
 * 代码块同源），且 highlightCode 自带内容键缓存（60 行 TS ≈ 1.6ms，输入逐字触发时必须缓存）。
 *
 * 高亮实现采用「双层 overlay」：底层 v-html 高亮层（aria-hidden），上层 node-view-content
 * 文本层 color: transparent（caret 正常着色）——两层同处一个 pre，天然同步滚动；
 * 样式一致性由 prose.css 的 .ws-cb-hl/.ws-cb-input 同规格约束（同 font/white-space/zero box）。
 */
import { CodeBlock } from '@tiptap/extension-code-block'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockView from '../components/CodeBlockView.vue'

/** 语言下拉清单：与 shared-ui codeHighlight 已注册的 Prism 语言集一一对应（ui 显示名） */
export const CODE_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '纯文本' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'json', label: 'JSON' },
  { value: 'bash', label: 'Bash' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'sql', label: 'SQL' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
  { value: 'yaml', label: 'YAML' },
]

export const CodeBlockEnhanced = CodeBlock.extend({
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockView)
  },
})

export default CodeBlockEnhanced
