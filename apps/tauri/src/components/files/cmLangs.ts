/**
 * CM6 语言映射（2026-09-07 从 CodeEditor 抽出共享）：ext 键 → 语言扩展。
 * CodeEditor（编辑）与 CodeDiff（对比）同源消费；未收录 ext 返回 null（纯文本）。
 * 官方 lang-* 为 Lezer 语法树（支持 indentRange 结构化）；legacy-modes 为流式高亮（无语法树）。
 */
import { type Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { rust } from '@codemirror/lang-rust'
import { go } from '@codemirror/lang-go'
import { java } from '@codemirror/lang-java'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { markdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { sql } from '@codemirror/lang-sql'
import { cpp } from '@codemirror/lang-cpp'
import { php } from '@codemirror/lang-php'
import { vue } from '@codemirror/lang-vue'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { properties } from '@codemirror/legacy-modes/mode/properties'

/** ts/js 族语言单例：tsAssist 的补全源须挂在编辑器实际使用的同一 language 实例上
 *  （languageData 挂在 A 实例、编辑器用 B 实例则源不生效），故 ts/tsx/js/jsx/mjs/cjs 全部缓存复用 */
let _tsLike: Record<string, Extension> | null = null
function tsLike(): Record<string, Extension> {
  if (!_tsLike) {
    _tsLike = {
      ts: javascript({ typescript: true }),
      tsx: javascript({ typescript: true, jsx: true }),
      js: javascript(),
      jsx: javascript({ jsx: true }),
      mjs: javascript(),
      cjs: javascript(),
    }
  }
  return _tsLike
}

const CM_LANG_BY_EXT: Record<string, () => Extension> = {
  // ── 官方 Lezer 语法树语言 ──
  py: () => python(),
  ts: () => tsLike().ts,
  tsx: () => tsLike().tsx,
  js: () => tsLike().js,
  jsx: () => tsLike().jsx,
  mjs: () => tsLike().mjs,
  cjs: () => tsLike().cjs,
  rs: () => rust(),
  go: () => go(),
  java: () => java(),
  json: () => json(),
  jsonc: () => json(),
  yaml: () => yaml(),
  yml: () => yaml(),
  md: () => markdown(),
  markdown: () => markdown(),
  html: () => html(),
  htm: () => html(),
  css: () => css(),
  sql: () => sql(),
  cpp: () => cpp(),
  c: () => cpp(),
  h: () => cpp(),
  hpp: () => cpp(),
  cc: () => cpp(),
  cxx: () => cpp(),
  php: () => php(),
  vue: () => vue(),
  // ── legacy 流式模式（高亮；无语法树，结构化缩进对其安全降级） ──
  sh: () => StreamLanguage.define(shell),
  bash: () => StreamLanguage.define(shell),
  zsh: () => StreamLanguage.define(shell),
  lua: () => StreamLanguage.define(lua),
  rb: () => StreamLanguage.define(ruby),
  toml: () => StreamLanguage.define(toml),
  dockerfile: () => StreamLanguage.define(dockerFile),
  ini: () => StreamLanguage.define(properties),
  cfg: () => StreamLanguage.define(properties),
  conf: () => StreamLanguage.define(properties),
}

/** 按扩展名取语言扩展；未收录返回 null（纯文本编辑/对比） */
export function cmLangOf(ext: string): Extension | null {
  const mk = CM_LANG_BY_EXT[ext]
  return mk ? mk() : null
}
