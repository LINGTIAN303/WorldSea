import type { IToolContext } from '@worldsmith/agent-runtime'
import { CliEntityStore } from './stores/cli-entity-store'
import { CliRelationStore } from './stores/cli-relation-store'
import { CliFileStore } from './stores/cli-file-store'
import { CliSettingsStore } from './stores/cli-settings-store'
import { CliUIStore } from './stores/cli-ui-store'
import type { ProviderConfig } from '@worldsmith/agent-runtime'

function formatBlockSummary(block: import('@worldsmith/agent-runtime').MessageBlock): string {
  switch (block.type) {
    case 'table':
      return `[表格: ${block.title || '数据'} (${block.rows.length}行×${block.columns.length}列)]`
    case 'choice': {
      const opts = block.options.map(o => `  - ${o.label}${o.description ? ': ' + o.description : ''}`).join('\n')
      return `[选择: ${block.title || '请选择'}]\n${opts}`
    }
    case 'code':
      return `[代码: ${block.language} (${block.code.split('\n').length}行)]`
    case 'entity-card':
      return `[实体: ${block.name} (${block.entityType})]`
    case 'alert':
      return `[${block.level === 'error' ? '❌' : block.level === 'warning' ? '⚠️' : block.level === 'success' ? '✅' : 'ℹ️'} ${block.title ? block.title + ': ' : ''}${block.message}]`
    case 'stat':
      return `[统计: ${block.title || '概览'} ${block.items.map(i => `${i.label}=${i.value}`).join(', ')}]`
    case 'list':
      return `[列表: ${block.title || '列表'}]\n${block.items.map(i => `  - ${i.icon ? i.icon + ' ' : ''}${i.label}${i.description ? ': ' + i.description : ''}`).join('\n')}`
    case 'progress':
      return `[进度: ${block.label} ${block.progress}% ${block.status}]`
    case 'comparison':
      return `[对比: ${block.left.label} vs ${block.right.label}]`
    case 'timeline':
      return `[时间线: ${block.title || ''}]\n${block.events.map(e => `  ${e.time} - ${e.label}${e.description ? ': ' + e.description : ''}`).join('\n')}`
    case 'image':
      return `[图片${block.caption ? ': ' + block.caption : ''}]`
    case 'accordion':
      return `[折叠区: ${block.title || '详情'} ${block.sections.length}段]`
    default:
      return `[${(block as any).type || '未知'}]`
  }
}

export function createCliToolContext(dataPath: string, providerConfig: ProviderConfig): IToolContext {
  const entityStore = new CliEntityStore(dataPath)
  const relationStore = new CliRelationStore(dataPath)
  const fileStore = new CliFileStore(dataPath)
  const settingsStore = new CliSettingsStore(providerConfig)
  const uiStore = new CliUIStore()

  const entityTypes = [...entityStore.typeCounts.keys()]

  return {
    stores: {
      entity: entityStore,
      relation: relationStore,
      file: fileStore,
      settings: settingsStore,
      ui: uiStore,
    },
    projectInfo: {
      name: 'WorldSmith',
      entityTypes,
      relationTypes: [],
    },
    platform: 'cli' as const,
    appendBlock: (block: import('@worldsmith/agent-runtime/bridge-types').MessageBlock) => {
      const summary = formatBlockSummary(block)
      process.stdout.write('\n' + summary + '\n')
    },
  }
}
