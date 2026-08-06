/** AgentPreview 工具调用结果 HTML 渲染器（纯函数，DOMPurify 消毒，any 说明见文档），详细见 docs/details/注释/web/agent/preview/resultRenderer.md */
import DOMPurify from 'dompurify'
import { getTypeLabel, translateKey, translateValue } from './previewLabels'

/** DOMPurify 配置：允许结果 HTML 中的 data-* 属性与 id/class */
const DOMPURIFY_CONFIG = {
  ADD_ATTR: ['data-toggle', 'data-entity-id', 'data-action', 'id', 'class'],
  ADD_TAGS: [] as string[],
  ALLOW_DATA_ATTR: true,
}

/** HTML 转义（用于将用户/工具内容安全嵌入 HTML 字符串） */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 渲染工具调用结果（主入口）
 * 按 toolName 与 obj 结构分派到具体渲染器。
 */
export function renderToolResult(toolName: string, raw: string): string {
  if (!raw) return ''
  let obj: any
  try {
    obj = JSON.parse(raw)
  } catch {
    return `<div class="r-fallback"><div class="r-text">${esc(raw.length > 300 ? raw.slice(0, 300) + '…' : raw)}</div></div>`
  }
  if (!obj || typeof obj !== 'object') {
    return `<div class="r-fallback"><div class="r-text">${esc(String(obj))}</div></div>`
  }

  if (obj.error) return renderError(obj)
  if (toolName.startsWith('output_')) return renderOutputResult(toolName, obj)
  if (toolName === 'entity_list' && obj.entities) return renderEntityList(obj)
  if (toolName === 'daily_report') return renderDailyReport(obj)
  if (obj.entities && Array.isArray(obj.entities)) return renderEntityList(obj)
  if (obj.success || obj.ok) return renderSuccess(obj)
  return renderFallback(obj)
}

/** 渲染 output_* 系列工具的"已创建组件"提示 */
function renderOutputResult(toolName: string, obj: any): string {
  const OUTPUT_LABELS: Record<string, string> = {
    output_table: '表格',
    output_choice: '选项',
    output_code: '代码',
    output_entity_card: '实体卡',
    output_alert: '提示',
    output_stat: '统计',
    output_list: '列表',
    output_progress: '进度',
    output_comparison: '对比',
    output_timeline: '时间线',
    output_image: '图片',
    output_accordion: '折叠区',
  }
  const label = OUTPUT_LABELS[toolName] || '输出'
  if (obj.error) return renderError(obj)
  const name = obj.name || obj.title || ''
  const detail = name ? `: ${esc(name)}` : ''
  return `<div class="r-success"><div class="r-success-name">✓ 已创建${label}组件${detail}</div></div>`
}

/** 渲染错误结果（含可选 hint） */
function renderError(obj: any): string {
  const hint = obj.hint ? `<div class="r-hint">${esc(String(obj.hint))}</div>` : ''
  return `<div class="r-error"><div class="r-error-msg">${esc(String(obj.error))}</div>${hint}</div>`
}

/** 渲染实体列表（含可展开详情、查看/编辑按钮） */
function renderEntityList(obj: any): string {
  const total =
    obj.total !== undefined
      ? `<div class="r-summary">共 ${obj.total} 个实体${obj.showing !== undefined ? `，显示 ${obj.showing}` : ''}</div>`
      : ''
  const cards = (obj.entities as any[])
    .map((e, i) => {
      const typeLabel = getTypeLabel(e.type || '?')
      const name = esc(e.name || e.id?.slice(0, 8) || '?')
      let tags = ''
      if (e.preview && typeof e.preview === 'object') {
        const entries = Object.entries(e.preview as Record<string, unknown>).slice(0, 4)
        tags = entries.map(([k, v]) => `<span class="r-tag">${esc(translateKey(k))}: ${esc(String(v))}</span>`).join('')
      }
      let desc = ''
      if (e.description) {
        const d = String(e.description)
        desc = `<div class="r-desc">${esc(d.length > 200 ? d.slice(0, 200) + '…' : d)}</div>`
      }
      const detailId = `ec-detail-${i}-${(e.id || '').slice(0, 8)}`
      const hasDetail = tags || desc
      const toggle = hasDetail
        ? `<span class="r-ec-toggle" data-toggle="${detailId}">▸</span>`
        : '<span class="r-ec-spacer"></span>'
      const detailWrap = hasDetail
        ? `<div class="r-ec-detail" id="${detailId}">${tags ? `<div class="r-tags">${tags}</div>` : ''}${desc}</div>`
        : ''
      const entityId = e.id ? `data-entity-id="${esc(e.id)}"` : ''
      const actions = `<div class="r-ec-actions"><span class="r-ec-btn" data-action="view" ${entityId}>查看</span><span class="r-ec-btn" data-action="edit" ${entityId}>编辑</span></div>`
      return `<div class="r-entity-card"><div class="r-ec-head">${toggle}<span class="r-ec-name">${name}</span><span class="r-ec-type">${typeLabel}</span></div>${detailWrap}${actions}</div>`
    })
    .join('')
  return `${total}${cards}`
}

/** 渲染每日报告（日期+统计+类型分布） */
function renderDailyReport(obj: any): string {
  const date = obj.date ? `<div class="r-date">${esc(obj.date)}</div>` : ''
  const summary = obj.summary || obj
  const stats = [
    summary.totalEntities !== undefined
      ? `<div class="r-stat"><div class="r-stat-num">${summary.totalEntities}</div><div class="r-stat-label">实体</div></div>`
      : '',
    summary.totalRelations !== undefined
      ? `<div class="r-stat"><div class="r-stat-num">${summary.totalRelations}</div><div class="r-stat-label">关系</div></div>`
      : '',
  ]
    .filter(Boolean)
    .join('')
  const statsRow = stats ? `<div class="r-stats">${stats}</div>` : ''
  let dist = ''
  if (summary.typeDistribution && typeof summary.typeDistribution === 'object') {
    const tags = Object.entries(summary.typeDistribution as Record<string, unknown>)
      .map(([k, v]) => {
        return `<span class="r-dist-tag">${getTypeLabel(k)} ×${v}</span>`
      })
      .join('')
    dist = `<div class="r-dist">${tags}</div>`
  }
  return `<div class="r-report">${date}${statsRow}${dist}</div>`
}

/** 渲染通用成功结果（含可选 id/key/action） */
function renderSuccess(obj: any): string {
  const name = obj.name || obj.message || '操作成功'
  const id = obj.id ? `<div class="r-id">标识: ${esc(obj.id.slice(0, 8))}…</div>` : ''
  const key = obj.key ? `<div class="r-id">键: ${esc(String(obj.key))}</div>` : ''
  const action = obj.action ? `<div class="r-id">操作: ${esc(String(obj.action))}</div>` : ''
  return `<div class="r-success"><div class="r-success-name">✓ ${esc(name)}</div>${id}${key}${action}</div>`
}

/** 兜底渲染：键值对列表（过滤 success/ok 字段，最多 8 项） */
function renderFallback(obj: any): string {
  const entries = Object.entries(obj).filter(([k]) => k !== 'success' && k !== 'ok').slice(0, 8)
  const rows = entries
    .map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : translateValue(v)
      return `<div class="r-kv-row"><span class="r-kv-key">${esc(translateKey(k))}</span><span class="r-kv-val">${esc(val.length > 80 ? val.slice(0, 80) + '…' : val)}</span></div>`
    })
    .join('')
  return `<div class="r-fallback">${rows}</div>`
}

/** 渲染并消毒工具结果（v-html 入口） */
export function sanitizeResult(toolName: string, raw: string): string {
  return DOMPurify.sanitize(renderToolResult(toolName, raw), DOMPURIFY_CONFIG)
}
