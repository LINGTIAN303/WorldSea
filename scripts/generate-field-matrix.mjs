import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS_DIR = path.join(ROOT, 'apps/tauri/src/world/plugins')
const TRAITS_FILE = path.join(ROOT, 'packages/entity-core/src/traits/index.ts')
const FACETS_FILE = path.join(ROOT, 'packages/entity-core/src/facets/index.ts')
const TEMPLATE_FILE = path.join(ROOT, 'scripts/field-matrix-template.html')
const MATRIX_CSS_FILE = path.join(ROOT, 'apps/tauri/src/world/plugins/field-matrix/styles/matrix.css')
const STANDALONE_CSS_FILE = path.join(ROOT, 'apps/tauri/src/world/plugins/field-matrix/styles/standalone.css')
const MD_OUT = path.join(ROOT, 'docs/details/架构/芽字段矩阵.md')
const HTML_OUT = path.join(ROOT, 'docs/details/架构/芽字段矩阵.html')
const TODAY = new Date().toISOString().slice(0, 10)

const TYPE_ZH = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  select: '单选',
  'multi-select': '多选',
  tags: '标签',
  image: '图片',
  color: '颜色',
  boolean: '开关',
  entityRef: '实体引用',
  date: '日期',
  multiSelect: '多选',
  formula: '公式',
  richtext: '富文本',
  url: '链接',
  email: '邮箱',
}
const TYPE_ORDER = ['text', 'textarea', 'number', 'select', 'multi-select', 'tags', 'image', 'color', 'boolean', 'entityRef', 'date', 'formula', 'richtext', 'url', 'email']
const TYPE_CLASS = {
  text: 'text',
  textarea: 'textarea',
  number: 'number',
  select: 'select',
  'multi-select': 'multi',
  multiSelect: 'multi',
  tags: 'tags',
  image: 'image',
  color: 'color',
  boolean: 'boolean',
  entityRef: 'ref',
  date: 'date',
}
const TOP_LEVEL = {
  title: '顶层 `name`（`title` 与 `name` 同义）',
  description: '顶层 `description`',
  tags: '顶层 `tags`',
  coverImage: '顶层 `coverImage`',
}
const TOP_LEVEL_HTML = {
  title: '顶层 <code>name</code>（<code>title</code> 与 <code>name</code> 同义）',
  description: '顶层 <code>description</code>',
  tags: '顶层 <code>tags</code>',
  coverImage: '顶层 <code>coverImage</code>',
}
const GROUPS = [
  {
    title: '三、世界观实体芽',
    lede: '人物、地理、组织、物产、事件等世界观基础实体。',
    types: ['character', 'species', 'organization', 'region', 'building', 'item', 'plant', 'concept', 'language', 'magic', 'combat_stat', 'conflict', 'culture', 'event', 'inspiration'],
  },
  {
    title: '四、创作与工具芽',
    lede: '正文、笔记、大纲、画板、编排、战术棋盘等创作过程实体。',
    types: ['book', 'manuscript', 'notebook', 'outline_node', 'outline_board', 'drawing', 'pipeline', 'tactical-board'],
  },
]
const SYSTEM_FIELDS = [
  ['id', '实体 ID', '系统生成，主键'],
  ['type', '实体类型', '如 `character` / `manuscript`'],
  ['name', '名称', '对应 schema 的 `title`；V2 方言中 `title` 与 `name` 同义'],
  ['description', '描述', '对应 `identifiable.description`'],
  ['tags', '标签', '对应 `taggable.tags`'],
  ['avatar', '头像', '实体头像'],
  ['coverImage', '封面图', '对应 `visual.coverImage`'],
  ['coverPosition', '封面位置', '封面裁切位置'],
  ['coverZoom', '封面缩放', '封面缩放比例'],
  ['properties', '扩展属性', '芽自有字段的实际存储容器'],
  ['facets', 'Facet 数据', 'Item 的 weapon / apparel 数据块'],
  ['createdAt', '创建时间', '系统维护'],
  ['updatedAt', '更新时间', '系统维护'],
]
const VIEW_ONLY = [
  ['official.apparel', '服饰/装备', 'Item + ApparelFacet 的组合视图，不注册独立实体'],
  ['official.weapons', '武器', 'Item + WeaponFacet 的组合视图，不注册独立实体'],
  ['official.batch-edit', '批量编辑', '工具视图，无实体字段'],
  ['official.custom', '自定义视窗', '工具视图，无实体字段'],
  ['official.data-tools', '数据工具', '工具视图，无实体字段'],
  ['official.doc-export', '文档导出', '工具视图，无实体字段'],
  ['official.entity-tools', '实体工具', '工具视图，无实体字段'],
  ['official.graph', '全局图谱', '工具视图，无实体字段'],
  ['official.import-export', '导入导出', '工具视图，无实体字段'],
  ['official.mindmap', '思维导图', '工具视图，无实体字段'],
  ['official.search', '全局搜索', '工具视图，无实体字段'],
  ['official.settings', '设置', '壳级设置视图，无实体字段'],
  ['official.templates', '模板管理', '工具视图，无实体字段'],
  ['official.theme-editor', '主题编辑器', '工具视图，无实体字段'],
  ['official.version-history', '版本历史', '工具视图，无实体字段'],
  ['official.field-matrix', '字段矩阵', '字段/关系/视图/AutoLink 运行时观测视图，不注册实体类型'],
]

function parse(file) {
  return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}
function prop(obj, name) {
  if (!ts.isObjectLiteralExpression(obj)) return undefined
  for (const p of obj.properties) {
    if (p.name && p.name.getText() === name) return p.initializer
  }
  return undefined
}
function str(node) {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}
function bool(node) {
  if (!node) return undefined
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  return undefined
}
function num(node) {
  if (!node) return undefined
  if (ts.isNumericLiteral(node)) return Number(node.text)
  return undefined
}
function options(node) {
  if (!node) return undefined
  let arr = node
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'map') arr = callee.expression
  }
  if (!arr || !ts.isArrayLiteralExpression(arr)) return undefined
  const out = []
  for (const el of arr.elements) {
    if (ts.isStringLiteral(el)) out.push({ value: el.text, label: el.text })
    else if (ts.isObjectLiteralExpression(el)) {
      const value = str(prop(el, 'value'))
      const label = str(prop(el, 'label'))
      if (value !== undefined) out.push({ value, label: label ?? value })
    }
  }
  return out
}
function field(node) {
  if (!ts.isObjectLiteralExpression(node)) return { raw: node?.getText().slice(0, 120) }
  const out = {}
  for (const key of ['key', 'label', 'fieldType', 'placeholder', 'semanticHint', 'refType']) {
    const value = str(prop(node, key))
    if (value !== undefined) out[key] = value
  }
  const required = bool(prop(node, 'required'))
  if (required !== undefined) out.required = required
  const defaultValue = prop(node, 'defaultValue')
  if (defaultValue) out.defaultValue = str(defaultValue) ?? num(defaultValue) ?? defaultValue.getText()
  const opts = options(prop(node, 'options'))
  if (opts) out.options = opts
  const autoLink = prop(node, 'autoLink')
  if (autoLink && ts.isObjectLiteralExpression(autoLink)) {
    out.autoLink = {
      targetType: str(prop(autoLink, 'targetType')),
      relationType: str(prop(autoLink, 'relationType')),
    }
  }
  return out
}
function collectConsts(sourceFile) {
  const map = new Map()
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) map.set(declaration.name.text, declaration.initializer)
    }
  }
  return map
}
function resolveArray(node, consts, seen = new Set()) {
  if (!node) return undefined
  if (ts.isArrayLiteralExpression(node)) return node.elements
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return undefined
    seen.add(node.text)
    return resolveArray(consts.get(node.text), consts, seen)
  }
  return undefined
}
function fields(node, consts) {
  const elements = resolveArray(node, consts)
  return elements ? elements.map(field) : []
}
function traitRef(node) {
  if (!ts.isObjectLiteralExpression(node)) return { raw: node.getText().slice(0, 80) }
  const out = { traitId: str(prop(node, 'traitId')) }
  const overrides = prop(node, 'fieldOverrides')
  if (overrides && ts.isObjectLiteralExpression(overrides)) {
    out.fieldOverrides = {}
    for (const property of overrides.properties) {
      const key = property.name.getText()
      if (ts.isObjectLiteralExpression(property.initializer)) out.fieldOverrides[key] = field(property.initializer)
    }
  }
  return out
}
function parseDefinitions(file, factoryName) {
  const sourceFile = parse(file)
  const consts = collectConsts(sourceFile)
  const out = []
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === factoryName) {
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        const hostTypes = prop(arg, 'hostTypes')
        out.push({
          id: str(prop(arg, 'id')),
          label: str(prop(arg, 'label')),
          fields: fields(prop(arg, 'fields'), consts),
          hostTypes: hostTypes && ts.isArrayLiteralExpression(hostTypes) ? hostTypes.elements.map(str) : undefined,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return out
}

const traits = parseDefinitions(TRAITS_FILE, 'defineTrait')
const facets = parseDefinitions(FACETS_FILE, 'defineFacet')
const traitMap = new Map(traits.map(trait => [trait.id, trait]))
const entities = []
for (const dir of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
  const file = path.join(PLUGINS_DIR, dir, 'index.ts')
  if (!fs.existsSync(file)) continue
  const sourceFile = parse(file)
  const consts = collectConsts(sourceFile)
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      if (method !== 'registerEntityV2' && method !== 'registerEntityType') {
        ts.forEachChild(node, visit)
        return
      }
      const arg = node.arguments[0]
      if (arg && ts.isObjectLiteralExpression(arg)) {
        if (method === 'registerEntityV2') {
          const refs = (() => {
            const elements = resolveArray(prop(arg, 'traits'), consts)
            return elements ? elements.map(traitRef) : []
          })()
          const ownFields = fields(prop(arg, 'ownFields'), consts)
          const effective = []
          const sources = {}
          const seen = new Set()
          for (const ref of refs) {
            const definition = traitMap.get(ref.traitId)
            if (!definition) continue
            for (const traitField of definition.fields) {
              const override = ref.fieldOverrides?.[traitField.key]
              const compiled = override ? { ...traitField, ...override } : { ...traitField }
              if (seen.has(compiled.key)) continue
              effective.push(compiled)
              seen.add(compiled.key)
              sources[compiled.key] = `trait:${ref.traitId}${override ? '+override' : ''}`
            }
          }
          for (const ownField of ownFields) {
            if (seen.has(ownField.key)) {
              const index = effective.findIndex(item => item.key === ownField.key)
              if (index !== -1) effective[index] = { ...ownField }
              sources[ownField.key] = `own+replace(${sources[ownField.key]})`
            } else {
              effective.push(ownField)
              seen.add(ownField.key)
              sources[ownField.key] = 'own'
            }
          }
          const facetElements = resolveArray(prop(arg, 'facets'), consts)
          entities.push({
            plugin: dir,
            api: 'registerEntityV2',
            type: str(prop(arg, 'type')),
            label: str(prop(arg, 'label')),
            traits: refs.map(ref => ref.traitId),
            ownFields,
            effective,
            sources,
            facets: facetElements ? facetElements.map(str) : undefined,
          })
        } else {
          const ownFields = fields(prop(arg, 'fields'), consts)
          entities.push({
            plugin: dir,
            api: 'registerEntityType',
            type: str(prop(arg, 'typeKey')),
            label: str(prop(arg, 'label')),
            traits: [],
            ownFields,
            effective: ownFields.map(item => ({ ...item })),
            sources: Object.fromEntries(ownFields.map(item => [item.key, 'own(legacy)'])),
            facets: undefined,
          })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

const totalInstances = entities.reduce((sum, entity) => sum + entity.effective.length, 0)
const uniqueKeys = new Set(entities.flatMap(entity => entity.effective.map(item => item.key))).size
const traitUse = new Map()
for (const entity of entities) for (const trait of entity.traits) traitUse.set(trait, (traitUse.get(trait) ?? 0) + 1)
const stats = {
  buds: new Set(entities.map(entity => entity.plugin)).size,
  types: entities.length,
  instances: totalInstances,
  keys: uniqueKeys,
  traits: traits.length,
  facets: facets.length,
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function mdInline(value) {
  return esc(value).replace(/`([^`]+)`/g, '<code>$1</code>')
}
function optionParts(fieldDef) {
  if (!fieldDef.options?.length) return { html: '', plain: '' }
  const chips = fieldDef.options.map(option => {
    const value = option.value === option.label ? '' : `<code>${esc(option.value)}</code> `
    return `<span class="opt">${value}${esc(option.label)}</span>`
  })
  const plain = '选项：' + fieldDef.options.map(option => option.value === option.label ? option.label : `${option.value}→${option.label}`).join('、')
  const html = fieldDef.options.length <= 4
    ? `<div class="opt-list">${chips.join('')}</div>`
    : `<details class="opts"><summary>${fieldDef.options.length} 个选项</summary><div class="opt-list">${chips.join('')}</div></details>`
  return { html, plain }
}
function sourceOf(entity, fieldDef) {
  const source = entity.sources[fieldDef.key] ?? ''
  if (source === 'own') return { kind: 'own', label: '芽自有' }
  if (source === 'own(legacy)') return { kind: 'legacy', label: '旧版自有' }
  if (source === 'system') return { kind: 'system', label: '系统' }
  if (source.startsWith('facet:')) return { kind: 'facet', label: `Facet · ${source.slice(6)}` }
  if (source.startsWith('own+replace')) {
    const trait = source.match(/trait:([^)]+)/)?.[1] ?? ''
    return { kind: 'replace', label: `芽自有 · 覆盖 ${trait}` }
  }
  if (source.startsWith('trait:')) {
    const trait = source.slice(6).replace('+override', '')
    return { kind: 'trait', label: `Trait · ${trait}${source.endsWith('+override') ? '（覆写）' : ''}` }
  }
  return { kind: 'own', label: '芽自有' }
}
function fieldNotes(entity, fieldDef) {
  const notes = []
  if (TOP_LEVEL_HTML[fieldDef.key]) {
    notes.push({ html: TOP_LEVEL_HTML[fieldDef.key], plain: TOP_LEVEL[fieldDef.key] })
  }
  if (fieldDef.placeholder) notes.push({ html: `占位：${esc(fieldDef.placeholder)}`, plain: `占位：${fieldDef.placeholder}` })
  if (fieldDef.defaultValue !== undefined) notes.push({ html: `默认 <code>${esc(fieldDef.defaultValue)}</code>`, plain: `默认 ${fieldDef.defaultValue}` })
  if (fieldDef.autoLink) notes.push({ html: `AutoLink → <code>${esc(fieldDef.autoLink.targetType)}</code> · <code>${esc(fieldDef.autoLink.relationType)}</code>`, plain: `AutoLink → ${fieldDef.autoLink.targetType} / ${fieldDef.autoLink.relationType}` })
  if (fieldDef.semanticHint) notes.push({ html: `hint · <code>${esc(fieldDef.semanticHint)}</code>`, plain: `semanticHint：${fieldDef.semanticHint}` })
  if (fieldDef.refType) notes.push({ html: `refType · <code>${esc(fieldDef.refType)}</code>`, plain: `refType：${fieldDef.refType}` })
  const source = entity.sources[fieldDef.key] ?? ''
  if (source.startsWith('own+replace')) notes.push({ html: '覆盖同名 Trait 字段', plain: '覆盖同名 Trait 字段' })
  if (source.endsWith('+override')) notes.push({ html: 'Trait 字段覆写', plain: 'Trait 字段覆写' })
  if (fieldDef.fieldType === 'multi-select') notes.push({ html: '归一类型 <code>multiSelect</code>', plain: '归一类型 multiSelect' })
  if (entity.type === 'event' && fieldDef.key === 'parentId') notes.push({ html: '事件树以属性为准，不建关系边', plain: '事件树以属性为准，不建关系边' })
  return {
    html: notes.map(note => `<span class="note">${note.html}</span>`).join(''),
    plain: notes.map(note => note.plain).join(' · '),
  }
}
function optionPlain(fieldDef) {
  return fieldDef.options?.length
    ? '选项：' + fieldDef.options.map(option => option.value === option.label ? option.label : `${option.value}→${option.label}`).join('、')
    : ''
}

function tableHead(columns) {
  return `<thead><tr>${columns.map(column => `<th scope="col">${column}</th>`).join('')}</tr></thead>`
}
function fieldRow(entity, fieldDef, tableId) {
  const source = sourceOf(entity, fieldDef)
  const notes = fieldNotes(entity, fieldDef)
  const options = optionParts(fieldDef)
  const typeClass = TYPE_CLASS[fieldDef.fieldType] ?? 'unknown'
  const typeZh = TYPE_ZH[fieldDef.fieldType] ?? fieldDef.fieldType
  const search = [
    entity.label, entity.type, entity.plugin, fieldDef.key, fieldDef.label,
    fieldDef.fieldType, typeZh, source.label, notes.plain, options.plain,
  ].join(' ').toLowerCase()
  const notesPlain = [notes.plain, options.plain].filter(Boolean).join(' · ')
  return `<tr class="field-row" id="f-${esc(entity.type)}-${esc(fieldDef.key)}" data-key="${esc(fieldDef.key)}" data-label="${esc(fieldDef.label)}" data-type="${esc(fieldDef.fieldType)}" data-required="${fieldDef.required ? '1' : '0'}" data-required-label="${fieldDef.required ? '是' : ''}" data-source="${source.kind}" data-source-label="${esc(source.label)}" data-notes="${esc(notesPlain)}" data-search="${esc(search)}">
  <td><div class="field-key"><span>${esc(fieldDef.key)}</span><button type="button" class="icon-btn copy-key" data-copy="${esc(fieldDef.key)}" aria-label="复制字段键 ${esc(fieldDef.key)}" title="复制字段键"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button></div></td>
  <td>${esc(fieldDef.label)}</td>
  <td><span class="type-badge t-${typeClass}">${esc(fieldDef.fieldType)}</span><span class="type-zh">${esc(typeZh)}</span></td>
  <td>${fieldDef.required ? '<span class="req">必填</span>' : '<span class="muted">—</span>'}</td>
  <td><span class="src src-${source.kind}">${esc(source.label)}</span></td>
  <td>${options.html}${notes.html}</td>
</tr>`
}
function entityTable(entity) {
  const id = `entity-${entity.type}-table`
  return `<div class="table-wrap"><table id="${esc(id)}"><caption class="sr-only">${esc(entity.label)}（${esc(entity.type)}）字段表</caption>${tableHead(['字段（English）', '中文字段名', '类型', '必填', '来源', '选项 / 说明'])}<tbody>${entity.effective.map(fieldDef => fieldRow(entity, fieldDef, id)).join('')}</tbody></table></div>`
}
function entitySection(entity) {
  const notes = []
  if (entity.type === 'book') notes.push('`book` 的 ownFields 为空；书籍只使用 `identifiable` + `visual` 的 3 个字段。')
  if (entity.type === 'event') notes.push('`parentId` 是 `entityRef` + `refType: event`，但刻意不声明 `relationType`：事件树以 `properties.parentId` 为准，不建立关系边。')
  if (entity.type === 'notebook') notes.push('`noteType` 的选项值是英文原值（`markdown` / `code` / `reference`），当前没有中文选项标签。')
  if (entity.type === 'pipeline') notes.push('已归一到 V2：`title` / `description` / `tags` 走 `identifiable` + `taggable`；`steps` / `connections` / `status` / `currentStepId` 仍在 `properties`。名称/描述/标签原本就在实体顶层，无需数据迁移。')
  if (entity.type === 'tactical-board') notes.push('已归一到 V2：`identifiable` + `taggable` + `visual`；棋盘数据仍在 `properties`，封面使用顶层 `coverImage`。名称/描述/标签原本就在实体顶层，无需数据迁移。')
  if (entity.type === 'item') notes.push('`item` 还可挂载 `weapon` / `apparel` Facet；Facet 字段见下方 Facet 区。')
  return `<section class="entity" id="entity-${esc(entity.type)}" data-field-section>
  <details class="entity-details" open>
    <summary>
      <span class="chev" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></span>
      <span class="entity-name">${esc(entity.label)}</span>
      <code class="entity-type">${esc(entity.type)}</code>
      <span class="entity-plugin">official.${esc(entity.plugin)}</span>
      <span class="entity-count"><b class="visible-count">${entity.effective.length}</b> 字段</span>
      <span class="entity-traits">${entity.traits.map(trait => `<code>${esc(trait)}</code>`).join('')}</span>
    </summary>
    <div class="entity-body">
      <div class="entity-toolbar"><span class="muted">芽 <code>official.${esc(entity.plugin)}</code> · ${entity.traits.length ? `Trait ${entity.traits.length} 个` : '无 Trait'}${entity.facets?.length ? ` · Facet ${entity.facets.join(' / ')}` : ''}</span><button type="button" class="ghost" data-copy-table="entity-${esc(entity.type)}-table">复制整表</button></div>
      ${entityTable(entity)}
      ${notes.length ? `<p class="section-note">${mdInline(notes.join(' '))}</p>` : ''}
    </div>
  </details>
</section>`
}

function renderMarkdown() {
  const lines = []
  lines.push('# 芽字段矩阵')
  lines.push('')
  lines.push(`> 状态：现行（${TODAY} 建立）｜生成：\`node scripts/generate-field-matrix.mjs\`（数据真源为代码，勿手改）`)
  lines.push(`> HTML 阅读版：[芽字段矩阵.html](./芽字段矩阵.html)｜快照：${TODAY}`)
  lines.push('')
  lines.push('## 〇、阅读口径')
  lines.push('')
  lines.push('- **实体字段 = 原子 Trait 字段 + 芽自有字段（ownFields）**。编译顺序：按 Trait 声明顺序展开字段 → 应用 `fieldOverrides` → 追加 `ownFields`；`ownFields` 与 Trait 同 key 时覆盖后者（`compileEntitySchema`）。')
  lines.push('- **中文名是展示标签，英文 key 是数据键**。同一 key 在不同芽中可能有不同中文名（例如 `condition` 在道具叫「状况」、在建筑叫「现状」、在大纲节点叫「状态」）。')
  lines.push('- **`title` 落地为实体顶层 `name`**；`description`、`tags`、`coverImage` 也落顶层，其余字段落 `properties`（见 [fieldAccessor.ts](../../../packages/plugin-sdk/src/detail/fieldAccessor.ts)）。')
  const legacyTypes = entities.filter(entity => entity.api === 'registerEntityType').length
  lines.push(legacyTypes
    ? `- **当前有 ${legacyTypes} 个实体类型仍使用旧版 \`registerEntityType\`**；其余使用 \`registerEntityV2\`。`
    : `- **当前 ${stats.buds} 个注册实体类型的芽均使用 \`registerEntityV2\`**；生成器仍兼容旧版 \`registerEntityType\`，供未来迁移期使用。`)
  lines.push('- 字段类型图例：`text` 单行文本 · `textarea` 多行文本 · `number` 数字 · `select` 单选 · `multi-select` 多选（归一名 `multiSelect`）· `tags` 标签 · `image` 图片 · `color` 颜色 · `boolean` 开关 · `entityRef` 实体引用。')
  lines.push('- 字段键沿用声明原文（多为 camelCase）；中文名是展示标签。部分历史选项值仍是英文原值（如 `noteType`、`pipeline.status`、`gridType`），表中按原值列出。')
  lines.push('- 每个芽的字段顺序 = `compileEntitySchema` 的编译顺序（先 Trait，后 ownFields；同名覆盖保持原位置）。')
  lines.push(`- 本文覆盖 **${stats.buds} 个注册了实体类型的芽 / ${stats.types} 个实体类型 / ${stats.instances} 个字段实例 / ${stats.keys} 个唯一字段键**；只注册视图、没有实体字段的芽见 §五。`)
  lines.push('- 本表的“字段”指**实体 Schema 字段**；关系类型（实体之间的边）、芽 manifest 元数据、用户自定义字段（`customFields`）不在本表范围内。')
  lines.push('')
  lines.push('## 一、总览（芽 × 实体类型）')
  lines.push('')
  lines.push('> 一行 = 一个实体类型；同一芽可以注册多个实体类型（`manuscript`、`outline`）。')
  lines.push('')
  lines.push('| 芽（插件 id） | 目录 | 实体类型 | 中文名 | Traits | 有效字段数 | 特例 |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const entity of entities) {
    const special = []
    if (entity.api === 'registerEntityType') special.push('旧版注册')
    if (entity.facets?.length) special.push(`Facet：${entity.facets.join(' / ')}`)
    lines.push(`| \`official.${entity.plugin}\` | \`apps/tauri/src/world/plugins/${entity.plugin}/\` | \`${entity.type}\` | ${entity.label} | ${entity.traits.length ? entity.traits.map(trait => `\`${trait}\``).join('、') : '—'} | ${entity.effective.length} | ${special.join('；')} |`)
  }
  lines.push('')
  lines.push('### Trait × 实体类型矩阵')
  lines.push('')
  lines.push('✓ = 该实体类型声明了该 Trait；— = 未声明。')
  lines.push('')
  lines.push(`| 实体类型 | ${traits.map(trait => `\`${trait.id}\``).join(' | ')} |`)
  lines.push(`|---|${traits.map(() => '---').join('|')}|`)
  for (const entity of entities) {
    lines.push(`| \`${entity.type}\` | ${traits.map(trait => entity.traits.includes(trait.id) ? '✓' : '—').join(' | ')} |`)
  }
  lines.push(`| **使用数** | ${traits.map(trait => traitUse.get(trait.id) ?? 0).join(' | ')} |`)
  lines.push('')
  lines.push('## 二、通用字段组（13 个原子 Trait）')
  lines.push('')
  lines.push('Trait 是字段复用单元。某个芽声明了 Trait，就拥有该 Trait 的全部字段（可被 `fieldOverrides` 改中文名/选项，或被同 key 的 ownFields 覆盖）。')
  lines.push('')
  lines.push('| Trait | 中文名 | 使用实体类型数 | 字段（English / 中文 / 类型） |')
  lines.push('|---|---|---|---|')
  for (const trait of traits) {
    lines.push(`| \`${trait.id}\` | ${trait.label} | ${traitUse.get(trait.id) ?? 0} | ${trait.fields.map(fieldDef => `\`${fieldDef.key}\` / ${fieldDef.label} / ${TYPE_ZH[fieldDef.fieldType] ?? fieldDef.fieldType}`).join('；')} |`)
  }
  lines.push('')
  lines.push('### 字段覆盖清单')
  lines.push('')
  lines.push('以下字段不是原样使用 Trait 声明，而是由芽改写中文名/选项（`fieldOverrides`）或用同 key 的 ownFields 覆盖：')
  lines.push('')
  lines.push('| 实体类型 | 字段 | 最终中文名 | 最终选项 / 说明 | 覆盖方式 |')
  lines.push('|---|---|---|---|---|')
  for (const entity of entities) {
    for (const fieldDef of entity.effective) {
      const source = entity.sources[fieldDef.key] ?? ''
      if (!source.endsWith('+override') && !source.startsWith('own+replace')) continue
      const way = source.startsWith('own+replace') ? `ownFields 覆盖 \`${source.match(/trait:([^)]+)/)?.[1] ?? ''}\`` : '`fieldOverrides`'
      lines.push(`| \`${entity.type}\` | \`${fieldDef.key}\` | ${fieldDef.label} | ${optionPlain(fieldDef) || '—'} | ${way} |`)
    }
  }
  lines.push('')
  for (const group of GROUPS) {
    lines.push(`## ${group.title}`)
    lines.push('')
    lines.push(group.lede)
    lines.push('')
    for (const type of group.types) {
      const entity = entities.find(item => item.type === type)
      if (!entity) continue
      lines.push(`### ${entity.label}（\`${entity.type}\`）`)
      lines.push('')
      const meta = [`芽：\`official.${entity.plugin}\``, `Traits：${entity.traits.length ? entity.traits.map(trait => `\`${trait}\``).join('、') : '—'}`, `有效字段：${entity.effective.length}`]
      if (entity.facets?.length) meta.push(`Facet：${entity.facets.map(facet => `\`${facet}\``).join('、')}`)
      lines.push(meta.join('｜'))
      lines.push('')
      lines.push('| 字段（English） | 中文字段名 | 类型 | 必填 | 来源 | 选项 / 说明 |')
      lines.push('|---|---|---|---|---|---|')
      for (const fieldDef of entity.effective) {
        const source = sourceOf(entity, fieldDef)
        const notes = []
        if (TOP_LEVEL[fieldDef.key]) notes.push(TOP_LEVEL[fieldDef.key])
        if (fieldDef.placeholder) notes.push(`占位：${fieldDef.placeholder}`)
        if (fieldDef.defaultValue !== undefined) notes.push(`默认：${JSON.stringify(fieldDef.defaultValue)}`)
        if (fieldDef.autoLink) notes.push(`AutoLink → \`${fieldDef.autoLink.targetType}\` / \`${fieldDef.autoLink.relationType}\``)
        if (fieldDef.semanticHint) notes.push(`semanticHint：\`${fieldDef.semanticHint}\``)
        if (fieldDef.refType) notes.push(`refType：\`${fieldDef.refType}\``)
        if ((entity.sources[fieldDef.key] ?? '').startsWith('own+replace')) notes.push('覆盖同名 trait 字段')
        if ((entity.sources[fieldDef.key] ?? '').endsWith('+override')) notes.push('Trait 字段覆写')
        if (fieldDef.fieldType === 'multi-select') notes.push('归一类型：`multiSelect`')
        if (entity.type === 'event' && fieldDef.key === 'parentId') notes.push('事件树以属性为准，不建关系边')
        if (optionPlain(fieldDef)) notes.push(optionPlain(fieldDef))
        lines.push(`| \`${fieldDef.key}\` | ${fieldDef.label ?? ''} | ${TYPE_ZH[fieldDef.fieldType] ?? fieldDef.fieldType} \`${fieldDef.fieldType ?? ''}\` | ${fieldDef.required ? '是' : ''} | ${source.label} | ${notes.join('；')} |`)
      }
      lines.push('')
      if (entity.type === 'book') lines.push('> `book` 的 ownFields 为空；书籍只使用 `identifiable` + `visual` 的 3 个字段。')
      if (entity.type === 'event') lines.push('> `parentId` 是 `entityRef` + `refType: event`，但刻意不声明 `relationType`：事件树以 `properties.parentId` 为准，不建立关系边。')
      if (entity.type === 'notebook') lines.push('> `noteType` 的选项值是英文原值（`markdown` / `code` / `reference`），当前没有中文选项标签。')
      if (entity.type === 'pipeline') lines.push('> 已归一到 V2：`title` / `description` / `tags` 走 `identifiable` + `taggable`；`steps` / `connections` / `status` / `currentStepId` 仍在 `properties`。名称/描述/标签原本就在实体顶层，无需数据迁移。')
      if (entity.type === 'tactical-board') lines.push('> 已归一到 V2：`identifiable` + `taggable` + `visual`；棋盘数据仍在 `properties`，封面使用顶层 `coverImage`。名称/描述/标签原本就在实体顶层，无需数据迁移。')
      if (entity.type === 'item') lines.push('> `item` 还可挂载 `weapon` / `apparel` Facet；Facet 字段见 §六。')
      lines.push('')
    }
  }
  lines.push('## 五、没有实体字段的芽（仅注册视图 / 工具）')
  lines.push('')
  lines.push('| 芽（插件 id） | 中文名 | 说明 |')
  lines.push('|---|---|---|')
  for (const [id, label, desc] of VIEW_ONLY) lines.push(`| \`${id}\` | ${label} | ${desc} |`)
  lines.push('')
  lines.push('## 六、Facet 字段（Item 的结构化数据块）')
  lines.push('')
  lines.push('Facet 不是独立实体，没有独立 ID，数据挂在 `item.facets[<facetId>]` 下；`official.weapons` / `official.apparel` 只提供视图筛选。')
  lines.push('')
  for (const facet of facets) {
    lines.push(`### ${facet.label}（\`${facet.id}\`）`)
    lines.push('')
    lines.push(`宿主：${facet.hostTypes.map(type => `\`${type}\``).join('、')}｜字段：${facet.fields.length}`)
    lines.push('')
    lines.push('| 字段（English） | 中文字段名 | 类型 | 必填 | 选项 / 说明 |')
    lines.push('|---|---|---|---|---|')
    for (const fieldDef of facet.fields) {
      const notes = []
      if (fieldDef.semanticHint) notes.push(`semanticHint：\`${fieldDef.semanticHint}\``)
      if (optionPlain(fieldDef)) notes.push(optionPlain(fieldDef))
      lines.push(`| \`${fieldDef.key}\` | ${fieldDef.label} | ${TYPE_ZH[fieldDef.fieldType] ?? fieldDef.fieldType} \`${fieldDef.fieldType}\` | ${fieldDef.required ? '是' : ''} | ${notes.join('；')} |`)
    }
    lines.push('')
  }
  lines.push('## 七、系统级 / 顶层字段')
  lines.push('')
  lines.push('所有实体都具备以下顶层结构（不属于某个芽的 ownFields）：')
  lines.push('')
  lines.push('| 字段（English） | 中文名 | 说明 |')
  lines.push('|---|---|---|')
  for (const [key, label, desc] of SYSTEM_FIELDS) lines.push(`| \`${key}\` | ${label} | ${desc} |`)
  lines.push('')
  lines.push('## 八、维护与来源')
  lines.push('')
  lines.push('- 字段声明真源：')
  lines.push('  - 芽自有字段：`apps/tauri/src/world/plugins/<芽>/index.ts` 的 `registerEntityV2({ ownFields })` / `registerEntityType({ fields })`')
  lines.push('  - 原子 Trait：`packages/entity-core/src/traits/index.ts`')
  lines.push('  - Facet：`packages/entity-core/src/facets/index.ts`')
  lines.push('  - 合并规则：`packages/entity-core/src/core/TraitRuntime.ts` 的 `compileEntitySchema`')
  lines.push('- 项目级 schema 覆盖：`<worlddata>/.worldsea/schemas/<type>.json`，可按 `label` / `traits` / `ownFields` / `fieldOverrides` 深合并；覆盖字段与用户 `customFields` 不在本表静态快照内。见 `apps/tauri/src/world/schemas.ts`。')
  lines.push('- 关系类型（`registerRelationV2`）描述实体之间的边，不是实体字段，未纳入本表。')
  lines.push('- `outline` 芽正在另一条施工线推进；其字段以当前代码为准，若本表与代码不一致，以 `apps/tauri/src/world/plugins/outline/index.ts` 为准。')
  lines.push(`- 重新生成：\`node scripts/generate-field-matrix.mjs\`（同时更新 MD 与 HTML）。`)
  return lines.join('\n') + '\n'
}

function renderSidebar() {
  const blocks = []
  blocks.push(`<div class="nav-group"><div class="nav-title">总览</div><a href="#overview"><span>速览</span></a><a href="#traits"><span>Trait 矩阵</span></a></div>`)
  for (const group of GROUPS) {
    const links = group.types.map(type => {
      const entity = entities.find(item => item.type === type)
      if (!entity) return ''
      return `<a href="#entity-${esc(entity.type)}"><span>${esc(entity.label)}</span><code>${esc(entity.type)}</code><b>${entity.effective.length}</b></a>`
    }).join('')
    blocks.push(`<div class="nav-group"><div class="nav-title">${group.title.replace(/^[一二三四五六七八九十]+、/, '')}</div>${links}</div>`)
  }
  blocks.push(`<div class="nav-group"><div class="nav-title">其他</div><a href="#facets"><span>Facet 字段</span><code>${facets.length}</code></a><a href="#system"><span>系统字段</span><code>${SYSTEM_FIELDS.length}</code></a><a href="#view-only"><span>无实体字段芽</span><code>${VIEW_ONLY.length}</code></a><a href="#scope"><span>口径与维护</span></a></div>`)
  return blocks.join('')
}

function renderOverview() {
  const statsHtml = [
    [stats.buds, '注册芽'],
    [stats.types, '实体类型'],
    [stats.instances, '字段实例'],
    [stats.keys, '唯一字段键'],
    [stats.traits, '原子 Trait'],
    [stats.facets, 'Facet'],
  ].map(([value, label]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`).join('')
  const rows = entities.map(entity => {
    const traitsHtml = entity.traits.length
      ? `<span class="traits-inline">${entity.traits.map(trait => `<code>${esc(trait)}</code>`).join('')}</span>`
      : '<span class="muted">—</span>'
    const special = [entity.api === 'registerEntityType' ? '旧版注册' : '', entity.facets?.length ? `Facet：${entity.facets.join(' / ')}` : ''].filter(Boolean).join('；')
    return `<tr><td><code>official.${esc(entity.plugin)}</code></td><td><a class="entity-link" href="#entity-${esc(entity.type)}">${esc(entity.label)}</a> <code>${esc(entity.type)}</code></td><td>${traitsHtml}</td><td><b>${entity.effective.length}</b></td><td>${esc(special)}</td></tr>`
  }).join('')
  return `<h2>总览</h2><p class="lead">按芽 / 实体类型查阅字段。字段 = <b>Trait 字段 + 芽自有字段</b>；中文名是展示标签，英文 key 是数据键。</p>
<div class="stat-grid">${statsHtml}</div>
<div class="table-wrap"><table class="overview-table"><caption class="sr-only">芽与实体类型总览</caption>${tableHead(['芽（插件 id）', '实体类型', 'Traits', '字段数', '特例'])}<tbody>${rows}</tbody></table></div>
<p class="section-note">点击实体名跳到字段表。运行时可再叠加项目级 schema 覆盖与用户自定义字段，这部分不在静态快照内。</p>`
}

function renderTraitMatrix() {
  const header = traits.map(trait => `<th scope="col"><code>${esc(trait.id)}</code></th>`).join('')
  const rows = entities.map(entity => `<tr><td><a href="#entity-${esc(entity.type)}"><code>${esc(entity.type)}</code></a></td>${traits.map(trait => entity.traits.includes(trait.id) ? '<td class="yes">✓</td>' : '<td class="no">—</td>').join('')}</tr>`).join('')
  const usage = `<tr><td>使用数</td>${traits.map(trait => `<td>${traitUse.get(trait.id) ?? 0}</td>`).join('')}</tr>`
  return `<h2>Trait × 实体类型矩阵</h2><p class="lead">✓ = 该实体类型声明了该 Trait；— = 未声明。Trait 的字段明细见下方“通用字段组”。</p>
<div class="matrix-wrap"><table class="matrix"><caption class="sr-only">Trait 与实体类型覆盖矩阵</caption><thead><tr><th scope="col">实体类型</th>${header}</tr></thead><tbody>${rows}${usage}</tbody></table></div>
<p class="matrix-legend"><span><b class="yes" style="color:var(--accent-strong)">✓</b> 已声明</span><span><b class="no">—</b> 未声明</span><span>使用数 = 声明该 Trait 的实体类型数量</span></p>
<div class="table-wrap" style="margin-top:16px"><table><caption class="sr-only">原子 Trait 字段明细</caption>${tableHead(['Trait', '中文名', '使用数', '字段（English / 中文 / 类型）'])}<tbody>${traits.map(trait => `<tr><td><code>${esc(trait.id)}</code></td><td>${esc(trait.label)}</td><td>${traitUse.get(trait.id) ?? 0}</td><td>${trait.fields.map(fieldDef => `<code>${esc(fieldDef.key)}</code> / ${esc(fieldDef.label)} / ${esc(TYPE_ZH[fieldDef.fieldType] ?? fieldDef.fieldType)}`).join('；')}</td></tr>`).join('')}</tbody></table></div>`
}

function renderEntityGroups() {
  return GROUPS.map(group => {
    const sections = group.types.map(type => {
      const entity = entities.find(item => item.type === type)
      return entity ? entitySection(entity) : ''
    }).join('')
    return `<div class="entity-group" data-entity-group><h2>${esc(group.title.replace(/^[一二三四五六七八九十]+、/, ''))}</h2><p class="lead">${esc(group.lede)}</p>${sections}</div>`
  }).join('')
}

function facetTable(facet) {
  const pseudo = { label: facet.label, type: `facet-${facet.id}`, plugin: 'entity-core', sources: Object.fromEntries(facet.fields.map(fieldDef => [fieldDef.key, `facet:${facet.id}`])) }
  const id = `facet-${facet.id}-table`
  return `<div class="table-wrap"><table id="${esc(id)}"><caption class="sr-only">${esc(facet.label)}字段表</caption>${tableHead(['字段（English）', '中文字段名', '类型', '必填', '来源', '选项 / 说明'])}<tbody>${facet.fields.map(fieldDef => fieldRow(pseudo, fieldDef, id)).join('')}</tbody></table></div>`
}
function renderFacets() {
  const cards = facets.map(facet => `<div class="facet-card"><div class="facet-head"><strong>${esc(facet.label)}</strong><code>${esc(facet.id)}</code><span class="muted">宿主 ${facet.hostTypes.map(type => `<code>${esc(type)}</code>`).join(' / ')} · ${facet.fields.length} 字段</span><button type="button" class="ghost" data-copy-table="facet-${esc(facet.id)}-table" style="margin-left:auto">复制整表</button></div><div class="facet-body">${facetTable(facet)}</div></div>`).join('')
  return `<h2>Facet 字段</h2><p class="lead">Facet 不是独立实体，没有独立 ID，数据挂在 <code>item.facets[&lt;facetId&gt;]</code> 下；<code>official.weapons</code> / <code>official.apparel</code> 只提供视图筛选。<span class="muted">（<b class="visible-count">${facets.reduce((sum, facet) => sum + facet.fields.length, 0)}</b> 个字段）</span></p>${cards}`
}

function systemRow(key, label, desc) {
  const search = [key, label, desc, '系统', 'system'].join(' ').toLowerCase()
  return `<tr class="field-row" id="f-system-${esc(key)}" data-key="${esc(key)}" data-label="${esc(label)}" data-type="text" data-required="0" data-required-label="" data-source="system" data-source-label="系统" data-notes="${esc(desc)}" data-search="${esc(search)}"><td><div class="field-key"><span>${esc(key)}</span><button type="button" class="icon-btn copy-key" data-copy="${esc(key)}" aria-label="复制字段键 ${esc(key)}" title="复制字段键"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button></div></td><td>${esc(label)}</td><td><span class="type-badge t-text">text</span><span class="type-zh">系统字段</span></td><td><span class="src src-system">系统</span></td><td>${mdInline(desc)}</td></tr>`
}
function renderSystem() {
  return `<h2>系统级 / 顶层字段</h2><p class="lead">所有实体都具备以下顶层结构（不属于某个芽的 ownFields）。<span class="muted">（<b class="visible-count">${SYSTEM_FIELDS.length}</b> 个字段）</span></p><div class="table-wrap"><table id="system-table"><caption class="sr-only">系统级字段表</caption>${tableHead(['字段（English）', '中文名', '类型', '来源', '说明'])}<tbody>${SYSTEM_FIELDS.map(([key, label, desc]) => systemRow(key, label, desc)).join('')}</tbody></table></div><div style="margin-top:10px"><button type="button" class="ghost" data-copy-table="system-table">复制整表</button></div>`
}
function renderViewOnly() {
  return `<h2>没有实体字段的芽</h2><p class="lead">这些芽只注册视图或工具，不声明实体 Schema 字段。</p><div class="view-only-grid">${VIEW_ONLY.map(([id, label, desc]) => `<div class="view-only-card"><strong>${esc(label)}</strong><code>${esc(id)}</code><span>${esc(desc)}</span></div>`).join('')}</div>`
}
function renderScope() {
  return `<h2>口径与维护</h2><div class="scope-grid">
<div class="scope-card"><h3>快照边界</h3><ul><li>数据真源：芽 <code>index.ts</code>、Trait、Facet 源码。</li><li>项目级 schema 覆盖（<code>worlddata/.worldsea/schemas/&lt;type&gt;.json</code>）与用户 <code>customFields</code> 不在静态快照内。</li><li>关系类型是实体之间的边，不是实体字段，未纳入本表。</li></ul></div>
<div class="scope-card"><h3>字段合并</h3><ul><li>先按 Trait 声明顺序展开字段，再应用 <code>fieldOverrides</code>，最后追加 <code>ownFields</code>。</li><li>同 key 时 <code>ownFields</code> 覆盖 Trait 字段。</li><li><code>title</code> 落地为顶层 <code>name</code>；<code>description</code> / <code>tags</code> / <code>coverImage</code> 也落顶层。</li></ul></div>
<div class="scope-card"><h3>重新生成</h3><p>在仓库根执行：</p><p><code>node scripts/generate-field-matrix.mjs</code></p><p>同源更新 <a href="./芽字段矩阵.md">Markdown 版</a> 与本页。快照日期 ${esc(TODAY)}。</p></div>
<div class="scope-card"><h3>字段声明真源</h3><ul><li><code>apps/tauri/src/world/plugins/&lt;芽&gt;/index.ts</code></li><li><code>packages/entity-core/src/traits/index.ts</code></li><li><code>packages/entity-core/src/facets/index.ts</code></li><li><code>packages/entity-core/src/core/TraitRuntime.ts</code></li></ul></div>
</div><p class="section-note">大纲芽正在另一条施工线推进；其字段以 <code>apps/tauri/src/world/plugins/outline/index.ts</code> 当前代码为准。</p>`
}

function renderHtml() {
  const usedTypes = new Set(entities.flatMap(entity => entity.effective.map(fieldDef => fieldDef.fieldType)))
  const typeOptions = [...usedTypes]
    .sort((a, b) => (TYPE_ORDER.indexOf(a) === -1 ? 99 : TYPE_ORDER.indexOf(a)) - (TYPE_ORDER.indexOf(b) === -1 ? 99 : TYPE_ORDER.indexOf(b)) || a.localeCompare(b))
    .map(type => `<option value="${esc(type)}">${esc(type)}（${esc(TYPE_ZH[type] ?? type)}）</option>`)
    .join('')
  const topStats = `<span><b>${stats.buds}</b> 芽</span><span><b>${stats.types}</b> 实体</span><span><b>${stats.instances}</b> 字段</span>`
  let html = fs.readFileSync(TEMPLATE_FILE, 'utf8')
  const matrixCss = fs.readFileSync(MATRIX_CSS_FILE, 'utf8')
  const standaloneCss = fs.readFileSync(STANDALONE_CSS_FILE, 'utf8')
  html = html
    .replaceAll('{{MATRIX_CSS}}', matrixCss)
    .replaceAll('{{STANDALONE_CSS}}', standaloneCss)
    .replaceAll('{{DATE}}', esc(TODAY))
    .replaceAll('{{TOP_STATS}}', topStats)
    .replaceAll('{{TYPE_OPTIONS}}', typeOptions)
    .replaceAll('{{SIDEBAR}}', renderSidebar())
    .replaceAll('{{OVERVIEW}}', renderOverview())
    .replaceAll('{{TRAIT_MATRIX}}', renderTraitMatrix())
    .replaceAll('{{ENTITY_GROUPS}}', renderEntityGroups())
    .replaceAll('{{FACETS}}', renderFacets())
    .replaceAll('{{SYSTEM}}', renderSystem())
    .replaceAll('{{VIEW_ONLY}}', renderViewOnly())
    .replaceAll('{{SCOPE}}', renderScope())
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('HTML 模板仍有未替换占位符')
  return html
}

fs.writeFileSync(MD_OUT, renderMarkdown(), 'utf8')
fs.writeFileSync(HTML_OUT, renderHtml(), 'utf8')
console.log(`芽字段矩阵已生成：${stats.buds} 芽 / ${stats.types} 实体 / ${stats.instances} 字段实例 / ${stats.keys} 唯一键`)
console.log(`- ${path.relative(ROOT, MD_OUT)}`)
console.log(`- ${path.relative(ROOT, HTML_OUT)}`)
