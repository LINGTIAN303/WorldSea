/**
 * wsBasicSetup（2026-09-08 智能提示修复）：
 * CM 官方 basicSetup 的等价复刻，唯一差异=不含 autocompletion()——
 * vue-codemirror 默认 basicSetup 的 autocompletion 实例与各 assist
 * （entity/ts/lsp-cmlsp）自建实例并存时，CM 补全系统互相干扰失效
 * （真机实测：键入与 startCompletion 直调均不弹），故全局默认替换为本集合，
 * 让 assist 的 override 实例成为编辑器内唯一 autocompletion。
 * 经 main.ts app.use(VueCodemirror, { extensions: [wsBasicSetup] }) 注入。
 * 官方 basicSetup 出处：codemirror.net basic-setup 包源（仅减 autocompletion()）。
 */
import { EditorState } from '@codemirror/state'
import {
  keymap,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from '@codemirror/view'
import {
  foldGutter,
  indentOnInput,
  bracketMatching,
  foldKeymap,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { lintKeymap } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'

export const wsBasicSetup: Extension[] = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    // completionKeymap（Esc/方向键操作补全列表）保留：无实例时无副作用，有 assist 实例时提供键控
    ...completionKeymap,
    ...lintKeymap,
  ]),
]
