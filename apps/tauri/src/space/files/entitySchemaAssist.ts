/**
 * 实体 JSON Schema 辅助（智能提示一期 D，2026-09-07 立项 §三）：
 * schema 源=entity-core 旧版实体注册表（entitySchemaRegistry）——官方插件启动时写入、
 * 侧栏/实体表单同源、切项目时 clear+重注册；直接同步读表无进程级缓存（项目切换零 stale）。
 * （原 WASM 核心表经调研为死代码：全应用零写入，已弃用，见走查清单结论 #1）
 * 匹配键=文件顶层 "type" 字段 → typeKey，无匹配则全部静默（非实体 JSON 零回归）。
 * 三源统一走本文件导出，A/B1 期以同形态接入（立项 §六）。
 * 详细见 docs/plans/2026-09-07-智能提示与语言服务立项.md
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { hoverTooltip } from '@codemirror/view'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { entitySchemaRegistry, type EntityTypeSchema, type FieldSchema } from '@worldsmith/entity-core'

/** 顶层固定键（所有实体文件通用；字段级键由 schema fields 提供） */
const TOP_KEYS: Completion[] = [
  { label: 'id', detail: 'UUID', type: 'variable' },
  { label: 'type', detail: '实体类型', type: 'keyword' },
  { label: 'name', detail: '名称', type: 'property' },
  { label: 'description', detail: '描述', type: 'property' },
  { label: 'properties', detail: '业务字段承载', type: 'namespace' },
  { label: 'tags', detail: '标签', type: 'property' },
  { label: 'createdAt', detail: '创建时间', type: 'variable' },
  { label: 'updatedAt', detail: '更新时间', type: 'variable' },
]
const TOP_KEY_SET = new Set(TOP_KEYS.map((k) => k.label))

// ── 文档定位启发（编辑中全文 JSON.parse 常失败，均为容错式启发，误差仅影响建议相关性） ──

/** 顶层 type 检测：优先全文 parse，失败退化扫前 40 行 */
function detectTypeKey(text: string): string | null {
  try {
    const o: unknown = JSON.parse(text)
    if (o && typeof o === 'object' && typeof (o as Record<string, unknown>).type === 'string') {
      return (o as Record<string, string>).type
    }
    return null
  } catch {
    const head = text.split('\n', 40).join('\n')
    const m = /"type"\s*:\s*"([^"]+)"/.exec(head)
    return m ? m[1] : null
  }
}

/** 光标是否位于顶层 "properties" 对象内部（数其后未闭合的花括号差值） */
function inProperties(text: string, pos: number): boolean {
  const idx = text.lastIndexOf('"properties"', pos)
  if (idx < 0) return false
  let depth = 0
  for (let i = text.indexOf('{', idx); i >= 0 && i < pos; i = text.indexOf('{', i + 1)) depth++
  for (let i = text.indexOf('}', idx); i >= 0 && i < pos; i = text.indexOf('}', i + 1)) depth--
  return depth > 0
}

/** 键位=光标行内冒号尚未出现且引号未闭合（正在敲键名）；返回片段与起点 */
function keyAtCursor(lineText: string, col: number): { name: string; from: number } | null {
  const before = lineText.slice(0, col)
  if (before.includes(':')) return null
  const m = /"([^"]*)$/.exec(before)
  if (!m) return null
  return { name: m[1], from: col - m[1].length }
}

/** 当前行值位判定：返回行内 "key": 模式的键名（光标须在冒号之后） */
function keyOfValuePos(lineText: string, col: number): string | null {
  const m = /"([^"]+)"\s*:\s*/.exec(lineText)
  if (!m) return null
  return m.index + m[0].length <= col ? m[1] : null
}

function fieldsOf(schema: EntityTypeSchema | null | undefined): FieldSchema[] {
  return schema?.fields ?? []
}

// ── 补全源：顶层键 / properties 字段键 / 值位枚举（options、type 键的 typeKey 列表） ──
function entityCompletionSource(ctx: CompletionContext): CompletionResult | null {
  const { state } = ctx
  const text = state.doc.toString()
  const typeKey = detectTypeKey(text)
  if (!typeKey) return null
  const schema = entitySchemaRegistry.get(typeKey)
  if (!schema) return null

  const pos = ctx.pos
  const line = state.doc.lineAt(pos)
  const col = pos - line.from

  // 值位优先：type 键 → 全部实体类型；字段键有 options → 枚举值
  const vk = keyOfValuePos(line.text, col)
  if (vk === 'type') {
    return {
      from: pos,
      options: entitySchemaRegistry.getAll().map((s) => ({ label: s.typeKey, detail: s.label, type: 'type' })),
    }
  }
  if (vk) {
    const field = fieldsOf(schema).find((f) => f.key === vk)
    if (field?.options?.length) {
      return { from: pos, options: field.options.map((o) => ({ label: o.value, detail: o.label, type: 'enum' })) }
    }
    return null
  }

  // 键位：顶层固定键 vs properties 字段键
  // 注意 from=文档绝对偏移：keyAtCursor 返回的是行内列，须加 line.from（2026-09-08 修复：
  // 原实现直接用行内列，from 落到文档头部，CM 静默丢弃跨行结果导致补全永不弹出）
  const key = keyAtCursor(line.text, col)
  if (!key) return null
  if (!inProperties(text, pos)) {
    return { from: line.from + key.from, options: TOP_KEYS }
  }
  return {
    from: line.from + key.from,
    options: fieldsOf(schema).map((f) => ({
      label: f.key,
      detail: f.label,
      type: 'property',
      info: f.required ? '必填字段' : undefined,
    })),
  }
}

// ── 悬停源：键名字符串上显示字段说明（label/fieldType/required/placeholder） ──
const hover = hoverTooltip((view, pos) => {
  const text = view.state.doc.toString()
  const typeKey = detectTypeKey(text)
  if (!typeKey) return null
  const schema = entitySchemaRegistry.get(typeKey)
  if (!schema) return null

  const line = view.state.doc.lineAt(pos)
  // 仅键名形态（"key": 后随冒号）触发
  const m = /^(\s*)"([^"]+)"\s*:/.exec(line.text)
  if (!m) return null
  const keyFrom = line.from + m[1].length + 1
  if (pos < keyFrom || pos > keyFrom + m[2].length) return null
  const key = m[2]

  let title = key
  let body = ''
  if (!inProperties(text, pos)) {
    const top = TOP_KEYS.find((k) => k.label === key)
    if (top) body = top.detail ?? ''
  } else {
    const field = fieldsOf(schema).find((f) => f.key === key)
    if (!field) return null
    title = field.label || key
    body = [field.fieldType, field.required ? '必填' : '', field.placeholder ?? ''].filter(Boolean).join(' · ')
  }
  if (!body) return null
  return {
    pos: keyFrom - 1,
    create: () => {
      const dom = document.createElement('div')
      dom.className = 'ws-schema-tip'
      const b = document.createElement('strong')
      b.textContent = title
      const s = document.createElement('span')
      s.textContent = body
      dom.append(b, document.createTextNode(' '), s)
      return { dom }
    },
  }
})

// ── 诊断：全文 parse 成功且顶层 type 命中已注册 schema 时才介入（未知顶层键 + properties
//  未知字段 + 缺必填）；非实体 JSON（无 type 或 type 未注册）完全静默，parse 失败静默 ──
const lint = linter((view) => {
  const diags: Diagnostic[] = []
  const text = view.state.doc.toString()
  let obj: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return diags
    obj = parsed as Record<string, unknown>
  } catch {
    return diags
  }
  const typeKey = typeof obj.type === 'string' ? obj.type : null
  const schema = typeKey ? entitySchemaRegistry.get(typeKey) : null
  if (!schema) return diags // 门槛：type 未命中注册表 = 非实体文件，零介入（D 走查 #8 修复）

  const keyRange = (key: string): { from: number; to: number } => {
    const i = text.indexOf(`"${key}"`)
    const from = i < 0 ? 0 : i
    return { from, to: from + key.length + 2 }
  }
  for (const k of Object.keys(obj)) {
    if (!TOP_KEY_SET.has(k)) {
      const r = keyRange(k)
      diags.push({ ...r, severity: 'warning', message: `未知顶层键「${k}」` })
    }
  }
  const props = obj.properties
  const fieldKeys = new Set(fieldsOf(schema).map((f) => f.key))
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const k of Object.keys(props)) {
      if (!fieldKeys.has(k)) {
        const r = keyRange(k)
        diags.push({ ...r, severity: 'warning', message: `「${schema.label}」无字段「${k}」` })
      }
    }
  }
  for (const f of fieldsOf(schema)) {
    if (f.required && (!props || typeof props !== 'object' || !(f.key in (props as object)))) {
      const r = keyRange('properties')
      diags.push({ ...r, severity: 'info', message: `缺少必填字段「${f.key}」（${f.label}）` })
    }
  }
  return diags
})

/** 三源集合：CodeEditor 编辑态 + json 语言时挂载（minimal 预览态不挂）；
 *  override 独占补全源（2026-09-08 恢复 override：data.of 方案在本环境实测不弹，
 *  且全局默认已换 wsBasicSetup 去掉了 basicSetup 的 autocompletion 实例，本实例唯一，
 *  详见走查清单 D 期修复记录） */
export function entityAssistExts(): Extension[] {
  return [autocompletion({ override: [entityCompletionSource] }), hover, lint, lintGutter()]
}
