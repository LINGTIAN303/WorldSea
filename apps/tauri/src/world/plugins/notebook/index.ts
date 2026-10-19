import type { WorldPluginApi } from '../../api'
import NotebookView from './NotebookView.vue'

export const manifest = {
  id: 'official.notebook',
  domain: 'narrative',
  secondaryDomains: ['tool'],
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
      // 批 5 F6：移除 canvas（未实现占位）；与 notebookConfig.NOTE_TYPES 保持一致
      { key: 'noteType', label: '笔记类型', fieldType: 'select', options: ['markdown', 'code', 'reference'].map(s => ({ value: s, label: s })) },
      // 块 2 阶段 4：backlinks / forwardLinks / linkedEntities 三字段声明退役
      //（其数据角色已由 note_link 关系表承接——建联＝内容的函数，由 backlinkDerive 派生；
      //  存量 properties 旧值不主动清理，无 UI 露出）
      { key: 'codeLanguage', label: '代码语言', fieldType: 'text' },
      { key: 'codeOutput', label: '代码输出', fieldType: 'text' },
      { key: 'folderId', label: '所属文件夹', fieldType: 'text' },
    ],
  })

  // 【块 1 阶段 3（2026-10-15）】装载网关归一器已退役：正文真相源＝md，装载走
  // contentType:'markdown' 直装；解析前容错（contentNormalize.normalizeNoteContent）
  // 移至 useNoteEditor 装载边界调用。原「md 纯文本 → HTML 渲染」职能随转型取消。

  api.registerView({ id: 'notebook', label: '笔记本', icon: 'notebook', component: NotebookView })
}

export default { manifest, apply }
