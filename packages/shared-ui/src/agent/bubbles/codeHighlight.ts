/** 代码语法高亮（Prism 轻量接入，仅高频语言），详细见 docs/details/注释/packages/shared-ui/agent/bubbles/codeHighlight.md
 *
 * 按需引入 Prism 核心 + 常用语言（javascript/typescript/python/rust/json/bash/markup/css/markdown/sql/go/java）。
 * 通过 useMarkdownRender 的 setCodeHighlighter 注入，命中语言返回高亮 HTML，未命中返回 null（降级纯文本）。
 *
 * ⚠️ Prism 组件（prism-*.js）在引入时会把对应语法注册到 Prism.languages，副作用在模块加载时完成。
 * 这里统一在 import 阶段触发，保证注入前所有语言已就绪。 */

import Prism from 'prismjs'
// 语言组件：import 副作用即注册语法（顺序无依赖）
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-rust'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-markdown'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-go'
import 'prismjs/components/prism-java'
import { setCodeHighlighter } from './useMarkdownRender'

/** 语言别名归一：LLM 常输出的口语化语言名 → Prism 语言键 */
const LANG_ALIAS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  vue: 'markup',
  yaml: 'yaml',
  yml: 'yaml',
  txt: '',
}

/**
 * Prism 高亮入口：返回高亮后的 <code> 内部 HTML；语言不支持或高亮失败返回 null（降级转义原文）。
 */
export function highlightCode(code: string, lang: string): string | null {
  const normalized = (LANG_ALIAS[lang] ?? lang ?? '').toLowerCase()
  if (!normalized) return null
  const grammar = Prism.languages[normalized] as Prism.Grammar | undefined
  if (!grammar) return null
  try {
    return Prism.highlight(code, grammar, normalized)
  } catch {
    return null
  }
}

// 模块加载即注入：保证 useMarkdownRender 渲染代码块时高亮器已就绪
setCodeHighlighter(highlightCode)