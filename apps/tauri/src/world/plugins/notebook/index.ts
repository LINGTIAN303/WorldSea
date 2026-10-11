import type { WorldPluginApi } from '../../api'
import NotebookView from './NotebookView.vue'
import { registerIngestNormalizer } from '@worldsea/entity-core'
import { normalizeNoteContent } from './contentNormalize'

export const manifest = {
  id: 'official.notebook',
  name: '笔记本',
  version: '2.0.0',
  description: '自由笔记与知识管理',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'notebook',
    label: '笔记',
    icon: 'notebook',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
      { traitId: 'narrative' },
    ],
    ownFields: [
      { key: 'noteType', label: '笔记类型', fieldType: 'select', options: ['markdown', 'code', 'canvas', 'reference'].map(s => ({ value: s, label: s })) },
      { key: 'backlinks', label: '反向链接', fieldType: 'text' },
      { key: 'forwardLinks', label: '正向链接', fieldType: 'text' },
      { key: 'linkedEntities', label: '关联实体', fieldType: 'text' },
      { key: 'codeLanguage', label: '代码语言', fieldType: 'text' },
      { key: 'codeOutput', label: '代码输出', fieldType: 'text' },
      { key: 'folderId', label: '所属文件夹', fieldType: 'text' },
    ],
  })

  // 装载网关归一器（2026-10-11）：外部写入的 markdown 纯文本正文在进 store 前
  // 渲染为 HTML —— Agent 写的标题/表格/代码块打开即得渲染，编辑器/预览/导出零兜底。
  // 幂等（HTML 放行）；无变化返回原引用，不触发响应式抖动。
  registerIngestNormalizer('notebook', (entity) => {
    const content = entity.properties?.content
    if (typeof content !== 'string') return entity
    const normalized = normalizeNoteContent(content)
    return normalized === content
      ? entity
      : { ...entity, properties: { ...entity.properties, content: normalized } }
  })

  api.registerView({ id: 'notebook', label: '笔记本', icon: 'notebook', component: NotebookView })
}

export default { manifest, apply }
