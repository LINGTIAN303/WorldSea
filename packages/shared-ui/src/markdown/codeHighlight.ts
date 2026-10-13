/** 代码语法高亮（Prism 轻量接入，仅高频语言），详细见 docs/details/注释/packages/shared-ui/markdown/codeHighlight.md
 *  按需引入 Prism 核心 + 常用语言（javascript/typescript/python/rust/json/bash/markup/css/markdown/sql/go/java），
 *  通过 useMarkdownRender 的 setCodeHighlighter 注入，命中语言返回高亮 HTML，未命中返回 null（降级纯文本）。
 *  ⚠️ Prism 组件引入时即把语法注册到 Prism.languages（模块加载副作用），统一在 import 阶段触发，保证注入前所有语言已就绪。 */

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
import { setCodeHighlighter } from './markdownStream'

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
 * 高亮结果内容键缓存（2026-09-20 帧率修复）：`Prism.highlight` 代价与源码长度成正比（实测 60 行 TS ≈ 1.6ms），
 * 渲染管线在内容未变时也会重复调用，缓存命中后热路径 Prism 调用降为 0 且输出逐字节一致；上限 64 条 FIFO 淘汰（约数百 KB）。
 * 两条实测热路径细节详见 docs/details/注释/packages/shared-ui/markdown/codeHighlight.md。
 */
const CACHE_MAX = 64
const cache = new Map<string, string | null>()

/** 归一化语言键（别名 → Prism 语言键；未支持返回 null） */
function normalizeLang(lang: string): { key: string; grammar: Prism.Grammar } | null {
  const normalized = (LANG_ALIAS[lang] ?? lang ?? '').toLowerCase()
  if (!normalized) return null
  const grammar = Prism.languages[normalized] as Prism.Grammar | undefined
  if (!grammar) return null
  return { key: normalized, grammar }
}

/** 直接调 Prism（无缓存）——`highlightCode` 与门禁参考实现共用同一底层 */
function prismHighlight(code: string, lang: string): string | null {
  const target = normalizeLang(lang)
  if (!target) return null
  try {
    return Prism.highlight(code, target.grammar, target.key)
  } catch {
    return null
  }
}

/**
 * Prism 高亮入口：返回高亮后的 <code> 内部 HTML；语言不支持或高亮失败返回 null（降级转义原文）。
 *
 * 结果按「(语言, 源码)」内容键 memo——同一份代码在渲染管线里被重复请求时不再跑 Prism。
 */
export function highlightCode(code: string, lang: string): string | null {
  const target = normalizeLang(lang)
  if (!target) return null

  const key = `${target.key}\u0000${code}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const result = prismHighlight(code, lang)
  // 失败结果（null）一并缓存：避免同一份坏输入反复走 try/catch
  if (cache.size >= CACHE_MAX) {
    const drop = Math.ceil(CACHE_MAX * 0.2)
    let n = 0
    for (const k of cache.keys()) {
      if (n++ >= drop) break
      cache.delete(k)
    }
  }
  cache.set(key, result)
  return result
}

/**
 * 参考实现（门禁对照用）：不查缓存的直接 Prism 高亮。
 * 保留在源码内是为了让门禁能断言「预算确实能捕获去掉缓存的回归」——参考实现的耗时
 * 必须超出预算（判别力自证），而不是一个永不红的空门槛。
 */
export function referenceHighlightCode(code: string, lang: string): string | null {
  return prismHighlight(code, lang)
}

/** 清空高亮缓存（测试用；生产无调用方） */
export function clearHighlightCache(): void {
  cache.clear()
}

// 模块加载即注入：保证 useMarkdownRender 渲染代码块时高亮器已就绪
setCodeHighlighter(highlightCode)